// ── DragON POKER Tutorial Mode ──

// ── Constants (from puzzle engine) ──
const GRID_SIZE = 7;
const MAX_HANDS = 9;
const HAND_SIZE = 5;

const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
const SUIT_NAMES = { '\u2660': 's', '\u2665': 'h', '\u2666': 'd', '\u2663': 'c' };
const SUIT_BY_CODE = { s: '\u2660', h: '\u2665', d: '\u2666', c: '\u2663' };
const VALUE_NAMES = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };
const VALUE_BY_NAME = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

const RANK = {
  HIGH_CARD: 0, ONE_PAIR: 1, TWO_PAIR: 2, THREE_KIND: 3,
  STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8, ROYAL_FLUSH: 9, ROYAL_FLUSH_PLUS: 10,
};
const RANK_BY_NAME = {
  'HIGH_CARD': 0, 'ONE_PAIR': 1, 'TWO_PAIR': 2, 'THREE_KIND': 3,
  'STRAIGHT': 4, 'FLUSH': 5, 'FULL_HOUSE': 6, 'FOUR_KIND': 7,
  'STRAIGHT_FLUSH': 8, 'ROYAL_FLUSH': 9, 'ROYAL_FLUSH_PLUS': 10,
};

// ── Tutorial State ──
let tutorials = [];
let currentStep = 0;
let currentPhaseIdx = 0;
let currentLineIdx = 0;
let waitingForMission = false;
let tutorialEnded = false;
let tutorialStarted = false;
let orderedStraightCount = 0;

// ── Game State ──
let state = {};
let tutConfig = null; // current step config (acts like puzzleConfig)

function initState() {
  state = {
    grid: [], hands: [], selectedPath: [], isDragging: false,
    phase: 'playing',
  };
}

// ── Card ──
function cardFromId(id) {
  const suitCode = id[id.length - 1];
  const valueName = id.slice(0, -1);
  return { suit: SUIT_BY_CODE[suitCode], value: VALUE_BY_NAME[valueName], id };
}
function cardDisplay(card) { return VALUE_NAMES[card.value] + card.suit; }

// ── Deck Loader ──
function loadTutorialDeck(initialDeck) {
  const normalized = initialDeck.map(id =>
    (!id || id.trim() === '') ? null : id.trim()
  );
  if (normalized.length !== 49) {
    console.error('initialDeck must have 49 elements');
    return;
  }
  state.grid = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const cardId = normalized[r * GRID_SIZE + c];
      row.push({ card: cardId ? cardFromId(cardId) : null, row: r, col: c });
    }
    state.grid.push(row);
  }
}

// ── Random Deck (for step 9 restart) ──
function loadRandomDeck() {
  const deck = [];
  for (const s of ['s','h','d','c']) {
    for (let v = 2; v <= 14; v++) {
      deck.push(VALUE_NAMES[v] + s);
    }
  }
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const grid49 = deck.slice(0, 49);
  state.grid = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const cardId = grid49[r * GRID_SIZE + c];
      row.push({ card: cardFromId(cardId), row: r, col: c });
    }
    state.grid.push(row);
  }
}

// ── Grid Render ──
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

// ── Drag Interaction ──
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
    const cardEl = children[i];
    if (cardEl.classList.contains('empty')) continue;
    const rect = cardEl.getBoundingClientRect();
    const mx = rect.width * inset, my = rect.height * inset;
    if (x >= rect.left + mx && x <= rect.right - mx && y >= rect.top + my && y <= rect.bottom - my) {
      return [parseInt(cardEl.dataset.row), parseInt(cardEl.dataset.col)];
    }
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
  if (state.phase !== 'playing' || tutorialEnded) return;
  if (!waitingForMission) return; // Only allow drag during instruction phase
  if (!state.grid[row][col].card) return;
  state.isDragging = true;
  state.selectedPath = [[row, col]];
  Sound.cardSelect(0);
  updateSelectionVisuals();
}

function isValidTutorialMove(fromR, fromC, toR, toC) {
  if (!tutConfig) return true;
  const c = tutConfig.constraints;
  const dr = toR - fromR, dc = toC - fromC;
  const adr = Math.abs(dr), adc = Math.abs(dc);
  const isDiag = adr >= 1 && adc >= 1 && adr === adc;
  const isOrtho = (adr >= 1 && adc === 0) || (adr === 0 && adc >= 1);
  if (c.diagonalOnly && !isDiag) return false;
  if (!c.diagonalAllowed && isDiag) return false;
  return true;
}

function extendPath(row, col) {
  if (!state.isDragging) return;
  if (!state.grid[row][col].card) return;

  // Backtracking
  if (state.selectedPath.some(p => p[0] === row && p[1] === col)) {
    if (state.selectedPath.length >= 2) {
      const prev = state.selectedPath[state.selectedPath.length - 2];
      if (prev[0] === row && prev[1] === col) {
        state.selectedPath.pop();
        const pathLenAfterRemove = state.selectedPath.length;
        if (pathLenAfterRemove >= 1 && pathLenAfterRemove <= 3) {
          Sound.cardSelect(pathLenAfterRemove - 1);
        }
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

  // Jump check
  const jumpAllowed = tutConfig ? tutConfig.constraints.jumpAllowed : true;
  const stepR = Math.sign(dr), stepC = Math.sign(dc);
  let cr = last[0] + stepR, cc = last[1] + stepC;
  while (cr !== row || cc !== col) {
    if (cr < 0 || cr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) return;
    if (state.grid[cr][cc].card !== null) return;
    if (!jumpAllowed) return;
    cr += stepR; cc += stepC;
  }

  if (!isValidTutorialMove(last[0], last[1], row, col)) return;
  state.selectedPath.push([row, col]);
  const pathLen = state.selectedPath.length;
  if (pathLen >= 1 && pathLen <= 4) {
    Sound.cardSelect(pathLen - 1);
  }
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

  const handData = { cards: [...cards], rank: hand.rank, rankValue: hand.rankValue, label: hand.label };

  // Track ordered straight
  if (tutConfig) {
    const osConditions = tutConfig.mission.conditions.filter(c => c.type === 'ordered_straight');
    if (osConditions.length > 0) {
      const dragValues = cards.map(c => c.value);
      let ascending = true, descending = true;
      for (let i = 1; i < dragValues.length; i++) {
        if (dragValues[i] !== dragValues[i-1] + 1) ascending = false;
        if (dragValues[i] !== dragValues[i-1] - 1) descending = false;
      }
      const isOrdered = ascending || descending;
      for (const osc of osConditions) {
        if (isOrdered && osc.hand === 'ROYAL_FLUSH_PLUS' && hand.rank >= RANK.ROYAL_FLUSH) {
          // RF+ requires ascending 10-J-Q-K-A specifically
          const dv = cards.map(c => c.value);
          if (dv[0]===10 && dv[1]===11 && dv[2]===12 && dv[3]===13 && dv[4]===14) {
            orderedStraightCount++;
          }
        } else if (isOrdered && osc.hand === 'STRAIGHT_FLUSH' && hand.rank >= RANK.STRAIGHT_FLUSH) {
          orderedStraightCount++;
        } else if (isOrdered && osc.hand === 'STRAIGHT' && hand.rank >= RANK.STRAIGHT) {
          orderedStraightCount++;
        }
      }
    }
  }

  state.hands.push(handData);
  Sound.handComplete(hand.rankValue);
  showScorePopup(hand.label, hand.rank);
  removeCardsAndApplyGravity(hand.rank);

  // Check mission completion
  if (waitingForMission) {
    setTimeout(() => onTutorialHandComplete(handData), 400);
  }
}

function clearSelection() {
  state.selectedPath = [];
  updateSelectionVisuals();
}

// ── Drag Line & Preview ──
function updateDragLine() {
  const line = document.getElementById('dragLine');
  if (!line) return;
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
  if (!previewEl) return;
  if (state.selectedPath.length === 0) { previewEl.textContent = ''; previewEl.className = 'hand-preview'; return; }
  const cards = state.selectedPath.map(([r, c]) => state.grid[r][c].card).filter(Boolean);
  if (cards.length < 2) { previewEl.textContent = `${cards.length}/5`; previewEl.className = 'hand-preview'; return; }
  const hand = evaluateHand(cards);
  const valid = cards.length === 5 && isValidHand(hand);
  const mark = cards.length === 5 ? (valid ? '\u2713' : '\u2717') : '';
  previewEl.textContent = `${hand.label} ${mark}`;
  previewEl.className = 'hand-preview ' + (cards.length === 5 ? (valid ? 'valid' : 'invalid') : '');
}

// ── Hand Evaluation ──
function evaluateHand(cards) {
  if (cards.length < 5) return partialEval(cards);
  const values = cards.map(c => c.value).sort((a, b) => a - b);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  let isStraight = false;
  const unique = [...new Set(values)];
  if (unique.length === 5) {
    if (unique[4] - unique[0] === 4) isStraight = true;
    if (unique[0]===2 && unique[1]===3 && unique[2]===4 && unique[3]===5 && unique[4]===14) isStraight = true;
  }
  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const cv = Object.values(counts).sort((a,b) => b-a);
  const ck = Object.entries(counts).sort((a,b) => b[1]-a[1] || b[0]-a[0]);
  let rank, label;
  const isRoyal = (values[0]===10&&values[1]===11&&values[2]===12&&values[3]===13&&values[4]===14);
  if (isFlush && isStraight) {
    if (isRoyal) { rank = RANK.ROYAL_FLUSH; label = 'Royal Flush'; }
    else { rank = RANK.STRAIGHT_FLUSH; label = 'Straight Flush'; }
  } else if (cv[0]===4) { rank = RANK.FOUR_KIND; label = `Four ${VALUE_NAMES[ck[0][0]]}s`; }
  else if (cv[0]===3 && cv[1]===2) { rank = RANK.FULL_HOUSE; label = 'Full House'; }
  else if (isFlush) { rank = RANK.FLUSH; label = 'Flush'; }
  else if (isStraight) { rank = RANK.STRAIGHT; label = 'Straight'; }
  else if (cv[0]===3) { rank = RANK.THREE_KIND; label = `Three ${VALUE_NAMES[ck[0][0]]}s`; }
  else if (cv[0]===2 && cv[1]===2) { rank = RANK.TWO_PAIR; label = 'Two Pair'; }
  else if (cv[0]===2) { rank = RANK.ONE_PAIR; label = `Pair of ${VALUE_NAMES[parseInt(ck[0][0])]}s`; }
  else { rank = RANK.HIGH_CARD; label = 'High Card'; }
  const pairValue = rank === RANK.ONE_PAIR ? parseInt(ck[0][0]) : 0;
  return { rank, rankValue: rank, label, pairValue };
}

function partialEval(cards) {
  if (cards.length < 2) return { rank: RANK.HIGH_CARD, rankValue: 0, label: 'High Card', pairValue: 0 };
  const values = cards.map(c => c.value);
  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const cv = Object.values(counts).sort((a,b) => b-a);
  const ck = Object.entries(counts).sort((a,b) => b[1]-a[1] || b[0]-a[0]);
  if (cv[0]>=4) return { rank: RANK.FOUR_KIND, rankValue: RANK.FOUR_KIND, label: `Four ${VALUE_NAMES[ck[0][0]]}s`, pairValue: 0 };
  if (cv[0]===3 && cv[1]===2) return { rank: RANK.FULL_HOUSE, rankValue: RANK.FULL_HOUSE, label: 'Full House', pairValue: 0 };
  if (cv[0]===3) return { rank: RANK.THREE_KIND, rankValue: RANK.THREE_KIND, label: `Three ${VALUE_NAMES[ck[0][0]]}s`, pairValue: 0 };
  if (cv[0]===2 && cv[1]===2) return { rank: RANK.TWO_PAIR, rankValue: RANK.TWO_PAIR, label: 'Two Pair', pairValue: 0 };
  if (cv[0]===2) { const pv = parseInt(ck[0][0]); return { rank: RANK.ONE_PAIR, rankValue: RANK.ONE_PAIR, label: `Pair of ${VALUE_NAMES[pv]}s`, pairValue: pv }; }
  return { rank: RANK.HIGH_CARD, rankValue: 0, label: 'High Card', pairValue: 0 };
}

function isValidHand(hand) {
  if (hand.rank >= RANK.TWO_PAIR) return true;
  if (hand.rank === RANK.ONE_PAIR && hand.pairValue >= 10) return true;
  return false;
}

// ── Gravity ──
function removeCardsAndApplyGravity(rank) {
  const gridEl = document.getElementById('grid');
  const positions = [...state.selectedPath];
  const tier = getHandTier(rank != null ? rank : RANK.ONE_PAIR);

  const intervals = [0, 0, 0, 50, 40, 30];
  const interval = intervals[Math.min(tier, 5)] || 0;

  if (interval === 0) {
    positions.forEach(([r, c]) => {
      gridEl.children[r * GRID_SIZE + c].classList.add('removing');
    });
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
    positions.forEach(([r, c]) => { state.grid[r][c].card = null; });
    const cols = [...new Set(positions.map(p => p[1]))];
    cols.forEach(col => applyGravityToColumn(col));
    Sound.cardDrop();
    state.selectedPath = [];
    renderGrid();
    updateHandPreview();
  }, 300 + totalRemovalTime);
}

function applyGravityToColumn(col) {
  const cards = [];
  for (let r = GRID_SIZE - 1; r >= 0; r--) { if (state.grid[r][col].card) cards.push(state.grid[r][col].card); }
  for (let r = GRID_SIZE - 1; r >= 0; r--) { const idx = GRID_SIZE - 1 - r; state.grid[r][col].card = idx < cards.length ? cards[idx] : null; }
}

function applyGravityToAll() {
  for (let col = 0; col < GRID_SIZE; col++) applyGravityToColumn(col);
}

// ── Score Popup ──
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
  const colors = {
    4: 'rgba(32, 200, 180, 0.18)',
    5: 'rgba(201, 168, 76, 0.25)',
    6: 'rgba(201, 168, 76, 0.4)'
  };
  flash.style.background = colors[Math.min(tier, 6)] || colors[4];
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 500);
}

function spawnParticles(count) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'popup-particle';
    const angle = (360 / count) * i + Math.random() * 20;
    const dist  = 60 + Math.random() * 40;
    const rad   = angle * Math.PI / 180;
    const tx    = Math.cos(rad) * dist;
    const ty    = Math.sin(rad) * dist;
    p.style.setProperty('--tx', `${tx}px`);
    p.style.setProperty('--ty', `${ty}px`);
    p.style.animationDelay = `${0.32 + Math.random() * 0.1}s`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

function showScorePopup(label, rank) {
  const tier = getHandTier(rank != null ? rank : RANK.ONE_PAIR);
  const popup = document.createElement('div');
  popup.className = `score-popup tier-${tier}`;
  popup.innerHTML = `<div class="popup-rank">${label}</div>`;
  if (tier >= 6) {
    popup.style.animationDelay = '0.32s';
    popup.style.opacity = '0';
  }
  document.body.appendChild(popup);
  if (tier >= 4) triggerScreenFlash(tier);
  if (tier >= 6) spawnParticles(4);
  setTimeout(() => popup.remove(), 1800);
}

// ── Mission Check ──
function checkTutorialMission(mission, lastHand) {
  if (mission.type === 'restart_pressed') return false;
  if (mission.type !== 'real_time') return false;
  return mission.conditions.every(cond => {
    if (cond.type === 'specific_hand') {
      const targetRank = RANK_BY_NAME[cond.hand];
      if (cond.exact) {
        return state.hands.filter(h => h.rank === targetRank).length >= (cond.count_gte || 1);
      }
      return state.hands.filter(h => h.rank >= targetRank).length >= (cond.count_gte || 1);
    }
    if (cond.type === 'ordered_straight') {
      return orderedStraightCount >= (cond.count_gte || 1);
    }
    if (cond.type === 'hands_complete') {
      return state.hands.length >= (cond.count_gte || cond.count || MAX_HANDS);
    }
    return false;
  });
}

// ══════════════════════════════════════
// ── Tutorial Dialog System ──
// ══════════════════════════════════════

const isReplay = new URLSearchParams(location.search).get('replay') === '1';
let typingTimer = null;

// ─── Start Overlay ───
function initStartOverlay(onStart) {
  const overlay = document.getElementById('startOverlay');
  const btn = document.getElementById('startBtn');
  const grid = document.getElementById('gridContainer') || document.getElementById('grid');
  if (grid) grid.style.pointerEvents = 'none';
  if (!overlay) {
    if (grid) grid.style.pointerEvents = '';
    onStart();
    return;
  }
  function handleStart(e) {
    e.stopPropagation();
    Sound.warmup();
    BGM.warmupAndPlay();
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

async function initTutorial() {
  try {
    const res = await fetch('./tutorials.json');
    tutorials = await res.json();
  } catch(e) {
    console.error('Failed to load tutorials.json:', e);
    return;
  }

  currentStep = 0;
  setupDragEvents();
  setupDialogEvents();

  initStartOverlay(() => {
    tutorialStarted = true;
    loadStep(currentStep);
  });
}

function setupDragEvents() {
  const gridEl = document.getElementById('grid');
  gridEl.addEventListener('mousedown', e => {
    const cell = getCellFromEvent(e);
    if (cell) startDrag(cell[0], cell[1]);
  });
  gridEl.addEventListener('mousemove', e => {
    const cell = getCellFromEvent(e);
    if (cell) extendPath(cell[0], cell[1]);
  });
  document.addEventListener('mouseup', () => {
    if (state.isDragging) finalizePath();
  });
  gridEl.addEventListener('touchstart', e => {
    e.preventDefault();
    const cell = getCellFromEvent(e);
    if (cell) startDrag(cell[0], cell[1]);
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (!state.isDragging) return;
    e.preventDefault();
    const cell = getCellFromEvent(e);
    if (cell) extendPath(cell[0], cell[1]);
  }, { passive: false });
  document.addEventListener('touchend', e => {
    if (state.isDragging) { e.preventDefault(); finalizePath(); }
  }, { passive: false });
  document.addEventListener('touchcancel', () => {
    if (state.isDragging) { state.isDragging = false; clearSelection(); }
  });
}

function setupDialogEvents() {
  // NEXT button
  const nextBtn = document.getElementById('tutNextBtn');
  let btnTouched = false;
  nextBtn.addEventListener('touchend', e => {
    e.preventDefault();
    e.stopPropagation();
    btnTouched = true;
    onDialogClick();
  }, { passive: false });
  nextBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (btnTouched) { btnTouched = false; return; }
    onDialogClick();
  });

  // Full-screen tap (for non-instruction phases)
  let bodyTouched = false;
  document.body.addEventListener('touchend', e => {
    if (waitingForMission) return;
    if (tutorialEnded) return;
    if (!tutorialStarted) return;
    // Ignore if touch was on grid (drag events)
    if (e.target.closest('.grid-container')) return;
    if (e.target.closest('.tut-next-btn')) return;
    if (e.target.closest('.tut-skip-btn')) return;
    if (e.target.closest('.tut-restart-btn')) return;
    if (e.target.closest('.start-overlay')) return;
    e.preventDefault();
    bodyTouched = true;
    onDialogClick();
  }, { passive: false });
  document.body.addEventListener('click', e => {
    if (waitingForMission) return;
    if (tutorialEnded) return;
    if (!tutorialStarted) return;
    if (e.target.closest('.grid-container')) return;
    if (e.target.closest('.tut-next-btn')) return;
    if (e.target.closest('.tut-skip-btn')) return;
    if (e.target.closest('.tut-restart-btn')) return;
    if (e.target.closest('.start-overlay')) return;
    if (bodyTouched) { bodyTouched = false; return; }
    onDialogClick();
  });
}

// ── Step Loading ──
function loadStep(idx) {
  if (idx >= tutorials.length) {
    completeTutorial();
    return;
  }

  const step = tutorials[idx];
  tutConfig = step;
  currentPhaseIdx = 0;
  currentLineIdx = 0;
  waitingForMission = false;
  orderedStraightCount = 0;

  // Progress display
  document.getElementById('tutProgress').textContent = `${idx + 1} / ${tutorials.length}`;

  // Restart button
  const restartBtn = document.getElementById('tutRestartBtn');
  restartBtn.disabled = false;

  // Init grid
  initState();
  loadTutorialDeck(step.initialDeck);
  applyGravityToAll();
  renderGrid();

  // Show first dialog
  showCurrentDialog();
}

// ── Dialog Display ──
function showCurrentDialog() {
  const step = tutorials[currentStep];
  if (!step || !step.dialogs[currentPhaseIdx]) return;
  const phase = step.dialogs[currentPhaseIdx];
  const line = phase.lines[currentLineIdx];
  if (!line) return;

  const lang = i18n.getLang();
  const text = line[lang] || line['en'] || line['ko'] || '';

  const textEl = document.getElementById('tutDialogText');
  const nextBtn = document.getElementById('tutNextBtn');
  const areaEl = document.getElementById('tutDialogArea');

  // Typing effect
  typeText(textEl, text);

  // Action prompt
  const prompt = document.getElementById('tutActionPrompt');
  const promptText = document.getElementById('tutActionText');

  // Instruction phase = waiting for mission
  if (phase.phase === 'instruction') {
    areaEl.classList.add('instruction-mode');
    nextBtn.classList.add('hidden');
    waitingForMission = true;
    if (promptText) promptText.textContent = i18n.t('tutorial.actionPrompt') || '드래그 해보세요!';
    if (prompt) prompt.classList.add('active');
  } else {
    areaEl.classList.remove('instruction-mode');
    nextBtn.classList.remove('hidden');
    waitingForMission = false;
    if (prompt) prompt.classList.remove('active');
  }

  // Auto trigger
  if (phase.trigger === 'auto') {
    nextBtn.classList.remove('hidden');
    setTimeout(() => advanceDialog(), 3000);
  }
}

function typeText(el, text) {
  if (typingTimer) clearInterval(typingTimer);
  el.textContent = '';
  let i = 0;
  typingTimer = setInterval(() => {
    el.textContent += text[i++];
    Sound.dialogTyping();
    if (i >= text.length) clearInterval(typingTimer);
  }, 18);
}

function isTypingComplete() {
  const step = tutorials[currentStep];
  if (!step) return true;
  const phase = step.dialogs[currentPhaseIdx];
  if (!phase) return true;
  const line = phase.lines[currentLineIdx];
  if (!line) return true;
  const lang = i18n.getLang();
  const text = line[lang] || line['en'] || line['ko'] || '';
  const textEl = document.getElementById('tutDialogText');
  return textEl.textContent.length >= text.length;
}

function forceCompleteTyping() {
  if (typingTimer) clearInterval(typingTimer);
  const step = tutorials[currentStep];
  const phase = step.dialogs[currentPhaseIdx];
  const line = phase.lines[currentLineIdx];
  const lang = i18n.getLang();
  const text = line[lang] || line['en'] || line['ko'] || '';
  document.getElementById('tutDialogText').textContent = text;
}

// ── Dialog Click ──
function onDialogClick() {
  if (!tutorialStarted) return;
  if (waitingForMission) return;
  if (tutorialEnded) return;

  // If still typing, complete it immediately
  if (!isTypingComplete()) {
    forceCompleteTyping();
    return;
  }

  advanceDialog();
}

// ── Dialog Advance ──
function advanceDialog() {
  const step = tutorials[currentStep];
  const phase = step.dialogs[currentPhaseIdx];

  // More lines in current phase?
  if (currentLineIdx < phase.lines.length - 1) {
    currentLineIdx++;
    showCurrentDialog();
    return;
  }

  // More phases?
  if (currentPhaseIdx < step.dialogs.length - 1) {
    currentPhaseIdx++;
    currentLineIdx = 0;
    showCurrentDialog();
    return;
  }

  // All dialogs done → next step
  currentStep++;
  loadStep(currentStep);
}

// ── Mission Complete Handler ──
function onTutorialHandComplete(handData) {
  if (!waitingForMission) return;
  const step = tutorials[currentStep];
  if (!checkTutorialMission(step.mission, handData)) return;

  // Mission complete → advance to next phase (result)
  waitingForMission = false;
  currentPhaseIdx++;
  currentLineIdx = 0;
  document.getElementById('tutDialogArea').classList.remove('instruction-mode');
  const prompt = document.getElementById('tutActionPrompt');
  if (prompt) prompt.classList.remove('active');
  setTimeout(() => showCurrentDialog(), 500);
}

// ── Restart Button ──
function tutorialRestart() {
  const step = tutorials[currentStep];

  // Step with restartMissionComplete: pressing restart IS the mission
  if (step.restartMissionComplete && waitingForMission) {
    initState();
    loadRandomDeck();
    renderGrid();

    waitingForMission = false;
    currentPhaseIdx++;
    currentLineIdx = 0;
    document.getElementById('tutDialogArea').classList.remove('instruction-mode');
    document.getElementById('tutNextBtn').classList.remove('hidden');
    const prompt = document.getElementById('tutActionPrompt');
    if (prompt) prompt.classList.remove('active');
    setTimeout(() => showCurrentDialog(), 400);
    return;
  }

  // Normal restart: reload current step's initialDeck (no gold cost)
  initState();
  loadTutorialDeck(step.initialDeck);
  applyGravityToAll();
  orderedStraightCount = 0;
  renderGrid();

  // Reset dialog to instruction phase
  const instrIdx = step.dialogs.findIndex(d => d.phase === 'instruction');
  if (instrIdx !== -1) {
    currentPhaseIdx = instrIdx;
    currentLineIdx = 0;
    waitingForMission = true;
    document.getElementById('tutDialogArea').classList.add('instruction-mode');
    document.getElementById('tutNextBtn').classList.add('hidden');
    showCurrentDialog();
  }
}

// ── Skip ──
function skipTutorial() {
  const msg = i18n.t('tutorial.skipConfirm') || 'Skip tutorial?';
  if (confirm(msg)) {
    completeTutorial();
  }
}

// ── Complete ──
function completeTutorial() {
  tutorialEnded = true;
  localStorage.setItem('poker_tutorial_done', '1');
  location.href = isReplay ? 'index.html' : 'id.html';
}

// ── Boot ──
initTutorial();
