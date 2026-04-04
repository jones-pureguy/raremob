// =============================================
// [UI] Quick Reference Modal — Expo 전환 시 재작성
// =============================================

// [REUSE] 점수 정책 조회
function getQRScores() {
  return ScorePolicy.get().handScores;
}

// [REWRITE] 미니 카드 HTML 생성
function miniCard(val, suit, dim) {
  const cls = {'\u2660':'s','\u2665':'h','\u2666':'d','\u2663':'c'}[suit] || '';
  return `<div class="qr-mini-card ${cls}${dim?' dim':''}">
    <span class="mc-val">${val}</span>
    <span class="mc-suit">${suit}</span>
  </div>`;
}

// [REWRITE] 족보 행 HTML 생성
function qrRow(nameStr, scoreStr, descStr, cardsHTML) {
  return `
    <div class="qr-row">
      <div class="qr-info">
        <div class="qr-name">${nameStr} <span class="qr-pts">(${scoreStr})</span></div>
        <div class="qr-desc">${descStr}</div>
      </div>
      <div class="qr-mini-cards">${cardsHTML}</div>
    </div>`;
}

// [REUSE] 족보 카드 데이터
const QR_HANDS = [
  { rank: 'STRAIGHT_FLUSH', cards: [['5','\u2666',false],['6','\u2666',false],['7','\u2666',false],['8','\u2666',false],['9','\u2666',false]] },
  { rank: 'FOUR_KIND',      cards: [['7','\u2660',true],['K','\u2660',false],['K','\u2665',false],['K','\u2666',false],['K','\u2663',false]] },
  { rank: 'FULL_HOUSE',     cards: [['J','\u2663',false],['J','\u2660',false],['Q','\u2660',false],['Q','\u2665',false],['Q','\u2666',false]] },
  { rank: 'FLUSH',          cards: [['2','\u2663',false],['4','\u2663',false],['7','\u2663',false],['10','\u2663',false],['A','\u2663',false]] },
  { rank: 'STRAIGHT',       cards: [['4','\u2660',false],['5','\u2663',false],['6','\u2666',false],['7','\u2665',false],['8','\u2660',false]] },
  { rank: 'THREE_KIND',     cards: [['3','\u2660',true],['8','\u2663',true],['J','\u2660',false],['J','\u2665',false],['J','\u2666',false]] },
  { rank: 'TWO_PAIR',       cards: [['5','\u2660',true],['9','\u2666',false],['9','\u2663',false],['10','\u2660',false],['10','\u2665',false]] },
  { rank: 'ONE_PAIR',       cards: [['2','\u2660',true],['7','\u2663',true],['K','\u2666',true],['A','\u2660',false],['A','\u2665',false]] }
];

// [REUSE] 폴백 족보명/설명
const QR_FALLBACK_NAMES = {
  ROYAL_FLUSH_PLUS: 'Royal Flush+', ROYAL_FLUSH: 'Royal Flush',
  STRAIGHT_FLUSH: 'Straight Flush', FOUR_KIND: 'Four of a Kind',
  FULL_HOUSE: 'Full House', FLUSH: 'Flush', STRAIGHT: 'Straight',
  THREE_KIND: 'Three of a Kind', TWO_PAIR: 'Two Pair', ONE_PAIR: 'One Pair'
};
const QR_FALLBACK_DESCS = {
  ROYAL_FLUSH_PLUS: 'Royal Flush selected in order',
  ROYAL_FLUSH: 'Top Straight Flush: 10,J,Q,K,A',
  STRAIGHT_FLUSH: 'Straight with same suit',
  FOUR_KIND: '4 cards of the same number',
  FULL_HOUSE: '3 of a kind + a pair',
  FLUSH: '5 cards of the same suit',
  STRAIGHT: '5 consecutive numbers (A=14 or 1)',
  THREE_KIND: '3 cards of the same number',
  TWO_PAIR: 'Two different pairs',
  ONE_PAIR: 'A pair (10s or higher only)'
};

// [REUSE] i18n 기반 족보명 조회
function qrName(rank) {
  const v = i18n.t(`handNames.${rank}`);
  return (v && !v.startsWith('handNames.')) ? v : QR_FALLBACK_NAMES[rank] || rank;
}
// [REUSE] i18n 기반 족보 설명 조회
function qrDesc(rank) {
  const v = i18n.t(`quickRef.desc.${rank}`);
  return (v && !v.startsWith('quickRef.')) ? v : QR_FALLBACK_DESCS[rank] || '';
}

// [REWRITE] Quick Reference 패널 빌드
function buildQuickRef() {
  const scores = getQRScores();
  const list = document.getElementById('qrHandList');
  if (!list) return;

  const rfPlusCards = [['10','\u2660'],['J','\u2660'],['Q','\u2660'],['K','\u2660'],['A','\u2660']];
  const rfPlusHTML = rfPlusCards.map(([v,s], i) =>
    miniCard(v, s, false) + (i < 4 ? '<span class="qr-arrow">\u2192</span>' : '')
  ).join('');

  const rfCards = [['10','\u2660'],['J','\u2660'],['Q','\u2660'],['K','\u2660'],['A','\u2660']];
  const rfHTML = rfCards.map(([v,s]) => miniCard(v, s, false)).join('');

  const rows = [
    qrRow(qrName('ROYAL_FLUSH_PLUS'), `${scores.ROYAL_FLUSH_PLUS}P`,
          qrDesc('ROYAL_FLUSH_PLUS'), rfPlusHTML),
    qrRow(qrName('ROYAL_FLUSH'), `${scores.ROYAL_FLUSH}P`,
          qrDesc('ROYAL_FLUSH'), rfHTML),
    ...QR_HANDS.map(h =>
      qrRow(qrName(h.rank), `${scores[h.rank] ?? 0}P`,
            qrDesc(h.rank),
            h.cards.map(([v,s,dim]) => miniCard(v, s, dim)).join(''))
    )
  ].join('');

  list.innerHTML = rows;
}

// [REWRITE] Quick Reference 모달 표시
async function showQuickRef() {
  if (typeof i18n !== 'undefined' && i18n.t('handNames.ROYAL_FLUSH') === 'handNames.ROYAL_FLUSH') {
    await i18n.init();
  }
  try { buildQuickRef(); } catch(e) { console.error('QR build error:', e); }
  const el = document.getElementById('qrOverlay');
  el.style.display = 'flex';
  el.classList.add('active');
}

// [REWRITE] Quick Reference 모달 닫기
function closeQuickRef() {
  const el = document.getElementById('qrOverlay');
  if (!el) return;
  el.classList.remove('active');
  el.style.display = 'none';
}

// [REWRITE] 버튼 이벤트 바인딩
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.qr-btn').forEach(btn => {
    btn.removeAttribute('onclick');

    let touched = false;
    btn.addEventListener('touchend', e => {
      e.preventDefault();
      e.stopPropagation();
      touched = true;
      showQuickRef();
    }, { passive: false });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (touched) { touched = false; return; }
      showQuickRef();
    });
  });

  const overlay = document.getElementById('qrOverlay');
  if (overlay) {
    overlay.addEventListener('touchend', e => {
      if (e.target === overlay) {
        e.preventDefault();
        closeQuickRef();
      }
    }, { passive: false });
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeQuickRef();
    });
  }
});

// [REWRITE] ESC 키 바인딩
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeQuickRef();
});

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 6개 (getQRScores, QR_HANDS, QR_FALLBACK_*, qrName, qrDesc)
// ADAPTER : 0개
// REWRITE : 7개 함수/블록 (전면 재작성)
//   - miniCard, qrRow → React Native 컴포넌트
//   - buildQuickRef, showQuickRef, closeQuickRef → Modal 컴포넌트
//   - DOMContentLoaded 이벤트, keydown 이벤트 → RN 이벤트
// =============================================
