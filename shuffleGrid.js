// =============================================
// [REUSE] 그리드 카드 셔플 모듈 — DragON POKER
// Expo 전환 시 그대로 이식 예정.
// DOM, Audio, localStorage 등 플랫폼 API 일절 참조 금지.
// =============================================

/**
 * shuffleGridCards({ grid, gridSize, outsideCards, mode })
 *
 * mode === 'redistribute' (기본, 인피니트용)
 *   그리드 + outsideCards의 카드를 모두 수집 후 셔플,
 *   gridSize×gridSize 칸에 순서대로 채우고 나머지는 outsideCards로 반환.
 *   빈 칸 위치는 보존하지 않음 (앞칸부터 꽉 채움).
 *
 * mode === 'in-place' (히든 게임용)
 *   카드가 있는 칸만 수집하여 셔플,
 *   카드가 원래 있던 좌표(위치)에만 재배치.
 *   빈 칸 위치는 그대로 유지.
 *   outsideCards 입출력 무시 (빈 배열 반환).
 *
 * @param {object} params
 * @param {Array}  params.grid          - 2D array of { card, row, col, ... }
 * @param {number} params.gridSize      - 그리드 한 변의 크기
 * @param {Array}  [params.outsideCards] - redistribute 모드 전용 (없으면 [])
 * @param {string} [params.mode]        - 'redistribute' | 'in-place' (기본: 'redistribute')
 *
 * @returns {{ newGrid: Array, newOutsideCards: Array }}
 */
// [REUSE]
window.shuffleGridCards = function shuffleGridCards({ grid, gridSize, outsideCards, mode }) {
  const effectiveMode = mode || 'redistribute';

  // ── Fisher-Yates 셔플 (공통 헬퍼) ──
  function fisherYates(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // ─────────────────────────────────────────
  // mode: 'in-place' — 히든 게임용
  // 빈 칸 위치 유지, 카드 있던 위치끼리만 셔플
  // ─────────────────────────────────────────
  if (effectiveMode === 'in-place') {
    // 카드가 있는 셀 좌표 + 카드 수집
    const filledPositions = [];
    const cards = [];
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (grid[r][c].card) {
          filledPositions.push([r, c]);
          cards.push(grid[r][c].card);
        }
      }
    }

    fisherYates(cards);

    // 원본 구조 복사 후 카드 재배치
    const newGrid = grid.map(row => row.map(cell => Object.assign({}, cell)));
    filledPositions.forEach(([r, c], i) => {
      newGrid[r][c] = Object.assign({}, grid[r][c], { card: cards[i] });
    });

    return { newGrid, newOutsideCards: [] };
  }

  // ─────────────────────────────────────────
  // mode: 'redistribute' — 인피니트용 (기존 동작)
  // grid + outsideCards 전체 셔플 후 재분배
  // ─────────────────────────────────────────
  const allCards = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (grid[r][c].card) allCards.push(grid[r][c].card);
    }
  }
  if (outsideCards && outsideCards.length) {
    allCards.push(...outsideCards);
  }

  fisherYates(allCards);

  // gridSize×gridSize 칸에 순서대로 배치
  const newGrid = [];
  let idx = 0;
  for (let r = 0; r < gridSize; r++) {
    const row = [];
    for (let c = 0; c < gridSize; c++) {
      row.push(Object.assign({}, grid[r][c], { card: allCards[idx++] || null }));
    }
    newGrid.push(row);
  }

  // 남은 카드 → newOutsideCards
  const newOutsideCards = allCards.slice(gridSize * gridSize);

  return { newGrid, newOutsideCards };
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : shuffleGridCards (변경 불필요)
// ADAPTER : window.shuffleGridCards → export default shuffleGridCards
// REWRITE : 0개
// =============================================
