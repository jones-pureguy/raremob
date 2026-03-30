// ─── DragON POKER — Infinite Mode ───

const TIMER_SECONDS = 300;
const GRID_SIZE = 6;
const HAND_SIZE = 5;

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const VALUE_NAMES = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };

const RANK = {
  HIGH_CARD: 0, ONE_PAIR: 1, TWO_PAIR: 2, THREE_KIND: 3,
  STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8, ROYAL_FLUSH: 9, ROYAL_FLUSH_PLUS: 10,
};

const RANK_NAME_BY_VALUE = {};
Object.entries(RANK).forEach(([k, v]) => RANK_NAME_BY_VALUE[v] = k);

function getRankScore(rank) {
  return ScorePolicy.getHandScore(RANK_NAME_BY_VALUE[rank] || 'HIGH_CARD');
}

const RANK_LABELS = {
  [RANK.HIGH_CARD]: 'High Card', [RANK.ONE_PAIR]: 'One Pair', [RANK.TWO_PAIR]: 'Two Pair',
  [RANK.THREE_KIND]: 'Three of a Kind', [RANK.STRAIGHT]: 'Straight', [RANK.FLUSH]: 'Flush',
  [RANK.FULL_HOUSE]: 'Full House', [RANK.FOUR_KIND]: 'Four of a Kind',
  [RANK.STRAIGHT_FLUSH]: 'Straight Flush', [RANK.ROYAL_FLUSH]: 'Royal Flush',
  [RANK.ROYAL_FLUSH_PLUS]: 'Royal Flush+',
};

const RANK_CSS = {
  [RANK.ONE_PAIR]: 'one-pair', [RANK.TWO_PAIR]: 'two-pair', [RANK.THREE_KIND]: 'three-kind',
  [RANK.STRAIGHT]: 'straight', [RANK.FLUSH]: 'flush', [RANK.FULL_HOUSE]: 'full-house',
  [RANK.FOUR_KIND]: 'four-kind', [RANK.STRAIGHT_FLUSH]: 'straight-flush',
  [RANK.ROYAL_FLUSH]: 'royal-flush', [RANK.ROYAL_FLUSH_PLUS]: 'royal-flush-plus',
};

// ─── COLLECTED panel (rank-based counter) ───
const HAND_DISPLAY_ORDER = [
  'ROYAL_FLUSH_PLUS', 'ROYAL_FLUSH', 'STRAIGHT_FLUSH', 'FOUR_KIND',
  'FULL_HOUSE', 'FLUSH', 'STRAIGHT', 'THREE_KIND', 'TWO_PAIR', 'ONE_PAIR'
];

function getInfiniteHandLabel(rankName) {
  const fixed = { ONE_PAIR: 'One Pair (10+)', THREE_KIND: 'Three of a Kind' };
  return fixed[rankName] || RANK_LABELS[RANK[rankName]] || rankName;
}

let handCounts = {};
HAND_DISPLAY_ORDER.forEach(r => { handCounts[r] = 0; });

// ─── Combo system ───
const COMBO_RANKS = new Set([RANK.FOUR_KIND, RANK.STRAIGHT_FLUSH, RANK.ROYAL_FLUSH, RANK.ROYAL_FLUSH_PLUS]);
let comboCount = 0;
let totalHands = 0;
let infiniteScore = 0;

// ─── Game State ───
let state = {};
let outsideCards = []; // 16 cards outside the grid

function initState() {
  state = {
    grid: [], hands: [], selectedPath: [], isDragging: false,
    timer: TIMER_SECONDS, phase: 'playing', timerInterval: null,
    currentScore: 0, removedCards: [],
  };
}

// ─── Deck & Cards ───
function createDeck() {
  const deck = [];
  for (const s of SUITS) for (let v = 2; v <= 14; v++) deck.push({ suit: s, value: v, id: VALUE_NAMES[v] + SUIT_NAMES[s] });
  return deck;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function cardDisplay(card) { return VALUE_NAMES[card.value] + card.suit; }
function isRedSuit(suit) { return suit === '♥' || suit === '♦'; }

const SUIT_BY_CODE = { s: '♠', h: '♥', d: '♦', c: '♣' };
const VALUE_BY_NAME = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
function cardFromId(id) {
  const suitCode = id[id.length - 1];
  const valueName = id.slice(0, -1);
  return { suit: SUIT_BY_CODE[suitCode], value: VALUE_BY_NAME[valueName], id };
}

// ─── Grid Init & Render ───
function initGrid() {
  const deck = shuffle(createDeck()); // 52 cards
  const gridCards = deck.slice(0, 36);  // 6×6 = 36
  outsideCards = deck.slice(36);         // remaining 16

  state.grid = [];
  let idx = 0;
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) row.push({ card: gridCards[idx++], row: r, col: c });
    state.grid.push(row);
  }
}

function renderGrid() {
  const gridEl = document.getElementById('grid');
  gridEl.innerHTML = '';
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = state.grid[r][c];
      const div = document.createElement('div');
      div.dataset.row = r;
      div.dataset.col = c;
      if (cell.card) {
        const card = cell.card;
        div.className = 'card suit-' + SUIT_NAMES[card.suit];
        div.innerHTML = `<span class="card-value">${VALUE_NAMES[card.value]}</span><span class="card-suit">${card.suit}</span>`;
        if (state.selectedPath.some(p => p[0] === r && p[1] === c)) div.classList.add('selected');
      } else {
        div.className = 'card empty';
      }
      gridEl.appendChild(div);
    }
  }
  updateDragLine();
}

// ─── Drag Interaction ───
function getEventCoords(e) {
  if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches.length > 0) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function getCellFromEvent(e) {
  const { x, y } = getEventCoords(e);
  const gridEl = document.getElementById('grid');
  const children = gridEl.children;
  const inset = 0.15;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (el.classList.contains('empty')) continue;
    const rect = el.getBoundingClientRect();
    const mx = rect.width * inset, my = rect.height * inset;
    if (x >= rect.left + mx && x <= rect.right - mx && y >= rect.top + my && y <= rect.bottom - my)
      return [parseInt(el.dataset.row), parseInt(el.dataset.col)];
  }
  return null;
}

function updateSelectionVisuals() {
  const gridEl = document.getElementById('grid');
  const children = gridEl.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const r = parseInt(el.dataset.row), c = parseInt(el.dataset.col);
    el.classList.toggle('selected', state.selectedPath.some(p => p[0] === r && p[1] === c));
  }
  updateDragLine();
  updateHandPreview();
}

function startDrag(row, col) {
  if (state.phase !== 'playing') return;
  if (!state.grid[row][col].card) return;
  state.isDragging = true;
  state.selectedPath = [[row, col]];
  Sound.cardSelect(0);
  updateSelectionVisuals();
}

function extendPath(row, col) {
  if (!state.isDragging) return;
  if (!state.grid[row][col].card) return;

  if (state.selectedPath.some(p => p[0] === row && p[1] === col)) {
    if (state.selectedPath.length >= 2) {
      const prev = state.selectedPath[state.selectedPath.length - 2];
      if (prev[0] === row && prev[1] === col) {
        state.selectedPath.pop();
        const pathLenAfterRemove = state.selectedPath.length;
        if (pathLenAfterRemove >= 1 && pathLenAfterRemove <= 3) Sound.cardSelect(pathLenAfterRemove - 1);
        updateSelectionVisuals();
      }
    }
    return;
  }

  if (state.selectedPath.length >= HAND_SIZE) return;
  const last = state.selectedPath[state.selectedPath.length - 1];
  const dr = row - last[0], dc = col - last[1];
  if (dr === 0 && dc === 0) return;
  if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return;
  const stepR = Math.sign(dr), stepC = Math.sign(dc);
  let cr = last[0] + stepR, cc = last[1] + stepC;
  while (cr !== row || cc !== col) {
    if (cr < 0 || cr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) return;
    if (state.grid[cr][cc].card !== null) return;
    cr += stepR; cc += stepC;
  }

  state.selectedPath.push([row, col]);
  const pathLen = state.selectedPath.length;
  if (pathLen >= 1 && pathLen <= 4) Sound.cardSelect(pathLen - 1);
  updateSelectionVisuals();
}

function finalizePath() {
  if (!state.isDragging) return;
  state.isDragging = false;

  if (state.selectedPath.length < HAND_SIZE) {
    clearSelection();
    return;
  }

  const cards = state.selectedPath.map(([r, c]) => state.grid[r][c].card);
  const hand = evaluateHand(cards);

  // Royal Flush+ check
  if (hand.rank === RANK.ROYAL_FLUSH) {
    const dv = cards.map(c => c.value);
    if (dv[0] === 10 && dv[1] === 11 && dv[2] === 12 && dv[3] === 13 && dv[4] === 14) {
      hand.rank = RANK.ROYAL_FLUSH_PLUS;
      hand.rankValue = RANK.ROYAL_FLUSH_PLUS;
      hand.label = 'Royal Flush+';
    }
  }

  if (!isValidHand(hand)) {
    const gridEl = document.getElementById('grid');
    state.selectedPath.forEach(([r, c]) => {
      const idx = r * GRID_SIZE + c;
      const el = gridEl.children[idx];
      el.classList.add('invalid-shake');
      el.style.borderColor = '#ff5252';
      setTimeout(() => { el.classList.remove('invalid-shake'); el.style.borderColor = ''; }, 400);
    });
    setTimeout(() => clearSelection(), 400);
    return;
  }

  // ─── Finalize hand ───
  const rankName = RANK_NAME_BY_VALUE[hand.rank] || 'HIGH_CARD';
  const baseScore = getRankScore(hand.rank);

  // Combo
  let earnedScore;
  if (COMBO_RANKS.has(hand.rank)) {
    comboCount++;
    earnedScore = baseScore * comboCount;
    showComboBadge(hand.label, comboCount, earnedScore);
    Sound.handComplete(RANK.ROYAL_FLUSH_PLUS);
  } else {
    comboCount = 0;
    earnedScore = baseScore;
    Sound.handComplete(hand.rankValue);
  }

  infiniteScore += earnedScore;
  state.currentScore = infiniteScore;
  totalHands++;

  // Increment hand counter
  if (handCounts[rankName] !== undefined) handCounts[rankName]++;

  state.hands.push({ cards: [...cards], rank: hand.rank, rankValue: hand.rankValue, label: hand.label });

  updateScoreDisplay();
  updateHandPanel();
  const displayLabel = getInfiniteHandLabel(rankName);
  showScorePopup(displayLabel, earnedScore, hand.rank);
  removeCardsAndRefill(hand.rank);
}

function clearSelection() {
  state.selectedPath = [];
  updateSelectionVisuals();
}

// ─── Drag Line & Preview ───
function updateDragLine() {
  const line = document.getElementById('dragLine');
  if (state.selectedPath.length < 2) { line.setAttribute('points', ''); return; }
  const gridEl = document.getElementById('grid');
  const containerEl = document.getElementById('gridContainer');
  const containerRect = containerEl.getBoundingClientRect();
  const points = state.selectedPath.map(([r, c]) => {
    const idx = r * GRID_SIZE + c;
    const cardEl = gridEl.children[idx];
    if (!cardEl) return '0,0';
    const rect = cardEl.getBoundingClientRect();
    return `${rect.left + rect.width/2 - containerRect.left},${rect.top + rect.height/2 - containerRect.top}`;
  }).join(' ');
  line.setAttribute('points', points);
}

function updateHandPreview() {
  const previewEl = document.getElementById('handPreview');
  if (state.selectedPath.length === 0) { previewEl.textContent = ''; previewEl.className = 'hand-preview'; return; }
  const cards = state.selectedPath.map(([r, c]) => state.grid[r][c].card).filter(Boolean);
  if (cards.length < 2) { previewEl.textContent = `${cards.length}/5`; previewEl.className = 'hand-preview'; return; }
  const hand = evaluateHand(cards);
  const valid = cards.length === 5 && isValidHand(hand);
  const mark = cards.length === 5 ? (valid ? '✓' : '✗') : '';
  previewEl.textContent = `${hand.label} ${mark}`;
  previewEl.className = 'hand-preview ' + (cards.length === 5 ? (valid ? 'valid' : 'invalid') : '');
}

// ─── Hand Evaluation ───
function evaluateHand(cards) {
  if (cards.length < 5) return partialEval(cards);
  const values = cards.map(c => c.value).sort((a, b) => a - b);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  let isStraight = false;
  const unique = [...new Set(values)];
  if (unique.length === 5) {
    if (unique[4] - unique[0] === 4) isStraight = true;
    if (unique[0]===2&&unique[1]===3&&unique[2]===4&&unique[3]===5&&unique[4]===14) isStraight = true;
  }
  const counts = {};
  values.forEach(v => counts[v] = (counts[v]||0)+1);
  const cv = Object.values(counts).sort((a,b)=>b-a);
  const ck = Object.entries(counts).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  let rank, label;
  const isRoyal = (values[0]===10&&values[1]===11&&values[2]===12&&values[3]===13&&values[4]===14);
  if (isFlush && isStraight) {
    if (isRoyal) { rank = RANK.ROYAL_FLUSH; label = 'Royal Flush'; }
    else { rank = RANK.STRAIGHT_FLUSH; label = 'Straight Flush'; }
  } else if (cv[0]===4) { rank = RANK.FOUR_KIND; label = `Four ${VALUE_NAMES[ck[0][0]]}s`; }
  else if (cv[0]===3&&cv[1]===2) { rank = RANK.FULL_HOUSE; label = 'Full House'; }
  else if (isFlush) { rank = RANK.FLUSH; label = 'Flush'; }
  else if (isStraight) { rank = RANK.STRAIGHT; label = 'Straight'; }
  else if (cv[0]===3) { rank = RANK.THREE_KIND; label = `Three ${VALUE_NAMES[ck[0][0]]}s`; }
  else if (cv[0]===2&&cv[1]===2) { rank = RANK.TWO_PAIR; label = 'Two Pair'; }
  else if (cv[0]===2) { rank = RANK.ONE_PAIR; label = `Pair of ${VALUE_NAMES[parseInt(ck[0][0])]}s`; }
  else { rank = RANK.HIGH_CARD; label = 'High Card'; }
  const pairValue = rank === RANK.ONE_PAIR ? parseInt(ck[0][0]) : 0;
  return { rank, rankValue: rank, label, pairValue };
}

function partialEval(cards) {
  if (cards.length < 2) return { rank: RANK.HIGH_CARD, rankValue: 0, label: 'High Card', pairValue: 0 };
  const values = cards.map(c => c.value);
  const counts = {};
  values.forEach(v => counts[v] = (counts[v]||0)+1);
  const cv = Object.values(counts).sort((a,b)=>b-a);
  const ck = Object.entries(counts).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  if (cv[0]>=4) return { rank: RANK.FOUR_KIND, rankValue: RANK.FOUR_KIND, label: `Four ${VALUE_NAMES[ck[0][0]]}s`, pairValue: 0 };
  if (cv[0]===3&&cv[1]===2) return { rank: RANK.FULL_HOUSE, rankValue: RANK.FULL_HOUSE, label: 'Full House', pairValue: 0 };
  if (cv[0]===3) return { rank: RANK.THREE_KIND, rankValue: RANK.THREE_KIND, label: `Three ${VALUE_NAMES[ck[0][0]]}s`, pairValue: 0 };
  if (cv[0]===2&&cv[1]===2) return { rank: RANK.TWO_PAIR, rankValue: RANK.TWO_PAIR, label: 'Two Pair', pairValue: 0 };
  if (cv[0]===2) { const pv = parseInt(ck[0][0]); return { rank: RANK.ONE_PAIR, rankValue: RANK.ONE_PAIR, label: `Pair of ${VALUE_NAMES[pv]}s`, pairValue: pv }; }
  return { rank: RANK.HIGH_CARD, rankValue: 0, label: 'High Card', pairValue: 0 };
}

function isValidHand(hand) {
  if (hand.rank >= RANK.TWO_PAIR) return true;
  if (hand.rank === RANK.ONE_PAIR && hand.pairValue >= 10) return true;
  return false;
}

// ─── Card Removal + Refill (Infinite Mode core) ───
function removeCardsAndRefill(rank) {
  const gridEl = document.getElementById('grid');
  const positions = [...state.selectedPath];
  const tier = getHandTier(rank != null ? rank : RANK.ONE_PAIR);

  // Capture the 5 cards being removed BEFORE nullifying
  const removedCards = positions.map(([r, c]) => state.grid[r][c].card);

  const intervals = [0, 0, 0, 50, 40, 30];
  const interval = intervals[Math.min(tier, 5)] || 0;

  if (interval === 0) {
    positions.forEach(([r, c]) => { gridEl.children[r * GRID_SIZE + c].classList.add('removing'); });
  } else {
    positions.forEach(([r, c], i) => {
      setTimeout(() => {
        const cell = gridEl.children[r * GRID_SIZE + c];
        if (cell) cell.classList.add('removing');
      }, i * interval);
    });
  }

  const totalRemovalTime = interval * (positions.length - 1);
  setTimeout(() => {
    // Nullify removed positions
    positions.forEach(([r, c]) => { state.grid[r][c].card = null; });

    // Apply gravity first
    const affectedCols = [...new Set(positions.map(p => p[1]))];
    affectedCols.forEach(col => applyGravityToColumn(col));
    Sound.cardDrop();

    // Pool = 16 outside + 5 removed = 21, pick 5 for grid, 16 remain outside
    const pool = [...outsideCards, ...removedCards].filter(Boolean);
    shuffle(pool);
    const toGrid = pool.slice(0, 5);
    outsideCards = pool.slice(5); // always 16

    // Find empty cells (after gravity)
    const emptyCells = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (!state.grid[r][c].card) emptyCells.push([r, c]);
      }
    }
    shuffle(emptyCells);
    toGrid.forEach((card, i) => {
      if (i < emptyCells.length) {
        const [r, c] = emptyCells[i];
        state.grid[r][c].card = card;
      }
    });

    // Apply gravity again after refill
    for (let col = 0; col < GRID_SIZE; col++) applyGravityToColumn(col);

    state.selectedPath = [];
    renderGrid();
    updateHandPanel();
    updateHandPreview();
    renderOutsideCards();

    // NO MORE MOVES check
    setTimeout(() => {
      if (state.phase === 'playing' && !scanForValidMoves()) {
        endGame('nomoves');
      }
    }, 500);
  }, 300 + totalRemovalTime);
}

function applyGravityToColumn(col) {
  const cards = [];
  for (let r = GRID_SIZE - 1; r >= 0; r--) { if (state.grid[r][col].card) cards.push(state.grid[r][col].card); }
  for (let r = GRID_SIZE - 1; r >= 0; r--) { const idx = GRID_SIZE - 1 - r; state.grid[r][col].card = idx < cards.length ? cards[idx] : null; }
}

// ─── Timer ───
function startTimer() {
  state.timer = TIMER_SECONDS;
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    if (state.phase !== 'playing') return;
    state.timer--;
    updateTimerDisplay();
    if (state.timer <= 0) endGame('gameover');
  }, 2000);
}

function updateTimerDisplay() {
  const numEl = document.getElementById('timerNum');
  const ringEl = document.getElementById('timerRing');
  const circumference = 2 * Math.PI * 16;
  numEl.textContent = Math.max(0, state.timer);
  const offset = circumference * (1 - state.timer / TIMER_SECONDS);
  ringEl.style.strokeDashoffset = offset;
  numEl.classList.remove('warning', 'urgent');
  if (state.timer <= 10) { numEl.classList.add('urgent'); ringEl.style.stroke = '#ff3333'; }
  else if (state.timer <= 30) { numEl.classList.add('warning'); ringEl.style.stroke = 'orange'; }
  else { ringEl.style.stroke = 'var(--gold)'; }
}

// ─── COLLECTED panel (rank counter) ───
function updateHandPanel() {
  const panel = document.getElementById('handPanel');
  const col1 = HAND_DISPLAY_ORDER.slice(0, 5);
  const col2 = HAND_DISPLAY_ORDER.slice(5, 10);

  const renderCol = (ranks) => ranks.map(rankName => {
    const count = handCounts[rankName] || 0;
    const label = getInfiniteHandLabel(rankName);
    return `<div class="inf-hand-row ${count > 0 ? 'active' : ''}">
      <span class="inf-hand-label">${label}</span>
      <span class="inf-hand-count">${count > 0 ? '×' + count : '—'}</span>
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="inf-hand-col">${renderCol(col1)}</div>
    <div class="inf-hand-col">${renderCol(col2)}</div>
  `;
  document.getElementById('totalHandCount').textContent = totalHands;
}

// ─── Score Display ───
function updateScoreDisplay() {
  document.getElementById('currentScore').textContent = infiniteScore;
  document.getElementById('highScoreDisplay').textContent = getHighScore();
}

function getHighScore() { return parseInt(localStorage.getItem('poker_infinite_hi') || '0'); }
function saveHighScore(score) {
  const cur = getHighScore();
  if (score > cur) { localStorage.setItem('poker_infinite_hi', score); return true; }
  return false;
}

// ─── Visual Effects ───
function getHandTier(rank) {
  if (rank >= RANK.ROYAL_FLUSH_PLUS) return 6;
  if (rank >= RANK.ROYAL_FLUSH) return 5;
  if (rank >= RANK.STRAIGHT_FLUSH) return 4;
  if (rank >= RANK.FULL_HOUSE) return 3;
  if (rank >= RANK.THREE_KIND) return 2;
  return 1;
}

function triggerScreenFlash(tier) {
  const flash = document.createElement('div');
  flash.className = 'screen-flash';
  const colors = { 4: 'rgba(32,200,180,0.18)', 5: 'rgba(201,168,76,0.25)', 6: 'rgba(201,168,76,0.4)' };
  flash.style.background = colors[Math.min(tier, 6)] || colors[4];
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 500);
}

function spawnParticles(count) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'popup-particle';
    const angle = (360/count)*i + Math.random()*20;
    const dist = 60 + Math.random()*40;
    const rad = angle * Math.PI / 180;
    p.style.setProperty('--tx', `${Math.cos(rad)*dist}px`);
    p.style.setProperty('--ty', `${Math.sin(rad)*dist}px`);
    p.style.animationDelay = `${0.32 + Math.random()*0.1}s`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

function showScorePopup(label, pts, rank) {
  const tier = getHandTier(rank != null ? rank : RANK.ONE_PAIR);
  const popup = document.createElement('div');
  popup.className = `score-popup tier-${tier}`;
  const ptsHTML = (pts !== undefined) ? `<div class="popup-pts">+${pts}</div>` : '';
  popup.innerHTML = `<div class="popup-rank">${label}</div>${ptsHTML}`;
  if (tier >= 6) { popup.style.animationDelay = '0.32s'; popup.style.opacity = '0'; }
  document.body.appendChild(popup);
  if (tier >= 4) triggerScreenFlash(tier);
  if (tier >= 6) spawnParticles(4);
  setTimeout(() => popup.remove(), 1800);
}

// ─── Combo Badge ───
function showComboBadge(handLabel, count, score) {
  const badge = document.getElementById('comboBadge');
  badge.innerHTML = `
    <div class="combo-rank">${handLabel}</div>
    <div class="combo-count">× ${count} COMBO!</div>
    <div class="combo-score">+${score}pts</div>
  `;
  badge.classList.remove('active');
  void badge.offsetWidth; // reflow
  badge.classList.add('active');
  setTimeout(() => badge.classList.remove('active'), 1500);
}

// ─── Outside Cards (8×2) ───
function renderOutsideCards() {
  const area = document.getElementById('outsideCardsArea');
  if (!area) return;
  const slots = Array(16).fill(null).map((_, i) => outsideCards[i] || null);
  area.innerHTML = slots.map(card => {
    if (!card) return `<div class="outside-card-slot empty"></div>`;
    const suitClass = 'suit-' + SUIT_NAMES[card.suit];
    return `<div class="outside-card-slot ${suitClass}">
      <span class="oc-val">${VALUE_NAMES[card.value]}</span>
      <span class="oc-suit">${card.suit}</span>
    </div>`;
  }).join('');
}

// ─── Valid Move Scanner ───
function scanForValidMoves() {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!state.grid[r][c].card) continue;
      if (findHandFrom(r, c, [[r, c]], 1)) return true;
    }
  }
  return false;
}

function findHandFrom(r, c, path, depth) {
  if (depth >= HAND_SIZE) {
    const cards = path.map(([pr, pc]) => state.grid[pr][pc].card);
    const hand = evaluateHand(cards);
    return isValidHand(hand);
  }
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for (const [dr, dc] of dirs) {
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
      if (state.grid[nr][nc].card && !path.some(p => p[0] === nr && p[1] === nc)) {
        path.push([nr, nc]);
        if (findHandFrom(nr, nc, path, depth + 1)) return true;
        path.pop();
        break;
      }
      if (state.grid[nr][nc].card) break;
      nr += dr; nc += dc;
    }
  }
  return false;
}

// ─── Toast ───
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ─── Game End ───
function endGame(reason) {
  state.phase = 'gameover';
  clearInterval(state.timerInterval);

  const finalScore = infiniteScore;
  const isNewHi = saveHighScore(finalScore);
  const highScore = Math.max(getHighScore(), finalScore);

  const sorted = [...state.hands].sort((a, b) => b.rankValue - a.rankValue);
  const best = sorted[0];

  const title = reason === 'nomoves' ? i18n.t('modal.noMoreMoves') : i18n.t('modal.timeUp');

  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>${title}</h2>
    <div class="subtitle">${totalHands}패 완성</div>
    ${best ? `<div class="best-hand">${i18n.t('modal.best', { hand: best.label })}</div>` : ''}
    <div class="score">${i18n.t('modal.score', { score: finalScore })}</div>
    ${isNewHi ? `<div style="color:var(--gold);font-size:1rem;font-weight:700;margin-bottom:4px;">${i18n.t('modal.newHighScore')}</div>` : ''}
    <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:8px;">${i18n.t('modal.myHighScore', { score: highScore })}</div>
    <div id="infTopScoreRow" style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:8px;"></div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button class="btn-play-again" onclick="restartGame()">${i18n.t('ui.playAgain')}</button>
      <a href="index.html" class="btn-play-again" style="background:rgba(255,255,255,0.1);color:#e0e0e0;text-decoration:none;display:flex;align-items:center;">${i18n.t('ui.gameEnd')}</a>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('active');

  // Save leaderboard
  saveInfiniteLeaderboard(finalScore);
}

async function saveInfiniteLeaderboard(score) {
  const username = (localStorage.getItem('poker_username') || '').trim();
  if (!username || score <= 0) return;

  try {
    // Ensure auth is initialized
    const playerId = await initAuth();
    if (!playerId) { console.warn('[Infinite] No auth, skipping leaderboard'); return; }

    const { data: existing, error: fetchErr } = await sb
      .from('leaderboard_infinite')
      .select('score')
      .eq('player_id', playerId)
      .maybeSingle();

    if (fetchErr) console.warn('[Infinite] Fetch existing:', fetchErr.message);

    if (!existing || score > existing.score) {
      const { error: upsertErr } = await sb.from('leaderboard_infinite').upsert({
        player_id: playerId,
        username,
        score,
      }, { onConflict: 'player_id' });
      if (upsertErr) console.error('[Infinite] Upsert error:', upsertErr.message);
      else console.log('[Infinite] Leaderboard saved:', score);
    }

    // Fetch top score
    const { data: topRow } = await sb
      .from('leaderboard_infinite')
      .select('score')
      .order('score', { ascending: false })
      .limit(1)
      .maybeSingle();
    const topEl = document.getElementById('infTopScoreRow');
    if (topEl && topRow) topEl.textContent = i18n.t('modal.allUserHighScore', { score: topRow.score });
  } catch(e) {
    console.error('[Infinite] Leaderboard error:', e);
  }
}

// ─── Restart ───
function restartGame() {
  document.getElementById('modalOverlay').classList.remove('active');
  clearInterval(state.timerInterval);

  initState();
  initGrid();
  comboCount = 0;
  totalHands = 0;
  infiniteScore = 0;
  HAND_DISPLAY_ORDER.forEach(r => { handCounts[r] = 0; });

  renderGrid();
  updateHandPanel();
  updateHandPreview();
  updateScoreDisplay();
  renderOutsideCards();
  startTimer();
}

// ─── Quick Reference ───
document.querySelector('.qr-btn').addEventListener('click', () => {
  if (typeof QuickRef !== 'undefined') QuickRef.toggle();
});

// ─── Start Overlay ───
function initStartOverlay(onStart) {
  const overlay = document.getElementById('startOverlay');
  const btn = document.getElementById('startBtn');
  const grid = document.getElementById('gridContainer') || document.getElementById('grid');
  if (grid) grid.style.pointerEvents = 'none';
  if (!overlay) { if (grid) grid.style.pointerEvents = ''; onStart(); return; }
  function handleStart(e) {
    e.stopPropagation();
    Sound.warmup();
    BGM.start();
    overlay.classList.add('hiding');
    setTimeout(() => {
      overlay.remove();
      if (grid) grid.style.pointerEvents = '';
      onStart();
    }, 300);
  }
  btn.addEventListener('click', handleStart);
  overlay.addEventListener('click', handleStart);
}

// ─── Event Listeners ───
function setupEventListeners() {
  const gridEl = document.getElementById('grid');
  gridEl.addEventListener('mousedown', e => { const cell = getCellFromEvent(e); if (cell) startDrag(cell[0], cell[1]); });
  gridEl.addEventListener('mousemove', e => { const cell = getCellFromEvent(e); if (cell) extendPath(cell[0], cell[1]); });
  document.addEventListener('mouseup', () => { if (state.isDragging) finalizePath(); });
  gridEl.addEventListener('touchstart', e => { e.preventDefault(); const cell = getCellFromEvent(e); if (cell) startDrag(cell[0], cell[1]); }, { passive: false });
  document.addEventListener('touchmove', e => { if (!state.isDragging) return; e.preventDefault(); const cell = getCellFromEvent(e); if (cell) extendPath(cell[0], cell[1]); }, { passive: false });
  document.addEventListener('touchend', e => { if (state.isDragging) { e.preventDefault(); finalizePath(); } }, { passive: false });
  document.addEventListener('touchcancel', () => { if (state.isDragging) { state.isDragging = false; clearSelection(); } });
}

// ─── Init ───
initState();
initGrid();
renderGrid();
updateHandPanel();
updateScoreDisplay();
renderOutsideCards();

setupEventListeners();

BGM.init('./audio/Infinite_Theme.mp3');
initStartOverlay(() => {
  startTimer();
});
