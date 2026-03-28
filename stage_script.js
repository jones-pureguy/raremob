// ─── Stage Mode Game Engine ───
// Based on script.js with stage-specific: constraints, missions, dual timer, fail/clear

// ─── Constants ───
const GRID_SIZE = 7;
const MAX_HANDS = 9;
const HAND_SIZE = 5;

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const VALUE_NAMES = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };

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

function getRankScore(rank) {
  return ScorePolicy.getHandScore(rank);
}
function getPenaltyPerCard() {
  return ScorePolicy.get().penalty.perCard;
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

const FAIL_MESSAGES = {
  'forbidden_hand':    () => i18n.t('failReasons.forbiddenHand'),
  'forbidden_value':   () => i18n.t('failReasons.forbiddenValue'),
  'ascending_rank':    () => i18n.t('failReasons.ascendingRank'),
  'high_card_start':   () => i18n.t('failReasons.highCardStart'),
  'timeout':           () => i18n.t('failReasons.stageTimeout'),
  'nomoves':           () => i18n.t('failReasons.noMoves'),
  'gameover':          () => i18n.t('failReasons.gameover'),
  'nth_hand_violated': () => i18n.t('failReasons.nthHand'),
};

// ─── Game State ───
let state = {};
let stageConfig = null;
let allStages = null;
let stageTimer = null;
let stageTimerInterval = null;
let resetUsed = 0;
let ascendingStreak = 0;
let orderedStraightCount = 0;
let stageFailed = false;
let stageCleared = false;

function initState() {
  state = {
    grid: [], hands: [], selectedPath: [], isDragging: false,
    timer: stageConfig ? Math.floor(stageConfig.timers.gameTime / 2) : 100,
    phase: 'playing', timerInterval: null, debugMode: false,
    currentScore: 0, removedCards: [],
  };
}

// ─── Card / Deck ───
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

function cardDisplay(card) { return VALUE_NAMES[card.value] + card.suit; }

// ─── Grid Init & Render ───
function initGrid() {
  const deck = shuffle(createDeck());
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
    const cardEl = children[i];
    if (cardEl.classList.contains('empty')) continue;
    const rect = cardEl.getBoundingClientRect();
    const mx = rect.width * inset, my = rect.height * inset;
    if (x >= rect.left + mx && x <= rect.right - mx && y >= rect.top + my && y <= rect.bottom - my) {
      const row = parseInt(cardEl.dataset.row), col = parseInt(cardEl.dataset.col);
      if (isNaN(row) || isNaN(col)) return null;
      return [row, col];
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
  if (state.phase !== 'playing' || stageFailed || stageCleared) return;
  if (!state.grid[row][col].card) return;
  state.isDragging = true;
  state.selectedPath = [[row, col]];
  updateSelectionVisuals();
}

// ─── Movement Constraint Check ───
function isValidStageMove(fromR, fromC, toR, toC) {
  if (!stageConfig) return true;
  const c = stageConfig.constraints;
  const dr = toR - fromR, dc = toC - fromC;
  const adr = Math.abs(dr), adc = Math.abs(dc);
  const isDiag = adr >= 1 && adc >= 1 && adr === adc;
  const isOrtho = (adr >= 1 && adc === 0) || (adr === 0 && adc >= 1);

  // diagonalOnly
  if (c.diagonalOnly) {
    if (!isDiag) return false;
  }
  // diagonalAllowed
  if (!c.diagonalAllowed && isDiag) return false;

  // moveMode: orthogonal
  if (c.moveMode === 'orthogonal' && !isOrtho) return false;

  // moveMode: straight — all cards must be same direction as first move
  if (c.moveMode === 'straight' && state.selectedPath.length >= 2) {
    const p0 = state.selectedPath[0], p1 = state.selectedPath[1];
    const origDr = Math.sign(p1[0] - p0[0]), origDc = Math.sign(p1[1] - p0[1]);
    const newDr = Math.sign(dr), newDc = Math.sign(dc);
    if (newDr !== origDr || newDc !== origDc) return false;
  }

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
  const jumpAllowed = stageConfig ? stageConfig.constraints.jumpAllowed : true;
  const stepR = Math.sign(dr), stepC = Math.sign(dc);
  let cr = last[0] + stepR, cc = last[1] + stepC;
  while (cr !== row || cc !== col) {
    if (cr < 0 || cr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) return;
    if (state.grid[cr][cc].card !== null) return; // blocked by card
    if (!jumpAllowed) return; // no jump allowed, gap means invalid
    cr += stepR;
    cc += stepC;
  }

  // Stage move constraint
  if (!isValidStageMove(last[0], last[1], row, col)) return;

  state.selectedPath.push([row, col]);
  updateSelectionVisuals();
}

function finalizePath() {
  if (!state.isDragging) return;
  state.isDragging = false;

  if (state.selectedPath.length < HAND_SIZE) {
    showToast(i18n.t('toast.selectFiveCards'));
    clearSelection();
    return;
  }

  const cards = state.selectedPath.map(([r, c]) => state.grid[r][c].card);
  const hand = evaluateHand(cards);

  // Royal Flush+
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
    showToast(i18n.t('toast.needHigherPair'));
    setTimeout(() => clearSelection(), 400);
    return;
  }

  // ─── Stage mission checks BEFORE adding hand ───
  const earnedScore = getRankScore(hand.rank);
  const handData = { cards: [...cards], rank: hand.rank, rankValue: hand.rankValue, label: hand.label, usedJump: wasJumpUsed(state.selectedPath) };

  // Check forbidden hands
  if (stageConfig && stageConfig.constraints.forbiddenHands.length > 0) {
    const rankName = Object.entries(RANK).find(([k, v]) => v === hand.rank);
    if (rankName && stageConfig.constraints.forbiddenHands.includes(rankName[0])) {
      if (stageConfig.mission.failTrigger === 'forbidden_hand_made') {
        state.currentScore += earnedScore;
        state.hands.push(handData);
        updateScoreDisplay();
        showScorePopup(hand.label, earnedScore);
        removeCardsAndApplyGravity();
        setTimeout(() => triggerStageFail('forbidden_hand'), 350);
        return;
      }
    }
  }

  // Check forbidden values
  if (stageConfig && stageConfig.constraints.forbiddenValues.length > 0) {
    const hasForbidden = cards.some(c => stageConfig.constraints.forbiddenValues.includes(c.value));
    if (hasForbidden && stageConfig.mission.failTrigger === 'forbidden_value_used') {
      state.currentScore += earnedScore;
      state.hands.push(handData);
      updateScoreDisplay();
      showScorePopup(hand.label, earnedScore);
      removeCardsAndApplyGravity();
      setTimeout(() => triggerStageFail('forbidden_value'), 350);
      return;
    }
  }

  // Check high_card_start
  if (stageConfig && stageConfig.mission.failTrigger === 'high_card_start_violated') {
    const startCard = cards[0];
    const maxVal = Math.max(...cards.map(c => c.value));
    if (startCard.value < maxVal) {
      state.currentScore += earnedScore;
      state.hands.push(handData);
      updateScoreDisplay();
      showScorePopup(hand.label, earnedScore);
      removeCardsAndApplyGravity();
      setTimeout(() => triggerStageFail('high_card_start'), 350);
      return;
    }
  }

  // Check ascending ranks
  if (stageConfig && stageConfig.mission.failTrigger === 'ascending_rank_broken') {
    if (state.hands.length > 0) {
      const prevHand = state.hands[state.hands.length - 1];
      if (hand.rankValue <= prevHand.rankValue) {
        state.currentScore += earnedScore;
        state.hands.push(handData);
        updateScoreDisplay();
        showScorePopup(hand.label, earnedScore);
        removeCardsAndApplyGravity();
        setTimeout(() => triggerStageFail('ascending_rank'), 350);
        return;
      }
    }
  }

  // Track ascending streak
  if (state.hands.length > 0) {
    const prev = state.hands[state.hands.length - 1];
    if (hand.rankValue > prev.rankValue) {
      ascendingStreak++;
    } else {
      ascendingStreak = 1;
    }
  } else {
    ascendingStreak = 1;
  }

  // Track ordered straight
  if (stageConfig) {
    const osConditions = stageConfig.mission.conditions.filter(c => c.type === 'ordered_straight');
    if (osConditions.length > 0) {
      const dragValues = cards.map(c => c.value);
      let isOrdered = true;
      // Check ascending
      let ascending = true, descending = true;
      for (let i = 1; i < dragValues.length; i++) {
        if (dragValues[i] !== dragValues[i-1] + 1) ascending = false;
        if (dragValues[i] !== dragValues[i-1] - 1) descending = false;
      }
      isOrdered = ascending || descending;

      for (const osc of osConditions) {
        const requiredRank = RANK_BY_NAME[osc.hand];
        if (isOrdered && hand.rank >= requiredRank) {
          // For STRAIGHT_FLUSH, check all same suit
          if (osc.hand === 'STRAIGHT_FLUSH' && hand.rank >= RANK.STRAIGHT_FLUSH) {
            orderedStraightCount++;
          } else if (osc.hand === 'STRAIGHT' && hand.rank >= RANK.STRAIGHT) {
            orderedStraightCount++;
          }
        }
      }
    }
  }

  // Add hand normally
  state.currentScore += earnedScore;
  state.hands.push(handData);
  updateScoreDisplay();
  showScorePopup(hand.label, earnedScore);
  renderScoreProgress();
  removeCardsAndApplyGravity();

  // Check nth_hand_condition (immediate fail if violated)
  if (stageConfig && !stageFailed && !stageCleared) {
    setTimeout(() => {
      if (!checkNthHandConditions()) return;
    }, 350);
  }

  // Check real_time mission completion after hand
  if (stageConfig && stageConfig.mission.type === 'real_time' && !stageFailed && !stageCleared) {
    setTimeout(() => {
      if (!stageFailed && !stageCleared && checkAllConditionsMet()) {
        triggerStageComplete();
      }
    }, 350);
  }
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
  if (cards.length < 2) { previewEl.textContent = i18n.t('ui.selecting', { count: cards.length }); previewEl.className = 'hand-preview'; return; }
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
    if (unique[0] === 2 && unique[1] === 3 && unique[2] === 4 && unique[3] === 5 && unique[4] === 14) isStraight = true;
  }
  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const countValues = Object.values(counts).sort((a, b) => b - a);
  const countKeys = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let rank, label;
  const isRoyal = (values[0]===10&&values[1]===11&&values[2]===12&&values[3]===13&&values[4]===14);
  if (isFlush && isStraight) {
    if (isRoyal) { rank = RANK.ROYAL_FLUSH; label = 'Royal Flush'; }
    else { rank = RANK.STRAIGHT_FLUSH; label = 'Straight Flush'; }
  } else if (countValues[0] === 4) { rank = RANK.FOUR_KIND; label = `Four ${VALUE_NAMES[countKeys[0][0]]}s`; }
  else if (countValues[0] === 3 && countValues[1] === 2) { rank = RANK.FULL_HOUSE; label = 'Full House'; }
  else if (isFlush) { rank = RANK.FLUSH; label = 'Flush'; }
  else if (isStraight) { rank = RANK.STRAIGHT; label = 'Straight'; }
  else if (countValues[0] === 3) { rank = RANK.THREE_KIND; label = `Three ${VALUE_NAMES[countKeys[0][0]]}s`; }
  else if (countValues[0] === 2 && countValues[1] === 2) { rank = RANK.TWO_PAIR; label = 'Two Pair'; }
  else if (countValues[0] === 2) { rank = RANK.ONE_PAIR; label = `Pair of ${VALUE_NAMES[parseInt(countKeys[0][0])]}s`; }
  else { rank = RANK.HIGH_CARD; label = 'High Card'; }
  return { rank, rankValue: rank, label, pairValue: countValues[0]===2 ? parseInt(countKeys[0][0]) : 0 };
}

function partialEval(cards) {
  if (cards.length < 2) return { rank: RANK.HIGH_CARD, rankValue: 0, label: 'High Card', pairValue: 0 };
  const values = cards.map(c => c.value);
  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const cv = Object.values(counts).sort((a, b) => b - a);
  const ck = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (cv[0] >= 4) return { rank: RANK.FOUR_KIND, rankValue: RANK.FOUR_KIND, label: `Four ${VALUE_NAMES[ck[0][0]]}s`, pairValue: 0 };
  if (cv[0] === 3 && cv[1] === 2) return { rank: RANK.FULL_HOUSE, rankValue: RANK.FULL_HOUSE, label: 'Full House', pairValue: 0 };
  if (cv[0] === 3) return { rank: RANK.THREE_KIND, rankValue: RANK.THREE_KIND, label: `Three ${VALUE_NAMES[ck[0][0]]}s`, pairValue: 0 };
  if (cv[0] === 2 && cv[1] === 2) return { rank: RANK.TWO_PAIR, rankValue: RANK.TWO_PAIR, label: 'Two Pair', pairValue: 0 };
  if (cv[0] === 2) { const pv = parseInt(ck[0][0]); return { rank: RANK.ONE_PAIR, rankValue: RANK.ONE_PAIR, label: `Pair of ${VALUE_NAMES[pv]}s`, pairValue: pv }; }
  return { rank: RANK.HIGH_CARD, rankValue: 0, label: 'High Card', pairValue: 0 };
}

function isValidHand(hand) {
  if (hand.rank >= RANK.TWO_PAIR) return true;
  if (hand.rank === RANK.ONE_PAIR && hand.pairValue >= 10) return true;
  return false;
}

// ─── Gravity ───
function removeCardsAndApplyGravity() {
  const gridEl = document.getElementById('grid');
  const positions = [...state.selectedPath];
  positions.forEach(([r, c]) => { gridEl.children[r * GRID_SIZE + c].classList.add('removing'); });
  setTimeout(() => {
    positions.forEach(([r, c]) => { state.grid[r][c].card = null; });
    const cols = [...new Set(positions.map(p => p[1]))];
    cols.forEach(col => applyGravityToColumn(col));
    state.selectedPath = [];
    renderGrid();
    updateHandPanel();
    updateHandPreview();
    if (stageFailed || stageCleared) return;
    if (state.hands.length >= MAX_HANDS) {
      endGame('complete');
    } else {
      setTimeout(() => {
        if (state.phase === 'playing' && !stageFailed && !stageCleared && !scanForValidMoves()) {
          endGame('nomoves');
        }
      }, 200);
    }
  }, 300);
}

function applyGravityToColumn(col) {
  const cards = [];
  for (let r = GRID_SIZE - 1; r >= 0; r--) { if (state.grid[r][col].card) cards.push(state.grid[r][col].card); }
  for (let r = GRID_SIZE - 1; r >= 0; r--) { const idx = GRID_SIZE - 1 - r; state.grid[r][col].card = idx < cards.length ? cards[idx] : null; }
}

// ─── Move Scanner (with stage constraints) ───
function scanForValidMoves() {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!state.grid[r][c].card) continue;
      const visited = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(false));
      if (dfsScan(r, c, [state.grid[r][c].card], visited, [[r, c]])) return true;
    }
  }
  return false;
}

function getReachableCards(r, c, visited) {
  const results = [];
  const jumpAllowed = stageConfig ? stageConfig.constraints.jumpAllowed : true;
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  for (const [dr, dc] of dirs) {
    let nr = r + dr, nc = c + dc;
    if (!jumpAllowed) {
      // Only immediate neighbor
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE && state.grid[nr][nc].card && !visited[nr][nc]) {
        if (isValidStageMove(r, c, nr, nc)) results.push([nr, nc]);
      }
    } else {
      while (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
        if (state.grid[nr][nc].card) {
          if (!visited[nr][nc] && isValidStageMove(r, c, nr, nc)) results.push([nr, nc]);
          break;
        }
        nr += dr; nc += dc;
      }
    }
  }
  return results;
}

function dfsScan(r, c, cards, visited, path) {
  visited[r][c] = true;
  if (cards.length === HAND_SIZE) {
    const hand = evaluateHand(cards);
    visited[r][c] = false;
    return isValidHand(hand);
  }
  // For straight mode, filter reachable based on direction
  let reachable = getReachableCards(r, c, visited);
  if (stageConfig && stageConfig.constraints.moveMode === 'straight' && path.length >= 2) {
    const origDr = Math.sign(path[1][0] - path[0][0]);
    const origDc = Math.sign(path[1][1] - path[0][1]);
    reachable = reachable.filter(([nr, nc]) => Math.sign(nr - r) === origDr && Math.sign(nc - c) === origDc);
  }
  for (const [nr, nc] of reachable) {
    cards.push(state.grid[nr][nc].card);
    path.push([nr, nc]);
    if (dfsScan(nr, nc, cards, visited, path)) return true;
    cards.pop();
    path.pop();
  }
  visited[r][c] = false;
  return false;
}

// ─── Timer ───
function startTimer() {
  const gameTimeCounts = stageConfig ? Math.floor(stageConfig.timers.gameTime / 2) : 100;
  state.timer = gameTimeCounts;
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    if (state.phase !== 'playing' || stageFailed || stageCleared) return;
    state.timer--;
    updateTimerDisplay();
    if (state.timer <= 0) endGame('gameover');
  }, 2000);
}

function updateTimerDisplay() {
  const gameTimeCounts = stageConfig ? Math.floor(stageConfig.timers.gameTime / 2) : 100;
  const numEl = document.getElementById('timerNum');
  const ringEl = document.getElementById('timerRing');
  const circumference = 2 * Math.PI * 16;
  numEl.textContent = Math.max(0, state.timer);
  const offset = circumference * (1 - state.timer / gameTimeCounts);
  ringEl.style.strokeDashoffset = offset;
  numEl.classList.remove('warning', 'urgent');
  if (state.timer <= 10) { numEl.classList.add('urgent'); ringEl.style.stroke = '#ff3333'; }
  else if (state.timer <= 30) { numEl.classList.add('warning'); ringEl.style.stroke = 'orange'; }
  else { ringEl.style.stroke = stageConfig ? stageConfig.theme.accentColor : 'var(--gold)'; }
}

// ─── Stage Timer ───
function startStageTimer(seconds) {
  if (!seconds) return;
  stageTimer = seconds;
  updateStageTimerUI();
  stageTimerInterval = setInterval(() => {
    if (stageFailed || stageCleared) { clearInterval(stageTimerInterval); return; }
    stageTimer--;
    updateStageTimerUI();
    if (stageTimer <= 0) {
      clearInterval(stageTimerInterval);
      triggerStageFail('timeout');
    }
  }, 1000);
}

function updateStageTimerUI() {
  const el = document.getElementById('stageTimerNum');
  if (el) {
    el.textContent = Math.max(0, stageTimer) + 's';
    if (stageTimer <= 30) el.style.color = '#ff3333';
    else if (stageTimer <= 60) el.style.color = 'orange';
  }
}

// ─── UI Updates ───
function updateHandPanel() {
  const slotsEl = document.getElementById('handSlots');
  const countEl = document.getElementById('handCount');
  countEl.textContent = state.hands.length;
  const sorted = [...state.hands].sort((a, b) => b.rankValue - a.rankValue);
  let html = '';
  for (let i = 0; i < MAX_HANDS; i++) {
    if (i < sorted.length) { const h = sorted[i]; html += `<div class="hand-badge ${RANK_CSS[h.rank] || ''}">${h.label}</div>`; }
    else { html += `<div class="hand-badge empty-slot">—</div>`; }
  }
  slotsEl.innerHTML = html;
}

function updateScoreDisplay() {
  document.getElementById('currentScore').textContent = state.currentScore;
}

function showScorePopup(label, pts) {
  const popup = document.createElement('div');
  popup.className = 'score-popup';
  popup.innerHTML = `<div class="popup-rank">${label}</div><div class="popup-pts">+${pts}</div>`;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1600);
}

function renderRemovedCards() {
  const container = document.getElementById('removedCards');
  container.innerHTML = state.removedCards.map(card => {
    const suitClass = 'suit-' + SUIT_NAMES[card.suit];
    return `<div class="removed-card ${suitClass}"><span class="card-value">${VALUE_NAMES[card.value]}</span><span class="card-suit">${card.suit}</span></div>`;
  }).join('');
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function countRemainingCards() {
  let count = 0;
  for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) if (state.grid[r][c].card) count++;
  return count;
}

// ─── Jump Detection ───
function wasJumpUsed(path) {
  for (let i = 0; i < path.length - 1; i++) {
    const [r1, c1] = path[i];
    const [r2, c2] = path[i + 1];
    const dr = Math.abs(r2 - r1);
    const dc = Math.abs(c2 - c1);
    if (dr > 1 || dc > 1) return true;
  }
  return false;
}

// ─── Nth Hand Sub-Condition Checker ───
function checkHandSubCondition(hand, condition) {
  switch (condition) {
    case 'all_odd': {
      const oddValues = [1, 3, 5, 7, 9, 11, 13, 14];
      return hand.cards.every(c => oddValues.includes(c.value));
    }
    case 'all_even': {
      const evenValues = [2, 4, 6, 8, 10, 12];
      return hand.cards.every(c => evenValues.includes(c.value));
    }
    case 'single_suit':
      return new Set(hand.cards.map(c => c.suit)).size === 1;
    default:
      return true;
  }
}

function checkNthHandConditions() {
  if (!stageConfig) return true;
  const nthConditions = stageConfig.mission.conditions.filter(c => c.type === 'nth_hand_condition');
  for (const cond of nthConditions) {
    for (const targetN of cond.targets) {
      if (state.hands.length < targetN) continue;
      const hand = state.hands[targetN - 1];
      if (!checkHandSubCondition(hand, cond.condition)) {
        if (stageConfig.mission.failTrigger === 'nth_hand_condition_violated') {
          triggerStageFail('nth_hand_violated', cond.failMessage);
          return false;
        }
      }
    }
  }
  return true;
}

// ─── Mission Condition Checker ───
function checkAllConditionsMet() {
  if (!stageConfig) return false;
  const m = stageConfig.mission;
  return m.conditions.every(cond => checkCondition(cond));
}

function checkCondition(cond) {
  switch (cond.type) {
    case 'specific_hand': {
      const targetRank = RANK_BY_NAME[cond.hand];
      const count = state.hands.filter(h =>
        cond.exact === true ? h.rank === targetRank : h.rank >= targetRank
      ).length;
      return count >= (cond.count_gte || 1);
    }
    case 'score_gte': {
      const score = (stageConfig && stageConfig.mission.type === 'real_time')
        ? state.hands.reduce((sum, h) => sum + getRankScore(h.rank), 0)
        : calcFinalScore();
      return score >= cond.value;
    }
    case 'hands_complete': {
      if (cond.count !== undefined) return state.hands.length === cond.count;
      if (cond.count_gte !== undefined) return state.hands.length >= cond.count_gte;
      return false;
    }
    case 'suit_remaining': {
      let count = 0;
      for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) {
        if (state.grid[r][c].card && state.grid[r][c].card.suit === cond.suit) count++;
      }
      return count >= cond.count_gte;
    }
    case 'suit_in_hand': {
      const targetRank = RANK_BY_NAME[cond.handType];
      return state.hands.some(h => {
        if (h.rank !== targetRank) return false;
        const suitCount = h.cards.filter(c => c.suit === cond.suit).length;
        return suitCount >= cond.count_gte;
      });
    }
    case 'score_last_digit': {
      const score = calcFinalScore();
      return score % 10 === cond.digit;
    }
    case 'nomoves_before': {
      return state.phase === 'nomoves' && state.hands.length <= cond.count_lte;
    }
    case 'ascending_ranks': {
      return ascendingStreak >= cond.trackCount;
    }
    case 'ordered_straight': {
      return orderedStraightCount >= (cond.count_gte || 1);
    }
    case 'high_card_start': {
      // All hands must have started with highest value card — checked in finalizePath failTrigger
      return state.hands.length >= cond.count;
    }
    case 'jump_hands_gte': {
      const jumpCount = state.hands.filter(h => h.usedJump === true).length;
      return jumpCount >= cond.count_gte;
    }
    case 'nth_hand_condition': {
      for (const targetN of cond.targets) {
        if (state.hands.length < targetN) return false;
        const hand = state.hands[targetN - 1];
        if (!checkHandSubCondition(hand, cond.condition)) return false;
      }
      return true;
    }
    default: return false;
  }
}

function renderScoreProgress() {
  const el = document.getElementById('scoreProgress');
  if (!el) return;
  if (!stageConfig || stageConfig.mission.type !== 'real_time') { el.style.display = 'none'; return; }
  const scoreCondition = stageConfig.mission.conditions.find(c => c.type === 'score_gte');
  if (!scoreCondition) { el.style.display = 'none'; return; }
  const current = state.hands.reduce((sum, h) => sum + getRankScore(h.rank), 0);
  const target = scoreCondition.value;
  const pct = Math.min(100, Math.round(current / target * 100));
  el.style.display = 'block';
  el.textContent = i18n.t('modal.scoreBreakdown.scoreProgress', { current, target, pct });
}

function calcFinalScore() {
  const handScore = state.hands.reduce((sum, h) => sum + getRankScore(h.rank), 0);
  const timeBonus = ScorePolicy.getTimeBonus(Math.max(0, state.timer));
  const remaining = countRemainingCards();
  const penalty = ScorePolicy.getPenalty(remaining);
  return Math.max(0, handScore + timeBonus - penalty);
}

// ─── Game End (stage version) ───
function endGame(reason) {
  if (stageFailed || stageCleared) return;
  state.phase = reason;
  clearInterval(state.timerInterval);

  // For end_of_game missions, check conditions now
  if (stageConfig && stageConfig.mission.type === 'end_of_game') {
    if (checkAllConditionsMet()) {
      triggerStageComplete();
      return;
    } else {
      // Determine fail reason
      let failReason = reason === 'nomoves' ? 'nomoves' : 'gameover';
      triggerStageFail(failReason);
      return;
    }
  }

  // For real_time missions that haven't cleared yet
  if (stageConfig && stageConfig.mission.type === 'real_time') {
    let failReason = reason === 'nomoves' ? 'nomoves' : 'gameover';
    triggerStageFail(failReason);
    return;
  }
}

// ─── Stage Complete ───
function triggerStageComplete() {
  if (stageCleared) return;
  stageCleared = true;
  state.phase = 'complete';
  clearInterval(state.timerInterval);
  clearInterval(stageTimerInterval);

  const finalScore = calcFinalScore();
  const sorted = [...state.hands].sort((a, b) => b.rankValue - a.rankValue);
  const best = sorted[0];

  // Calculate gold rewards
  let goldBase = stageConfig.rewards.gold;
  let bonuses = [];
  const ctx = {
    finalScore,
    timeRemaining: Math.max(0, state.timer),
    stageTimeRemaining: stageTimer || 0,
    handsCollected: state.hands.length,
    suitRemaining: {},
    resetUsed,
    ascendingStreak,
  };
  // Count suit remaining
  for (const suit of SUITS) {
    let count = 0;
    for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) {
      if (state.grid[r][c].card && state.grid[r][c].card.suit === suit) count++;
    }
    ctx.suitRemaining[suit] = count;
  }

  for (const b of stageConfig.rewards.bonus) {
    try {
      const fn = new Function('finalScore','timeRemaining','stageTimeRemaining','handsCollected','suitRemaining','resetUsed','ascendingStreak',
        `return (${b.condition});`);
      if (fn(ctx.finalScore, ctx.timeRemaining, ctx.stageTimeRemaining, ctx.handsCollected, ctx.suitRemaining, ctx.resetUsed, ctx.ascendingStreak)) {
        bonuses.push({ gold: b.gold, description: b.description });
      }
    } catch(e) { console.warn('Bonus eval error:', e); }
  }

  const totalGold = goldBase + bonuses.reduce((s, b) => s + b.gold, 0);

  // Check first clear from local cache (synchronous — no DB wait)
  const progress = JSON.parse(localStorage.getItem('poker_stage_progress') || '{}');
  const isFirstClear = !progress.clearedStages || !progress.clearedStages.includes(stageConfig.id);
  const actualGold = isFirstClear ? totalGold : 0;

  // Show clear popup immediately (no DB delay)
  showStageClearPopup({ finalScore, best, goldBase, bonuses, totalGold, isFirstClear });

  // Save to DB in background
  saveStageResult(stageConfig.id, { success: true, finalScore }, actualGold).catch(err => {
    console.error('Stage save failed:', err);
  });
}

// ─── Stage Fail ───
function triggerStageFail(reason, customMessage) {
  if (stageFailed || stageCleared) return;
  stageFailed = true;
  state.phase = 'failed';
  clearInterval(state.timerInterval);
  clearInterval(stageTimerInterval);

  showStageFailPopup(reason, customMessage);
}

// ─── Popups ───
function showStageClearPopup({ finalScore, best, goldBase, bonuses, totalGold, isFirstClear }) {
  const modal = document.getElementById('modal');
  const currentGold = parseInt(localStorage.getItem('poker_gold') || '0');
  const actualGold = isFirstClear ? totalGold : 0;
  const newGold = currentGold + actualGold;

  let rewardHTML = '';
  if (isFirstClear) {
    let bonusHTML = '';
    if (bonuses.length > 0) {
      bonusHTML = bonuses.map(b => `<div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#4CAF50;"><span>${b.description}</span><span>+${b.gold} Gold</span></div>`).join('');
    }
    rewardHTML = `
      <div style="margin:12px 0;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;">
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:rgba(255,255,255,0.7);"><span>${i18n.t('modal.baseReward')}</span><span>+${goldBase} Gold</span></div>
        ${bonusHTML}
        <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-size:1rem;font-weight:700;color:var(--gold);"><span>${i18n.t('modal.total')}</span><span>+${totalGold} Gold</span></div>
      </div>
      <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:12px;">${i18n.t('modal.goldChange', { before: currentGold.toLocaleString(), after: newGold.toLocaleString() })}</div>
    `;
  } else {
    rewardHTML = `
      <div style="margin:12px 0;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
        <div style="color:rgba(255,255,255,0.4);font-size:0.8rem;text-align:center;">${i18n.t('modal.alreadyCleared')}</div>
      </div>
    `;
  }

  // Next stage preview
  const nextId = stageConfig.id + 1;
  const nextStage = allStages ? allStages.find(s => s.id === nextId) : null;
  let nextStageHTML = '';
  if (nextStage) {
    let metaItems = [];
    if (nextStage.timers.gameTime !== 200) metaItems.push(`⏱ ${nextStage.timers.gameTime}s`);
    if (nextStage.timers.stageTime) metaItems.push(`⏳ ${nextStage.timers.stageTime}s`);
    if (nextStage.constraints.resetLimit === 0) metaItems.push('↺ ' + i18n.t('constraint.resetOnly'));
    else if (nextStage.constraints.resetLimit !== null) metaItems.push(`↺ ${nextStage.constraints.resetLimit}`);
    if (!nextStage.constraints.jumpAllowed) metaItems.push(i18n.t('constraint.jumpOnly'));
    if (nextStage.constraints.diagonalOnly) metaItems.push(i18n.t('constraint.diagOnly'));
    else if (!nextStage.constraints.diagonalAllowed) metaItems.push(i18n.t('constraint.orthOnly'));
    if (nextStage.constraints.forbiddenHands.length > 0) metaItems.push(i18n.t('constraint.forbiddenHands', { list: nextStage.constraints.forbiddenHands.join(', ') }));
    const metaStr = metaItems.length > 0 ? `<div style="color:rgba(255,255,255,0.35);font-size:0.7rem;margin-top:4px;">${metaItems.join(' · ')}</div>` : '';

    nextStageHTML = `
      <div style="margin-top:10px;padding:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;text-align:left;">
        <div style="color:rgba(255,255,255,0.4);font-size:0.7rem;margin-bottom:4px;">${i18n.t('modal.nextStageLabel')}</div>
        <div style="color:var(--gold);font-size:0.85rem;font-weight:700;">Stage ${nextStage.id}: ${i18n.tField(nextStage.title)}</div>
        <div style="color:rgba(255,255,255,0.6);font-size:0.75rem;margin-top:2px;">${i18n.tField(nextStage.description)}</div>
        <div style="color:var(--gold);font-size:0.75rem;margin-top:4px;">${i18n.t('modal.reward')}: ${nextStage.rewards.gold} Gold</div>
        ${metaStr}
      </div>
    `;
  }

  const clearBreakdownHTML = buildScoreBreakdownHTML('var(--gold)');

  modal.innerHTML = `
    <h2 style="color:var(--gold);">${i18n.t('modal.stageClear')}</h2>
    <div class="subtitle">Stage ${stageConfig.id}: ${i18n.tField(stageConfig.title)}</div>
    ${best ? `<div style="color:var(--gold);font-size:0.9rem;margin:8px 0;">Best: ${best.label}</div>` : ''}
    <div class="score">Score: ${finalScore}pts</div>
    ${clearBreakdownHTML}
    ${rewardHTML}
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      ${nextStage ? `<button class="btn-play-again" onclick="goNextStage()">${i18n.t('ui.nextStage')}</button>` : ''}
      <a href="stage_select.html" class="btn-play-again" style="background:rgba(255,255,255,0.1);color:#e0e0e0;text-decoration:none;display:flex;align-items:center;">${i18n.t('ui.stageSelect')}</a>
    </div>
    ${nextStageHTML}
  `;
  document.getElementById('modalOverlay').classList.add('active');
}

function buildScoreBreakdownHTML(accentColor) {
  if (!stageConfig) return '';
  const conditions = stageConfig.mission.conditions || [];
  const digitCond = conditions.find(c => c.type === 'score_last_digit');
  const scoreCond = conditions.find(c => c.type === 'score_gte');
  if (!digitCond && !scoreCond) return '';

  const handScore = state.hands.reduce((sum, h) => sum + getRankScore(h.rank), 0);
  const timeBonus = ScorePolicy.getTimeBonus(Math.max(0, state.timer));
  const remaining = countRemainingCards();
  const cardPenalty = ScorePolicy.getPenalty(remaining);
  const finalScore = Math.max(0, handScore + timeBonus - cardPenalty);

  const ac = accentColor || '#C9A84C';
  const dim = 'rgba(255,255,255,0.5)';
  const row = (label, value, color) =>
    `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:${dim};font-size:0.82rem;">${label}</span><span style="color:${color || 'rgba(255,255,255,0.8)'};font-size:0.82rem;font-weight:600;">${value}</span></div>`;

  let rows = '';
  if (scoreCond) {
    rows += row(i18n.t('modal.scoreBreakdown.handScore'), `${handScore} / ${scoreCond.value}pts`);
  } else {
    rows += row(i18n.t('modal.scoreBreakdown.handScore'), `${handScore}pts`);
  }
  rows += row(i18n.t('modal.scoreBreakdown.timeBonus'), `+${timeBonus}pts`, timeBonus > 0 ? '#4CAF50' : dim);
  rows += row(i18n.t('modal.scoreBreakdown.cardPenalty'), cardPenalty > 0 ? `-${cardPenalty}pts` : '0pts', cardPenalty > 0 ? '#ff5252' : dim);
  rows += `<div style="border-top:1px solid rgba(255,255,255,0.12);margin:6px 0;"></div>`;
  if (scoreCond) {
    rows += row(i18n.t('modal.scoreBreakdown.finalScore'), `${finalScore} / ${scoreCond.value}pts`, ac);
  } else {
    rows += row(i18n.t('modal.scoreBreakdown.finalScore'), `${finalScore}pts`, ac);
  }

  if (digitCond) {
    const actualDigit = finalScore % 10;
    rows += `<div style="border-top:1px solid rgba(255,255,255,0.12);margin:6px 0;"></div>`;
    rows += row(i18n.t('modal.scoreBreakdown.lastDigit'), `${actualDigit}`, actualDigit === digitCond.digit ? '#4CAF50' : '#ff5252');
    rows += row(i18n.t('modal.scoreBreakdown.targetDigit'), `${digitCond.digit}`, ac);
  }

  return `
    <div style="margin:10px 0;padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid rgba(255,255,255,0.1);font-family:'IBM Plex Mono',monospace;">
      ${rows}
    </div>`;
}

function showStageFailPopup(reason, customMessage) {
  const modal = document.getElementById('modal');
  const msg = customMessage || (FAIL_MESSAGES[reason] ? FAIL_MESSAGES[reason]() : i18n.t('failReasons.stageFail'));

  const conditions = stageConfig ? (stageConfig.mission.conditions || []) : [];
  const hasScoreCond = conditions.some(c => c.type === 'score_last_digit' || c.type === 'score_gte');
  const digitCond = conditions.find(c => c.type === 'score_last_digit');

  let failLabel = msg;
  if (hasScoreCond && (reason === 'gameover' || reason === 'nomoves')) {
    failLabel = digitCond ? i18n.t('failReasons.scoreDigit') : i18n.t('failReasons.scoreTarget');
  }

  const breakdownHTML = hasScoreCond ? buildScoreBreakdownHTML('#ff5252') : '';

  modal.innerHTML = `
    <h2 style="color:#ff5252;">${i18n.t('modal.stageFailed')}</h2>
    <div class="subtitle">Stage ${stageConfig.id}: ${i18n.tField(stageConfig.title)}</div>
    <div style="margin:16px 0;padding:12px;background:rgba(255,82,82,0.1);border-radius:8px;border:1px solid rgba(255,82,82,0.3);">
      <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:4px;">${i18n.t('modal.failReason')}</div>
      <div style="color:#ff5252;font-size:0.95rem;font-weight:600;">"${failLabel}"</div>
    </div>
    ${breakdownHTML}
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button class="btn-play-again" onclick="retryStage()">${i18n.t('ui.retry')}</button>
      <a href="stage_select.html" class="btn-play-again" style="background:rgba(255,255,255,0.1);color:#e0e0e0;text-decoration:none;display:flex;align-items:center;">${i18n.t('ui.stageSelect')}</a>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('active');
}

// ─── Navigation ───
function goNextStage() {
  const nextId = stageConfig.id + 1;
  window.location.href = `stage.html?id=${nextId}`;
}

function retryStage() {
  window.location.href = `stage.html?id=${stageConfig.id}`;
}

// ─── Game Reset (stage version) ───
function resetGame() {
  if (stageFailed || stageCleared) return;

  // 골드 확인
  const currentGold = parseInt(localStorage.getItem('poker_gold') || '0');
  if (currentGold < 1) {
    showToast(i18n.t('toast.goldInsufficientN', { n: 1 }));
    return;
  }

  if (stageConfig && stageConfig.constraints.resetLimit !== null) {
    const limit = stageConfig.constraints.resetLimit;
    if (limit === 0) return;
    if (resetUsed >= limit) { showToast(i18n.t('toast.resetLimitReached')); return; }
    resetUsed++;
    updateResetButton();
  }

  // 골드 차감
  deductGoldLocal(1, 'restart');

  document.getElementById('modalOverlay').classList.remove('active');
  document.getElementById('gridContainer').classList.remove('no-moves-dim');
  document.getElementById('noMovesOverlay').classList.remove('active');
  clearInterval(state.timerInterval);

  // Reset game state but keep stage timer
  initState();
  initGrid();
  renderGrid();
  updateHandPanel();
  updateHandPreview();
  updateScoreDisplay();
  renderScoreProgress();
  renderRemovedCards();
  startTimer();
  ascendingStreak = 0;
  orderedStraightCount = 0;

  // Sanity check (reshuffle without extra gold cost)
  setTimeout(() => {
    if (!scanForValidMoves()) {
      document.getElementById('modalOverlay').classList.remove('active');
      document.getElementById('gridContainer').classList.remove('no-moves-dim');
      document.getElementById('noMovesOverlay').classList.remove('active');
      clearInterval(state.timerInterval);
      initState();
      initGrid();
      renderGrid();
      updateHandPanel();
      updateHandPreview();
      updateScoreDisplay();
      renderScoreProgress();
      renderRemovedCards();
      startTimer();
    }
  }, 100);
}

function updateResetButton() {
  const btn = document.getElementById('restartBtn');
  if (!btn || !stageConfig) return;
  const limit = stageConfig.constraints.resetLimit;
  if (limit === null) {
    btn.textContent = '↺';
    btn.disabled = false;
  } else if (limit === 0) {
    btn.textContent = '↺';
    btn.disabled = true;
    btn.style.opacity = '0.3';
  } else {
    const remaining = limit - resetUsed;
    btn.textContent = `↺ (${remaining})`;
    btn.disabled = remaining <= 0;
    if (remaining <= 0) btn.style.opacity = '0.3';
  }
}

// ─── DB Functions ───
function syncProgressFromDB() {
  const playerId = localStorage.getItem('poker_player_id');
  if (!playerId) return;

  // 골드 싱크 — DB 읽지 않고 localStorage 유지 (세션 중 localStorage가 진실)
  // DB 싱크는 게임 종료 시 syncGoldToDB에서 처리

  // 진도 싱크
  sb.from('player_stages').select('*').eq('player_id', playerId)
    .then(({ data }) => {
      if (!data) return;
      const progress = {
        clearedStages: data.filter(s => s.cleared).map(s => s.stage_id),
        stageData: data,
        lastSynced: new Date().toISOString(),
      };
      localStorage.setItem('poker_stage_progress', JSON.stringify(progress));
    })
    .then(result => { if (result && result.error) console.error('Stage progress sync failed:', result.error); });
}

async function checkFirstClear(stageId) {
  const playerId = localStorage.getItem('poker_player_id');
  if (!playerId) return true;
  try {
    const { data } = await sb.from('player_stages')
      .select('cleared')
      .eq('player_id', playerId).eq('stage_id', stageId).maybeSingle();
    return !data || !data.cleared;
  } catch(e) { return true; }
}

async function saveStageResult(stageId, result, goldEarned) {
  const playerId = localStorage.getItem('poker_player_id');
  if (!playerId) return;

  try {
    // Sync pending gold deductions before DB write
    await syncGoldToDB('stage_end');

    // Check existing record for clear_count increment
    const { data: existing } = await sb.from('player_stages')
      .select('clear_count, best_score, gold_earned')
      .eq('player_id', playerId).eq('stage_id', stageId).maybeSingle();

    const clearCount = existing ? existing.clear_count + (result.success ? 1 : 0) : (result.success ? 1 : 0);
    const bestScore = existing ? Math.max(existing.best_score, result.finalScore) : result.finalScore;

    await sb.from('player_stages').upsert({
      player_id: playerId,
      stage_id: stageId,
      cleared: result.success || (existing && existing.clear_count > 0),
      best_score: bestScore,
      clear_count: clearCount,
      gold_earned: existing ? (existing.gold_earned || 0) + goldEarned : goldEarned,
      cleared_at: result.success ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'player_id,stage_id' });

    if (goldEarned > 0) {
      await sb.from('gold_transactions').insert({
        player_id: playerId,
        amount: goldEarned,
        reason: `stage_clear_${stageId}`,
        meta: { stageId, finalScore: result.finalScore, firstClear: true },
      });

      // Update player gold
      const { data: player } = await sb.from('players').select('gold').eq('id', playerId).single();
      const currentGold = player ? player.gold : 0;
      await sb.from('players').update({ gold: currentGold + goldEarned }).eq('id', playerId);
      localStorage.setItem('poker_gold', currentGold + goldEarned);
    }

    // Update local cache
    const progress = JSON.parse(localStorage.getItem('poker_stage_progress') || '{}');
    if (!progress.clearedStages) progress.clearedStages = [];
    if (result.success && !progress.clearedStages.includes(stageId)) {
      progress.clearedStages.push(stageId);
    }
    localStorage.setItem('poker_stage_progress', JSON.stringify(progress));
  } catch(e) { console.error('Failed to save stage result:', e); }
}

// ─── Stage Init ───
async function initStage() {
  const params = new URLSearchParams(window.location.search);
  const stageId = parseInt(params.get('id'));
  if (!stageId) { window.location.href = 'stage_select.html'; return; }

  // Load stages.json
  try {
    const res = await fetch('stages.json');
    const stages = await res.json();
    allStages = stages;
    stageConfig = stages.find(s => s.id === stageId);
    if (!stageConfig) { showToast(i18n.t('toast.stageNotFound')); return; }
  } catch(e) { showToast(i18n.t('toast.stageLoadFailed')); return; }

  // Apply theme
  document.body.style.setProperty('--bg', stageConfig.theme.bgColor);
  document.body.style.setProperty('--felt-dark', stageConfig.theme.bgColor);
  document.body.style.setProperty('--gold', stageConfig.theme.accentColor);
  document.body.style.setProperty('--gold-glow', stageConfig.theme.accentColor + '80');

  // Update header
  document.getElementById('stageTitle').textContent = `Stage ${stageConfig.id}`;
  document.getElementById('stageMission').textContent = i18n.tField(stageConfig.title);

  // Stage timer
  const stageTimerEl = document.getElementById('stageTimerWrap');
  if (stageConfig.timers.stageTime) {
    stageTimerEl.style.display = 'flex';
    startStageTimer(stageConfig.timers.stageTime);
  } else {
    stageTimerEl.style.display = 'none';
  }

  // Condition bar
  const condBar = document.getElementById('stageConditionBar');
  if (condBar) {
    let text = i18n.tField(stageConfig.description);
    const forbidden = [];
    if (stageConfig.constraints.forbiddenHands.length > 0)
      forbidden.push(i18n.t('constraint.forbiddenHands', { list: stageConfig.constraints.forbiddenHands.join(', ') }));
    if (stageConfig.constraints.forbiddenValues.length > 0)
      forbidden.push(i18n.t('constraint.forbiddenValues', { list: stageConfig.constraints.forbiddenValues.join(', ') }));
    if (forbidden.length > 0) text += ' [' + forbidden.join(' / ') + ']';
    condBar.textContent = text;
  }

  // Username
  const saved = localStorage.getItem('poker_username') || '';
  const el = document.getElementById('usernameDisplay');
  if (el) el.textContent = saved;

  // Reset button
  updateResetButton();

  // Init game
  initState();
  initGrid();
  renderGrid();
  updateHandPanel();
  updateHandPreview();
  updateScoreDisplay();
  renderScoreProgress();
  renderRemovedCards();
  startTimer();

  // 백그라운드에서 DB 싱크 (게임 시작 후 조용히)
  syncProgressFromDB();

  // Sanity check
  setTimeout(() => {
    if (!scanForValidMoves()) resetGame();
  }, 100);

  // Setup event listeners
  setupEventListeners();
}

function setupEventListeners() {
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

  document.getElementById('restartBtn').addEventListener('click', () => resetGame());
}

// ─── Boot ───
initStage();
