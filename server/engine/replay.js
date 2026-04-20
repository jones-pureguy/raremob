// [REUSE] dragLog 재생 → 최종 점수 재계산 (Phase 1-8 세션 검증 코어)

const { createDeck, shuffleDeckWithSeed } = require('./deck');
const { evaluateHand, isRoyalFlushPlus, RANK } = require('./handRank');
const { validatePath, HAND_SIZE } = require('./pathValidator');
const { applyGravity, countCards } = require('./gravity');
const { calculateTotalScore } = require('./scorer');

// [REUSE] seed로 초기 그리드 생성 — 클라 initGrid()와 동일 로직
//   basic/hidden (7×7): 처음 3장을 removedCards로 스킵 → 3..51 카드 49개 배치 (script.js:179 deck.splice(0,3))
//   infinite   (6×6): 스킵 없이 0..35 카드 36개 배치 (infinite_script.js:201 deck.slice(0,36))
function buildInitialGrid(seed, gridSize = 7) {
  const deck = createDeck();
  const shuffled = shuffleDeckWithSeed(deck, seed);

  const grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(null));

  // 7×7 은 클라가 removedCards 로 3장을 떼어냄 → 서버도 동일하게 스킵
  const startIdx = gridSize === 7 ? 3 : 0;

  let idx = startIdx;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (idx < shuffled.length) {
        grid[r][c] = shuffled[idx++];
      }
    }
  }

  return grid;
}

// [REUSE] dragLog 재생하여 최종 상태 계산 (Phase 1-8 /api/session/submit의 유일한 엔트리포인트)
function replaySession({
  seed,
  gridSize = 7,
  dragLog = [],
  constraints = {},
  timeRemaining = 0,
  scoringOptions = { applyTimeBonus: true, applyPenalty: true },
}) {
  // 1. 초기 그리드 복원
  let grid = buildInitialGrid(seed, gridSize);
  const hands = [];

  // 2. 각 드래그 재생
  for (let i = 0; i < dragLog.length; i++) {
    const drag = dragLog[i];
    const pathCells = drag.cards;

    // 경로 검증
    const pathResult = validatePath(pathCells, grid, constraints);
    if (!pathResult.valid) {
      return {
        valid: false,
        reason: `INVALID_PATH: ${pathResult.reason}`,
        step: i,
      };
    }

    // 경로상 카드들 추출 (순서 유지)
    const cards = pathCells.map(([r, c]) => grid[r][c]);

    // 족보 판정
    const hand = evaluateHand(cards);

    // HIGH_CARD는 무효
    if (hand.rank === RANK.HIGH_CARD) {
      return {
        valid: false,
        reason: 'INVALID_HAND_HIGH_CARD',
        step: i,
      };
    }

    // RF+ 특수 판정 (경로 순서 기반)
    let finalRank = hand.rank;
    if (isRoyalFlushPlus(cards)) {
      finalRank = RANK.ROYAL_FLUSH_PLUS;
    }

    // 금지 족보 체크
    if (constraints.forbiddenHands && constraints.forbiddenHands.includes(finalRank)) {
      return {
        valid: false,
        reason: 'FORBIDDEN_HAND',
        step: i,
        rank: finalRank,
      };
    }

    // 금지 숫자 체크
    if (constraints.forbiddenValues && constraints.forbiddenValues.length > 0) {
      const hasForbidden = cards.some(c => constraints.forbiddenValues.includes(c.value));
      if (hasForbidden) {
        return {
          valid: false,
          reason: 'FORBIDDEN_VALUE',
          step: i,
        };
      }
    }

    hands.push({ rank: finalRank, cards, pathCells });

    // 카드 제거 + 중력
    grid = applyGravity(grid, pathCells);
  }

  // 3. 최종 점수 계산
  const remainingCards = countCards(grid);
  const scoreBreakdown = calculateTotalScore(hands, remainingCards, timeRemaining, scoringOptions);

  return {
    valid: true,
    score: scoreBreakdown.total,
    breakdown: scoreBreakdown,
    hands,
    remainingCards,
    finalGrid: grid,
  };
}

module.exports = {
  buildInitialGrid,
  replaySession,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 2개 함수 (buildInitialGrid, replaySession) — 서버 전용, 클라에선 불필요
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
