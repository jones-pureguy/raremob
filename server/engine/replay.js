// [REUSE] dragLog 재생 → 최종 점수 재계산 (Phase 1-8 세션 검증 코어)

const { createDeck, shuffleDeckWithSeed } = require('./deck');
const { evaluateHand, isRoyalFlushPlus, RANK, RANK_LABELS } = require('./handRank');
const { validatePath, HAND_SIZE, isValidMove, isJumpMove, isJumpPathClear } = require('./pathValidator');
const { applyGravity, countCards } = require('./gravity');
const { calculateTotalScore, getHandScore, getTimeBonus, getPenalty } = require('./scorer');
const { mulberry32, shuffleWithRng } = require('./prng');

// [REUSE] Phase 1-7.5-A: 이벤트별 seed 파생 상수 (골든 레이시오 기반)
//   refill  : seed XOR (handIndex * SEED_MIX)
//   shuffle : seed XOR ((shuffleIndex + SHUFFLE_OFFSET) * SEED_MIX)
const SEED_MIX = 0x9E3779B9;
const SHUFFLE_INDEX_OFFSET = 10000;

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

// [REUSE] Phase 1-7.5-A: 인피니트 전용 6×6 초기 그리드 + outsideCards 16장
//   클라 infinite_script.js:199-211 initGrid()와 bit-for-bit 일치 필요
function buildInitialGridInfinite(seed, gridSize = 6) {
  const initRng = mulberry32(seed);
  const shuffled = shuffleWithRng(createDeck(), initRng);
  const gridCells = gridSize * gridSize;
  const gridCards = shuffled.slice(0, gridCells);
  const outsideCards = shuffled.slice(gridCells);

  const grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(null));
  let idx = 0;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      grid[r][c] = gridCards[idx++];
    }
  }

  return { grid, outsideCards };
}

// [REUSE] Phase 1-7.5-A: 인피니트 refill — 클라 removeCardsAndRefill 라인 604-635와 동일 순서
//   중력은 이미 외부(replay 루프)에서 1차 적용된 grid를 받는다고 가정.
//   pool = outside + removed (21장) → 셔플 → 5장 그리드, 16장 outside
//   빈 칸 좌표 → 같은 rng로 셔플 → 순서대로 5장 배치 → 다시 중력
function refillInfinite({ grid, outsideCards, removedCards, gridSize, rng }) {
  const pool = [...outsideCards, ...removedCards].filter(Boolean);
  const shuffledPool = shuffleWithRng(pool, rng);
  const toGrid = shuffledPool.slice(0, 5);
  const newOutside = shuffledPool.slice(5);

  const emptyCells = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (!grid[r][c]) emptyCells.push([r, c]);
    }
  }
  const shuffledEmpty = shuffleWithRng(emptyCells, rng);

  const placedGrid = grid.map(row => row.slice());
  toGrid.forEach((card, i) => {
    if (i < shuffledEmpty.length) {
      const [r, c] = shuffledEmpty[i];
      placedGrid[r][c] = card;
    }
  });

  // 클라가 refill 후 다시 중력 적용 (infinite_script.js:635)
  const finalGrid = applyGravity(placedGrid, []);

  return { grid: finalGrid, outsideCards: newOutside };
}

// [REUSE] Phase 1-7.5-B: 히든 셔플 이벤트 — 클라 doHiddenShuffle + shuffleGrid.js 'in-place'와 동일
//   카드가 있는 셀만 수집 → 셔플 → 같은 좌표에 재배치 (빈 칸 위치 유지)
//   outsideCards는 히든에 없음 (항상 빈 배열)
function shuffleHiddenInPlace({ grid, gridSize, rng }) {
  const filledPositions = [];
  const cards = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (grid[r][c]) {
        filledPositions.push([r, c]);
        cards.push(grid[r][c]);
      }
    }
  }
  const shuffled = shuffleWithRng(cards, rng);
  const newGrid = grid.map(row => row.slice());
  filledPositions.forEach(([r, c], i) => {
    newGrid[r][c] = shuffled[i];
  });
  return newGrid;
}

// [REUSE] Phase 1-7.5-A: 인피니트 셔플 이벤트 — 클라 doShuffle + shuffleGrid.js 'redistribute'와 동일
//   그리드 카드 + outsideCards 모두 모아 셔플 → 처음 36장을 그리드에, 나머지를 outside
//   클라도 셔플 후 중력 적용(infinite_script.js:818) → 서버도 동일
function shuffleInfinite({ grid, outsideCards, gridSize, rng }) {
  const allCards = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (grid[r][c]) allCards.push(grid[r][c]);
    }
  }
  if (outsideCards && outsideCards.length) {
    for (const card of outsideCards) {
      if (card) allCards.push(card);
    }
  }

  const shuffled = shuffleWithRng(allCards, rng);

  const gridCells = gridSize * gridSize;
  const newGrid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(null));
  let idx = 0;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      newGrid[r][c] = shuffled[idx++] || null;
    }
  }

  const newOutside = shuffled.slice(gridCells);
  const finalGrid = applyGravity(newGrid, []);

  return { grid: finalGrid, outsideCards: newOutside };
}

// [REUSE] dragLog 재생하여 최종 상태 계산 (Phase 1-8 /api/session/submit의 유일한 엔트리포인트)
//   mode === 'infinite' 이면:
//     - 6×6 초기 그리드 + outsideCards 추적
//     - 각 hand 완성 후 refillInfinite 호출 (seed XOR (handIndex * SEED_MIX) 파생 RNG)
//     - { type: 'shuffle' } 이벤트 지원 (seed XOR ((shuffleIdx+OFFSET) * SEED_MIX) 파생 RNG)
//   basic / hidden / 그외: 기존 동작 유지 (outsideCards 없음, refill 없음)
function replaySession({
  seed,
  gridSize = 7,
  mode = 'basic',
  dragLog = [],
  constraints = {},
  timeRemaining = 0,
  // [REUSE for Expo] Phase 1-11.3.1: timestamp cutoff용 — RN 환경에서도 동일 보장
  startedAt = null,
  gameTime = null,
  scoringOptions = { applyTimeBonus: true, applyPenalty: true, applyCombo: false },
}) {
  // 1. 초기 그리드 복원
  let grid;
  let outsideCards = [];
  if (mode === 'infinite') {
    const init = buildInitialGridInfinite(seed, gridSize);
    grid = init.grid;
    outsideCards = init.outsideCards;
  } else {
    grid = buildInitialGrid(seed, gridSize);
  }

  const hands = [];
  let handIndex = 0;
  let shuffleIndex = 0;

  // [REUSE for Expo] Phase 1-11.3.1: dragLog timestamp cutoff (race-late event 차단)
  //   gameTime null (hidden) 이거나 startedAt 부재 시 cutoff 미적용
  //   TOLERANCE_MS = 500: 정상 race 흡수 + 어뷰징 방어 균형
  const TOLERANCE_MS = 500;
  const cutoffTs = (gameTime !== null && startedAt)
    ? startedAt + gameTime * 1000 + TOLERANCE_MS
    : null;

  // 2. 이벤트 재생
  for (let i = 0; i < dragLog.length; i++) {
    const event = dragLog[i];
    const eventType = event.type || 'hand'; // 하위 호환: 구 베이직 형식 { cards:[...] }

    // [REUSE for Expo] Phase 1-11.3.1: cutoff 이후 이벤트 무시 (race condition 방어)
    if (cutoffTs && event.ts && event.ts > cutoffTs) {
      console.log(`[replay] event ${i} (type=${eventType}, ts=${event.ts}) after cutoff ${cutoffTs}, ignoring`);
      continue;
    }

    if (eventType === 'shuffle') {
      if (mode !== 'infinite' && mode !== 'hidden') {
        return { valid: false, reason: 'SHUFFLE_NOT_ALLOWED', step: i };
      }
      const shuffleRng = mulberry32(seed ^ ((shuffleIndex + SHUFFLE_INDEX_OFFSET) * SEED_MIX));
      if (mode === 'infinite') {
        const out = shuffleInfinite({ grid, outsideCards, gridSize, rng: shuffleRng });
        grid = out.grid;
        outsideCards = out.outsideCards;
      } else {
        // hidden: in-place shuffle
        grid = shuffleHiddenInPlace({ grid, gridSize, rng: shuffleRng });
      }
      shuffleIndex++;
      continue;
    }

    // 'hand' 이벤트
    const pathCells = event.cards;

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

    // 인피니트 전용: refill
    if (mode === 'infinite') {
      const refillRng = mulberry32(seed ^ (handIndex * SEED_MIX));
      const out = refillInfinite({
        grid,
        outsideCards,
        removedCards: cards,
        gridSize,
        rng: refillRng,
      });
      grid = out.grid;
      outsideCards = out.outsideCards;
    }

    handIndex++;
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
    finalOutsideCards: outsideCards,
  };
}

// =============================================
// [REWRITE] 매니악 모드 dragLog 재생 + 콤보 멀티 점수 검증
// =============================================
// dragLog 형식 (클라 maniac_script.js mn_endDrag 참조):
//   각 슬라이스가 별도 event로 push됨. 같은 한 번의 드래그(콤보)는
//   동일 comboGroupId + 동일 comboSize 공유. 슬라이스 cards는 5장 좌표.
//   예: 2-콤보 → 2 events, 9-콤보 → 9 events.
//
// 검증 흐름:
//   1) consecutive comboGroupId로 그룹핑
//   2) 그룹별 fullPath = concat(slice cards) → 5n장 path
//   3) fullPath 전체에 대해 인접성 + 중복 + 카드 존재 검증
//   4) 슬라이스별 evaluateHand → 매니악 룰 (10 이상 원페어 이상) 검증
//   5) 콤보 멀티 점수 = sum(슬라이스 점수) × n
//   6) 그룹의 모든 카드를 한 번에 제거 + 중력 (콤보 단위, 베이직과 다름)
//   7) timeBonus + penalty 베이직 동일 적용
function replayManiacSession({
  seed,
  gridSize = 7,
  dragLog = [],
  timeRemaining = 0,
  startedAt = null,
  gameTime = 200,
}) {
  // 1. 초기 그리드 (베이직 동일 — 7×7, removedCards 3장 스킵)
  let grid = buildInitialGrid(seed, gridSize);

  // 2. dragLog cutoff (race-late 방어, baseline 패턴 동일)
  const TOLERANCE_MS = 500;
  const cutoffTs = (gameTime !== null && startedAt)
    ? startedAt + gameTime * 1000 + TOLERANCE_MS
    : null;

  const filteredLog = [];
  for (let i = 0; i < dragLog.length; i++) {
    const event = dragLog[i];
    if (cutoffTs && event.ts && event.ts > cutoffTs) {
      console.log(`[replayManiac] event ${i} (ts=${event.ts}) after cutoff ${cutoffTs}, ignoring`);
      continue;
    }
    filteredLog.push(event);
  }

  // 3. consecutive comboGroupId로 그룹핑 + 사전 검증 (event type)
  const groups = [];
  let currentGroup = null;
  for (let i = 0; i < filteredLog.length; i++) {
    const event = filteredLog[i];
    const eventType = event.type || 'hand';
    if (eventType !== 'hand') {
      return { valid: false, reason: 'INVALID_EVENT_TYPE_FOR_MANIAC', step: i, eventType };
    }
    const groupId = event.comboGroupId;
    if (currentGroup && currentGroup.id === groupId) {
      currentGroup.events.push(event);
    } else {
      currentGroup = { id: groupId, events: [event] };
      groups.push(currentGroup);
    }
  }

  // 4. 각 그룹 검증 + 점수 계산
  let handSum = 0;
  let totalHandCount = 0;
  let maxComboSize = 0;             // [STEP 8+] saveManiacSession용 메타
  const allHands = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const expectedSize = group.events[0].comboSize;
    if (typeof expectedSize === 'number' && expectedSize !== group.events.length) {
      return { valid: false, reason: 'COMBO_SIZE_MISMATCH', step: gi, expected: expectedSize, actual: group.events.length };
    }

    // fullPath = concat of all slice cards
    const fullPath = [];
    for (const event of group.events) {
      if (!Array.isArray(event.cards) || event.cards.length !== 5) {
        return { valid: false, reason: 'INVALID_SLICE_LENGTH', step: gi, sliceLen: event.cards ? event.cards.length : 0 };
      }
      for (const cell of event.cards) {
        if (!Array.isArray(cell) || cell.length !== 2) {
          return { valid: false, reason: 'INVALID_CELL_FORMAT', step: gi };
        }
        fullPath.push(cell);
      }
    }

    if (fullPath.length === 0 || fullPath.length % HAND_SIZE !== 0 || fullPath.length > HAND_SIZE * 9) {
      return { valid: false, reason: 'INVALID_PATH_LENGTH_IN_COMBO', step: gi, pathLen: fullPath.length };
    }

    // fullPath 전체 검증
    // 4-1) 중복 셀
    const seen = new Set();
    for (const [r, c] of fullPath) {
      const key = `${r},${c}`;
      if (seen.has(key)) {
        return { valid: false, reason: 'DUPLICATE_CELL_IN_COMBO', step: gi, cell: [r, c] };
      }
      seen.add(key);
    }
    // 4-2) 각 셀에 카드 존재
    for (const [r, c] of fullPath) {
      if (!grid[r] || !grid[r][c]) {
        return { valid: false, reason: 'EMPTY_CELL_IN_COMBO', step: gi, cell: [r, c] };
      }
    }
    // 4-3) 인접성 + 점프 (cross-slice 포함)
    for (let i = 1; i < fullPath.length; i++) {
      const [fromR, fromC] = fullPath[i - 1];
      const [toR, toC] = fullPath[i];
      if (!isValidMove(fromR, fromC, toR, toC, {}, fullPath.slice(0, i))) {
        return { valid: false, reason: 'INVALID_DIRECTION_IN_COMBO', step: gi, subStep: i };
      }
      if (isJumpMove(fromR, fromC, toR, toC)) {
        if (!isJumpPathClear(grid, fromR, fromC, toR, toC)) {
          return { valid: false, reason: 'JUMP_BLOCKED_IN_COMBO', step: gi, subStep: i };
        }
      }
    }

    // 4-4) 슬라이스별 evaluateHand (베이직 룰 동일: 10 이상 원페어 이상)
    const sliceScores = [];
    const sliceHands = [];
    for (let si = 0; si < group.events.length; si++) {
      const slicePath = fullPath.slice(si * HAND_SIZE, (si + 1) * HAND_SIZE);
      const sliceCards = slicePath.map(([r, c]) => grid[r][c]);
      const hand = evaluateHand(sliceCards);

      if (hand.rank === RANK.HIGH_CARD) {
        return { valid: false, reason: 'INVALID_HAND_HIGH_CARD', step: gi, sliceIdx: si };
      }
      // 10 미만 원페어 reject (매니악 룰 = 베이직 isValidHand 동일)
      if (hand.rank === RANK.ONE_PAIR && hand.pairValue < 10) {
        return { valid: false, reason: 'INVALID_HAND_LOW_PAIR', step: gi, sliceIdx: si, pairValue: hand.pairValue };
      }

      // RF+ 특수 (경로 순서 기반)
      let finalRank = hand.rank;
      if (isRoyalFlushPlus(sliceCards)) {
        finalRank = RANK.ROYAL_FLUSH_PLUS;
      }

      sliceScores.push(getHandScore(finalRank));
      sliceHands.push({ rank: finalRank, cards: sliceCards, pathCells: slicePath });
    }

    // 4-5) 콤보 멀티 적용
    const n = sliceHands.length;
    const sliceSum = sliceScores.reduce((a, b) => a + b, 0);
    const groupScore = sliceSum * n;
    handSum += groupScore;
    totalHandCount += n;
    if (n > maxComboSize) maxComboSize = n;
    allHands.push(...sliceHands);

    // 4-6) 9패 초과 검증
    if (totalHandCount > 9) {
      return { valid: false, reason: 'EXCEED_MAX_HANDS', step: gi, totalHandCount };
    }

    // 4-7) 그룹의 모든 카드를 한 번에 제거 + 중력 (베이직과 다름: 콤보 단위)
    grid = applyGravity(grid, fullPath);
  }

  // 5. 최종 점수 (timeBonus + penalty)
  const remainingCards = countCards(grid);
  const timeBonus = getTimeBonus(timeRemaining);
  const penalty = getPenalty(remainingCards);
  const rawTotal = handSum + timeBonus - penalty;
  const total = Math.max(0, rawTotal);

  // [STEP 8+] saveManiacSession 메타: 베스트 패 라벨 (최고 rank의 RANK_LABELS)
  let bestRank = 0;
  for (const h of allHands) {
    if (h.rank > bestRank) bestRank = h.rank;
  }
  const bestHand = RANK_LABELS[bestRank] || null;

  return {
    valid: true,
    score: total,
    breakdown: { handSum, bonus: timeBonus, penalty, rawTotal, total },
    hands: allHands,
    remainingCards,
    finalGrid: grid,
    // [STEP 8+] 매니악 메타 — saveManiacSession 호출 시 사용
    handCount: totalHandCount,
    maxComboSize,
    bestHand,
  };
}

module.exports = {
  buildInitialGrid,
  buildInitialGridInfinite,
  refillInfinite,
  shuffleInfinite,
  shuffleHiddenInPlace,
  replaySession,
  replayManiacSession,
  SEED_MIX,
  SHUFFLE_INDEX_OFFSET,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 6개 함수 + 2개 상수 (buildInitialGrid, buildInitialGridInfinite,
//           refillInfinite, shuffleInfinite, replaySession, replayManiacSession,
//           SEED_MIX, SHUFFLE_INDEX_OFFSET) — 서버 전용, 클라에선 불필요
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
