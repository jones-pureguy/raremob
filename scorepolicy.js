const ScorePolicy = (() => {
  let policy = null;

  const DEFAULTS = {
    handScores: {
      HIGH_CARD: 0, ONE_PAIR: 1, TWO_PAIR: 2,
      THREE_KIND: 5, STRAIGHT: 10, FLUSH: 15,
      FULL_HOUSE: 20, FOUR_KIND: 50,
      STRAIGHT_FLUSH: 75, ROYAL_FLUSH: 100,
      ROYAL_FLUSH_PLUS: 250
    },
    penalty: { freeCards: 4, perCard: 10 },
    timeBonus: { enabled: true, perSecond: 1 }
  };

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

  function get() {
    return policy || DEFAULTS;
  }

  function getHandScore(rank) {
    return (policy || DEFAULTS).handScores[rank] ?? 0;
  }

  function getPenalty(remainingCards) {
    const p = (policy || DEFAULTS).penalty;
    const over = Math.max(0, remainingCards - p.freeCards);
    return over * p.perCard;
  }

  function getTimeBonus(secondsRemaining) {
    const tb = (policy || DEFAULTS).timeBonus;
    if (!tb.enabled) return 0;
    return secondsRemaining * tb.perSecond;
  }

  return { load, get, getHandScore, getPenalty, getTimeBonus };
})();
