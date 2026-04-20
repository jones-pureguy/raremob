// [REUSE] 카드 제거 후 중력 적용 (각 열에서 위 카드가 아래 빈칸으로 낙하)

// [REUSE] 경로상의 카드들을 제거하고 중력 적용 (원본 grid 변경 안 함)
function applyGravity(grid, pathCells) {
  const gridSize = grid.length;
  if (gridSize === 0) return [];

  // 깊은 복사
  const newGrid = grid.map(row => row.slice());

  // 1. 경로 셀들을 null로
  for (const [r, c] of pathCells) {
    if (newGrid[r]) newGrid[r][c] = null;
  }

  // 2. 각 열에 중력 적용 (아래로 낙하)
  const cols = newGrid[0].length;
  for (let c = 0; c < cols; c++) {
    const colCards = [];
    for (let r = 0; r < gridSize; r++) {
      if (newGrid[r][c]) colCards.push(newGrid[r][c]);
    }

    for (let r = 0; r < gridSize; r++) {
      newGrid[r][c] = null;
    }

    const emptyRows = gridSize - colCards.length;
    for (let i = 0; i < colCards.length; i++) {
      newGrid[emptyRows + i][c] = colCards[i];
    }
  }

  return newGrid;
}

// [REUSE] 그리드에 남은 카드 수
function countCards(grid) {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell) count++;
    }
  }
  return count;
}

module.exports = {
  applyGravity,
  countCards,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 2개 함수 (applyGravity, countCards)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
