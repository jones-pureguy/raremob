// ─── Puzzle Mode Game Engine ───
// Based on stage_script.js — no timer, no score, no reset, fixed deck

// ─── Constants ───
const GRID_SIZE = 7;
const MAX_HANDS = 9;
const HAND_SIZE = 5;

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const SUIT_BY_CODE = { s: '♠', h: '♥', d: '♦', c: '♣' };
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

function getFailMessage(reason) {
  const messages = {
    'forbidden_hand':    i18n.t('failReasons.forbiddenHand'),
    'forbidden_value':   i18n.t('failReasons.forbiddenValue'),
    'nomoves':           i18n.t('failReasons.noMoreMovesCondition'),
  };
  return messages[reason];
}

const HINT_COSTS = { 1: 30, 2: 60, 3: 90 };

// ─── Game State ───
let state = {};
let puzzleConfig = null;
let allPuzzles = null;
let puzzleFailed = false;
let puzzleCleared = false;
let hintLevel = 0;
let orderedStraightCount = 0;

function initState() {
  state = {
    grid: [], hands: [], selectedPath: [], isDragging: false,
    phase: 'playing',
  };
}

// ─── Card ───
function cardFromId(id) {
  const suitCode = id[id.length - 1];
  const valueName = id.slice(0, -1);
  return { suit: SUIT_BY_CODE[suitCode], value: VALUE_BY_NAME[valueName], id };
}

function cardDisplay(card) { return VALUE_NAMES[card.value] + card.suit; }

// ─── Puzzle Deck Loader ───
function loadPuzzleDeck(initialDeck) {
  const normalized = initialDeck.map(id =>
    (!id || id.trim() === '') ? null : id.trim()
  );

  if (normalized.length !== 49) {
    console.error('initialDeck must have exactly 49 elements, got ' + normalized.length);
    return false;
  }

  state.grid = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const idx = r * GRID_SIZE + c;
      const cardId = normalized[idx];
      row.push({
        card: cardId ? cardFromId(cardId) : null,
        row: r, col: c
      });
    }
    state.grid.push(row);
  }
  return true;
}

function applyGravityToAll() {
  for (let col = 0; col < GRID_SIZE; col++) {
    applyGravityToColumn(col);
  }
}

// ─── Grid Render ───
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
  if (state.phase !== 'playing' || puzzleFailed || puzzleCleared) return;
  if (!state.grid[row][col].card) return;
  state.isDragging = true;
  state.selectedPath = [[row, col]];
  Sound.cardSelect(0);
  updateSelectionVisuals();
}

// ─── Movement Constraint Check ───
function isValidPuzzleMove(fromR, fromC, toR, toC) {
  if (!puzzleConfig) return true;
  const c = puzzleConfig.constraints;
  const dr = toR - fromR, dc = toC - fromC;
  const adr = Math.abs(dr), adc = Math.abs(dc);
  const isDiag = adr >= 1 && adc >= 1 && adr === adc;
  const isOrtho = (adr >= 1 && adc === 0) || (adr === 0 && adc >= 1);

  if (c.diagonalOnly && !isDiag) return false;
  if (!c.diagonalAllowed && isDiag) return false;
  if (c.moveMode === 'orthogonal' && !isOrtho) return false;

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
  const jumpAllowed = puzzleConfig ? puzzleConfig.constraints.jumpAllowed : true;
  const stepR = Math.sign(dr), stepC = Math.sign(dc);
  let cr = last[0] + stepR, cc = last[1] + stepC;
  while (cr !== row || cc !== col) {
    if (cr < 0 || cr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) return;
    if (state.grid[cr][cc].card !== null) return;
    if (!jumpAllowed) return;
    cr += stepR;
    cc += stepC;
  }

  if (!isValidPuzzleMove(last[0], last[1], row, col)) return;

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

  const handData = { cards: [...cards], rank: hand.rank, rankValue: hand.rankValue, label: hand.label };

  // Check forbidden hands
  if (puzzleConfig && puzzleConfig.constraints.forbiddenHands.length > 0) {
    const rankName = Object.entries(RANK).find(([k, v]) => v === hand.rank);
    if (rankName && puzzleConfig.constraints.forbiddenHands.includes(rankName[0])) {
      if (puzzleConfig.mission.failTrigger === 'forbidden_hand_made') {
        state.hands.push(handData);
        showScorePopup(hand.label, hand.rank);
        removeCardsAndApplyGravity(hand.rank);
        setTimeout(() => triggerPuzzleFail('forbidden_hand'), 350);
        return;
      }
    }
  }

  // Check forbidden values
  if (puzzleConfig && puzzleConfig.constraints.forbiddenValues.length > 0) {
    const hasForbidden = cards.some(c => puzzleConfig.constraints.forbiddenValues.includes(c.value));
    if (hasForbidden && puzzleConfig.mission.failTrigger === 'forbidden_value_used') {
      state.hands.push(handData);
      showScorePopup(hand.label, hand.rank);
      removeCardsAndApplyGravity(hand.rank);
      setTimeout(() => triggerPuzzleFail('forbidden_value'), 350);
      return;
    }
  }

  // Track ordered straight
  if (puzzleConfig) {
    const osConditions = puzzleConfig.mission.conditions.filter(c => c.type === 'ordered_straight');
    if (osConditions.length > 0) {
      const dragValues = cards.map(c => c.value);
      let ascending = true, descending = true;
      for (let i = 1; i < dragValues.length; i++) {
        if (dragValues[i] !== dragValues[i-1] + 1) ascending = false;
        if (dragValues[i] !== dragValues[i-1] - 1) descending = false;
      }
      const isOrdered = ascending || descending;
      for (const osc of osConditions) {
        if (isOrdered && osc.hand === 'STRAIGHT_FLUSH' && hand.rank >= RANK.STRAIGHT_FLUSH) {
          orderedStraightCount++;
        } else if (isOrdered && osc.hand === 'STRAIGHT' && hand.rank >= RANK.STRAIGHT) {
          orderedStraightCount++;
        }
      }
    }
  }

  // Add hand
  state.hands.push(handData);
  Sound.handComplete(hand.rankValue);
  showScorePopup(hand.label, hand.rank);
  removeCardsAndApplyGravity(hand.rank);

  // Check real_time mission completion
  if (puzzleConfig && !puzzleFailed && !puzzleCleared) {
    setTimeout(() => {
      if (!puzzleFailed && !puzzleCleared && checkAllConditionsMet()) {
        triggerPuzzleComplete();
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

  const pairValue = rank === RANK.ONE_PAIR ? parseInt(countKeys[0][0]) : 0;
  return { rank, rankValue: rank, label, pairValue };
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
    if (puzzleFailed || puzzleCleared) return;
    if (state.hands.length >= MAX_HANDS) {
      endPuzzle('complete');
    } else {
      setTimeout(() => {
        if (state.phase === 'playing' && !puzzleFailed && !puzzleCleared && !scanForValidMoves()) {
          endPuzzle('nomoves');
        }
      }, 200);
    }
  }, 300 + totalRemovalTime);
}

function applyGravityToColumn(col) {
  const cards = [];
  for (let r = GRID_SIZE - 1; r >= 0; r--) { if (state.grid[r][col].card) cards.push(state.grid[r][col].card); }
  for (let r = GRID_SIZE - 1; r >= 0; r--) { const idx = GRID_SIZE - 1 - r; state.grid[r][col].card = idx < cards.length ? cards[idx] : null; }
}

// ─── Move Scanner ───
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
  const jumpAllowed = puzzleConfig ? puzzleConfig.constraints.jumpAllowed : true;
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  for (const [dr, dc] of dirs) {
    let nr = r + dr, nc = c + dc;
    if (!jumpAllowed) {
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE && state.grid[nr][nc].card && !visited[nr][nc]) {
        if (isValidPuzzleMove(r, c, nr, nc)) results.push([nr, nc]);
      }
    } else {
      while (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
        if (state.grid[nr][nc].card) {
          if (!visited[nr][nc] && isValidPuzzleMove(r, c, nr, nc)) results.push([nr, nc]);
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
  let reachable = getReachableCards(r, c, visited);
  if (puzzleConfig && puzzleConfig.constraints.moveMode === 'straight' && path.length >= 2) {
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

// ─── Mission Condition Checker ───
function checkAllConditionsMet() {
  if (!puzzleConfig) return false;
  const m = puzzleConfig.mission;
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
    case 'hands_complete': {
      const target = cond.count || cond.count_gte || MAX_HANDS;
      return state.hands.length >= target;
    }
    case 'ordered_straight': {
      return orderedStraightCount >= (cond.count_gte || 1);
    }
    case 'grid_empty': {
      const remaining = state.grid.flat().filter(cell => cell && cell.card !== null).length;
      return remaining === 0;
    }
    default: return false;
  }
}

// ─── UI Helpers ───
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

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ─── Game End ───
function endPuzzle(reason) {
  if (puzzleFailed || puzzleCleared) return;
  state.phase = reason;

  if (puzzleConfig && puzzleConfig.mission.type === 'end_of_game') {
    if (checkAllConditionsMet()) {
      triggerPuzzleComplete();
      return;
    }
  }

  triggerPuzzleFail('nomoves');
}

// ─── Puzzle Complete ───
function triggerPuzzleComplete() {
  if (puzzleCleared) return;
  puzzleCleared = true;
  state.phase = 'complete';

  const goldBase = puzzleConfig.rewards.gold;
  const hintBonus = hintLevel === 0 ? Math.floor(goldBase * 0.6) : 0;
  const totalGold = goldBase + hintBonus;

  const progress = JSON.parse(localStorage.getItem('poker_puzzle_progress') || '{}');
  const isFirstClear = !progress.clearedPuzzles || !progress.clearedPuzzles.includes(puzzleConfig.id);
  const actualGold = isFirstClear ? totalGold : 0;

  showPuzzleClearPopup({ goldBase, hintBonus, totalGold, isFirstClear });
  savePuzzleResult(puzzleConfig.id, true, actualGold);
}

// ─── Puzzle Fail ───
function triggerPuzzleFail(reason) {
  if (puzzleFailed || puzzleCleared) return;
  puzzleFailed = true;
  state.phase = 'failed';

  showPuzzleFailPopup(reason);
}

// ─── Popups ───
function showPuzzleClearPopup({ goldBase, hintBonus, totalGold, isFirstClear }) {
  const modal = document.getElementById('modal');
  const currentGold = parseInt(localStorage.getItem('poker_gold') || '0');
  const actualGold = isFirstClear ? totalGold : 0;
  const newGold = currentGold + actualGold;

  const hintStatusHTML = hintLevel === 0
    ? `<div style="color:#4CAF50;font-size:0.9rem;margin:8px 0;">${i18n.t('modal.hintUnused')}</div>`
    : `<div style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin:8px 0;">${i18n.t('modal.hintUsed', { n: hintLevel })}</div>`;

  let rewardHTML = '';
  if (isFirstClear) {
    let bonusLine = '';
    if (hintBonus > 0) {
      bonusLine = `<div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#4CAF50;"><span>${i18n.t('modal.hintUnusedBonus')}</span><span>+${hintBonus} Gold</span></div>`;
    }
    rewardHTML = `
      <div style="margin:12px 0;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;">
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:rgba(255,255,255,0.7);"><span>${i18n.t('modal.baseReward')}</span><span>+${goldBase} Gold</span></div>
        ${bonusLine}
        <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-size:1rem;font-weight:700;color:var(--gold);"><span>${i18n.t('modal.total')}</span><span>+${totalGold} Gold</span></div>
      </div>
      <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:12px;">${i18n.t('modal.goldChange', { before: currentGold.toLocaleString(), after: newGold.toLocaleString() })}</div>
    `;
  } else {
    rewardHTML = `
      <div style="margin:12px 0;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
        <div style="color:rgba(255,255,255,0.4);font-size:0.8rem;text-align:center;">${i18n.t('modal.alreadyClearedPuzzle')}</div>
      </div>
    `;
  }

  // Next puzzle preview
  const nextId = puzzleConfig.id + 1;
  const nextPuzzle = allPuzzles ? allPuzzles.find(p => p.id === nextId) : null;
  let nextHTML = '';
  if (nextPuzzle) {
    nextHTML = `
      <div style="margin-top:10px;padding:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;text-align:left;">
        <div style="color:rgba(255,255,255,0.4);font-size:0.7rem;margin-bottom:4px;">${i18n.t('modal.nextPuzzleLabel')}</div>
        <div style="color:var(--gold);font-size:0.85rem;font-weight:700;">Puzzle ${nextPuzzle.id}: ${i18n.tField(nextPuzzle.title)}</div>
        <div style="color:rgba(255,255,255,0.6);font-size:0.75rem;margin-top:2px;">${i18n.tField(nextPuzzle.description)}</div>
        <div style="color:var(--gold);font-size:0.75rem;margin-top:4px;">${i18n.t('modal.stageReward', { n: nextPuzzle.rewards.gold })}</div>
      </div>
    `;
  }

  modal.innerHTML = `
    <h2 style="color:var(--gold);">${i18n.t('modal.puzzleClear')}</h2>
    <div class="subtitle">Puzzle ${puzzleConfig.id}: ${i18n.tField(puzzleConfig.title)}</div>
    ${hintStatusHTML}
    ${rewardHTML}
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      ${nextPuzzle ? `<button class="btn-play-again" onclick="goNextPuzzle()">${i18n.t('ui.nextPuzzle')}</button>` : ''}
      <a href="puzzle_select.html" class="btn-play-again" style="background:rgba(255,255,255,0.1);color:#e0e0e0;text-decoration:none;display:flex;align-items:center;">${i18n.t('ui.puzzleSelect')}</a>
    </div>
    ${nextHTML}
  `;
  document.getElementById('modalOverlay').classList.add('active');
}

function showPuzzleFailPopup(reason) {
  const modal = document.getElementById('modal');
  const msg = getFailMessage(reason) || i18n.t('failReasons.puzzleFail');

  modal.innerHTML = `
    <h2 style="color:#ff5252;">${i18n.t('modal.puzzleFailed')}</h2>
    <div class="subtitle">Puzzle ${puzzleConfig.id}: ${i18n.tField(puzzleConfig.title)}</div>
    <div style="margin:16px 0;padding:12px;background:rgba(255,82,82,0.1);border-radius:8px;border:1px solid rgba(255,82,82,0.3);">
      <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:4px;">${i18n.t('modal.failReason')}</div>
      <div style="color:#ff5252;font-size:0.95rem;font-weight:600;">"${msg}"</div>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button class="btn-play-again" onclick="retryPuzzle()">${i18n.t('ui.retry')}</button>
      <a href="puzzle_select.html" class="btn-play-again" style="background:rgba(255,255,255,0.1);color:#e0e0e0;text-decoration:none;display:flex;align-items:center;">${i18n.t('ui.puzzleSelect')}</a>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('active');
}

// ─── Navigation (in-place for BGM continuity) ───
function goNextPuzzle() {
  const nextId = puzzleConfig.id + 1;
  initPuzzleById(nextId);
}

function retryPuzzle() {
  initPuzzleById(puzzleConfig.id);
}

async function initPuzzleById(puzzleId) {
  // Clean up DOM
  document.querySelectorAll('.score-popup, .screen-flash, .popup-particle, .start-overlay').forEach(el => el.remove());
  document.getElementById('modalOverlay').classList.remove('active');

  // Reset flags
  puzzleFailed = false;
  puzzleCleared = false;
  hintLevel = 0;
  orderedStraightCount = 0;

  // Load puzzle config
  let puzzle;
  try {
    const res = await fetch('./puzzles.json');
    const puzzles = await res.json();
    allPuzzles = puzzles;
    puzzle = puzzles.find(p => p.id === puzzleId);
  } catch(e) {
    location.href = 'puzzle_select.html';
    return;
  }
  if (!puzzle) {
    location.href = 'puzzle_select.html';
    return;
  }
  puzzleConfig = puzzle;

  // Update URL
  history.pushState({}, '', `puzzle.html?id=${puzzleId}`);

  // Apply theme
  document.body.style.setProperty('--bg', puzzle.theme.bgColor);
  document.body.style.setProperty('--felt-dark', puzzle.theme.bgColor);
  document.body.style.setProperty('--gold', puzzle.theme.accentColor);
  document.body.style.setProperty('--gold-glow', puzzle.theme.accentColor + '80');

  // Update header
  document.getElementById('puzzleTitle').textContent = `Puzzle ${puzzle.id}: ${i18n.tField(puzzle.title)}`;

  // Condition bar
  const condBar = document.getElementById('puzzleConditionBar');
  if (condBar) {
    let text = i18n.tField(puzzle.description);
    const forbidden = [];
    if (puzzle.constraints.forbiddenHands.length > 0)
      forbidden.push(i18n.t('constraint.forbiddenHands', { list: puzzle.constraints.forbiddenHands.join(', ') }));
    if (puzzle.constraints.forbiddenValues.length > 0)
      forbidden.push(i18n.t('constraint.forbiddenValues', { list: puzzle.constraints.forbiddenValues.join(', ') }));
    if (forbidden.length > 0) text += ' [' + forbidden.join(' / ') + ']';
    condBar.textContent = text;
  }

  // Init puzzle
  initState();
  loadPuzzleDeck(puzzle.initialDeck);
  applyGravityToAll();
  renderGrid();

  // Show in-place overlay (no BGM.start — already playing)
  showInPlacePuzzleOverlay(puzzle);
}

function showInPlacePuzzleOverlay(puzzle) {
  const grid = document.getElementById('gridContainer') || document.getElementById('grid');
  if (grid) grid.style.pointerEvents = 'none';

  const overlay = document.createElement('div');
  overlay.className = 'start-overlay';
  overlay.id = 'startOverlay';
  overlay.innerHTML = `
    <div class="start-box">
      <div class="start-title">Puzzle ${puzzle.id}: ${i18n.tField(puzzle.title)}</div>
      <div class="start-subtitle">${i18n.tField(puzzle.description)}</div>
      <button class="start-btn" id="startBtn">▶ START</button>
    </div>
  `;
  document.body.appendChild(overlay);

  function handleStart(e) {
    e.stopPropagation();
    overlay.classList.add('hiding');
    setTimeout(() => {
      overlay.remove();
      if (grid) grid.style.pointerEvents = '';
    }, 300);
  }

  document.getElementById('startBtn').addEventListener('click', handleStart);
  overlay.addEventListener('click', handleStart);
}

window.addEventListener('popstate', () => {
  location.href = 'puzzle_select.html';
});

// ─── Hint System ───
function onHintButtonClick() {
  if (!puzzleConfig || !puzzleConfig.hint) return;
  const hint = puzzleConfig.hint;
  const nextLevel = Math.min(hintLevel + 1, 3);

  if (hintLevel >= nextLevel) {
    // Already seen all hints, show last one for free
    showHintDisplayModal(hintLevel, hint['level' + hintLevel]);
    return;
  }

  const cost = HINT_COSTS[nextLevel];
  const currentGold = parseInt(localStorage.getItem('poker_gold') || '0');

  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2 style="color:var(--gold);">${i18n.t('modal.hintConfirmTitle', { n: nextLevel })}</h2>
    <div style="margin:16px 0;color:rgba(255,255,255,0.7);font-size:0.9rem;">
      ${i18n.t('modal.hintCost', { n: cost })}
    </div>
    <div style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin-bottom:16px;">
      ${i18n.t('modal.hintCurrentGold', { n: currentGold.toLocaleString() })}
    </div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button class="btn-play-again" onclick="confirmHint(${nextLevel}, ${cost})" ${currentGold < cost ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>${i18n.t('modal.hintConfirmTitle', { n: nextLevel })} -${cost}G</button>
      <button class="btn-play-again" style="background:rgba(255,255,255,0.1);color:#e0e0e0;" onclick="closeHintModal()">${i18n.t('ui.cancel')}</button>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('active');
}

function confirmHint(level, cost) {
  if (!deductGold(cost, 'puzzle_hint_' + puzzleConfig.id + '_lv' + level)) return;
  hintLevel = level;
  const hintText = i18n.tField(puzzleConfig.hint['level' + level]);
  showHintDisplayModal(level, hintText);
}

function showHintDisplayModal(level, text) {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2 style="color:var(--gold);">${i18n.t('modal.hintTitle', { n: level })}</h2>
    <div style="margin:16px 0;padding:14px;background:rgba(255,255,255,0.05);border-radius:8px;color:rgba(255,255,255,0.8);font-size:0.9rem;line-height:1.5;">
      ${text}
    </div>
    <div style="display:flex;justify-content:center;">
      <button class="btn-play-again" onclick="closeHintModal()">${i18n.t('ui.confirm')}</button>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('active');
}

function closeHintModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

// ─── Gold ───
function deductGold(amount, reason) {
  const current = parseInt(localStorage.getItem('poker_gold') || '0');
  if (current < amount) {
    showToast(i18n.t('toast.goldInsufficient'));
    return false;
  }
  const newGold = current - amount;
  localStorage.setItem('poker_gold', newGold);
  renderCurrencyBar();

  const playerId = localStorage.getItem('poker_player_id');
  if (playerId) {
    (async () => {
      try {
        const { error: goldErr } = await sb.from('players')
          .update({ gold: newGold }).eq('id', playerId);
        if (goldErr) console.error('[Puzzle] Gold deduct DB failed:', goldErr);

        const { error: txErr } = await sb.from('gold_transactions').insert({
          player_id: playerId, amount: -amount, reason: reason,
          meta: { puzzleId: puzzleConfig.id }
        });
        if (txErr) console.error('[Puzzle] Deduct transaction failed:', txErr);
      } catch(e) { console.error('[Puzzle] Gold deduct sync error:', e); }
    })();
  }
  return true;
}

// ─── Save Progress ───
function savePuzzleResult(puzzleId, cleared, goldEarned) {
  const progress = JSON.parse(localStorage.getItem('poker_puzzle_progress') || '{}');
  if (!progress.clearedPuzzles) progress.clearedPuzzles = [];
  if (!progress.hintUsed) progress.hintUsed = {};

  const isFirstClear = cleared && !progress.clearedPuzzles.includes(puzzleId);

  if (cleared && !progress.clearedPuzzles.includes(puzzleId)) {
    progress.clearedPuzzles.push(puzzleId);
  }
  progress.hintUsed[puzzleId] = hintLevel;
  localStorage.setItem('poker_puzzle_progress', JSON.stringify(progress));

  if (isFirstClear && goldEarned > 0) {
    const currentGold = parseInt(localStorage.getItem('poker_gold') || '0');
    const newGold = currentGold + goldEarned;
    localStorage.setItem('poker_gold', newGold);
    renderCurrencyBar();

    // DB 골드 업데이트 (async, 에러 로깅)
    const playerId = localStorage.getItem('poker_player_id');
    if (playerId) {
      (async () => {
        try {
          const { error: goldErr } = await sb.from('players')
            .update({ gold: newGold }).eq('id', playerId);
          if (goldErr) console.error('[Puzzle] Gold DB update failed:', goldErr);
          else console.log('[Puzzle] Gold synced to DB:', newGold);

          const { error: txErr } = await sb.from('gold_transactions').insert({
            player_id: playerId, amount: goldEarned,
            reason: 'puzzle_clear_' + puzzleId,
            meta: { puzzleId, hintLevel, firstClear: true }
          });
          if (txErr) console.error('[Puzzle] Transaction insert failed:', txErr);
        } catch(e) { console.error('[Puzzle] Gold sync error:', e); }
      })();
    }
  }
}

// ─── Puzzle Init ───
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

async function initPuzzle() {
  const params = new URLSearchParams(window.location.search);
  const puzzleId = parseInt(params.get('id'));
  if (!puzzleId) { window.location.href = 'puzzle_select.html'; return; }

  // Load puzzles.json
  try {
    const res = await fetch('puzzles.json');
    allPuzzles = await res.json();
    puzzleConfig = allPuzzles.find(p => p.id === puzzleId);
    if (!puzzleConfig) { showToast(i18n.t('toast.puzzleNotFound')); return; }
  } catch(e) { showToast(i18n.t('toast.puzzleLoadFailed')); return; }

  puzzleFailed = false;
  puzzleCleared = false;
  hintLevel = 0;

  // Apply theme
  document.body.style.setProperty('--bg', puzzleConfig.theme.bgColor);
  document.body.style.setProperty('--felt-dark', puzzleConfig.theme.bgColor);
  document.body.style.setProperty('--gold', puzzleConfig.theme.accentColor);
  document.body.style.setProperty('--gold-glow', puzzleConfig.theme.accentColor + '80');

  // Update header
  document.getElementById('puzzleTitle').textContent = `Puzzle ${puzzleConfig.id}: ${i18n.tField(puzzleConfig.title)}`;

  // Condition bar
  const condBar = document.getElementById('puzzleConditionBar');
  if (condBar) {
    let text = i18n.tField(puzzleConfig.description);
    const forbidden = [];
    if (puzzleConfig.constraints.forbiddenHands.length > 0)
      forbidden.push(i18n.t('constraint.forbiddenHands', { list: puzzleConfig.constraints.forbiddenHands.join(', ') }));
    if (puzzleConfig.constraints.forbiddenValues.length > 0)
      forbidden.push(i18n.t('constraint.forbiddenValues', { list: puzzleConfig.constraints.forbiddenValues.join(', ') }));
    if (forbidden.length > 0) text += ' [' + forbidden.join(' / ') + ']';
    condBar.textContent = text;
  }

  // Username
  const saved = localStorage.getItem('poker_username') || '';
  const el = document.getElementById('usernameDisplay');
  if (el) el.textContent = saved;

  // Init puzzle (render behind overlay)
  initState();
  loadPuzzleDeck(puzzleConfig.initialDeck);
  applyGravityToAll();
  renderGrid();

  // Overlay에 퍼즐 정보 표시
  const startTitleEl = document.getElementById('startPuzzleTitle');
  const startDescEl = document.getElementById('startPuzzleDesc');
  if (startTitleEl) startTitleEl.textContent = `Puzzle ${puzzleConfig.id}: ${i18n.tField(puzzleConfig.title)}`;
  if (startDescEl) startDescEl.textContent = i18n.tField(puzzleConfig.description);

  BGM.init('./audio/Sub_Theme.mp3');
  initStartOverlay(() => {
    setupEventListeners();
  });
}

let _puzzleEventsAttached = false;
function setupEventListeners() {
  if (_puzzleEventsAttached) return;
  _puzzleEventsAttached = true;
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

  document.getElementById('hintBtn').addEventListener('click', () => onHintButtonClick());
}

// ─── Boot ───
initPuzzle();
