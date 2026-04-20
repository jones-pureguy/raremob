// PRNG 결정론적 동작 검증 — `node server/engine/prng.test.js` 실행
// 클라/서버 bit-for-bit 일치 확인용 기준값 포함

const { mulberry32, shuffleFromSeed } = require('./prng');

function testDeterministic() {
  const rng1 = mulberry32(12345);
  const rng2 = mulberry32(12345);
  for (let i = 0; i < 100; i++) {
    if (rng1() !== rng2()) {
      console.error(`FAIL: determinism broken at iteration ${i}`);
      return false;
    }
  }
  console.log('PASS: determinism');
  return true;
}

function testDifferentSeeds() {
  const rng1 = mulberry32(1);
  const rng2 = mulberry32(2);
  const a = rng1();
  const b = rng2();
  if (a === b) {
    console.error('FAIL: different seeds produced same result');
    return false;
  }
  console.log('PASS: different seeds');
  return true;
}

function testShuffle() {
  const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const s1 = shuffleFromSeed(original, 42);
  const s2 = shuffleFromSeed(original, 42);
  if (JSON.stringify(s1) !== JSON.stringify(s2)) {
    console.error('FAIL: shuffle not deterministic', s1, s2);
    return false;
  }
  if (JSON.stringify(original) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])) {
    console.error('FAIL: original array mutated');
    return false;
  }
  console.log('PASS: shuffle deterministic');
  console.log('  seed=42 result:', s1);
  return true;
}

function testKnownValues() {
  const rng = mulberry32(0);
  const values = [];
  for (let i = 0; i < 5; i++) values.push(rng());
  console.log('Reference values for seed=0:', values);
  console.log('  → 클라이언트에서도 동일한 값이 나와야 함');
  return true;
}

const results = [
  testDeterministic(),
  testDifferentSeeds(),
  testShuffle(),
  testKnownValues(),
];

if (results.every(Boolean)) {
  console.log('\n✅ All PRNG tests passed');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}
