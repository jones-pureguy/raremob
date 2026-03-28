// Quick Reference Modal — shared across game/stage/puzzle pages

function getQRScores() {
  try {
    const saved = JSON.parse(localStorage.getItem('poker_scores') || '{}');
    const s = saved.scores || {};
    return {
      ROYAL_FLUSH_PLUS: s.ROYAL_FLUSH_PLUS ?? 250,
      ROYAL_FLUSH:      s.ROYAL_FLUSH      ?? 100,
      STRAIGHT_FLUSH:   s.STRAIGHT_FLUSH   ?? 75,
      FOUR_KIND:        s.FOUR_KIND        ?? 50,
      FULL_HOUSE:       s.FULL_HOUSE       ?? 20,
      FLUSH:            s.FLUSH            ?? 15,
      STRAIGHT:         s.STRAIGHT         ?? 10,
      THREE_KIND:       s.THREE_KIND       ?? 5,
      TWO_PAIR:         s.TWO_PAIR         ?? 2,
      ONE_PAIR:         s.ONE_PAIR         ?? 1
    };
  } catch(e) { return {}; }
}

function miniCard(val, suit, dim) {
  const cls = {'\u2660':'s','\u2665':'h','\u2666':'d','\u2663':'c'}[suit] || '';
  return `<div class="qr-mini-card ${cls}${dim?' dim':''}">
    <span class="mc-val">${val}</span>
    <span class="mc-suit">${suit}</span>
  </div>`;
}

function textCard(val, suit, dim) {
  const cls = {'\u2660':'s','\u2665':'h','\u2666':'d','\u2663':'c'}[suit] || '';
  return `<span class="qr-text-card ${cls}${dim?' dim':''}">${suit}${val}</span>`;
}

function buildQuickRef() {
  const scores = getQRScores();
  const list = document.getElementById('qrHandList');
  if (!list) return;

  const name = rank => i18n.t(`handNames.${rank}`);

  // Royal Flush+ — mini cards + orange arrows
  const rfPlusCards = [['A','\u2660'],['K','\u2660'],['Q','\u2660'],['J','\u2660'],['10','\u2660']];
  const rfPlusHTML = rfPlusCards.map(([v,s], i) =>
    miniCard(v, s, false) + (i < 4 ? '<span class="qr-arrow">\u2192</span>' : '')
  ).join('');

  // Royal Flush — mini cards, shuffled order
  const rfCards = [['J','\u2665'],['A','\u2665'],['K','\u2665'],['10','\u2665'],['Q','\u2665']];
  const rfHTML = rfCards.map(([v,s]) => miniCard(v, s, false)).join('');

  // Remaining 8 hands — text style
  const hands = [
    { rank: 'STRAIGHT_FLUSH', cards: [['9','\u2666',false],['8','\u2666',false],['7','\u2666',false],['6','\u2666',false],['5','\u2666',false]] },
    { rank: 'FOUR_KIND',      cards: [['K','\u2660',false],['K','\u2665',false],['K','\u2666',false],['K','\u2663',false],['7','\u2660',true]] },
    { rank: 'FULL_HOUSE',     cards: [['Q','\u2660',false],['Q','\u2665',false],['Q','\u2666',false],['J','\u2663',false],['J','\u2660',false]] },
    { rank: 'FLUSH',          cards: [['A','\u2663',false],['10','\u2663',false],['7','\u2663',false],['4','\u2663',false],['2','\u2663',false]] },
    { rank: 'STRAIGHT',       cards: [['8','\u2660',false],['7','\u2665',false],['6','\u2666',false],['5','\u2663',false],['4','\u2660',false]] },
    { rank: 'THREE_KIND',     cards: [['J','\u2660',false],['J','\u2665',false],['J','\u2666',false],['8','\u2663',true],['3','\u2660',true]] },
    { rank: 'TWO_PAIR',       cards: [['10','\u2660',false],['10','\u2665',false],['9','\u2666',false],['9','\u2663',false],['5','\u2660',true]] },
    { rank: 'ONE_PAIR',       cards: [['A','\u2660',false],['A','\u2665',false],['K','\u2666',true],['7','\u2663',true],['2','\u2660',true]] }
  ];

  const rfPlusRow = `
    <div class="qr-row">
      <div class="qr-info">
        <div class="qr-name">${name('ROYAL_FLUSH_PLUS')}</div>
        <div class="qr-score">${scores.ROYAL_FLUSH_PLUS} pts</div>
      </div>
      <div class="qr-mini-cards">${rfPlusHTML}</div>
    </div>`;

  const rfRow = `
    <div class="qr-row">
      <div class="qr-info">
        <div class="qr-name">${name('ROYAL_FLUSH')}</div>
        <div class="qr-score">${scores.ROYAL_FLUSH} pts</div>
      </div>
      <div class="qr-mini-cards">${rfHTML}</div>
    </div>`;

  const otherRows = hands.map(h => {
    const cardsHTML = h.cards.map(([v,s,dim]) => textCard(v, s, dim)).join('');
    return `
      <div class="qr-row">
        <div class="qr-info">
          <div class="qr-name">${name(h.rank)}</div>
          <div class="qr-score">${scores[h.rank] ?? 0} pts</div>
        </div>
        <div class="qr-text-cards">${cardsHTML}</div>
      </div>`;
  }).join('');

  list.innerHTML = rfPlusRow + rfRow + otherRows;

  const titleEl = document.getElementById('qrTitle');
  if (titleEl) titleEl.textContent = i18n.t('quickRef.title');
}

function showQuickRef() {
  buildQuickRef();
  document.getElementById('qrOverlay').classList.add('active');
}

function closeQuickRef() {
  document.getElementById('qrOverlay').classList.remove('active');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeQuickRef();
});
