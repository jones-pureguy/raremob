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

const FAIL_MESSAGES = {
  'forbidden_hand':    '금지된 족보 패를 만들었습니다',
  'forbidden_value':   '금지된 숫자가 포함된 패를 만들었습니다',
  'nomoves':           '더 이상 만들 수 있는 패가 없습니다',
};

const HINT_COSTS = { 1: 30, 2: 60, 3: 90 };

// ─── Game State ───
let state = {};
let puzzleConfig = null;
let allPuzzles = null;
let puzzleFailed = false;
let puzzleCleared = false;
let hintLevel = 0;

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
    showToast('10 이상의 원페어가 필요합니다!');
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
        showScorePopup(hand.label);
        removeCardsAndApplyGravity();
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
      showScorePopup(hand.label);
      removeCardsAndApplyGravity();
      setTimeout(() => triggerPuzzleFail('forbidden_value'), 350);
      return;
    }
  }

  // Add hand
  state.hands.push(handData);
  showScorePopup(hand.label);
  removeCardsAndApplyGravity();

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
  if (cards.length < 2) { previewEl.textContent = `${cards.length}/5 선택 중...`; previewEl.className = 'hand-preview'; return; }
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
  }, 300);
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
    case 'grid_empty': {
      const remaining = state.grid.flat().filter(cell => cell && cell.card !== null).length;
      return remaining === 0;
    }
    default: return false;
  }
}

// ─── UI Helpers ───
function showScorePopup(label) {
  const popup = document.createElement('div');
  popup.className = 'score-popup';
  popup.innerHTML = `<div class="popup-rank">${label}</div>`;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1600);
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
    ? '<div style="color:#4CAF50;font-size:0.9rem;margin:8px 0;">힌트 미사용 클리어!</div>'
    : `<div style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin:8px 0;">힌트 Lv.${hintLevel} 사용</div>`;

  let rewardHTML = '';
  if (isFirstClear) {
    let bonusLine = '';
    if (hintBonus > 0) {
      bonusLine = `<div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#4CAF50;"><span>힌트 미사용</span><span>+${hintBonus} Gold</span></div>`;
    }
    rewardHTML = `
      <div style="margin:12px 0;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;">
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:rgba(255,255,255,0.7);"><span>기본 보상</span><span>+${goldBase} Gold</span></div>
        ${bonusLine}
        <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-size:1rem;font-weight:700;color:var(--gold);"><span>합계</span><span>+${totalGold} Gold</span></div>
      </div>
      <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:12px;">보유 골드: ${currentGold.toLocaleString()} → ${newGold.toLocaleString()}</div>
    `;
  } else {
    rewardHTML = `
      <div style="margin:12px 0;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
        <div style="color:rgba(255,255,255,0.4);font-size:0.8rem;text-align:center;">이미 클리어한 퍼즐입니다.<br>골드 보상은 첫 클리어 시에만 지급됩니다.</div>
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
        <div style="color:rgba(255,255,255,0.4);font-size:0.7rem;margin-bottom:4px;">NEXT PUZZLE</div>
        <div style="color:var(--gold);font-size:0.85rem;font-weight:700;">Puzzle ${nextPuzzle.id}: ${nextPuzzle.title}</div>
        <div style="color:rgba(255,255,255,0.6);font-size:0.75rem;margin-top:2px;">${nextPuzzle.description}</div>
        <div style="color:var(--gold);font-size:0.75rem;margin-top:4px;">보상: ${nextPuzzle.rewards.gold} Gold</div>
      </div>
    `;
  }

  modal.innerHTML = `
    <h2 style="color:var(--gold);">PUZZLE CLEAR!</h2>
    <div class="subtitle">Puzzle ${puzzleConfig.id}: ${puzzleConfig.title}</div>
    ${hintStatusHTML}
    ${rewardHTML}
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      ${nextPuzzle ? `<button class="btn-play-again" onclick="goNextPuzzle()">다음 퍼즐</button>` : ''}
      <a href="puzzle_select.html" class="btn-play-again" style="background:rgba(255,255,255,0.1);color:#e0e0e0;text-decoration:none;display:flex;align-items:center;">퍼즐 선택</a>
    </div>
    ${nextHTML}
  `;
  document.getElementById('modalOverlay').classList.add('active');
}

function showPuzzleFailPopup(reason) {
  const modal = document.getElementById('modal');
  const msg = FAIL_MESSAGES[reason] || '퍼즐 실패';

  modal.innerHTML = `
    <h2 style="color:#ff5252;">PUZZLE FAILED</h2>
    <div class="subtitle">Puzzle ${puzzleConfig.id}: ${puzzleConfig.title}</div>
    <div style="margin:16px 0;padding:12px;background:rgba(255,82,82,0.1);border-radius:8px;border:1px solid rgba(255,82,82,0.3);">
      <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:4px;">실패 원인:</div>
      <div style="color:#ff5252;font-size:0.95rem;font-weight:600;">"${msg}"</div>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button class="btn-play-again" onclick="retryPuzzle()">다시 도전</button>
      <a href="puzzle_select.html" class="btn-play-again" style="background:rgba(255,255,255,0.1);color:#e0e0e0;text-decoration:none;display:flex;align-items:center;">퍼즐 선택</a>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('active');
}

// ─── Navigation ───
function goNextPuzzle() {
  const nextId = puzzleConfig.id + 1;
  window.location.href = `puzzle.html?id=${nextId}`;
}

function retryPuzzle() {
  // hintLevel is preserved on retry
  puzzleFailed = false;
  puzzleCleared = false;
  document.getElementById('modalOverlay').classList.remove('active');

  initState();
  loadPuzzleDeck(puzzleConfig.initialDeck);
  applyGravityToAll();
  renderGrid();
}

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
    <h2 style="color:var(--gold);">힌트 Lv.${nextLevel} 보기</h2>
    <div style="margin:16px 0;color:rgba(255,255,255,0.7);font-size:0.9rem;">
      골드 ${cost} 소모
    </div>
    <div style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin-bottom:16px;">
      현재 보유: ${currentGold.toLocaleString()} Gold
    </div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button class="btn-play-again" onclick="confirmHint(${nextLevel}, ${cost})" ${currentGold < cost ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>힌트 보기 -${cost}G</button>
      <button class="btn-play-again" style="background:rgba(255,255,255,0.1);color:#e0e0e0;" onclick="closeHintModal()">취소</button>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('active');
}

function confirmHint(level, cost) {
  if (!deductGold(cost, 'puzzle_hint_' + puzzleConfig.id + '_lv' + level)) return;
  hintLevel = level;
  const hintText = puzzleConfig.hint['level' + level];
  showHintDisplayModal(level, hintText);
}

function showHintDisplayModal(level, text) {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2 style="color:var(--gold);">힌트 Lv.${level}</h2>
    <div style="margin:16px 0;padding:14px;background:rgba(255,255,255,0.05);border-radius:8px;color:rgba(255,255,255,0.8);font-size:0.9rem;line-height:1.5;">
      ${text}
    </div>
    <div style="display:flex;justify-content:center;">
      <button class="btn-play-again" onclick="closeHintModal()">확인</button>
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
    showToast('골드가 부족합니다.');
    return false;
  }
  const newGold = current - amount;
  localStorage.setItem('poker_gold', newGold);
  renderCurrencyBar();

  const playerId = localStorage.getItem('poker_player_id');
  if (playerId) {
    sb.from('players').update({ gold: newGold }).eq('id', playerId)
      .catch(err => console.error('Gold deduct sync failed:', err));
    sb.from('gold_transactions').insert({
      player_id: playerId, amount: -amount, reason: reason,
      meta: { puzzleId: puzzleConfig.id }
    }).catch(err => console.error('Transaction insert failed:', err));
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

    const playerId = localStorage.getItem('poker_player_id');
    if (playerId) {
      sb.from('players').update({ gold: newGold }).eq('id', playerId)
        .catch(err => console.error('Gold save failed:', err));
      sb.from('gold_transactions').insert({
        player_id: playerId, amount: goldEarned,
        reason: 'puzzle_clear_' + puzzleId,
        meta: { puzzleId, hintLevel, firstClear: true }
      }).catch(err => console.error('Transaction save failed:', err));
    }
  }
}

// ─── Puzzle Init ───
async function initPuzzle() {
  const params = new URLSearchParams(window.location.search);
  const puzzleId = parseInt(params.get('id'));
  if (!puzzleId) { window.location.href = 'puzzle_select.html'; return; }

  // Load puzzles.json
  try {
    const res = await fetch('puzzles.json');
    allPuzzles = await res.json();
    puzzleConfig = allPuzzles.find(p => p.id === puzzleId);
    if (!puzzleConfig) { showToast('퍼즐을 찾을 수 없습니다'); return; }
  } catch(e) { showToast('퍼즐 데이터 로드 실패'); return; }

  puzzleFailed = false;
  puzzleCleared = false;
  hintLevel = 0;

  // Apply theme
  document.body.style.setProperty('--bg', puzzleConfig.theme.bgColor);
  document.body.style.setProperty('--felt-dark', puzzleConfig.theme.bgColor);
  document.body.style.setProperty('--gold', puzzleConfig.theme.accentColor);
  document.body.style.setProperty('--gold-glow', puzzleConfig.theme.accentColor + '80');

  // Update header
  document.getElementById('puzzleTitle').textContent = `Puzzle ${puzzleConfig.id}: ${puzzleConfig.title}`;

  // Condition bar
  const condBar = document.getElementById('puzzleConditionBar');
  if (condBar) {
    let text = puzzleConfig.description;
    const forbidden = [];
    if (puzzleConfig.constraints.forbiddenHands.length > 0)
      forbidden.push('금지: ' + puzzleConfig.constraints.forbiddenHands.join(', '));
    if (puzzleConfig.constraints.forbiddenValues.length > 0)
      forbidden.push('금지: ' + puzzleConfig.constraints.forbiddenValues.join(', '));
    if (forbidden.length > 0) text += ' [' + forbidden.join(' / ') + ']';
    condBar.textContent = text;
  }

  // Username
  const saved = localStorage.getItem('poker_username') || '';
  const el = document.getElementById('usernameDisplay');
  if (el) el.textContent = saved;

  // Init puzzle
  initState();
  loadPuzzleDeck(puzzleConfig.initialDeck);
  applyGravityToAll();
  renderGrid();

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

  document.getElementById('hintBtn').addEventListener('click', () => onHintButtonClick());
}

// ─── Boot ───
initPuzzle();
