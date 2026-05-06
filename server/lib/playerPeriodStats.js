// =============================================
// [REUSE] player_period_stats UPSERT 모듈
// submit 검증 통과 후 호출
// 시간대 정책: TIMEZONE_POLICY.md (UTC 기준)
// =============================================

const { getPeriodKeys } = require('./periodKeys');

/**
 * 단일 게임 결과를 player_period_stats에 반영
 *
 * Phase 1-11.3:
 * - 신기록 판정 (all_time best_score 기준) → isNewRecord 반환
 * - replayId 인자 (optional): 신기록 + replayId 있을 때만 all_time row에 연결
 *   (일반 호출자는 이 인자 없이 호출하고, 나중에 replay INSERT 후 직접 UPDATE)
 *
 * @param {object} supabaseAdmin - service_role 클라이언트
 * @param {object} params
 * @param {string} params.playerId
 * @param {string} params.board     - 'basic' | 'maniac' | 'infinite' | 'hidden'
 * @param {number} params.score     - 이번 게임 점수
 * @param {Date}   [params.playedAt=new Date()] - 게임 종료 시각 (서버 시각 = UTC)
 * @param {string} [params.replayId] - (optional) 신기록 시 all_time row에 연결할 game_replays.id
 *
 * @returns {Promise<{ ok: boolean, upserted: number, errors: array, isNewRecord: boolean }>}
 */
async function upsertPlayerPeriodStats(supabaseAdmin, { playerId, board, score, playedAt, replayId }) {
  const date = playedAt || new Date();
  const periods = getPeriodKeys(board, date);

  const errors = [];
  let upserted = 0;

  // [Phase 1-11.3] 신기록 판정: UPSERT 전에 all_time best 조회
  let isNewRecord = false;
  try {
    const { data: current } = await supabaseAdmin
      .from('player_period_stats')
      .select('best_score')
      .eq('player_id', playerId)
      .eq('board', board)
      .eq('period_type', 'all_time')
      .maybeSingle();
    isNewRecord = !current || score > (current.best_score || 0);
  } catch (e) {
    console.warn('[upsertPPS] isNewRecord check failed:', e.message);
    isNewRecord = false; // 안전: 비신기록 간주 → 리플레이 저장 스킵
  }

  // 기존 UPSERT 루프
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

  // [Phase 1-11.3] 신기록 + replayId 있으면 all_time row에 replay_id 연결
  // (일반 플로우: 호출자가 game_replays INSERT 후 직접 UPDATE. 이 분기는 replayId를
  //  미리 알고 있는 드문 케이스용.)
  if (isNewRecord && replayId) {
    try {
      const { error: linkErr } = await supabaseAdmin
        .from('player_period_stats')
        .update({ replay_id: replayId })
        .eq('player_id', playerId)
        .eq('board', board)
        .eq('period_type', 'all_time');
      if (linkErr) {
        console.warn('[upsertPPS] replay_id link failed:', linkErr.message);
      }
    } catch (e) {
      console.warn('[upsertPPS] replay_id link exception:', e.message);
    }
  }

  return {
    ok: errors.length === 0,
    upserted,
    errors,
    isNewRecord,
  };
}

module.exports = { upsertPlayerPeriodStats };

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 0개 (서버 전용)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
