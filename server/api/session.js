// [REUSE] 싱글플레이 세션 API
// - POST /api/session/start        : basic/infinite/hidden 세션 발급
// - POST /api/session/submit       : 검증 후 리더보드 등재
// - POST /api/session/retry/submit : RETRY는 검증 없이 서버 경유만
// - GET  /api/session/debug/count  : 디버그/관측용

const { randomUUID } = require('crypto');
const { generateSeed } = require('../engine/prng');
const { replaySession, buildInitialGrid } = require('../engine/replay');
const supabase = require('../supabase');

// =============================================
// 세션 메모리 저장소 (24시간 자동 만료)
// =============================================
const activeSessions = new Map();

// =============================================
// Rate limit (userId별)
// =============================================
const rateLimits = new Map();

const RATE_LIMIT = {
  perSecond: 5,
  perMinute: 200,
  perHour: 2000,
};

// [REUSE] rate limit 체크
function checkRateLimit(userId) {
  const now = Date.now();
  const record = rateLimits.get(userId) || { timestamps: [] };

  record.timestamps = record.timestamps.filter(ts => now - ts < 3600000);

  const lastHour = record.timestamps.length;
  const lastMinute = record.timestamps.filter(ts => now - ts < 60000).length;
  const lastSecond = record.timestamps.filter(ts => now - ts < 1000).length;

  if (lastSecond >= RATE_LIMIT.perSecond) return { ok: false, reason: 'RATE_LIMIT_SECOND' };
  if (lastMinute >= RATE_LIMIT.perMinute) return { ok: false, reason: 'RATE_LIMIT_MINUTE' };
  if (lastHour >= RATE_LIMIT.perHour) return { ok: false, reason: 'RATE_LIMIT_HOUR' };

  record.timestamps.push(now);
  rateLimits.set(userId, record);
  return { ok: true };
}

// 주기적 rate limit 메모리 정리 (10분마다)
setInterval(() => {
  const now = Date.now();
  for (const [userId, record] of rateLimits) {
    record.timestamps = record.timestamps.filter(ts => now - ts < 3600000);
    if (record.timestamps.length === 0) {
      rateLimits.delete(userId);
    }
  }
}, 600000);

// =============================================
// 모드별 설정
// =============================================
const MODE_CONFIG = {
  basic: {
    gridSize: 7,
    gameTime: 200,
    sessionsTable: 'game_sessions',
  },
  infinite: {
    gridSize: 6,
    gameTime: 600,
    sessionsTable: 'infinite_sessions',
  },
  hidden: {
    gridSize: 7,
    gameTime: null,
    sessionsTable: 'hidden_sessions',
  },
};

// [REUSE] 모드별 스코어링 옵션
function getScoringOptions(mode) {
  switch (mode) {
    case 'basic':
      return { applyTimeBonus: true, applyPenalty: true };
    case 'infinite':
      return { applyTimeBonus: false, applyPenalty: false };
    case 'hidden':
      return { applyTimeBonus: false, applyPenalty: true };
    default:
      return { applyTimeBonus: true, applyPenalty: true };
  }
}

// [REUSE] 세션 생성
function createSession({ userId, mode, seed }) {
  const config = MODE_CONFIG[mode];
  if (!config) throw new Error(`Unknown mode: ${mode}`);

  const sessionId = randomUUID();
  const session = {
    sessionId,
    userId,
    mode,
    seed,
    gridSize: config.gridSize,
    gameTime: config.gameTime,
    startedAt: Date.now(),
    submitted: false,
  };

  activeSessions.set(sessionId, session);

  // 24시간 후 자동 만료
  setTimeout(() => {
    activeSessions.delete(sessionId);
  }, 24 * 60 * 60 * 1000);

  return session;
}

// =============================================
// 엔드포인트 등록
// =============================================
function registerSessionRoutes(app) {
  // ─── POST /api/session/start ───
  app.post('/api/session/start', async (req, res) => {
    try {
      const { userId, mode } = req.body || {};

      if (!userId || !mode) {
        return res.status(400).json({ error: 'MISSING_PARAMS' });
      }
      if (!MODE_CONFIG[mode]) {
        return res.status(400).json({ error: 'INVALID_MODE' });
      }

      const rl = checkRateLimit(userId);
      if (!rl.ok) {
        return res.status(429).json({ error: rl.reason });
      }

      const seed = generateSeed();
      const session = createSession({ userId, mode, seed });

      console.log(`[session] start: user=${String(userId).slice(0, 8)}, mode=${mode}, sessionId=${session.sessionId.slice(0, 8)}, seed=${seed}`);

      return res.json({
        sessionId: session.sessionId,
        seed: session.seed,
        gridSize: session.gridSize,
        gameTime: session.gameTime,
        startedAt: session.startedAt,
      });
    } catch (err) {
      console.error('[session/start] error:', err);
      return res.status(500).json({ error: 'INTERNAL' });
    }
  });

  // ─── POST /api/session/submit — 검증 포함 ───
  app.post('/api/session/submit', async (req, res) => {
    try {
      const {
        sessionId,
        dragLog,
        claimedScore,
        timeRemaining = 0,
        extraData = {},
      } = req.body || {};

      if (!sessionId || !Array.isArray(dragLog) || typeof claimedScore !== 'number') {
        return res.status(400).json({ error: 'MISSING_PARAMS' });
      }

      const session = activeSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
      }
      if (session.submitted) {
        return res.status(409).json({ error: 'ALREADY_SUBMITTED' });
      }

      // 시간 sanity check
      const elapsedMs = Date.now() - session.startedAt;
      if (session.gameTime !== null) {
        const maxMs = (session.gameTime + 30) * 1000;
        if (elapsedMs > maxMs) {
          console.warn(`[session/submit] time exceeded: elapsed=${elapsedMs}ms, max=${maxMs}ms, session=${sessionId.slice(0, 8)}`);
        }
      }

      // 리플레이 재생 + 검증
      const replayResult = replaySession({
        seed: session.seed,
        gridSize: session.gridSize,
        dragLog,
        constraints: {},
        timeRemaining,
        scoringOptions: getScoringOptions(session.mode),
      });

      if (!replayResult.valid) {
        console.warn(`[session/submit] replay invalid: ${replayResult.reason}, session=${sessionId.slice(0, 8)}`);
        return res.status(400).json({
          accepted: false,
          reason: replayResult.reason,
          step: replayResult.step,
        });
      }

      if (replayResult.score !== claimedScore) {
        console.warn(`[session/submit] score mismatch: claimed=${claimedScore}, calculated=${replayResult.score}, session=${sessionId.slice(0, 8)}`);
        return res.status(400).json({
          accepted: false,
          reason: 'SCORE_MISMATCH',
          expected: replayResult.score,
          claimed: claimedScore,
        });
      }

      // 0점 세션은 DB 저장 skip (무의미한 플레이 방어)
      if (replayResult.score <= 0) {
        session.submitted = true;
        console.log(`[session/submit] accepted but skipping DB (score=0): user=${String(session.userId).slice(0, 8)}, mode=${session.mode}`);
        return res.json({
          accepted: true,
          score: 0,
          breakdown: replayResult.breakdown,
          sessionRecordId: null,
          replayId: null,
          skipped: true,
        });
      }

      // DB 저장
      const dbResult = await saveSessionToDb(session, replayResult, extraData, dragLog);
      if (dbResult.error) {
        console.error(`[session/submit] db error:`, dbResult.error);
        return res.status(500).json({ error: 'DB_ERROR', detail: dbResult.error });
      }

      // DB 성공 후 중복 제출 방지 플래그 — 실패 시 클라 재시도 가능
      session.submitted = true;

      console.log(`[session/submit] accepted: user=${String(session.userId).slice(0, 8)}, mode=${session.mode}, score=${replayResult.score}, hands=${replayResult.hands.length}`);

      return res.json({
        accepted: true,
        score: replayResult.score,
        breakdown: replayResult.breakdown,
        sessionRecordId: dbResult.sessionRecordId,
        replayId: dbResult.replayId,
      });
    } catch (err) {
      console.error('[session/submit] error:', err);
      return res.status(500).json({ error: 'INTERNAL', detail: err.message });
    }
  });

  // ─── POST /api/session/retry/submit — 검증 없이 서버 경유만 ───
  app.post('/api/session/retry/submit', async (req, res) => {
    try {
      const {
        userId,
        parentSessionId,
        grid,
        moves,
        score,
        handsCollected,
        timeRemaining = 0,
        bestHand,
      } = req.body || {};

      if (!userId || !Array.isArray(grid) || !Array.isArray(moves) || typeof score !== 'number') {
        return res.status(400).json({ error: 'MISSING_PARAMS' });
      }

      const rl = checkRateLimit(userId);
      if (!rl.ok) {
        return res.status(429).json({ error: rl.reason });
      }

      // 검증 스킵 — score, bestHand 그대로 신뢰
      const { data: sessionData, error: sessErr } = await supabase
        .from('game_sessions')
        .insert({
          player_id: userId,
          score,
          best_hand: bestHand || null,
          hands_collected: handsCollected || 0,
          time_remaining: timeRemaining,
          completed: true,
          is_retry: true,
        })
        .select()
        .single();

      if (sessErr) {
        console.error('[retry/submit] game_sessions insert error:', sessErr);
        return res.status(500).json({ error: 'DB_ERROR', detail: sessErr.message });
      }

      const { data: replayData, error: replayErr } = await supabase
        .from('game_replays')
        .insert({
          player_id: userId,
          score,
          replay_data: {
            grid,
            moves,
            finalScore: score,
            isRetry: true,
            parentSessionId: parentSessionId || null,
          },
        })
        .select()
        .single();

      if (replayErr) {
        console.error('[retry/submit] game_replays insert error:', replayErr);
      }

      await upsertLeaderboardR(userId, score, bestHand);

      console.log(`[retry/submit] recorded: user=${String(userId).slice(0, 8)}, score=${score}, hands=${handsCollected}`);

      return res.json({
        accepted: true,
        sessionRecordId: sessionData?.id,
        replayId: replayData?.id,
      });
    } catch (err) {
      console.error('[retry/submit] error:', err);
      return res.status(500).json({ error: 'INTERNAL', detail: err.message });
    }
  });

  // ─── GET /api/session/debug/count ───
  app.get('/api/session/debug/count', (req, res) => {
    res.json({
      activeSessions: activeSessions.size,
      rateLimits: rateLimits.size,
    });
  });
}

// =============================================
// DB 저장 — 모드별 테이블 분기
// =============================================
async function saveSessionToDb(session, replayResult, extraData, dragLog) {
  const { userId, mode, seed, gridSize, gameTime, startedAt } = session;
  const { score, hands, remainingCards } = replayResult;

  let bestRank = 0;
  for (const h of hands) {
    if (h.rank > bestRank) bestRank = h.rank;
  }
  const bestHandLabel = rankToLabel(bestRank);

  // replay_data 는 기존 형식 유지 (replay.html 호환)
  const initialGrid = buildInitialGrid(seed, gridSize);
  const replayData = {
    grid: initialGrid,
    moves: dragLog.map(d => d.cards),
    finalScore: score,
    seed,
    mode,
  };

  try {
    if (mode === 'basic') {
      const { data, error } = await supabase
        .from('game_sessions')
        .insert({
          player_id: userId,
          score,
          best_hand: bestHandLabel,
          hands_collected: hands.length,
          time_remaining: gameTime !== null
            ? Math.max(0, gameTime - Math.floor((Date.now() - startedAt) / 1000))
            : 0,
          completed: true,
          is_retry: false,
        })
        .select()
        .single();

      if (error) return { error };

      const { data: replayRow, error: replayErr } = await supabase
        .from('game_replays')
        .insert({
          player_id: userId,
          score,
          replay_data: replayData,
        })
        .select()
        .single();

      if (replayErr) console.warn('[replay insert] warning:', replayErr.message);

      await upsertLeaderboard(userId, score, bestHandLabel, replayRow?.id);

      return { sessionRecordId: data?.id, replayId: replayRow?.id };
    }

    if (mode === 'infinite') {
      const { data, error } = await supabase
        .from('infinite_sessions')
        .insert({
          player_id: userId,
          score,
          best_hand: bestHandLabel,
          hands_collected: hands.length,
          shuffle_count: extraData.shuffle_count || 0,
          time_remaining: gameTime !== null
            ? Math.max(0, gameTime - Math.floor((Date.now() - startedAt) / 1000))
            : 0,
        })
        .select()
        .single();

      if (error) return { error };

      await upsertLeaderboardInfinite(userId, score);

      return { sessionRecordId: data?.id };
    }

    if (mode === 'hidden') {
      const { data, error } = await supabase
        .from('hidden_sessions')
        .insert({
          player_id: userId,
          basic_final_score: extraData.basic_final_score || 0,
          hidden_score: score,
          best_hand: bestHandLabel,
          reset_count: extraData.reset_count || 0,
          shuffle_count: extraData.shuffle_count || 0,
        })
        .select()
        .single();

      if (error) return { error };

      await upsertLeaderboardHidden(userId, score, bestHandLabel);

      return { sessionRecordId: data?.id };
    }

    return { error: 'UNKNOWN_MODE' };
  } catch (err) {
    return { error: err.message };
  }
}

// =============================================
// 리더보드 UPSERT 헬퍼 (기존 호환)
// =============================================
async function upsertLeaderboard(userId, score, bestHand, replayId) {
  try {
    const { data: player } = await supabase
      .from('players')
      .select('username')
      .eq('id', userId)
      .single();

    const username = player?.username || 'Unknown';

    const { data: existing } = await supabase
      .from('leaderboard')
      .select('score')
      .eq('player_id', userId)
      .maybeSingle();

    if (!existing || existing.score < score) {
      await supabase.from('leaderboard').upsert({
        player_id: userId,
        username,
        score,
        best_hand: bestHand,
        replay_id: replayId,
      }, { onConflict: 'player_id' });
    }
  } catch (err) {
    console.warn('[leaderboard upsert] error:', err.message);
  }
}

async function upsertLeaderboardR(userId, score, bestHand) {
  try {
    const { data: player } = await supabase
      .from('players')
      .select('username')
      .eq('id', userId)
      .single();

    const username = player?.username || 'Unknown';

    const { data: existing } = await supabase
      .from('leaderboard_r')
      .select('score')
      .eq('player_id', userId)
      .maybeSingle();

    if (!existing || existing.score < score) {
      await supabase.from('leaderboard_r').upsert({
        player_id: userId,
        username,
        score,
        best_hand: bestHand,
      }, { onConflict: 'player_id' });
    }
  } catch (err) {
    console.warn('[leaderboard_r upsert] error:', err.message);
  }
}

async function upsertLeaderboardInfinite(userId, score) {
  try {
    const { data: player } = await supabase
      .from('players')
      .select('username')
      .eq('id', userId)
      .single();

    const username = player?.username || 'Unknown';

    const { data: existing } = await supabase
      .from('leaderboard_infinite')
      .select('score')
      .eq('player_id', userId)
      .maybeSingle();

    if (!existing || existing.score < score) {
      await supabase.from('leaderboard_infinite').upsert({
        player_id: userId,
        username,
        score,
      }, { onConflict: 'player_id' });
    }
  } catch (err) {
    console.warn('[leaderboard_infinite upsert] error:', err.message);
  }
}

async function upsertLeaderboardHidden(userId, score, bestHand) {
  try {
    const { data: player } = await supabase
      .from('players')
      .select('username')
      .eq('id', userId)
      .single();

    const username = player?.username || 'Unknown';

    const { data: existing } = await supabase
      .from('leaderboard_hidden')
      .select('score')
      .eq('player_id', userId)
      .maybeSingle();

    if (!existing || existing.score < score) {
      await supabase.from('leaderboard_hidden').upsert({
        player_id: userId,
        username,
        score,
        best_hand: bestHand,
      }, { onConflict: 'player_id' });
    }
  } catch (err) {
    console.warn('[leaderboard_hidden upsert] error:', err.message);
  }
}

// =============================================
// 헬퍼
// =============================================
function rankToLabel(rank) {
  const labels = [
    'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
    'Straight', 'Flush', 'Full House', 'Four of a Kind',
    'Straight Flush', 'Royal Flush', 'Royal Flush Plus',
  ];
  return labels[rank] || 'Unknown';
}

module.exports = {
  registerSessionRoutes,
  activeSessions,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 엔진 호출부 / rate limit / 세션 관리 로직
// ADAPTER : Supabase 클라이언트 (서버 전용, Expo 앱에선 불필요)
// REWRITE : 0개 (서버 사이드 API)
// =============================================
