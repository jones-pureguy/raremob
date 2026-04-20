// =============================================
// [REUSE] 그리드 카드 셔플 모듈 — DragON POKER
// Expo 전환 시 그대로 이식 예정.
// DOM, Audio, localStorage 등 플랫폼 API 일절 참조 금지.
// =============================================

/**
 * shuffleGridCards({ grid, gridSize, outsideCards })
 *
 * 그리드와 outsideCards의 카드를 모두 수집하여
 * Fisher-Yates 셔플 후 재배치합니다.
 * 빈 셀은 빈 셀로 유지하지 않고, 카드 총량만 보존합니다.
 *
 * @param {object} params
 * @param {Array}  params.grid         - 2D array of { card, row, col, ... }
 * @param {number} params.gridSize     - 그리드 한 변의 크기 (예: 6)
 * @param {Array}  [params.outsideCards] - 그리드 밖 카드 배열 (없으면 [])
 *
 * @returns {{ newGrid: Array, newOutsideCards: Array }}
 *   newGrid         - 원본 cell 구조 유지, card만 재배치된 2D 배열
 *   newOutsideCards - 그리드 배치 후 남은 카드 배열
 */
// [REUSE]
window.shuffleGridCards = function shuffleGridCards({ grid, gridSize, outsideCards }) {
  // 1. 모든 카드 수집 (grid + outside)
  const allCards = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const card = grid[r][c].card;
      if (card) allCards.push(card);
    }
  }
  if (outsideCards && outsideCards.length) {
    allCards.push(...outsideCards);
  }

  // 2. Fisher-Yates 셔플
  for (let i = allCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = allCards[i];
    allCards[i] = allCards[j];
    allCards[j] = tmp;
  }

  // 3. gridSize×gridSize 칸에 순서대로 배치
  const newGrid = [];
  let idx = 0;
  for (let r = 0; r < gridSize; r++) {
    const row = [];
    for (let c = 0; c < gridSize; c++) {
      // 원본 셀 구조(row, col 등) 유지, card만 교체
      row.push(Object.assign({}, grid[r][c], { card: allCards[idx++] || null }));
    }
    newGrid.push(row);
  }

  // 4. 남은 카드 → outsideCards
  const newOutsideCards = allCards.slice(gridSize * gridSize);

  return { newGrid, newOutsideCards };
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : shuffleGridCards (변경 불필요)
// ADAPTER : window.shuffleGridCards → export default shuffleGridCards
// REWRITE : 0개
// =============================================
