// [REUSE] 점수 계산 — scorepolicy.json 기반
// scorepolicy.json 키 구조: handScores 는 문자열 이름 key("ROYAL_FLUSH" 등)

const path = require('path');
const fs = require('fs');

// 숫자 rank → 문자열 이름 매핑 (handRank.RANK와 일치)
const RANK_NAMES = [
  'HIGH_CARD',
  'ONE_PAIR',
  'TWO_PAIR',
  'THREE_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_KIND',
  'STRAIGHT_FLUSH',
  'ROYAL_FLUSH',
  'ROYAL_FLUSH_PLUS',
];

let _policy = null;

// [REUSE] scorepolicy.json 로드 (최초 1회 캐싱)
function loadPolicy() {
  if (_policy) return _policy;
  // server/engine/scorer.js → ../../scorepolicy.json
  const policyPath = path.join(__dirname, '..', '..', 'scorepolicy.json');
  const raw = fs.readFileSync(policyPath, 'utf8');
  _policy = JSON.parse(raw);
  return _policy;
}

// [REUSE] 족보별 점수 — rank는 문자열 이름 또는 숫자 index 허용
function getHandScore(rank) {
  const policy = loadPolicy();
  const scores = policy.handScores || {};

  if (typeof rank === 'string') {
    return scores[rank] || 0;
  }
  if (typeof rank === 'number' && rank >= 0 && rank < RANK_NAMES.length) {
    return scores[RANK_NAMES[rank]] || 0;
  }
  return 0;
}

// [REUSE] 잔여 카드 페널티 (양수, 차감할 값)
function getPenalty(remainingCards) {
  const policy = loadPolicy();
  const penaltyConfig = policy.penalty;
  if (!penaltyConfig) return 0;

  const freeCards = penaltyConfig.freeCards || 0;
  const perCard = penaltyConfig.perCard || 0;

  const chargeable = Math.max(0, remainingCards - freeCards);
  return chargeable * perCard;
}

// [REUSE] 타임 보너스
function getTimeBonus(seconds) {
  const policy = loadPolicy();
  const bonusConfig = policy.timeBonus;
  if (!bonusConfig || !bonusConfig.enabled) return 0;

  const perSecond = bonusConfig.perSecond || 0;
  return Math.max(0, seconds) * perSecond;
}

// [REUSE] 골드 비용 조회 (mode, action)
function getGoldCost(mode, action) {
  const policy = loadPolicy();
  if (!policy.goldCosts || !policy.goldCosts[mode]) return 0;
  return policy.goldCosts[mode][action] || 0;
}

// [REUSE] 전체 세션 점수 계산
function calculateTotalScore(hands, remainingCards, timeRemaining, options = {}) {
  const { applyTimeBonus = true, applyPenalty = true } = options;

  let handSum = 0;
  for (const h of hands) {
    handSum += getHandScore(h.rank);
  }

  const bonus = applyTimeBonus ? getTimeBonus(timeRemaining) : 0;
  const penalty = applyPenalty ? getPenalty(remainingCards) : 0;

  const rawTotal = handSum + bonus - penalty;
  return {
    total: Math.max(0, rawTotal),
    handSum,
    bonus,
    penalty,
    rawTotal,
  };
}

module.exports = {
  loadPolicy,
  getHandScore,
  getPenalty,
  getTimeBonus,
  getGoldCost,
  calculateTotalScore,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 6개 함수 (loadPolicy, getHandScore, getPenalty, getTimeBonus, getGoldCost, calculateTotalScore)
// ADAPTER : 1개 (loadPolicy — Node fs → Expo bundled asset 또는 require('./scorepolicy.json'))
// REWRITE : 0개
// =============================================
