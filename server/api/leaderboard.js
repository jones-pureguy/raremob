// =============================================
// [REWRITE] 리더보드 조회 API (Phase 1-10)
// 정책: PHASE_1_10_DECISIONS.md 이슈 ⑪~⑯
// 시간대: UTC (TIMEZONE_POLICY.md)
// 등록 방식: 기존 session.js 패턴 (registerLeaderboardRoutes(app))
// =============================================

const supabase = require('../supabase');
const {
  getDailyKey,
  getWeeklyKey,
  getMonthlyKey,
  getAllTimeKey,
} = require('../lib/periodKeys');

const BOARDS = ['basic', 'basic_retry', 'infinite', 'hidden'];
const PERIODS = ['all_time', 'daily', 'weekly', 'monthly'];

/**
 * board별 지원 period 목록
 * - basic_retry는 all_time만 (이슈 ②)
 */
function getSupportedPeriods(board) {
  if (board === 'basic_retry') return ['all_time'];
  return PERIODS;
}

/**
 * username 결측 시 'Anonymous' 폴백 (이슈 ⑭)
 */
function displayName(player) {
  const name = player && player.username && String(player.username).trim();
  return name || 'Anonymous';
}

/**
 * 현재 period_key 4종 (UTC)
 */
function getCurrentKeys(now = new Date()) {
  return {
    all_time: getAllTimeKey(),
    daily:    getDailyKey(now),
    weekly:   getWeeklyKey(now),
    monthly:  getMonthlyKey(now),
  };
}

/**
 * 점수가 분포의 몇 percentile에 속하는지 추정
 * 분포는 컷오프 형태 (p01 = 상위 1% 컷오프)
 * 점수가 p01 이상이면 상위 1%, p05 이상이면 상위 5%, ...
 */
function estimatePercentile(score, stats, prefix) {
  const cutoffs = [
    { p: 1,  v: stats[`${prefix}_at_p01`] },
    { p: 5,  v: stats[`${prefix}_at_p05`] },
    { p: 10, v: stats[`${prefix}_at_p10`] },
    { p: 25, v: stats[`${prefix}_at_p25`] },
    { p: 50, v: stats[`${prefix}_at_p50`] },
  ];

  for (const { p, v } of cutoffs) {
    if (v !== null && v !== undefined && Number(score) >= Number(v)) return p;
  }
  return null;
}

// =============================================
// /top 캐시 (in-memory, TTL 1분) — 이슈 ⑮
// =============================================

const TOP_CACHE = new Map();
const TOP_CACHE_TTL_MS = 60 * 1000;

function getCacheKey(board, period, periodKey, sort, offset, limit) {
  return `top:${board}:${period}:${periodKey}:${sort}:${offset}:${limit}`;
}

function getCached(key) {
  const entry = TOP_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TOP_CACHE_TTL_MS) {
    TOP_CACHE.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  TOP_CACHE.set(key, { timestamp: Date.now(), data });
}

// 주기 메모리 정리 (10분마다)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of TOP_CACHE) {
    if (now - v.timestamp > TOP_CACHE_TTL_MS) TOP_CACHE.delete(k);
  }
}, 10 * 60 * 1000);

// =============================================
// 엔드포인트 등록
// =============================================
function registerLeaderboardRoutes(app) {
  // ─── GET /api/leaderboard/me ───
  app.get('/api/leaderboard/me', async (req, res) => {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({
        error: 'MISSING_USER_ID',
        message: 'userId query parameter is required',
      });
    }

    try {
      const currentKeys = getCurrentKeys();

      // 응답 객체 초기화 (board별 지원 period만 키로 가짐)
      const response = {};
      for (const board of BOARDS) {
        response[board] = {};
        for (const period of getSupportedPeriods(board)) {
          response[board][period] = null;
        }
      }

      // 본인 데이터 일괄 조회
      const { data: myStats, error: myErr } = await supabase
        .from('player_period_stats')
        .select('board, period_type, period_key, best_score, sum_score, game_count')
        .eq('player_id', userId);

      if (myErr) {
        console.error('[/me] player_period_stats query error:', myErr);
        return res.status(500).json({ error: 'DB_ERROR', message: myErr.message });
      }

      // 현재 period_key에 해당하는 row만 응답에 채움
      for (const row of myStats || []) {
        const expectedKey = currentKeys[row.period_type];
        if (!expectedKey || row.period_key !== expectedKey) continue;
        if (!response[row.board] || !(row.period_type in response[row.board])) continue;

        response[row.board][row.period_type] = {
          score: row.best_score,
          sum: Number(row.sum_score),
          game_count: row.game_count,
          rank: null,
          exact: false,
          percentile_best: null,
          percentile_sum: null,
          percentile_avg: null,
        };
      }

      // rank + percentile 계산
      for (const board of BOARDS) {
        for (const period of getSupportedPeriods(board)) {
          const entry = response[board][period];
          if (!entry) continue;

          const periodKey = currentKeys[period];

          // total_count
          const { count: totalCount, error: cntErr } = await supabase
            .from('player_period_stats')
            .select('*', { count: 'exact', head: true })
            .eq('board', board)
            .eq('period_type', period)
            .eq('period_key', periodKey);

          if (cntErr) {
            console.error(`[/me] count query error for ${board}/${period}:`, cntErr);
            continue;
          }

          // 본인보다 best_score 높은 사람 수
          const { count: higherCount, error: rnkErr } = await supabase
            .from('player_period_stats')
            .select('*', { count: 'exact', head: true })
            .eq('board', board)
            .eq('period_type', period)
            .eq('period_key', periodKey)
            .gt('best_score', entry.score);

          if (rnkErr) {
            console.error(`[/me] rank query error for ${board}/${period}:`, rnkErr);
            continue;
          }

          const myRank = (higherCount || 0) + 1;

          if ((totalCount || 0) < 100 || myRank <= 100) {
            // 정확 등수
            entry.rank = myRank;
            entry.exact = true;
          } else {
            // percentile 추정
            entry.rank = null;
            entry.exact = false;

            const { data: stats, error: statsErr } = await supabase
              .from('leaderboard_stats')
              .select('best_at_p01, best_at_p05, best_at_p10, best_at_p25, best_at_p50, ' +
                      'sum_at_p01, sum_at_p05, sum_at_p10, sum_at_p25, sum_at_p50, ' +
                      'avg_at_p01, avg_at_p05, avg_at_p10, avg_at_p25, avg_at_p50')
              .eq('board', board)
              .eq('period_type', period)
              .eq('period_key', periodKey)
              .maybeSingle();

            if (statsErr) {
              console.warn(`[/me] leaderboard_stats error for ${board}/${period}/${periodKey}:`, statsErr.message);
              continue;
            }
            if (!stats) continue;

            const myAvg = entry.game_count > 0 ? entry.sum / entry.game_count : 0;

            entry.percentile_best = estimatePercentile(entry.score, stats, 'best');
            entry.percentile_sum  = estimatePercentile(entry.sum,   stats, 'sum');
            entry.percentile_avg  = estimatePercentile(myAvg,       stats, 'avg');
          }
        }
      }

      return res.json(response);
    } catch (e) {
      console.error('[/me] unexpected error:', e);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e.message });
    }
  });

  // ─── GET /api/leaderboard/top ───
  app.get('/api/leaderboard/top', async (req, res) => {
    const board  = req.query.board;
    const period = req.query.period;
    const sort   = req.query.sort   || 'best';
    const offset = parseInt(req.query.offset, 10) || 0;
    const limit  = parseInt(req.query.limit, 10)  || 20;

    // === 입력 검증 ===
    if (!BOARDS.includes(board)) {
      return res.status(400).json({ error: 'INVALID_BOARD', message: `Unknown board: ${board}` });
    }
    if (!PERIODS.includes(period)) {
      return res.status(400).json({ error: 'INVALID_PERIOD', message: `Unknown period: ${period}` });
    }
    if (board === 'basic_retry' && period !== 'all_time') {
      return res.status(400).json({ error: 'RETRY_PERIOD_INVALID', message: 'RETRY supports all_time only' });
    }
    if (!['best', 'sum', 'avg'].includes(sort)) {
      return res.status(400).json({ error: 'INVALID_SORT', message: `sort must be best/sum/avg, got: ${sort}` });
    }
    if (offset < 0 || limit < 1 || limit > 100 || offset + limit > 100) {
      return res.status(400).json({ error: 'OFFSET_OUT_OF_RANGE', message: 'offset + limit must be ≤ 100, limit ≤ 100' });
    }

    try {
      const now = new Date();
      const periodKey = period === 'all_time' ? getAllTimeKey()
                      : period === 'daily'    ? getDailyKey(now)
                      : period === 'weekly'   ? getWeeklyKey(now)
                      :                         getMonthlyKey(now);

      const cacheKey = getCacheKey(board, period, periodKey, sort, offset, limit);
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);

      // === total_count ===
      const { count: totalCount, error: cntErr } = await supabase
        .from('player_period_stats')
        .select('*', { count: 'exact', head: true })
        .eq('board', board)
        .eq('period_type', period)
        .eq('period_key', periodKey);

      if (cntErr) {
        console.error('[/top] count error:', cntErr);
        return res.status(500).json({ error: 'DB_ERROR', message: cntErr.message });
      }

      // === Top N 조회 ===
      let query = supabase
        .from('player_period_stats')
        .select('player_id, best_score, sum_score, game_count, updated_at')
        .eq('board', board)
        .eq('period_type', period)
        .eq('period_key', periodKey);

      if (sort === 'best') {
        query = query.order('best_score', { ascending: false })
                     .order('updated_at', { ascending: true });
      } else if (sort === 'sum') {
        query = query.order('sum_score', { ascending: false })
                     .order('updated_at', { ascending: true });
      } else {
        // avg: game_count>0 row만, 메모리 정렬
        query = query.gt('game_count', 0);
      }

      let rows;
      let rowErr;
      if (sort === 'avg') {
        const r = await query;
        rows = r.data;
        rowErr = r.error;
      } else {
        const r = await query.range(offset, offset + limit - 1);
        rows = r.data;
        rowErr = r.error;
      }

      if (rowErr) {
        console.error('[/top] rows error:', rowErr);
        return res.status(500).json({ error: 'DB_ERROR', message: rowErr.message });
      }

      if (sort === 'avg') {
        rows = (rows || [])
          .map(r => ({ ...r, _avg: Number(r.sum_score) / r.game_count }))
          .sort((a, b) => b._avg - a._avg)
          .slice(offset, offset + limit);
      }

      // === username 일괄 조회 ===
      const playerIds = (rows || []).map(r => r.player_id);
      let players = [];
      if (playerIds.length > 0) {
        const { data, error: pErr } = await supabase
          .from('players')
          .select('id, username')
          .in('id', playerIds);
        if (pErr) {
          console.error('[/top] players error:', pErr);
          // username 못 가져와도 응답은 'Anonymous' 폴백으로 계속
        }
        players = data || [];
      }
      const playerMap = new Map(players.map(p => [p.id, p]));

      // === 응답 조립 ===
      const responseRows = (rows || []).map((row, idx) => {
        const player = playerMap.get(row.player_id);
        const avg = row.game_count > 0 ? Math.round(Number(row.sum_score) / row.game_count) : 0;
        const score = sort === 'best' ? row.best_score
                    : sort === 'sum'  ? Number(row.sum_score)
                    :                   avg;

        return {
          rank: offset + idx + 1,
          player_id: row.player_id,
          username: displayName(player),
          score,
          best_score: row.best_score,
          sum_score: Number(row.sum_score),
          game_count: row.game_count,
          avg_score: avg,
          updated_at: row.updated_at,
        };
      });

      const response = {
        board,
        period,
        period_key: periodKey,
        sort,
        total_count: totalCount || 0,
        offset,
        limit,
        rows: responseRows,
      };

      setCached(cacheKey, response);
      return res.json(response);
    } catch (e) {
      console.error('[/top] unexpected error:', e);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e.message });
    }
  });
}

module.exports = { registerLeaderboardRoutes };

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 0개 (서버 전용 API)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
