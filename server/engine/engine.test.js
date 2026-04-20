// 엔진 모듈 통합 검증 — `node server/engine/engine.test.js` 실행

const { createDeck, shuffleDeckWithSeed, SUIT_RANK } = require('./deck');
const { evaluateHand, RANK, compareHandsByCards } = require('./handRank');

function testCreateDeck() {
  const deck = createDeck();
  if (deck.length !== 52) {
    console.error(`FAIL: deck size = ${deck.length}, expected 52`);
    return false;
  }
  console.log('PASS: createDeck returns 52 cards');
  return true;
}

function testShuffleDeterministic() {
  const deck = createDeck();
  const s1 = shuffleDeckWithSeed(deck, 12345);
  const s2 = shuffleDeckWithSeed(deck, 12345);
  const equal = s1.every((c, i) => c.suit === s2[i].suit && c.value === s2[i].value);
  if (!equal) {
    console.error('FAIL: shuffleDeckWithSeed not deterministic');
    return false;
  }
  console.log('PASS: shuffleDeckWithSeed deterministic');
  console.log('  seed=12345 first 3 cards:', s1.slice(0, 3));
  return true;
}

function testRoyalFlush() {
  const cards = [
    { suit: '♠', value: 10 },
    { suit: '♠', value: 11 },
    { suit: '♠', value: 12 },
    { suit: '♠', value: 13 },
    { suit: '♠', value: 14 },
  ];
  const result = evaluateHand(cards);
  if (result.rank !== RANK.ROYAL_FLUSH) {
    console.error(`FAIL: expected ROYAL_FLUSH, got ${result.rank} (${result.label})`);
    return false;
  }
  console.log('PASS: Royal Flush detected');
  return true;
}

function testFullHouse() {
  const cards = [
    { suit: '♠', value: 5 },
    { suit: '♥', value: 5 },
    { suit: '♦', value: 5 },
    { suit: '♠', value: 2 },
    { suit: '♣', value: 2 },
  ];
  const result = evaluateHand(cards);
  if (result.rank !== RANK.FULL_HOUSE) {
    console.error(`FAIL: expected FULL_HOUSE, got ${result.rank} (${result.label})`);
    return false;
  }
  console.log('PASS: Full House detected');
  return true;
}

function testAceLowStraight() {
  const cards = [
    { suit: '♠', value: 14 },
    { suit: '♥', value: 2 },
    { suit: '♦', value: 3 },
    { suit: '♠', value: 4 },
    { suit: '♣', value: 5 },
  ];
  const result = evaluateHand(cards);
  if (result.rank !== RANK.STRAIGHT) {
    console.error(`FAIL: expected STRAIGHT (A-low), got ${result.rank} (${result.label})`);
    return false;
  }
  console.log('PASS: A-low Straight detected');
  return true;
}

function testTiebreaker() {
  const handA = {
    rank: 1,
    cards: [
      { suit: '♠', value: 10 },
      { suit: '♥', value: 10 },
      { suit: '♦', value: 7 },
      { suit: '♠', value: 4 },
      { suit: '♣', value: 2 },
    ],
  };
  const handB = {
    rank: 1,
    cards: [
      { suit: '♠', value: 5 },
      { suit: '♥', value: 5 },
      { suit: '♦', value: 13 },
      { suit: '♠', value: 9 },
      { suit: '♣', value: 3 },
    ],
  };
  const cmp = compareHandsByCards(handA, handB);
  if (cmp !== 1) {
    console.error(`FAIL: expected A wins (1), got ${cmp}`);
    return false;
  }
  console.log('PASS: Pair tiebreaker (10s beat 5s)');
  return true;
}

const results = [
  testCreateDeck(),
  testShuffleDeterministic(),
  testRoyalFlush(),
  testFullHouse(),
  testAceLowStraight(),
  testTiebreaker(),
];

if (results.every(Boolean)) {
  console.log('\n✅ All engine tests passed');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}
