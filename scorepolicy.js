// =============================================
// [LOGIC] 점수 정책 모듈 — Expo 전환 시 재활용
// =============================================

const ScorePolicy = (() => {
  let policy = null;

  // [REUSE] 기본 점수 정책 — scorepolicy.json과 동기화 (fetch 실패 시 fallback)
  // 갱신 시 scorepolicy.json도 함께 변경. 둘 사이 drift 금지.
  const DEFAULTS = {
    handScores: {
      HIGH_CARD: 0, ONE_PAIR: 1, TWO_PAIR: 5,
      THREE_KIND: 10, STRAIGHT: 15, FLUSH: 20,
      FULL_HOUSE: 30, FOUR_KIND: 50,
      STRAIGHT_FLUSH: 75, ROYAL_FLUSH: 100,
      ROYAL_FLUSH_PLUS: 200
    },
    penalty: { freeCards: 4, perCard: 10 },
    timeBonus: { enabled: true, perSecond: 1 },
    goldCosts: {
      basic:    { restart: 1 },
      hidden:   { restart: 20, shuffle: 100 },
      infinite: { shuffle: 5 },
      puzzle:   { hintLv1: 10, hintLv2: 20, hintLv3: 30 },
      replay:   { save: 50 },
      retry:    { game: 200 }
    }
  };

  // [ADAPTER] 정책 JSON 로드 — Expo 전환 시 bundled require
  async function load() {
    if (policy) return policy;
    try {
      const res = await fetch('./scorepolicy.json');
      if (!res.ok) throw new Error('scorepolicy.json not found');
      policy = await res.json();
      console.log('[ScorePolicy] loaded v' + policy.version);
    } catch (e) {
      console.warn('[ScorePolicy] using defaults:', e.message);
      policy = DEFAULTS;
    }
    return policy;
  }

  // [REUSE] 현재 정책 반환
  function get() {
    return policy || DEFAULTS;
  }

  // [REUSE] 족보별 점수 반환
  function getHandScore(rank) {
    return (policy || DEFAULTS).handScores[rank] ?? 0;
  }

  // [REUSE] 남은 카드 패널티 계산
  function getPenalty(remainingCards) {
    const p = (policy || DEFAULTS).penalty;
    const over = Math.max(0, remainingCards - p.freeCards);
    return over * p.perCard;
  }

  // [REUSE] 시간 보너스 계산
  function getTimeBonus(secondsRemaining) {
    const tb = (policy || DEFAULTS).timeBonus;
    if (!tb.enabled) return 0;
    return secondsRemaining * tb.perSecond;
  }

  // [REUSE] 모드별 골드 비용 반환 — getGoldCost('hidden', 'shuffle') → 100
  function getGoldCost(mode, action) {
    const costs = ((policy || DEFAULTS).goldCosts || {})[mode];
    if (!costs) return 0;
    return costs[action] ?? 0;
  }

  return { load, get, getHandScore, getPenalty, getTimeBonus, getGoldCost };
})();

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 4개 함수 (변경 불필요)
//   - get, getHandScore, getPenalty, getTimeBonus
// ADAPTER : 1개 함수 (내부 구현 교체 필요)
//   - load → bundled require / expo-asset
// REWRITE : 0개
// =============================================
