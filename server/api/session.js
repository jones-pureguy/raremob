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
      return { applyTimeBonus: true, applyPenalty: true, applyCombo: false };
    case 'infinite':
      return { applyTimeBonus: false, applyPenalty: false, applyCombo: true };
    case 'hidden':
      return { applyTimeBonus: false, applyPenalty: true, applyCombo: false };
    default:
      return { applyTimeBonus: true, applyPenalty: true, applyCombo: false };
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

// [REUSE] Phase 1-7.5-C: 히든 진입 자격 검증
// 체크: basic_session_id 존재 / 본인 소유 / !is_retry / score>=500 / 미사용(UNIQUE)
async function verifyHiddenEntry(userId, basicSessionId) {
  if (!basicSessionId) {
    return { ok: false, reason: 'basic_session_id_missing' };
  }

  const { data: basicSession, error } = await supabase
    .from('game_sessions')
    .select('id, player_id, score, is_retry')
    .eq('id', basicSessionId)
    .single();

  if (error || !basicSession) {
    return { ok: false, reason: 'basic_session_not_found' };
  }

  if (basicSession.player_id !== userId) {
    return { ok: false, reason: 'basic_session_not_owned' };
  }

  if (basicSession.is_retry === true) {
    return { ok: false, reason: 'basic_session_is_retry' };
  }

  if ((basicSession.score || 0) < 500) {
    return { ok: false, reason: 'basic_score_too_low' };
  }

  const { data: existingHidden } = await supabase
    .from('hidden_sessions')
    .select('id')
    .eq('basic_session_id', basicSessionId)
    .maybeSingle();

  if (existingHidden) {
    return { ok: false, reason: 'basic_session_already_used' };
  }

  return { ok: true, basicScore: basicSession.score || 0 };
}

// =============================================
// 엔드포인트 등록
// =============================================
function registerSessionRoutes(app) {
  // ─── POST /api/session/start ───
  app.post('/api/session/start', async (req, res) => {
    try {
      const { userId, mode, basicSessionId } = req.body || {};

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

      // [Phase 1-7.5-C] 히든 진입 자격 검증
      if (mode === 'hidden') {
        const guardResult = await verifyHiddenEntry(userId, basicSessionId);
        if (!guardResult.ok) {
          console.warn(`[hidden-guard] denied user=${String(userId).slice(0, 8)}, reason=${guardResult.reason}, basicSessionId=${String(basicSessionId || '').slice(0, 8)}`);
          return res.status(403).json({
            error: 'HIDDEN_ENTRY_DENIED',
            reason: guardResult.reason,
          });
        }
      }

      const seed = generateSeed();
      const session = createSession({ userId, mode, seed });

      // [Phase 1-7.5-C] 히든 세션에 basic_session_id 연결 (submit 시 저장용)
      if (mode === 'hidden') {
        session.basicSessionId = basicSessionId;
      }

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
        mode: session.mode,
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
        actions,   // [Phase 1-7.5-prep] 클라 replayLog.actions[] = { t, path, hand, score }
        reason,    // [Phase 1-7.5-prep] 'complete' | 'nomoves' | 'gameover'
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

      // [Phase 1-7.5-prep] 신기록 판정 후 조건부 replay INSERT (구조 A 형식)
      const isNewRecord = await upsertLeaderboardR(userId, score, bestHand);

      let replayRow = null;
      if (isNewRecord) {
        const replayDataObj = await buildRetryReplayData({
          userId,
          actions,
          score,
          bestHand,
          timeRemaining,
          grid,
          reason,
        });

        const { data: row, error: replayErr } = await supabase
          .from('game_replays')
          .insert({
            player_id: userId,
            score,
            replay_data: replayDataObj,
          })
          .select()
          .single();

        if (replayErr) {
          console.error('[retry/submit] game_replays insert error:', replayErr);
        } else {
          replayRow = row;
          // [Phase 1-7.5-prep] 신기록 row에 replay_id 연결 (leaderboard와 동일 패턴)
          if (replayRow?.id) {
            await supabase
              .from('leaderboard_r')
              .update({ replay_id: replayRow.id })
              .eq('player_id', userId);
          }
        }
      }

      console.log(`[retry/submit] recorded: user=${String(userId).slice(0, 8)}, score=${score}, hands=${handsCollected}, isNewRecord=${isNewRecord}`);

      return res.json({
        accepted: true,
        sessionRecordId: sessionData?.id,
        replayId: replayRow?.id,
        isNewRecord,
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

  // [Phase 1-7.5-prep] replay_data 정책 변경:
  //   - 신기록일 때만 INSERT (클라 saveReplayToDB와 동일 정책)
  //   - 구조 A (initialDeck + actions) 사용 → replay.html 분기 불필요
  //   - 100골드 명시 저장은 별도 엔드포인트 (Phase 1-11 예정)

  const timeRemaining = gameTime !== null
    ? Math.max(0, gameTime - Math.floor((Date.now() - startedAt) / 1000))
    : 0;

  try {
    if (mode === 'basic') {
      const { data, error } = await supabase
        .from('game_sessions')
        .insert({
          player_id: userId,
          score,
          best_hand: bestHandLabel,
          hands_collected: hands.length,
          time_remaining: timeRemaining,
          completed: true,
          is_retry: false,
        })
        .select()
        .single();

      if (error) return { error };

      // [Phase 1-7.5-prep] 신기록 판정 후 조건부 replay INSERT
      const isNewRecord = await upsertLeaderboard(userId, score, bestHandLabel, null);

      let replayRow = null;
      if (isNewRecord) {
        const replayData = await buildLegacyReplayData({
          userId,
          hands,
          score,
          bestHandLabel,
          timeRemaining,
          seed,
          reason: extraData?.reason,
          gameTime,
          startedAt,
        });

        const { data: row, error: replayErr } = await supabase
          .from('game_replays')
          .insert({
            player_id: userId,
            score,
            replay_data: replayData,
          })
          .select()
          .single();

        if (replayErr) {
          console.warn('[replay insert] warning:', replayErr.message);
        } else {
          replayRow = row;
          // 신기록 row에 replay_id 연결
          if (replayRow?.id) {
            await supabase
              .from('leaderboard')
              .update({ replay_id: replayRow.id })
              .eq('player_id', userId);
          }
        }
      }

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

      await upsertLeaderboardInfinite(userId, score, bestHandLabel);

      return { sessionRecordId: data?.id };
    }

    if (mode === 'hidden') {
      // [Phase 1-7.5-C] basic_session_id로 DB에서 직접 basic_final_score 조회 (위조 방지)
      const basicSessionId = session.basicSessionId || null;
      let verifiedBasicScore = 0;
      if (basicSessionId) {
        const { data: basicData } = await supabase
          .from('game_sessions')
          .select('score')
          .eq('id', basicSessionId)
          .maybeSingle();
        verifiedBasicScore = basicData?.score || 0;
      }

      if (extraData.basic_final_score !== undefined &&
          extraData.basic_final_score !== verifiedBasicScore) {
        console.warn(
          `[hidden-guard] basic_final_score mismatch: claimed=${extraData.basic_final_score}, actual=${verifiedBasicScore}, user=${String(userId).slice(0, 8)}`
        );
      }

      const { data, error } = await supabase
        .from('hidden_sessions')
        .insert({
          player_id: userId,
          basic_session_id: basicSessionId,
          basic_final_score: verifiedBasicScore,
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
      return true; // [Phase 1-7.5-prep] 신기록
    }
    return false; // [Phase 1-7.5-prep] 비신기록
  } catch (err) {
    console.warn('[leaderboard upsert] error:', err.message);
    return false;
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
      return true; // [Phase 1-7.5-prep] 신기록
    }
    return false; // [Phase 1-7.5-prep] 비신기록
  } catch (err) {
    console.warn('[leaderboard_r upsert] error:', err.message);
    return false;
  }
}

async function upsertLeaderboardInfinite(userId, score, bestHand) {
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
        best_hand: bestHand || null,
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

// =============================================
// [REUSE] Phase 1-7.5-prep: replay_data 구조 A 변환 헬퍼 (replay.html 호환)
// 클라가 saveReplayToDB로 넣는 형식과 동일 구조 생성 → replay.html 분기 불필요
// =============================================

// [REUSE] 카드 객체 → 클라식 ID 문자열 (예: {suit:'♠',value:14} → "As", value:10 → "10h")
function cardToId(card) {
  let valueName;
  if (card.value === 14) valueName = 'A';
  else if (card.value === 13) valueName = 'K';
  else if (card.value === 12) valueName = 'Q';
  else if (card.value === 11) valueName = 'J';
  else valueName = String(card.value);

  let suitCode;
  if (card.suit === '♠') suitCode = 's';
  else if (card.suit === '♥') suitCode = 'h';
  else if (card.suit === '♦') suitCode = 'd';
  else suitCode = 'c';

  return valueName + suitCode;
}

// [REUSE] seed → 클라식 1D 문자열 덱 ("As", "10h", ...) — 셔플된 52장 전체
function buildInitialDeckString(seed) {
  const { createDeck, shuffleDeckWithSeed } = require('../engine/deck');
  const shuffled = shuffleDeckWithSeed(createDeck(), seed);
  return shuffled.map(cardToId);
}

// [REUSE] hands → actions[] (구조 A 형식, replay.html 재생 호환)
// dragLog의 timestamp는 ms단위라 정확한 t값 추출이 어려움 → 균등 분포 추정 사용
function buildActionsFromHands(hands, gameTime, startedAt) {
  const { getHandScore } = require('../engine/scorer');
  // t = 패 완성 시점의 남은 시간(초). 정확히 알기 어려우므로 게임 시작 시점부터 균등 분포 가정
  // (재생 시 액션 순서와 점수 누적은 정확하므로 표시용으로만 사용됨)
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const totalElapsed = gameTime !== null ? Math.min(elapsed, gameTime) : elapsed;
  const handCount = hands.length;

  return hands.map((h, i) => {
    // i번째 패는 게임 시작 후 (i+1)/handCount 비율 시점에 완성됐다고 추정
    const elapsedAtHand = handCount > 0 ? Math.floor((totalElapsed * (i + 1)) / handCount) : 0;
    const t = gameTime !== null ? Math.max(0, gameTime - elapsedAtHand) : 0;
    return {
      t,
      hand: rankToLabel(h.rank),
      path: h.pathCells,
      score: getHandScore(h.rank),
    };
  });
}

// [REUSE] hands → 구조 A replay_data 객체 (game_replays.replay_data에 들어갈 JSON)
// userId로 username 조회까지 포함
async function buildLegacyReplayData({
  userId, hands, score, bestHandLabel,
  timeRemaining, seed, reason,
  gameTime, startedAt,
}) {
  const { data: player } = await supabase
    .from('players')
    .select('username')
    .eq('id', userId)
    .single();
  const username = player?.username || 'Unknown';

  return {
    result: {
      reason: reason || 'complete',
      bestHand: bestHandLabel,
      finalScore: score,
      timeRemaining,
      handsCollected: hands.length,
    },
    actions: buildActionsFromHands(hands, gameTime, startedAt),
    version: 1,
    username,
    timestamp: new Date().toISOString(),
    initialDeck: buildInitialDeckString(seed),
  };
}

// [REUSE] RETRY 전용: 클라가 보낸 actions 그대로 사용 (검증 없음)
// 클라 replayLog.actions[] = { t, path, hand, score } 형식 그대로 들어옴
async function buildRetryReplayData({
  userId, actions, score, bestHand,
  timeRemaining, grid, reason,
}) {
  const { data: player } = await supabase
    .from('players')
    .select('username')
    .eq('id', userId)
    .single();
  const username = player?.username || 'Unknown';

  return {
    result: {
      reason: reason || 'complete',
      bestHand: bestHand || null,
      finalScore: score,
      timeRemaining,
      handsCollected: Array.isArray(actions) ? actions.length : 0,
    },
    actions: Array.isArray(actions) ? actions : [],
    version: 1,
    username,
    timestamp: new Date().toISOString(),
    initialDeck: Array.isArray(grid) ? grid : [],
  };
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
