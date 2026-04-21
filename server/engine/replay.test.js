// 리플레이 엔진 통합 검증 — `node server/engine/replay.test.js`

const {
  buildInitialGrid,
  buildInitialGridInfinite,
  refillInfinite,
  shuffleInfinite,
  replaySession,
  SEED_MIX,
  SHUFFLE_INDEX_OFFSET,
} = require('./replay');
const { mulberry32 } = require('./prng');
const { calculateTotalScore } = require('./scorer');
const { RANK } = require('./handRank');

function testInitialGridDeterministic() {
  const g1 = buildInitialGrid(12345, 7);
  const g2 = buildInitialGrid(12345, 7);
  let diff = 0;
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const a = g1[r][c];
      const b = g2[r][c];
      if ((a && !b) || (!a && b)) diff++;
      else if (a && b && (a.suit !== b.suit || a.value !== b.value)) diff++;
    }
  }
  if (diff > 0) {
    console.error(`FAIL: initial grid not deterministic, ${diff} cells differ`);
    return false;
  }
  console.log('PASS: initial grid deterministic (seed=12345)');
  console.log('  [0][0]:', g1[0][0]);  // expected: {suit:'♥',value:7}  (7×7은 첫 3장 skip)
  console.log('  [3][3]:', g1[3][3]);  // expected: {suit:'♠',value:14}
  console.log('  [6][6]:', g1[6][6]);  // expected: {suit:'♣',value:13}
  return true;
}

function testEmptyDragLog() {
  const result = replaySession({
    seed: 12345,
    gridSize: 7,
    dragLog: [],
    timeRemaining: 0,
    scoringOptions: { applyTimeBonus: false, applyPenalty: true },
  });
  if (!result.valid) {
    console.error('FAIL: empty dragLog should be valid');
    return false;
  }
  console.log('PASS: empty dragLog replay');
  console.log('  remaining cards:', result.remainingCards);
  console.log('  score:', result.score);
  console.log('  breakdown:', result.breakdown);
  return true;
}

function testInvalidPath() {
  const result = replaySession({
    seed: 12345,
    gridSize: 7,
    dragLog: [
      { cards: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
    ],
    timeRemaining: 0,
  });
  console.log('PASS: path replay attempted');
  console.log('  valid:', result.valid);
  console.log('  reason:', result.reason || 'N/A');
  return true;
}

function testDuplicateCells() {
  const result = replaySession({
    seed: 12345,
    gridSize: 7,
    dragLog: [
      { cards: [[0, 0], [0, 1], [0, 0], [0, 2], [0, 3]] },
    ],
    timeRemaining: 0,
  });
  if (result.valid) {
    console.error('FAIL: duplicate cells should be rejected');
    return false;
  }
  if (!result.reason.includes('DUPLICATE')) {
    console.error('FAIL: wrong reason:', result.reason);
    return false;
  }
  console.log('PASS: duplicate cells rejected:', result.reason);
  return true;
}

function testShortPath() {
  const result = replaySession({
    seed: 12345,
    gridSize: 7,
    dragLog: [
      { cards: [[0, 0], [0, 1], [0, 2]] },
    ],
    timeRemaining: 0,
  });
  if (result.valid) {
    console.error('FAIL: short path should be rejected');
    return false;
  }
  console.log('PASS: short path rejected:', result.reason);
  return true;
}

// ─── Phase 1-7.5-A: 인피니트 모드 결정론 검증 ───

function cardsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.suit === b.suit && a.value === b.value;
}

function gridsEqual(g1, g2) {
  if (g1.length !== g2.length) return false;
  for (let r = 0; r < g1.length; r++) {
    if (g1[r].length !== g2[r].length) return false;
    for (let c = 0; c < g1[r].length; c++) {
      if (!cardsEqual(g1[r][c], g2[r][c])) return false;
    }
  }
  return true;
}

function cardListsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!cardsEqual(a[i], b[i])) return false;
  }
  return true;
}

function testInfiniteInitialGridDeterministic() {
  const a = buildInitialGridInfinite(54321, 6);
  const b = buildInitialGridInfinite(54321, 6);
  if (!gridsEqual(a.grid, b.grid) || !cardListsEqual(a.outsideCards, b.outsideCards)) {
    console.error('FAIL: infinite initial grid not deterministic');
    return false;
  }
  // 구조 체크: 6×6 = 36 + outside 16 = 52
  const totalGrid = a.grid.flat().filter(Boolean).length;
  if (totalGrid !== 36 || a.outsideCards.length !== 16) {
    console.error(`FAIL: infinite grid sizes wrong: grid=${totalGrid}, outside=${a.outsideCards.length}`);
    return false;
  }
  console.log('PASS: infinite initial grid deterministic (seed=54321, 6×6=36 + outside=16)');
  console.log('  [0][0]:', a.grid[0][0]);
  console.log('  [5][5]:', a.grid[5][5]);
  return true;
}

function testRefillInfiniteDeterministic() {
  const { grid, outsideCards } = buildInitialGridInfinite(12345, 6);
  // 5장 제거 시뮬 (단순히 grid 0행에서 떼어냄)
  const removed = [grid[0][0], grid[0][1], grid[0][2], grid[0][3], grid[0][4]];
  const gridWithHoles = grid.map(row => row.slice());
  gridWithHoles[0][0] = null;
  gridWithHoles[0][1] = null;
  gridWithHoles[0][2] = null;
  gridWithHoles[0][3] = null;
  gridWithHoles[0][4] = null;

  const handIndex = 0;
  const rng1 = mulberry32(12345 ^ (handIndex * SEED_MIX));
  const rng2 = mulberry32(12345 ^ (handIndex * SEED_MIX));
  const r1 = refillInfinite({ grid: gridWithHoles, outsideCards, removedCards: removed, gridSize: 6, rng: rng1 });
  const r2 = refillInfinite({ grid: gridWithHoles, outsideCards, removedCards: removed, gridSize: 6, rng: rng2 });
  if (!gridsEqual(r1.grid, r2.grid) || !cardListsEqual(r1.outsideCards, r2.outsideCards)) {
    console.error('FAIL: refillInfinite not deterministic');
    return false;
  }
  // outside 크기 보존
  if (r1.outsideCards.length !== 16) {
    console.error(`FAIL: refill outside size = ${r1.outsideCards.length}, expected 16`);
    return false;
  }
  console.log('PASS: refillInfinite deterministic + outside=16 preserved');
  return true;
}

function testShuffleInfiniteDeterministic() {
  const { grid, outsideCards } = buildInitialGridInfinite(99999, 6);
  const shuffleIndex = 0;
  const rng1 = mulberry32(99999 ^ ((shuffleIndex + SHUFFLE_INDEX_OFFSET) * SEED_MIX));
  const rng2 = mulberry32(99999 ^ ((shuffleIndex + SHUFFLE_INDEX_OFFSET) * SEED_MIX));
  const s1 = shuffleInfinite({ grid, outsideCards, gridSize: 6, rng: rng1 });
  const s2 = shuffleInfinite({ grid, outsideCards, gridSize: 6, rng: rng2 });
  if (!gridsEqual(s1.grid, s2.grid) || !cardListsEqual(s1.outsideCards, s2.outsideCards)) {
    console.error('FAIL: shuffleInfinite not deterministic');
    return false;
  }
  console.log('PASS: shuffleInfinite deterministic');
  return true;
}

function testInfiniteReplayDoubleCall() {
  // 같은 seed + 같은 dragLog → 서버 리플레이 두 번 호출 결과 bit-for-bit 일치
  const seed = 777;
  const dragLog = [{ type: 'shuffle' }]; // hand 없이 셔플만 — 간단 케이스
  const opts = {
    seed, gridSize: 6, mode: 'infinite', dragLog,
    scoringOptions: { applyTimeBonus: false, applyPenalty: false, applyCombo: true },
  };
  const r1 = replaySession(opts);
  const r2 = replaySession(opts);
  if (!r1.valid || !r2.valid) {
    console.error('FAIL: replay should be valid:', r1.reason, r2.reason);
    return false;
  }
  if (!gridsEqual(r1.finalGrid, r2.finalGrid) || !cardListsEqual(r1.finalOutsideCards, r2.finalOutsideCards)) {
    console.error('FAIL: infinite replay not deterministic');
    return false;
  }
  console.log('PASS: infinite replay deterministic (shuffle-only event)');
  return true;
}

function testShuffleInBasicModeRejected() {
  const r = replaySession({
    seed: 1, gridSize: 7, mode: 'basic',
    dragLog: [{ type: 'shuffle' }],
    scoringOptions: { applyTimeBonus: true, applyPenalty: true, applyCombo: false },
  });
  if (r.valid || r.reason !== 'SHUFFLE_NOT_ALLOWED') {
    console.error('FAIL: basic mode should reject shuffle event, got:', r);
    return false;
  }
  console.log('PASS: shuffle event rejected in basic mode');
  return true;
}

function testComboScoring() {
  // 클라 정책 검증: [FOUR_KIND, FOUR_KIND, ONE_PAIR, STRAIGHT_FLUSH, STRAIGHT_FLUSH]
  // 기대값:
  //   FOUR_KIND (combo=1): 50 * 1 = 50
  //   FOUR_KIND (combo=2): 50 * 2 = 100
  //   ONE_PAIR  (combo reset): 1
  //   STRAIGHT_FLUSH (combo=1): 75 * 1 = 75
  //   STRAIGHT_FLUSH (combo=2): 75 * 2 = 150
  //   합계: 50 + 100 + 1 + 75 + 150 = 376
  const hands = [
    { rank: RANK.FOUR_KIND },
    { rank: RANK.FOUR_KIND },
    { rank: RANK.ONE_PAIR },
    { rank: RANK.STRAIGHT_FLUSH },
    { rank: RANK.STRAIGHT_FLUSH },
  ];
  const br = calculateTotalScore(hands, 0, 0, {
    applyTimeBonus: false, applyPenalty: false, applyCombo: true,
  });
  if (br.total !== 376) {
    console.error(`FAIL: combo total = ${br.total}, expected 376`);
    console.error('  breakdown:', br);
    return false;
  }
  console.log('PASS: infinite combo scoring = 376 (50+100+1+75+150)');
  return true;
}

function testBasicScoringUnchanged() {
  // 회귀 검증: applyCombo=false 시 기존 합산
  const hands = [
    { rank: RANK.FOUR_KIND },
    { rank: RANK.FOUR_KIND },
  ];
  const br = calculateTotalScore(hands, 0, 0, {
    applyTimeBonus: false, applyPenalty: false, applyCombo: false,
  });
  if (br.total !== 100) {
    console.error(`FAIL: basic score = ${br.total}, expected 100 (50+50)`);
    return false;
  }
  console.log('PASS: basic scoring unchanged (applyCombo=false)');
  return true;
}

const results = [
  testInitialGridDeterministic(),
  testEmptyDragLog(),
  testInvalidPath(),
  testDuplicateCells(),
  testShortPath(),
  testInfiniteInitialGridDeterministic(),
  testRefillInfiniteDeterministic(),
  testShuffleInfiniteDeterministic(),
  testInfiniteReplayDoubleCall(),
  testShuffleInBasicModeRejected(),
  testComboScoring(),
  testBasicScoringUnchanged(),
];

if (results.every(Boolean)) {
  console.log('\n✅ All replay engine tests passed');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}
