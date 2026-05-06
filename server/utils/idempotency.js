// server/utils/idempotency.js — Phase 2A-new
// 매치 ID 기반 deterministic idempotency_key 생성

const { v5: uuidv5 } = require('uuid');

// Phase 2A-new에서 한 번 생성한 NAMESPACE UUID (영구 고정)
const NAMESPACE_PVP_MATCH = 'fbadd820-ac5e-4a48-9e7b-74244a158890';

// RE-TRY (same-seed replay) 차감용 NAMESPACE — 영구 고정
const NAMESPACE_RETRY = '8710b7ec-a03c-4055-aa8f-18996266b490';

/**
 * PvP 매치 정산용 idempotency_key 생성
 * 같은 (roomId, role) 조합이면 항상 같은 UUID 반환
 *
 * @param {string} roomId - 매치 room ID
 * @param {string} role - 'win' | 'lose'
 * @returns {string} UUID
 */
function pvpMatchKey(roomId, role) {
  return uuidv5(`${roomId}:${role}`, NAMESPACE_PVP_MATCH);
}

/**
 * RE-TRY 차감용 idempotency_key 생성
 * 같은 sourceSessionId면 항상 같은 UUID 반환 — 같은 source로 두 번 호출 시 RPC가
 * duplicated:true 반환하고 두 번째 차감 차단 (의도된 동작)
 *
 * @param {string} sourceSessionId - 원본 세션 UUID
 * @returns {string} UUID
 */
function retryKey(sourceSessionId) {
  return uuidv5(`${sourceSessionId}:same_seed_replay`, NAMESPACE_RETRY);
}

module.exports = { pvpMatchKey, retryKey };
