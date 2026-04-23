// =============================================
// [REUSE] player_period_stats UPSERT 모듈
// submit 검증 통과 후 호출
// 시간대 정책: TIMEZONE_POLICY.md (UTC 기준)
// =============================================

const { getPeriodKeys } = require('./periodKeys');

/**
 * 단일 게임 결과를 player_period_stats에 반영
 *
 * @param {object} supabaseAdmin - service_role 클라이언트
 * @param {object} params
 * @param {string} params.playerId
 * @param {string} params.board     - 'basic' | 'basic_retry' | 'infinite' | 'hidden'
 * @param {number} params.score     - 이번 게임 점수
 * @param {Date}   [params.playedAt=new Date()] - 게임 종료 시각 (서버 시각 = UTC)
 *
 * @returns {Promise<{ ok: boolean, upserted: number, errors: array }>}
 */
async function upsertPlayerPeriodStats(supabaseAdmin, { playerId, board, score, playedAt }) {
  // 서버 시각 (UTC) 사용 — 클라가 보낸 timestamp는 신뢰하지 않음
  const date = playedAt || new Date();
  const periods = getPeriodKeys(board, date);

  const errors = [];
  let upserted = 0;

  // Supabase의 .upsert()는 ON CONFLICT DO UPDATE에서 GREATEST 같은 표현식을 못 써서 RPC 사용
  for (const { period_type, period_key } of periods) {
    try {
      const { error } = await supabaseAdmin.rpc('upsert_player_period_stat', {
        p_player_id:   playerId,
        p_board:       board,
        p_period_type: period_type,
        p_period_key:  period_key,
        p_score:       score,
      });
      if (error) {
        errors.push({ period_type, period_key, error: error.message });
      } else {
        upserted++;
      }
    } catch (e) {
      errors.push({ period_type, period_key, error: e.message });
    }
  }

  return {
    ok: errors.length === 0,
    upserted,
    errors,
  };
}

module.exports = { upsertPlayerPeriodStats };

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 0개 (서버 전용)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
