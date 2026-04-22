// [REUSE] 카드 덱 생성 및 셔플 — 플랫폼 무관, Expo 전환 시 그대로 재활용

const { shuffleWithRng, mulberry32 } = require('./prng');

// [Phase 1-8-prep] 클라/서버 SUITS 순서 통일 — bit-for-bit 일치
//   클라 script.js / infinite_script.js / stage_script.js 등과 동일 (♠♥♦♣).
//   SUIT_RANK (포커 우선순위)는 별도 매핑이라 이 배열 순서와 독립.
const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 14 = Ace

// [REUSE] 수트 우선순위: 스페이드 > 다이아 > 하트 > 클로버
const SUIT_RANK = {
  '♠': 4,
  '♦': 3,
  '♥': 2,
  '♣': 1,
};

// [REUSE] 52장 카드 덱 생성 (셔플 전)
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value });
    }
  }
  return deck;
}

// [REUSE] seed 기반 결정론적 셔플 (Phase 1-8부터 사용)
function shuffleDeckWithSeed(deck, seed) {
  const rng = mulberry32(seed);
  return shuffleWithRng(deck, rng);
}

// [REUSE] 기존 호환용: seed 없으면 Math.random 기반 셔플 (PvP 호환)
function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = {
  SUITS,
  VALUES,
  SUIT_RANK,
  createDeck,
  shuffleDeck,
  shuffleDeckWithSeed,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 3개 함수 + 3개 상수 (createDeck, shuffleDeck, shuffleDeckWithSeed, SUITS, VALUES, SUIT_RANK)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
