// ─── Constants ───
const TIMER_SECONDS = 100;
const GRID_SIZE = 7;
const MAX_HANDS = 9;
const HAND_SIZE = 5;

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const VALUE_NAMES = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };

const RANK = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_KIND: 3,
  STRAIGHT: 4,
  BROADWAY_STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_KIND: 8,
  STRAIGHT_FLUSH: 9,
  ROYAL_FLUSH: 10,
};

const DEFAULT_SCORES = {
  [RANK.HIGH_CARD]: 0,
  [RANK.ONE_PAIR]: 1,
  [RANK.TWO_PAIR]: 2,
  [RANK.THREE_KIND]: 5,
  [RANK.STRAIGHT]: 10,
  [RANK.BROADWAY_STRAIGHT]: 15,
  [RANK.FLUSH]: 15,
  [RANK.FULL_HOUSE]: 20,
  [RANK.FOUR_KIND]: 50,
  [RANK.STRAIGHT_FLUSH]: 75,
  [RANK.ROYAL_FLUSH]: 100,
};

const DEFAULT_PENALTY = 10;

function getScoreSettings() {
  try {
    const saved = localStorage.getItem('poker_scores');
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  return { scores: { ...DEFAULT_SCORES }, penalty: DEFAULT_PENALTY };
}

function getRankScore(rank) {
  const settings = getScoreSettings();
  return settings.scores[rank] !== undefined ? settings.scores[rank] : (DEFAULT_SCORES[rank] || 0);
}

function getPenaltyPerCard() {
  const settings = getScoreSettings();
  return settings.penalty !== undefined ? settings.penalty : DEFAULT_PENALTY;
}

const RANK_LABELS = {
  [RANK.HIGH_CARD]: 'High Card',
  [RANK.ONE_PAIR]: 'One Pair',
  [RANK.TWO_PAIR]: 'Two Pair',
  [RANK.THREE_KIND]: 'Three of a Kind',
  [RANK.STRAIGHT]: 'Straight',
  [RANK.BROADWAY_STRAIGHT]: 'Broadway Straight',
  [RANK.FLUSH]: 'Flush',
  [RANK.FULL_HOUSE]: 'Full House',
  [RANK.FOUR_KIND]: 'Four of a Kind',
  [RANK.STRAIGHT_FLUSH]: 'Straight Flush',
  [RANK.ROYAL_FLUSH]: 'Royal Flush',
};

const RANK_CSS = {
  [RANK.ONE_PAIR]: 'one-pair',
  [RANK.TWO_PAIR]: 'two-pair',
  [RANK.THREE_KIND]: 'three-kind',
  [RANK.STRAIGHT]: 'straight',
  [RANK.BROADWAY_STRAIGHT]: 'broadway-straight',
  [RANK.FLUSH]: 'flush',
  [RANK.FULL_HOUSE]: 'full-house',
  [RANK.FOUR_KIND]: 'four-kind',
  [RANK.STRAIGHT_FLUSH]: 'straight-flush',
  [RANK.ROYAL_FLUSH]: 'royal-flush',
};

// ─── Game State ───
let state = {};

function initState() {
  state = {
    grid: [],
    hands: [],
    selectionMode: 1,
    selectedPath: [],
    isDragging: false,
    timer: TIMER_SECONDS,
    phase: 'playing',
    timerInterval: null,
    debugMode: false,
    currentScore: 0,
    removedCards: [],
  };
}

// ─── Card / Deck Utilities ───
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let v = 2; v <= 14; v++) {
      deck.push({ suit, value: v, id: VALUE_NAMES[v] + SUIT_NAMES[suit] });
    }
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardDisplay(card) {
  return VALUE_NAMES[card.value] + card.suit;
}

function isRedSuit(suit) {
  return suit === '♥' || suit === '♦';
}

// ─── Grid Init & Render ───
function initGrid() {
  const deck = shuffle(createDeck());
  // Remove 3 random cards
  state.removedCards = deck.splice(0, 3);
  const cards = deck.slice(0, 49);

  state.grid = [];
  let idx = 0;
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      row.push({ card: cards[idx++], row: r, col: c });
    }
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
        const suitClass = 'suit-' + SUIT_NAMES[card.suit];
        div.className = `card ${suitClass}`;

        const vn = VALUE_NAMES[card.value];
        div.innerHTML = `
          <span class="card-value">${vn}</span>
          <span class="card-suit">${card.suit}</span>
          <span class="debug-info">${r},${c}</span>
        `;

        // Check selected
        if (state.selectedPath.some(p => p[0] === r && p[1] === c)) {
          div.classList.add('selected');
        }
      } else {
        div.className = 'card empty';
        div.innerHTML = `<span class="debug-info">${r},${c}</span>`;
      }

      gridEl.appendChild(div);
    }
  }

  updateDragLine();
}

// ─── Drag Interaction ───
function getEventCoords(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function getCellFromEvent(e) {
  const { x, y } = getEventCoords(e);
  const gridEl = document.getElementById('grid');
  const children = gridEl.children;
  const inset = 0.15; // shrink hit area to center 70% to help diagonal drags
  for (let i = 0; i < children.length; i++) {
    const cardEl = children[i];
    if (cardEl.classList.contains('empty')) continue;
    const rect = cardEl.getBoundingClientRect();
    const mx = rect.width * inset;
    const my = rect.height * inset;
    if (x >= rect.left + mx && x <= rect.right - mx &&
        y >= rect.top + my && y <= rect.bottom - my) {
      const row = parseInt(cardEl.dataset.row);
      const col = parseInt(cardEl.dataset.col);
      if (isNaN(row) || isNaN(col)) return null;
      return [row, col];
    }
  }
  return null;
}

// Update selection visuals without rebuilding DOM (safe for touch)
function updateSelectionVisuals() {
  const gridEl = document.getElementById('grid');
  const children = gridEl.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const r = parseInt(el.dataset.row);
    const c = parseInt(el.dataset.col);
    const isSelected = state.selectedPath.some(p => p[0] === r && p[1] === c);
    el.classList.toggle('selected', isSelected);
  }
  updateDragLine();
  updateHandPreview();
}

function startDrag(row, col) {
  if (state.phase !== 'playing') return;
  if (!state.grid[row][col].card) return;
  state.isDragging = true;
  state.selectedPath = [[row, col]];
  updateSelectionVisuals();
}

function extendPath(row, col) {
  if (!state.isDragging) return;
  if (!state.grid[row][col].card) return;

  // Already in path? Allow backtracking even at 5 cards
  if (state.selectedPath.some(p => p[0] === row && p[1] === col)) {
    if (state.selectedPath.length >= 2) {
      const prev = state.selectedPath[state.selectedPath.length - 2];
      if (prev[0] === row && prev[1] === col) {
        state.selectedPath.pop();
        updateSelectionVisuals();
      }
    }
    return;
  }

  // Can't add beyond 5
  if (state.selectedPath.length >= HAND_SIZE) return;

  const last = state.selectedPath[state.selectedPath.length - 1];

  if (state.selectionMode === 1) {
    // Mode 1: 자유+점프 — 8방향 + 빈칸 건너뛰기
    const dr = row - last[0];
    const dc = col - last[1];
    if (dr === 0 && dc === 0) return;
    if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return;
    const stepR = Math.sign(dr);
    const stepC = Math.sign(dc);
    let cr = last[0] + stepR;
    let cc = last[1] + stepC;
    while (cr !== row || cc !== col) {
      if (cr < 0 || cr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) return;
      if (state.grid[cr][cc].card !== null) return;
      cr += stepR;
      cc += stepC;
    }
  } else if (state.selectionMode === 2) {
    // Mode 2: 자유 — 8방향 인접
    const dr = Math.abs(row - last[0]);
    const dc = Math.abs(col - last[1]);
    if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) return;
  } else if (state.selectionMode === 3) {
    // Mode 3: 직선 — 일직선으로만
    if (state.selectedPath.length === 1) {
      const dr = Math.abs(row - last[0]);
      const dc = Math.abs(col - last[1]);
      if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) return;
    } else {
      const first = state.selectedPath[0];
      const second = state.selectedPath[1];
      const dirR = Math.sign(second[0] - first[0]);
      const dirC = Math.sign(second[1] - first[1]);
      const prevEnd = state.selectedPath[state.selectedPath.length - 1];
      const expectedR = prevEnd[0] + dirR;
      const expectedC = prevEnd[1] + dirC;
      if (row !== expectedR || col !== expectedC) return;
    }
  } else if (state.selectionMode === 4) {
    // Mode 4: 가로세로 — 상하좌우만
    const dr = Math.abs(row - last[0]);
    const dc = Math.abs(col - last[1]);
    if (!((dr === 1 && dc === 0) || (dr === 0 && dc === 1))) return;
  }

  state.selectedPath.push([row, col]);
  updateSelectionVisuals();
}

function finalizePath() {
  if (!state.isDragging) return;
  state.isDragging = false;

  if (state.selectedPath.length < HAND_SIZE) {
    showToast('카드 5장을 선택해주세요!');
    clearSelection();
    return;
  }

  const cards = state.selectedPath.map(([r, c]) => state.grid[r][c].card);
  const hand = evaluateHand(cards);

  if (!isValidHand(hand)) {
    // Invalid: shake + message
    const gridEl = document.getElementById('grid');
    state.selectedPath.forEach(([r, c]) => {
      const idx = r * GRID_SIZE + c;
      const el = gridEl.children[idx];
      el.classList.add('invalid-shake');
      el.style.borderColor = '#ff5252';
      setTimeout(() => {
        el.classList.remove('invalid-shake');
        el.style.borderColor = '';
      }, 400);
    });
    showToast('10 이상의 원페어가 필요합니다!');
    setTimeout(() => clearSelection(), 400);
    return;
  }

  // Valid hand!
  const earnedScore = getRankScore(hand.rank);
  state.currentScore += earnedScore;
  state.hands.push({
    cards: [...cards],
    rank: hand.rank,
    rankValue: hand.rankValue,
    label: hand.label,
  });

  updateScoreDisplay();
  showScorePopup(hand.label, earnedScore);
  removeCardsAndApplyGravity();
}

function clearSelection() {
  state.selectedPath = [];
  updateSelectionVisuals();
}

function updateDragLine() {
  const line = document.getElementById('dragLine');
  if (state.selectedPath.length < 2) {
    line.setAttribute('points', '');
    return;
  }

  const gridEl = document.getElementById('grid');
  const containerEl = document.getElementById('gridContainer');
  const containerRect = containerEl.getBoundingClientRect();

  const points = state.selectedPath.map(([r, c]) => {
    const idx = r * GRID_SIZE + c;
    const cardEl = gridEl.children[idx];
    if (!cardEl) return '0,0';
    const rect = cardEl.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - containerRect.left;
    const y = rect.top + rect.height / 2 - containerRect.top;
    return `${x},${y}`;
  }).join(' ');

  line.setAttribute('points', points);
}

function updateHandPreview() {
  const previewEl = document.getElementById('handPreview');
  if (state.selectedPath.length === 0) {
    previewEl.textContent = '';
    previewEl.className = 'hand-preview';
    return;
  }

  const cards = state.selectedPath.map(([r, c]) => state.grid[r][c].card).filter(Boolean);
  if (cards.length < 2) {
    previewEl.textContent = `${cards.length}/5 선택 중...`;
    previewEl.className = 'hand-preview';
    return;
  }

  const hand = evaluateHand(cards);
  const valid = cards.length === 5 && isValidHand(hand);
  const mark = cards.length === 5 ? (valid ? '✓' : '✗') : '';

  previewEl.textContent = `${hand.label} ${mark}`;
  previewEl.className = 'hand-preview ' + (cards.length === 5 ? (valid ? 'valid' : 'invalid') : '');
}

// ─── Event Listeners ───
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
  if (state.isDragging) {
    e.preventDefault();
    finalizePath();
  }
}, { passive: false });

document.addEventListener('touchcancel', () => {
  if (state.isDragging) {
    state.isDragging = false;
    clearSelection();
  }
});

document.getElementById('modeSelector').addEventListener('change', e => {
  const mode = parseInt(e.target.value);
  resetGame();
  state.selectionMode = mode;
  document.getElementById('modeSelector').value = mode;
  updateScoreDisplay();
});

document.getElementById('restartBtn').addEventListener('click', () => {
  resetGame();
});

// ─── Hand Evaluation (Poker Logic) ───
function evaluateHand(cards) {
  if (cards.length < 5) {
    // Partial eval for preview
    return partialEval(cards);
  }

  const values = cards.map(c => c.value).sort((a, b) => a - b);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  // Straight check
  let isStraight = false;
  const unique = [...new Set(values)];
  if (unique.length === 5) {
    if (unique[4] - unique[0] === 4) {
      isStraight = true;
    }
    // Ace-low straight: A,2,3,4,5
    if (unique[0] === 2 && unique[1] === 3 && unique[2] === 4 && unique[3] === 5 && unique[4] === 14) {
      isStraight = true;
    }
  }

  // Count values
  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const countValues = Object.values(counts).sort((a, b) => b - a);
  const countKeys = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  let rank, label;

  const isRoyal = (values[0] === 10 && values[1] === 11 && values[2] === 12 && values[3] === 13 && values[4] === 14);

  if (isFlush && isStraight) {
    if (isRoyal) {
      rank = RANK.ROYAL_FLUSH;
      label = 'Royal Flush';
    } else {
      rank = RANK.STRAIGHT_FLUSH;
      label = 'Straight Flush';
    }
  } else if (countValues[0] === 4) {
    rank = RANK.FOUR_KIND;
    label = `Four ${VALUE_NAMES[countKeys[0][0]]}s`;
  } else if (countValues[0] === 3 && countValues[1] === 2) {
    rank = RANK.FULL_HOUSE;
    label = `Full House`;
  } else if (isFlush) {
    rank = RANK.FLUSH;
    label = 'Flush';
  } else if (isStraight && isRoyal) {
    rank = RANK.BROADWAY_STRAIGHT;
    label = 'Broadway Straight';
  } else if (isStraight) {
    rank = RANK.STRAIGHT;
    label = 'Straight';
  } else if (countValues[0] === 3) {
    rank = RANK.THREE_KIND;
    label = `Three ${VALUE_NAMES[countKeys[0][0]]}s`;
  } else if (countValues[0] === 2 && countValues[1] === 2) {
    rank = RANK.TWO_PAIR;
    label = 'Two Pair';
  } else if (countValues[0] === 2) {
    const pairVal = parseInt(countKeys[0][0]);
    rank = RANK.ONE_PAIR;
    label = `Pair of ${VALUE_NAMES[pairVal]}s`;
  } else {
    rank = RANK.HIGH_CARD;
    label = 'High Card';
  }

  return { rank, rankValue: rank, label, pairValue: countValues[0] === 2 ? parseInt(countKeys[0][0]) : 0 };
}

function partialEval(cards) {
  if (cards.length < 2) return { rank: RANK.HIGH_CARD, rankValue: 0, label: 'High Card', pairValue: 0 };

  const values = cards.map(c => c.value);
  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const countValues = Object.values(counts).sort((a, b) => b - a);
  const countKeys = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (countValues[0] >= 4) return { rank: RANK.FOUR_KIND, rankValue: RANK.FOUR_KIND, label: `Four ${VALUE_NAMES[countKeys[0][0]]}s`, pairValue: 0 };
  if (countValues[0] === 3 && countValues[1] === 2) return { rank: RANK.FULL_HOUSE, rankValue: RANK.FULL_HOUSE, label: 'Full House', pairValue: 0 };
  if (countValues[0] === 3) return { rank: RANK.THREE_KIND, rankValue: RANK.THREE_KIND, label: `Three ${VALUE_NAMES[countKeys[0][0]]}s`, pairValue: 0 };
  if (countValues[0] === 2 && countValues[1] === 2) return { rank: RANK.TWO_PAIR, rankValue: RANK.TWO_PAIR, label: 'Two Pair', pairValue: 0 };
  if (countValues[0] === 2) {
    const pv = parseInt(countKeys[0][0]);
    return { rank: RANK.ONE_PAIR, rankValue: RANK.ONE_PAIR, label: `Pair of ${VALUE_NAMES[pv]}s`, pairValue: pv };
  }

  return { rank: RANK.HIGH_CARD, rankValue: 0, label: 'High Card', pairValue: 0 };
}

function isValidHand(hand) {
  if (hand.rank >= RANK.TWO_PAIR) return true;
  if (state.selectionMode >= 3) {
    return hand.rank >= RANK.ONE_PAIR;
  }
  if (hand.rank === RANK.ONE_PAIR && hand.pairValue >= 10) return true;
  return false;
}

// ─── Card Removal + Gravity ───
function removeCardsAndApplyGravity() {
  const gridEl = document.getElementById('grid');
  const positions = [...state.selectedPath];

  // Animate removal
  positions.forEach(([r, c]) => {
    const idx = r * GRID_SIZE + c;
    gridEl.children[idx].classList.add('removing');
  });

  setTimeout(() => {
    // Remove cards from state
    positions.forEach(([r, c]) => {
      state.grid[r][c].card = null;
    });

    // Apply gravity per column
    const affectedCols = [...new Set(positions.map(p => p[1]))];
    affectedCols.forEach(col => {
      applyGravityToColumn(col);
    });

    state.selectedPath = [];
    renderGrid();
    updateHandPanel();
    updateHandPreview();

    // Check game end
    if (state.hands.length >= MAX_HANDS) {
      endGame('complete');
    }
  }, 500);
}

function applyGravityToColumn(col) {
  // Collect non-null cards from bottom to top
  const cards = [];
  for (let r = GRID_SIZE - 1; r >= 0; r--) {
    if (state.grid[r][col].card) {
      cards.push(state.grid[r][col].card);
    }
  }

  // Place them at bottom, nulls at top
  for (let r = GRID_SIZE - 1; r >= 0; r--) {
    const idx = GRID_SIZE - 1 - r;
    state.grid[r][col].card = idx < cards.length ? cards[idx] : null;
  }
}

// ─── Timer ───
function startTimer() {
  state.timer = TIMER_SECONDS;
  updateTimerDisplay();

  state.timerInterval = setInterval(() => {
    if (state.phase !== 'playing') return;
    state.timer--;
    updateTimerDisplay();
    if (state.timer <= 0) {
      endGame('gameover');
    }
  }, 2000);
}

function updateTimerDisplay() {
  const numEl = document.getElementById('timerNum');
  const ringEl = document.getElementById('timerRing');
  const circumference = 2 * Math.PI * 16; // r=16

  numEl.textContent = Math.max(0, state.timer);
  const offset = circumference * (1 - state.timer / TIMER_SECONDS);
  ringEl.style.strokeDashoffset = offset;

  numEl.classList.remove('warning', 'urgent');
  if (state.timer <= 10) {
    numEl.classList.add('urgent');
    ringEl.style.stroke = '#ff3333';
  } else if (state.timer <= 30) {
    numEl.classList.add('warning');
    ringEl.style.stroke = 'orange';
  } else {
    ringEl.style.stroke = 'var(--gold)';
  }
}

// ─── Hand Panel ───
function updateHandPanel() {
  const slotsEl = document.getElementById('handSlots');
  const countEl = document.getElementById('handCount');
  countEl.textContent = state.hands.length;

  // Sort by rank descending
  const sorted = [...state.hands].sort((a, b) => b.rankValue - a.rankValue);

  let html = '';
  for (let i = 0; i < MAX_HANDS; i++) {
    if (i < sorted.length) {
      const h = sorted[i];
      const css = RANK_CSS[h.rank] || '';
      html += `<div class="hand-badge ${css}">${h.label}</div>`;
    } else {
      html += `<div class="hand-badge empty-slot">—</div>`;
    }
  }
  slotsEl.innerHTML = html;
}

// ─── High Score ───
function getHighScores() {
  try {
    const saved = localStorage.getItem('poker_highscores');
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  return {};
}

function saveHighScore(mode, score) {
  const highscores = getHighScores();
  const key = 'mode_' + mode;
  if (!highscores[key] || score > highscores[key]) {
    highscores[key] = score;
    localStorage.setItem('poker_highscores', JSON.stringify(highscores));
    return true;
  }
  return false;
}

function getHighScore(mode) {
  const highscores = getHighScores();
  return highscores['mode_' + mode] || 0;
}

// ─── Remaining Cards Count ───
function countRemainingCards() {
  let count = 0;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (state.grid[r][c].card) count++;
    }
  }
  return count;
}

// ─── Game End ───
function endGame(reason) {
  state.phase = reason === 'complete' ? 'complete' : 'gameover';
  clearInterval(state.timerInterval);

  const sorted = [...state.hands].sort((a, b) => b.rankValue - a.rankValue);
  const handScore = state.hands.reduce((sum, h) => sum + getRankScore(h.rank), 0);
  const best = sorted[0];

  const currentMode = state.selectionMode;

  // Time bonus
  const timeBonus = Math.max(0, state.timer);

  // Remaining cards penalty (modes 1 & 2 only)
  const remainingCards = countRemainingCards();
  const penaltyPerCard = getPenaltyPerCard();
  const applyPenalty = (currentMode <= 2);
  const penalty = applyPenalty && remainingCards > 4 ? (remainingCards - 4) * penaltyPerCard : 0;
  const score = Math.max(0, handScore + timeBonus - penalty);

  // High score
  const prevHighScore = getHighScore(currentMode);
  const isNewHighScore = saveHighScore(currentMode, score);
  const highScore = Math.max(prevHighScore, score);

  const modal = document.getElementById('modal');
  const title = reason === 'complete' ? 'COMPLETE!' : "TIME'S UP!";

  let handListHTML = '';
  sorted.forEach((h, i) => {
    const cardsStr = h.cards.map(c => cardDisplay(c)).join(' ');
    const pts = getRankScore(h.rank);
    handListHTML += `<div class="hand-list-item">
      <span class="rank-label">${i === 0 ? '🏆 ' : ''}${h.label}</span>
      <span class="cards-str">${cardsStr} (+${pts})</span>
    </div>`;
  });

  let timeBonusHTML = '';
  if (timeBonus > 0) {
    timeBonusHTML = `<div style="color:#4CAF50;font-size:0.85rem;margin-bottom:4px;">남은 시간 보너스: +${timeBonus}</div>`;
  }

  let penaltyHTML = '';
  if (penalty > 0) {
    penaltyHTML = `<div style="color:#ff5252;font-size:0.85rem;margin-bottom:8px;">남은 카드 ${remainingCards}장 (4장 초과 ${remainingCards - 4}장 × -${penaltyPerCard}) = -${penalty}</div>`;
  }

  let highScoreHTML = '';
  if (isNewHighScore && score > 0) {
    highScoreHTML = `<div style="color:var(--gold);font-size:1rem;font-weight:700;margin-bottom:8px;">🏆 NEW HIGH SCORE!</div>`;
  } else {
    highScoreHTML = `<div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:8px;">High Score (Mode ${currentMode}): ${highScore}</div>`;
  }

  modal.innerHTML = `
    <h2>${title}</h2>
    <div class="subtitle">${state.hands.length}개의 핸드를 완성했습니다</div>
    ${best ? `<div class="best-hand">Best: ${best.label}</div>` : ''}
    <div class="score">Score: ${score}</div>
    ${timeBonusHTML}
    ${penaltyHTML}
    ${highScoreHTML}
    <div class="hand-list">${handListHTML}</div>
    <button class="btn-play-again" onclick="resetGame()">Play Again</button>
  `;

  document.getElementById('modalOverlay').classList.add('active');

  // Save to server and show leaderboard
  const username = (document.getElementById('usernameInput').value || '').trim();
  if (username) {
    saveSessionAndShowLeaderboard({
      username,
      score,
      best_hand: best ? best.label : null,
      hands_collected: state.hands.length,
      time_remaining: Math.max(0, state.timer),
      mode: currentMode,
    });
  }
}

// ─── Game Reset ───
function resetGame() {
  document.getElementById('modalOverlay').classList.remove('active');
  clearInterval(state.timerInterval);
  const prevMode = state.selectionMode || 1;
  initState();
  state.selectionMode = prevMode;
  initGrid();
  renderGrid();
  updateHandPanel();
  updateHandPreview();
  updateScoreDisplay();
  renderRemovedCards();
  startTimer();
  document.getElementById('modeSelector').value = prevMode;
}

// ─── Score Display ───
function updateScoreDisplay() {
  document.getElementById('currentScore').textContent = state.currentScore;
  const hi = getHighScore(state.selectionMode);
  document.getElementById('highScoreDisplay').textContent = hi;
}

function showScorePopup(label, pts) {
  const popup = document.createElement('div');
  popup.className = 'score-popup';
  popup.innerHTML = `<div class="popup-rank">${label}</div><div class="popup-pts">+${pts}</div>`;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1600);
}

// ─── Removed Cards ───
function renderRemovedCards() {
  const container = document.getElementById('removedCards');
  container.innerHTML = state.removedCards.map(card => {
    const suitClass = 'suit-' + SUIT_NAMES[card.suit];
    return `<div class="removed-card ${suitClass}">
      <span class="card-value">${VALUE_NAMES[card.value]}</span>
      <span class="card-suit">${card.suit}</span>
    </div>`;
  }).join('');
}

// ─── Toast ───
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ─── Debug Mode ───
document.addEventListener('keydown', e => {
  if (e.key === 'd' || e.key === 'D') {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    state.debugMode = !state.debugMode;
    document.body.classList.toggle('debug-mode', state.debugMode);
    if (state.debugMode) {
      console.log('Debug mode ON');
      console.log('Selected path:', state.selectedPath);
      console.log('Current hand eval:', state.selectedPath.length >= 2 ?
        evaluateHand(state.selectedPath.map(([r,c]) => state.grid[r][c].card).filter(Boolean)) : 'N/A');
    } else {
      console.log('Debug mode OFF');
    }
  }
});

window.validateGrid = function() {
  const ids = new Set();
  let count = 0;
  let duplicates = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const card = state.grid[r][c].card;
      if (card) {
        count++;
        if (ids.has(card.id)) {
          duplicates.push(card.id);
        }
        ids.add(card.id);
      }
    }
  }
  if (duplicates.length > 0) {
    console.error(`DUPLICATES FOUND: ${duplicates.join(', ')}`);
    return `${count} cards, ${duplicates.length} duplicates: ${duplicates.join(', ')}`;
  }
  console.log(`${count} unique cards, no duplicates`);
  return `${count} unique cards, no duplicates`;
};

// ─── Supabase / Leaderboard ───
async function saveSessionAndShowLeaderboard(data) {
  try {
    // Insert game session
    const { error: sessionError } = await supabase
      .from('game_sessions')
      .insert({
        username: data.username,
        score: data.score,
        best_hand: data.best_hand || null,
        hands_collected: data.hands_collected || 0,
        time_remaining: data.time_remaining || 0,
        mode: data.mode || 1,
      });
    if (sessionError) console.error('Session save error:', sessionError);

    // Upsert leaderboard — keep highest score per username+mode
    const { data: existing } = await supabase
      .from('leaderboard')
      .select('score')
      .eq('username', data.username)
      .eq('mode', data.mode)
      .single();

    if (!existing || data.score > existing.score) {
      await supabase
        .from('leaderboard')
        .upsert({
          username: data.username,
          score: data.score,
          best_hand: data.best_hand || null,
          mode: data.mode || 1,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'username,mode' });
    }
  } catch (err) {
    console.error('Save error:', err);
  }
  showLeaderboard(data.mode, data.username);
}

async function showLeaderboard(mode, currentUser) {
  try {
    const { data: rows, error } = await supabase
      .from('leaderboard')
      .select('username, score, best_hand, mode, updated_at')
      .eq('mode', mode)
      .order('score', { ascending: false })
      .limit(10);

    if (error) { console.error('Leaderboard error:', error); return; }

    let tableHTML = `<table class="leaderboard-table">
      <thead><tr><th>#</th><th>NAME</th><th>SCORE</th><th>BEST HAND</th></tr></thead><tbody>`;
    (rows || []).forEach((row, i) => {
      const hl = currentUser && row.username.toLowerCase() === currentUser.toLowerCase() ? ' class="highlight"' : '';
      tableHTML += `<tr${hl}><td>${i + 1}</td><td>${escapeHTML(row.username)}</td><td>${row.score}</td><td>${escapeHTML(row.best_hand || '-')}</td></tr>`;
    });
    tableHTML += '</tbody></table>';

    if (!rows || rows.length === 0) {
      tableHTML = '<div style="padding:16px;color:rgba(255,255,255,0.5);">No scores yet</div>';
    }

    const modal = document.getElementById('leaderboardModal');
    modal.innerHTML = `
      <h2>LEADERBOARD</h2>
      <div class="subtitle">Mode ${mode} · Top 10</div>
      ${tableHTML}
      <button class="btn-close-lb" onclick="document.getElementById('leaderboardOverlay').classList.remove('active')">CLOSE</button>
    `;
    document.getElementById('leaderboardOverlay').classList.add('active');
  } catch (err) {
    console.error('Leaderboard error:', err);
  }
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Load saved username ───
(function() {
  const saved = localStorage.getItem('poker_username');
  if (saved) document.getElementById('usernameInput').value = saved;
  document.getElementById('usernameInput').addEventListener('change', function() {
    localStorage.setItem('poker_username', this.value.trim());
  });
})();

// ─── Init ───
initState();
initGrid();
renderGrid();
updateHandPanel();
updateScoreDisplay();
renderRemovedCards();
startTimer();
