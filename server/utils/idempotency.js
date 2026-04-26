// server/utils/idempotency.js — Phase 2A-new
// 매치 ID 기반 deterministic idempotency_key 생성

const { v5: uuidv5 } = require('uuid');

// Phase 2A-new에서 한 번 생성한 NAMESPACE UUID (영구 고정)
const NAMESPACE_PVP_MATCH = 'fbadd820-ac5e-4a48-9e7b-74244a158890';

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

module.exports = { pvpMatchKey };
