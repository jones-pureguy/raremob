// [REUSE] ARCADE BATTLE 승패 판정 및 칩 정산 — server.js 원본 로직 이동

const { handSortComparator, compareHandsByCards } = require('./handRank');

// [REUSE] 두 플레이어의 패 목록 비교 (서버용)
function compareArcadeHands(handsA, handsB, socketIdA, socketIdB) {
  const sortedA = handsA.slice().sort(handSortComparator);
  const sortedB = handsB.slice().sort(handSortComparator);

  const maxLen = Math.max(sortedA.length, sortedB.length, 9);
  const results = [];
  let winsA = 0, winsB = 0;

  for (let i = 0; i < maxLen; i++) {
    const a = sortedA[i];
    const b = sortedB[i];

    if (a && !b) {
      results.push('A');
      winsA++;
    } else if (!a && b) {
      results.push('B');
      winsB++;
    } else if (a && b) {
      if (a.rank !== b.rank) {
        if (a.rank > b.rank) { results.push('A'); winsA++; }
        else { results.push('B'); winsB++; }
      } else {
        // rank 같으면 카드 세부 비교
        const cmp = compareHandsByCards(a, b);
        if (cmp > 0) { results.push('A'); winsA++; }
        else if (cmp < 0) { results.push('B'); winsB++; }
        else { results.push('draw'); }
      }
    } else {
      results.push('draw');
    }
  }

  let winner = 'draw';
  if (winsA > winsB) winner = socketIdA;
  else if (winsB > winsA) winner = socketIdB;

  return { results, winsA, winsB, winner };
}

// [REUSE] ARCADE BATTLE 칩 정산
function calculateArcadeChips(winsA, winsB, chipA, chipB, socketIdA, socketIdB) {
  if (winsA === winsB) {
    return {
      delta: { [socketIdA]: 0, [socketIdB]: 0 },
      newChip: { [socketIdA]: chipA, [socketIdB]: chipB },
    };
  }

  const diff = Math.abs(winsA - winsB);
  const grossWin = diff * 10;
  const tableFee = 1;
  const netWin = grossWin - tableFee;

  let winnerId, loserId, winnerChip, loserChip;
  if (winsA > winsB) {
    winnerId = socketIdA; loserId = socketIdB;
    winnerChip = chipA; loserChip = chipB;
  } else {
    winnerId = socketIdB; loserId = socketIdA;
    winnerChip = chipB; loserChip = chipA;
  }

  // 패자 보유칩 초과 불가
  const actualLoss = Math.min(grossWin, loserChip);
  const actualGain = Math.min(netWin, actualLoss - tableFee > 0 ? actualLoss - tableFee : 0);

  return {
    delta: {
      [winnerId]: actualGain > 0 ? actualGain : 0,
      [loserId]: -actualLoss,
    },
    newChip: {
      [winnerId]: winnerChip + (actualGain > 0 ? actualGain : 0),
      [loserId]: loserChip - actualLoss,
    },
  };
}

module.exports = {
  compareArcadeHands,
  calculateArcadeChips,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 2개 함수 (compareArcadeHands, calculateArcadeChips)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
