// 리플레이 엔진 통합 검증 — `node server/engine/replay.test.js`

const { buildInitialGrid, replaySession } = require('./replay');

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

const results = [
  testInitialGridDeterministic(),
  testEmptyDragLog(),
  testInvalidPath(),
  testDuplicateCells(),
  testShortPath(),
];

if (results.every(Boolean)) {
  console.log('\n✅ All replay engine tests passed');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}
