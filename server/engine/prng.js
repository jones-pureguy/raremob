// [REUSE] 결정론적 PRNG — 클라/서버 공통, Expo 전환 시 그대로 재활용
// 클라이언트 prng.js와 bit-for-bit 동일 구현 필수 (SERVER_SECURITY_ROADMAP.md §8.1)

// [REUSE] mulberry32 seeded PRNG — 동일 seed → 동일 난수 시퀀스 보장
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [REUSE] PRNG 기반 Fisher-Yates 셔플 (원본 불변)
function shuffleWithRng(arr, rng) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// [REUSE] seed에서 셔플된 배열 직접 생성
function shuffleFromSeed(arr, seed) {
  const rng = mulberry32(seed);
  return shuffleWithRng(arr, rng);
}

// [REUSE] 안전한 랜덤 seed 생성 (서버 전용)
function generateSeed() {
  return Math.floor(Math.random() * 0xFFFFFFFF);
}

module.exports = {
  mulberry32,
  shuffleWithRng,
  shuffleFromSeed,
  generateSeed,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 4개 함수 (mulberry32, shuffleWithRng, shuffleFromSeed, generateSeed)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
