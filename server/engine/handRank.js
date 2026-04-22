// [REUSE] 족보 판정 및 비교 — 플랫폼 무관, Expo 전환 시 그대로 재활용

const { SUIT_RANK } = require('./deck');

// 족보 rank 상수 (client pvp_utils.js와 동일)
const RANK = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
  ROYAL_FLUSH_PLUS: 10,
};

const RANK_LABELS = {
  0: 'High Card',
  1: 'One Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
  9: 'Royal Flush',
  10: 'Royal Flush+',
};

// [REUSE] 5장 카드로 족보 판정 (RF+ 판정 제외 — 경로 순서가 필요함)
function evaluateHand(cards) {
  if (!cards || cards.length !== 5) {
    return { rank: RANK.HIGH_CARD, label: RANK_LABELS[0], cards: cards || [] };
  }

  const values = cards.map(c => c.value).sort((a, b) => a - b);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  let isStraight = false;
  const unique = [...new Set(values)];
  if (unique.length === 5) {
    if (unique[4] - unique[0] === 4) isStraight = true;
    // A-low: 2,3,4,5,A (14)
    if (unique[0] === 2 && unique[1] === 3 && unique[2] === 4 && unique[3] === 5 && unique[4] === 14) {
      isStraight = true;
    }
  }

  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const cv = Object.values(counts).sort((a, b) => b - a);

  const isRoyal = (values[0] === 10 && values[1] === 11 && values[2] === 12 && values[3] === 13 && values[4] === 14);

  let rank;
  if (isFlush && isStraight) {
    if (isRoyal) rank = RANK.ROYAL_FLUSH;
    else rank = RANK.STRAIGHT_FLUSH;
  } else if (cv[0] === 4) rank = RANK.FOUR_KIND;
  else if (cv[0] === 3 && cv[1] === 2) rank = RANK.FULL_HOUSE;
  else if (isFlush) rank = RANK.FLUSH;
  else if (isStraight) rank = RANK.STRAIGHT;
  else if (cv[0] === 3) rank = RANK.THREE_KIND;
  else if (cv[0] === 2 && cv[1] === 2) rank = RANK.TWO_PAIR;
  else if (cv[0] === 2) rank = RANK.ONE_PAIR;
  else rank = RANK.HIGH_CARD;

  return { rank, label: RANK_LABELS[rank], cards };
}

// [REUSE] 경로 순서까지 고려한 RF+ 판정 (10→J→Q→K→A + 같은 수트)
function isRoyalFlushPlus(orderedCards) {
  if (!orderedCards || orderedCards.length !== 5) return false;
  const expectedValues = [10, 11, 12, 13, 14];
  for (let i = 0; i < 5; i++) {
    if (orderedCards[i].value !== expectedValues[i]) return false;
  }
  const firstSuit = orderedCards[0].suit;
  return orderedCards.every(c => c.suit === firstSuit);
}

// [REUSE] 두 패의 카드 세부 비교 (같은 rank 내 tiebreaker) — server.js 원본 로직
function compareHandsByCards(handA, handB) {
  if (!handA.cards || !handB.cards) {
    const sA = SUIT_RANK[handA.suit] || 0;
    const sB = SUIT_RANK[handB.suit] || 0;
    if (sA > sB) return 1;
    if (sB > sA) return -1;
    return 0;
  }

  const getCompareKeys = (hand) => {
    const cards = hand.cards.slice().sort((a, b) => b.value - a.value);
    const counts = {};
    cards.forEach(c => counts[c.value] = (counts[c.value] || 0) + 1);
    const byCount = Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || parseInt(b[0]) - parseInt(a[0]))
      .map(e => parseInt(e[0]));

    switch (hand.rank) {
      case 1: // ONE_PAIR
        return [byCount[0], ...cards.filter(c => c.value !== byCount[0]).map(c => c.value)];
      case 2: // TWO_PAIR
        return [byCount[0], byCount[1], ...cards.filter(c => c.value !== byCount[0] && c.value !== byCount[1]).map(c => c.value)];
      case 3: // THREE_KIND
        return [byCount[0], ...cards.filter(c => c.value !== byCount[0]).map(c => c.value)];
      case 4: // STRAIGHT
      case 8: // STRAIGHT_FLUSH
        // A-low: [14,5,4,3,2] → high=5
        if (cards[0].value === 14 && cards[1].value === 5) return [5];
        return [cards[0].value];
      case 5: // FLUSH
        return cards.map(c => c.value);
      case 6: // FULL_HOUSE
        return [byCount[0], byCount[1]];
      case 7: // FOUR_KIND
        return [byCount[0], ...cards.filter(c => c.value !== byCount[0]).map(c => c.value)];
      case 9:  // ROYAL_FLUSH
      case 10: // ROYAL_FLUSH_PLUS
        return [];
      default: // HIGH_CARD
        return cards.map(c => c.value);
    }
  };

  const keysA = getCompareKeys(handA);
  const keysB = getCompareKeys(handB);

  for (let i = 0; i < Math.max(keysA.length, keysB.length); i++) {
    const a = keysA[i] || 0;
    const b = keysB[i] || 0;
    if (a > b) return 1;
    if (b > a) return -1;
  }

  // 숫자 모두 같으면 최고 카드 수트 비교
  const topA = handA.cards.slice().sort((a, b) => b.value - a.value);
  const topB = handB.cards.slice().sort((a, b) => b.value - a.value);
  const sA = SUIT_RANK[topA[0].suit] || 0;
  const sB = SUIT_RANK[topB[0].suit] || 0;
  if (sA > sB) return 1;
  if (sB > sA) return -1;
  return 0;
}

// [REUSE] 핸드 정렬 comparator (rank 내림차순 → 같은 rank면 세부 비교)
function handSortComparator(a, b) {
  if (b.rank !== a.rank) return b.rank - a.rank;
  return -compareHandsByCards(a, b);
}

module.exports = {
  RANK,
  RANK_LABELS,
  evaluateHand,
  isRoyalFlushPlus,
  compareHandsByCards,
  handSortComparator,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 4개 함수 + 2개 상수 (evaluateHand, isRoyalFlushPlus, compareHandsByCards, handSortComparator, RANK, RANK_LABELS)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
