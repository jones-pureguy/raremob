// =============================================
// [REUSE] PvP 유틸리티 — 순수 함수, DOM 의존성 없음
// Expo 전환 시: 그대로 재활용
// =============================================

// [REUSE] 수트 우선순위: 스페이드 > 다이아 > 하트 > 클로버
const SUIT_RANK = {
  '♠': 4,
  '♦': 3,
  '♥': 2,
  '♣': 1
};

// [REUSE] 두 패를 비교하여 승패 판정
// handA, handB: evaluateHand() 반환값
// return: 1 (A 승), -1 (B 승), 0 (무승부)
function compareHands(handA, handB) {
  // 1. rank 비교
  if (handA.rank !== handB.rank) {
    return handA.rank > handB.rank ? 1 : -1;
  }

  const rank = handA.rank;

  // 2. 같은 rank — 족보별 세부 비교
  switch (rank) {
    case RANK.ROYAL_FLUSH_PLUS:
    case RANK.ROYAL_FLUSH:
      return _compareSuits(handA, handB);

    case RANK.STRAIGHT_FLUSH: {
      const cmp = _compareHighCard(handA, handB);
      if (cmp !== 0) return cmp;
      return _compareSuits(handA, handB);
    }

    case RANK.FOUR_KIND: {
      if (handA.primaryVal !== handB.primaryVal) {
        return handA.primaryVal > handB.primaryVal ? 1 : -1;
      }
      return _compareArrays(handA.kickers, handB.kickers);
    }

    case RANK.FULL_HOUSE: {
      if (handA.primaryVal !== handB.primaryVal) {
        return handA.primaryVal > handB.primaryVal ? 1 : -1;
      }
      if (handA.secondaryVal !== handB.secondaryVal) {
        return handA.secondaryVal > handB.secondaryVal ? 1 : -1;
      }
      return 0;
    }

    case RANK.FLUSH: {
      const cmp = _compareArrays(handA.values, handB.values);
      if (cmp !== 0) return cmp;
      return _compareSuits(handA, handB);
    }

    case RANK.STRAIGHT: {
      return _compareHighCard(handA, handB);
    }

    case RANK.THREE_KIND: {
      if (handA.primaryVal !== handB.primaryVal) {
        return handA.primaryVal > handB.primaryVal ? 1 : -1;
      }
      return _compareArrays(handA.kickers, handB.kickers);
    }

    case RANK.TWO_PAIR: {
      if (handA.primaryVal !== handB.primaryVal) {
        return handA.primaryVal > handB.primaryVal ? 1 : -1;
      }
      if (handA.secondaryVal !== handB.secondaryVal) {
        return handA.secondaryVal > handB.secondaryVal ? 1 : -1;
      }
      return _compareArrays(handA.kickers, handB.kickers);
    }

    case RANK.ONE_PAIR: {
      if (handA.primaryVal !== handB.primaryVal) {
        return handA.primaryVal > handB.primaryVal ? 1 : -1;
      }
      return _compareArrays(handA.kickers, handB.kickers);
    }

    case RANK.HIGH_CARD:
      return _compareArrays(handA.values, handB.values);

    default:
      return 0;
  }
}

// [REUSE] 스트레이트 최고값 비교 (A-low 처리 포함)
function _compareHighCard(handA, handB) {
  const highA = _getStraightHigh(handA.values);
  const highB = _getStraightHigh(handB.values);
  if (highA !== highB) return highA > highB ? 1 : -1;
  return 0;
}

// [REUSE] 스트레이트 최고값 반환 (A-low: [14,5,4,3,2] → 5)
function _getStraightHigh(values) {
  if (values[0] === 14 && values[1] === 5) return 5;
  return values[0];
}

// [REUSE] 숫자 배열 순서 비교
function _compareArrays(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

// [REUSE] 수트 우선순위 비교 (5장 카드의 수트를 SUIT_RANK 기준 내림차순 정렬 후 비교)
function _compareSuits(handA, handB) {
  const suitsA = handA.suits.map(s => SUIT_RANK[s] || 0).sort((a, b) => b - a);
  const suitsB = handB.suits.map(s => SUIT_RANK[s] || 0).sort((a, b) => b - a);
  return _compareArrays(suitsA, suitsB);
}

// [REUSE] 두 플레이어의 패 목록 비교 (ARCADE BATTLE / GAMBLE DUEL 공통)
// handsA, handsB: evaluateHand() 반환값 배열
// return: { results, winsA, winsB, winner }
function compareHandLists(handsA, handsB) {
  // rank 내림차순 정렬
  const sortedA = handsA.slice().sort((a, b) => b.rank - a.rank);
  const sortedB = handsB.slice().sort((a, b) => b.rank - a.rank);

  const maxLen = Math.max(sortedA.length, sortedB.length);
  const results = [];
  let winsA = 0, winsB = 0;

  for (let i = 0; i < maxLen; i++) {
    const a = sortedA[i];
    const b = sortedB[i];

    if (a && !b) {
      results.push(1);
      winsA++;
    } else if (!a && b) {
      results.push(-1);
      winsB++;
    } else if (a && b) {
      const cmp = compareHands(a, b);
      results.push(cmp);
      if (cmp === 1) winsA++;
      else if (cmp === -1) winsB++;
    }
  }

  let winner = 'draw';
  if (winsA > winsB) winner = 'A';
  else if (winsB > winsA) winner = 'B';

  return { results, winsA, winsB, winner };
}

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 전체 (compareHands, compareHandLists, SUIT_RANK)
// ADAPTER : 없음
// REWRITE : 없음
// =============================================
