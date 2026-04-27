// maniac_script.js
// MANIAC MODE — 5n장 콤보 드래그 + 콤보 멀티플라이어
// 베이직 미수정 원칙 (script.js 로드 안 함). [REUSE] 함수는 본 파일에 복사.
// 정책: 매니악 단계 2~5 (클라 본체) — 서버 분기는 단계 6에서 별도.

// =============== Adapters (베이직과 동일) ===============
function mn_saveLocal(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
function mn_loadLocal(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function mn_navigateTo(page) { window.location.href = page; }

// =============== Constants ===============
const MN_TIMER_SECONDS = 200;
const MN_GRID_SIZE = 7;
const MN_HAND_SIZE = 5;
const MN_MAX_COMBO = 9;
const MN_MAX_PATH = MN_HAND_SIZE * MN_MAX_COMBO; // 45
const MN_UNLOCK_SCORE = 400;
const MN_HIGH_SCORE_KEY = 'maniac_highScore';

const MN_SUITS = ['♠', '♥', '♦', '♣'];
const MN_SUIT_NAMES = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const MN_VALUE_NAMES = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };
const MN_SUIT_BY_CODE = { s: '♠', h: '♥', d: '♦', c: '♣' };
const MN_VALUE_BY_NAME = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

const MN_RANK = {
  HIGH_CARD: 0, ONE_PAIR: 1, TWO_PAIR: 2, THREE_KIND: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, FOUR_KIND: 7, STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9, ROYAL_FLUSH_PLUS: 10,
};
const MN_RANK_NAME_BY_VALUE = {};
Object.entries(MN_RANK).forEach(([k, v]) => MN_RANK_NAME_BY_VALUE[v] = k);

const MN_RANK_CSS = {
  [MN_RANK.ONE_PAIR]: 'one-pair', [MN_RANK.TWO_PAIR]: 'two-pair',
  [MN_RANK.THREE_KIND]: 'three-kind', [MN_RANK.STRAIGHT]: 'straight',
  [MN_RANK.FLUSH]: 'flush', [MN_RANK.FULL_HOUSE]: 'full-house',
  [MN_RANK.FOUR_KIND]: 'four-kind', [MN_RANK.STRAIGHT_FLUSH]: 'straight-flush',
  [MN_RANK.ROYAL_FLUSH]: 'royal-flush', [MN_RANK.ROYAL_FLUSH_PLUS]: 'royal-flush-plus',
};

// 9단계 콤보 글로우 클래스 (1~9, mn-glow-N)
const MN_GLOW_CLASSES = ['mn-glow-1','mn-glow-2','mn-glow-3','mn-glow-4','mn-glow-5','mn-glow-6','mn-glow-7','mn-glow-8','mn-glow-9'];
const MN_GLOW_STROKE = ['#FFD700','#00D4FF','#FF6BAA','#39E58B','#FF9F1C','#B47CFF','#C8FF5C','#FF4FCB','#ffffff'];

// =============== State ===============
let mn_state = {};
let mn_serverSession = { sessionId: null, seed: null, dragLog: [], serverStartedAt: null, mode: 'maniac', submitted: false };
let mn_gameStarted = false;

function mn_initState() {
  // [HOTFIX] 이전 timer interval 정리 (RESTART/Play Again 시 timer 누적 방지)
  // mn_state = {...}로 새 객체를 만들면 이전 timerInterval 핸들이 분실되어
  // setInterval이 GC되지 않고 계속 fire — N회 재시작 시 1초에 N씩 떨어지는 버그.
  if (mn_state && mn_state.timerInterval) {
    clearInterval(mn_state.timerInterval);
  }
  mn_state = {
    grid: [],
    hands: [],                  // 모든 슬라이스 누적 (콤보 그룹별 group_id 포함)
    selectedPath: [],           // 드래그 중 좌표 (최대 45)
    isDragging: false,
    gameOver: false,
    timer: MN_TIMER_SECONDS,
    phase: 'playing',
    timerInterval: null,
    currentScore: 0,
    removedCards: [],
    // MANIAC 전용
    completedSlices: [],        // 드래그 중 누적 5장 슬라이스 [{cards, hand}]
    nextComboGroupId: 0,        // hand 객체에 박을 콤보 그룹 ID
    blockShakeAt: 0,            // 차단 디바운스
  };
}

// =============== [REUSE] Card / Deck ===============
function mn_createDeck() {
  const deck = [];
  for (const suit of MN_SUITS) {
    for (let v = 2; v <= 14; v++) deck.push({ suit, value: v, id: MN_VALUE_NAMES[v] + MN_SUIT_NAMES[suit] });
  }
  return deck;
}
function mn_shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function mn_cardFromId(id) {
  const suitCode = id[id.length - 1];
  const valueName = id.slice(0, -1);
  return { suit: MN_SUIT_BY_CODE[suitCode], value: MN_VALUE_BY_NAME[valueName], id };
}

// =============== [REUSE] initGrid ===============
function mn_initGrid(seed = null) {
  let deck;
  if (seed !== null && window.PRNG) {
    deck = window.PRNG.shuffleFromSeed(mn_createDeck(), seed);
  } else {
    deck = mn_shuffle(mn_createDeck());
  }
  mn_state.removedCards = deck.splice(0, 3);
  const cards = deck.slice(0, 49);
  mn_state.grid = [];
  let idx = 0;
  for (let r = 0; r < MN_GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < MN_GRID_SIZE; c++) row.push({ card: cards[idx++], row: r, col: c });
    mn_state.grid.push(row);
  }
}

// =============== [REUSE] evaluateHand / partialEval / isValidHand ===============
function mn_evaluateHand(cards) {
  if (cards.length < 5) return mn_partialEval(cards);
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
  const isRoyal = (values[0] === 10 && values[1] === 11 && values[2] === 12 && values[3] === 13 && values[4] === 14);

  let rank, label;
  if (isFlush && isStraight) {
    if (isRoyal) { rank = MN_RANK.ROYAL_FLUSH; label = 'Royal Flush'; }
    else { rank = MN_RANK.STRAIGHT_FLUSH; label = 'Straight Flush'; }
  } else if (countValues[0] === 4) { rank = MN_RANK.FOUR_KIND; label = `Four ${MN_VALUE_NAMES[countKeys[0][0]]}s`; }
  else if (countValues[0] === 3 && countValues[1] === 2) { rank = MN_RANK.FULL_HOUSE; label = 'Full House'; }
  else if (isFlush) { rank = MN_RANK.FLUSH; label = 'Flush'; }
  else if (isStraight) { rank = MN_RANK.STRAIGHT; label = 'Straight'; }
  else if (countValues[0] === 3) { rank = MN_RANK.THREE_KIND; label = `Three ${MN_VALUE_NAMES[countKeys[0][0]]}s`; }
  else if (countValues[0] === 2 && countValues[1] === 2) { rank = MN_RANK.TWO_PAIR; label = 'Two Pair'; }
  else if (countValues[0] === 2) { const pv = parseInt(countKeys[0][0]); rank = MN_RANK.ONE_PAIR; label = `Pair of ${MN_VALUE_NAMES[pv]}s`; }
  else { rank = MN_RANK.HIGH_CARD; label = 'High Card'; }

  // Royal Flush+ : 드래그 순서가 10→J→Q→K→A
  if (rank === MN_RANK.ROYAL_FLUSH) {
    const dv = cards.map(c => c.value);
    if (dv[0] === 10 && dv[1] === 11 && dv[2] === 12 && dv[3] === 13 && dv[4] === 14) {
      rank = MN_RANK.ROYAL_FLUSH_PLUS; label = 'Royal Flush+';
    }
  }
  return { rank, rankValue: rank, label, pairValue: countValues[0] === 2 ? parseInt(countKeys[0][0]) : 0, cards: [...cards] };
}
function mn_partialEval(cards) {
  if (cards.length < 2) return { rank: MN_RANK.HIGH_CARD, rankValue: 0, label: 'High Card', pairValue: 0 };
  const values = cards.map(c => c.value);
  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const countValues = Object.values(counts).sort((a, b) => b - a);
  const countKeys = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (countValues[0] >= 4) return { rank: MN_RANK.FOUR_KIND, rankValue: MN_RANK.FOUR_KIND, label: `Four ${MN_VALUE_NAMES[countKeys[0][0]]}s`, pairValue: 0 };
  if (countValues[0] === 3 && countValues[1] === 2) return { rank: MN_RANK.FULL_HOUSE, rankValue: MN_RANK.FULL_HOUSE, label: 'Full House', pairValue: 0 };
  if (countValues[0] === 3) return { rank: MN_RANK.THREE_KIND, rankValue: MN_RANK.THREE_KIND, label: `Three ${MN_VALUE_NAMES[countKeys[0][0]]}s`, pairValue: 0 };
  if (countValues[0] === 2 && countValues[1] === 2) return { rank: MN_RANK.TWO_PAIR, rankValue: MN_RANK.TWO_PAIR, label: 'Two Pair', pairValue: 0 };
  if (countValues[0] === 2) { const pv = parseInt(countKeys[0][0]); return { rank: MN_RANK.ONE_PAIR, rankValue: MN_RANK.ONE_PAIR, label: `Pair of ${MN_VALUE_NAMES[pv]}s`, pairValue: pv }; }
  return { rank: MN_RANK.HIGH_CARD, rankValue: 0, label: 'High Card', pairValue: 0 };
}
function mn_isValidHand(hand) {
  if (hand.rank >= MN_RANK.TWO_PAIR) return true;
  if (hand.rank === MN_RANK.ONE_PAIR && hand.pairValue >= 10) return true;
  return false;
}

// =============== [REUSE] Score helpers ===============
function mn_getRankScore(rank) { return ScorePolicy.getHandScore(MN_RANK_NAME_BY_VALUE[rank] || 'HIGH_CARD'); }
function mn_getPenaltyPerCard() { return ScorePolicy.get().penalty.perCard; }

// =============== [REUSE] Grid utilities ===============
function mn_applyGravityToColumn(col) {
  const cards = [];
  for (let r = MN_GRID_SIZE - 1; r >= 0; r--) {
    if (mn_state.grid[r][col].card) cards.push(mn_state.grid[r][col].card);
  }
  for (let r = MN_GRID_SIZE - 1; r >= 0; r--) {
    const idx = MN_GRID_SIZE - 1 - r;
    mn_state.grid[r][col].card = idx < cards.length ? cards[idx] : null;
  }
}
function mn_countRemainingCards() {
  let count = 0;
  for (let r = 0; r < MN_GRID_SIZE; r++) for (let c = 0; c < MN_GRID_SIZE; c++) {
    if (mn_state.grid[r][c].card) count++;
  }
  return count;
}
function mn_getReachableCards(r, c, visited) {
  const results = [];
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  for (const [dr, dc] of dirs) {
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < MN_GRID_SIZE && nc >= 0 && nc < MN_GRID_SIZE) {
      if (mn_state.grid[nr][nc].card) { if (!visited[nr][nc]) results.push([nr, nc]); break; }
      nr += dr; nc += dc;
    }
  }
  return results;
}
function mn_dfsScan(r, c, cards, visited) {
  visited[r][c] = true;
  if (cards.length === MN_HAND_SIZE) {
    const hand = mn_evaluateHand(cards);
    visited[r][c] = false;
    return mn_isValidHand(hand);
  }
  for (const [nr, nc] of mn_getReachableCards(r, c, visited)) {
    cards.push(mn_state.grid[nr][nc].card);
    if (mn_dfsScan(nr, nc, cards, visited)) return true;
    cards.pop();
  }
  visited[r][c] = false;
  return false;
}
function mn_scanForValidMoves() {
  for (let r = 0; r < MN_GRID_SIZE; r++) for (let c = 0; c < MN_GRID_SIZE; c++) {
    if (!mn_state.grid[r][c].card) continue;
    const visited = Array.from({length: MN_GRID_SIZE}, () => Array(MN_GRID_SIZE).fill(false));
    if (mn_dfsScan(r, c, [mn_state.grid[r][c].card], visited)) return true;
  }
  return false;
}

// =============== [REWRITE] HighScore ===============
function mn_saveHighScore(score) {
  const prev = parseInt(mn_loadLocal(MN_HIGH_SCORE_KEY) || '0', 10);
  if (score > prev) { mn_saveLocal(MN_HIGH_SCORE_KEY, String(score)); return true; }
  return false;
}
function mn_getHighScore() { return parseInt(mn_loadLocal(MN_HIGH_SCORE_KEY) || '0', 10); }

// =============== [REWRITE] renderGrid + glow application ===============
function mn_renderGrid() {
  const gridEl = document.getElementById('grid');
  gridEl.innerHTML = '';
  for (let r = 0; r < MN_GRID_SIZE; r++) {
    for (let c = 0; c < MN_GRID_SIZE; c++) {
      const cell = mn_state.grid[r][c];
      const div = document.createElement('div');
      div.dataset.row = r;
      div.dataset.col = c;
      if (cell.card) {
        const card = cell.card;
        div.className = `card suit-${MN_SUIT_NAMES[card.suit]}`;
        const vn = MN_VALUE_NAMES[card.value];
        div.innerHTML = `<span class="card-value">${vn}</span><span class="card-suit">${card.suit}</span><span class="debug-info">${r},${c}</span>`;
      } else {
        div.className = 'card empty';
        div.innerHTML = `<span class="debug-info">${r},${c}</span>`;
      }
      gridEl.appendChild(div);
    }
  }
  mn_updateSelectionVisuals();
}

// =============== [REWRITE] Drag input ===============
function mn_getEventCoords(e) {
  if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches.length > 0) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}
function mn_getCellFromEvent(e) {
  const { x, y } = mn_getEventCoords(e);
  const gridEl = document.getElementById('grid');
  const children = gridEl.children;
  const inset = 0.15;
  for (let i = 0; i < children.length; i++) {
    const cardEl = children[i];
    if (cardEl.classList.contains('empty')) continue;
    const rect = cardEl.getBoundingClientRect();
    const mx = rect.width * inset;
    const my = rect.height * inset;
    if (x >= rect.left + mx && x <= rect.right - mx && y >= rect.top + my && y <= rect.bottom - my) {
      const row = parseInt(cardEl.dataset.row);
      const col = parseInt(cardEl.dataset.col);
      if (isNaN(row) || isNaN(col)) return null;
      return [row, col];
    }
  }
  return null;
}

// path 위치 → 콤보 그룹 인덱스 (0~8)
function mn_groupIndexAt(pathPos) {
  // pathPos: 1-based card count. 1~5 → group 0, 6~10 → group 1, ...
  return Math.floor((pathPos - 1) / MN_HAND_SIZE);
}

// path 위치 → cardSelect index (0~4, 도-레-미-파-솔)
function mn_noteIndexAt(pathPos) {
  return (pathPos - 1) % MN_HAND_SIZE;
}

// 글로우 클래스 적용/제거
function mn_clearAllGlows() {
  const gridEl = document.getElementById('grid');
  for (let i = 0; i < gridEl.children.length; i++) {
    const el = gridEl.children[i];
    MN_GLOW_CLASSES.forEach(cls => el.classList.remove(cls));
    el.classList.remove('selected');
  }
}
function mn_updateSelectionVisuals() {
  mn_clearAllGlows();
  const gridEl = document.getElementById('grid');
  const path = mn_state.selectedPath;
  for (let i = 0; i < path.length; i++) {
    const [r, c] = path[i];
    const idx = r * MN_GRID_SIZE + c;
    const el = gridEl.children[idx];
    if (!el) continue;
    el.classList.add('selected');
    const groupIdx = mn_groupIndexAt(i + 1);
    el.classList.add(MN_GLOW_CLASSES[Math.min(groupIdx, MN_GLOW_CLASSES.length - 1)]);
  }
  mn_updateDragLine();
  mn_updateCumulativePreview();
}
function mn_updateDragLine() {
  const line = document.getElementById('dragLine');
  if (mn_state.selectedPath.length < 2) { line.setAttribute('points', ''); return; }
  const gridEl = document.getElementById('grid');
  const containerEl = document.getElementById('gridContainer');
  const containerRect = containerEl.getBoundingClientRect();
  const points = mn_state.selectedPath.map(([r, c]) => {
    const idx = r * MN_GRID_SIZE + c;
    const cardEl = gridEl.children[idx];
    if (!cardEl) return '0,0';
    const rect = cardEl.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - containerRect.left;
    const y = rect.top + rect.height / 2 - containerRect.top;
    return `${x},${y}`;
  }).join(' ');
  line.setAttribute('points', points);
  // 라인 컬러: 마지막 카드의 그룹 컬러
  const lastGroupIdx = mn_groupIndexAt(mn_state.selectedPath.length);
  const stroke = MN_GLOW_STROKE[Math.min(lastGroupIdx, MN_GLOW_STROKE.length - 1)];
  line.style.stroke = (lastGroupIdx === MN_MAX_COMBO - 1) ? '#ffffff' : stroke;
}

// =============== [REWRITE] 누적 정보 표시 (하단 영역) ===============
function mn_updateCumulativePreview() {
  const previewEl = document.getElementById('handPreview');
  const path = mn_state.selectedPath;
  if (path.length === 0) {
    previewEl.textContent = '';
    previewEl.className = 'hand-preview';
    return;
  }

  // 5장 단위로 슬라이스 평가
  previewEl.className = 'hand-preview mn-cumulative';
  const parts = [];
  const fullSlices = Math.floor(path.length / MN_HAND_SIZE);
  for (let g = 0; g < fullSlices; g++) {
    const slice = path.slice(g * MN_HAND_SIZE, (g + 1) * MN_HAND_SIZE);
    const cards = slice.map(([r, c]) => mn_state.grid[r][c].card);
    const hand = mn_evaluateHand(cards);
    const valid = mn_isValidHand(hand);
    const mark = valid ? '✓' : '✗';
    const cls = valid ? 'valid' : 'invalid';
    const color = MN_GLOW_STROKE[Math.min(g, MN_GLOW_STROKE.length - 1)];
    parts.push(`<span class="mn-slice-result ${cls}" style="color:${color};">${hand.label} ${mark}</span>`);
  }
  // 진행 중 슬라이스 (5장 미만)
  const remainder = path.length % MN_HAND_SIZE;
  if (remainder > 0) {
    const startIdx = fullSlices * MN_HAND_SIZE;
    const partialPath = path.slice(startIdx);
    const cards = partialPath.map(([r, c]) => mn_state.grid[r][c].card);
    const hand = mn_partialEval(cards);
    const color = MN_GLOW_STROKE[Math.min(fullSlices, MN_GLOW_STROKE.length - 1)];
    parts.push(`<span class="mn-slice-result mn-slice-pending" style="color:${color};">${hand.label || '...'}</span>`);
  }
  previewEl.innerHTML = parts.join('<span class="mn-slice-sep">→</span>');
}

// =============== [REWRITE] 콤보 ×N 배지 ===============
function mn_updateComboBadge() {
  const badge = document.getElementById('mnComboBadge');
  if (!badge) return;
  const completed = mn_state.completedSlices.length;
  if (completed < 2) {
    badge.classList.remove('active', 'rainbow');
    return;
  }
  const key = `maniac.combo.x${completed}`;
  const text = (typeof i18n !== 'undefined' && i18n.t) ? i18n.t(key) : `×${completed} COMBO`;
  badge.textContent = text;
  badge.classList.add('active');
  badge.classList.toggle('rainbow', completed >= MN_MAX_COMBO);
}
function mn_hideComboBadge() {
  const badge = document.getElementById('mnComboBadge');
  if (badge) badge.classList.remove('active', 'rainbow');
}

// =============== [REWRITE] 드래그 핸들러 ===============
function mn_startDrag(row, col) {
  if (mn_state.phase !== 'playing') return;
  if (!mn_state.grid[row][col].card) return;
  if (!mn_gameStarted) return;
  mn_state.isDragging = true;
  mn_state.selectedPath = [[row, col]];
  mn_state.completedSlices = [];
  if (typeof Sound !== 'undefined' && Sound.cardSelectMn) Sound.cardSelectMn(0);
  else if (typeof Sound !== 'undefined' && Sound.cardSelect) Sound.cardSelect(0);
  mn_updateSelectionVisuals();
  mn_hideComboBadge();
}

function mn_extendPath(row, col) {
  if (!mn_state.isDragging) return;
  if (!mn_state.grid[row][col].card) return;

  // 백트래킹 (이미 path에 있는 카드)
  const path = mn_state.selectedPath;
  if (path.some(p => p[0] === row && p[1] === col)) {
    if (path.length >= 2) {
      const prev = path[path.length - 2];
      if (prev[0] === row && prev[1] === col) {
        path.pop();
        // 슬라이스 캔슬 (5n+1 → 5n로 돌아온 경우)
        const remainSlices = Math.floor(path.length / MN_HAND_SIZE);
        if (mn_state.completedSlices.length > remainSlices) {
          mn_state.completedSlices = mn_state.completedSlices.slice(0, remainSlices);
        }
        const lenAfter = path.length;
        if (lenAfter > 0) {
          if (typeof Sound !== 'undefined' && Sound.cardSelectMn) Sound.cardSelectMn(mn_noteIndexAt(lenAfter));
          else if (typeof Sound !== 'undefined' && Sound.cardSelect) Sound.cardSelect(Math.min(lenAfter - 1, 3));
        }
        mn_updateSelectionVisuals();
        mn_updateComboBadge();
      }
    }
    return;
  }

  // 최대 45장 cap
  if (path.length >= MN_MAX_PATH) return;

  // 5n+1번째 진입 시 직전 5장 검증 (path 길이 = 5, 10, 15, ... 일 때 다음 카드 진입)
  if (path.length > 0 && path.length % MN_HAND_SIZE === 0) {
    // 직전 슬라이스 유효성 확인 (이미 completedSlices에 push됐어야 함)
    const lastSliceIdx = (path.length / MN_HAND_SIZE) - 1;
    const lastSlice = mn_state.completedSlices[lastSliceIdx];
    if (!lastSlice || !mn_isValidHand(lastSlice.hand)) {
      // 차단 — 셀 진입 불가 + 흔들림 + 차단음
      mn_invalidPathFeedback(row, col);
      return;
    }
  }

  // 인접 + 직선 + 빈칸 건너뛰기 검증
  const last = path[path.length - 1];
  const dr = row - last[0];
  const dc = col - last[1];
  if (dr === 0 && dc === 0) return;
  if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return;
  const stepR = Math.sign(dr);
  const stepC = Math.sign(dc);
  let cr = last[0] + stepR;
  let cc = last[1] + stepC;
  while (cr !== row || cc !== col) {
    if (cr < 0 || cr >= MN_GRID_SIZE || cc < 0 || cc >= MN_GRID_SIZE) return;
    if (mn_state.grid[cr][cc].card !== null) return;
    cr += stepR; cc += stepC;
  }

  // 카드 추가
  path.push([row, col]);
  const newLen = path.length;

  // cardSelect 사운드 (5장 단위 도-레-미-파-솔)
  if (typeof Sound !== 'undefined' && Sound.cardSelectMn) Sound.cardSelectMn(mn_noteIndexAt(newLen));
  else if (typeof Sound !== 'undefined' && Sound.cardSelect) Sound.cardSelect(Math.min(mn_noteIndexAt(newLen), 3));

  // 5장 완성 시: 슬라이스 평가 + completedSlices push + "딩" + 콤보 배지
  if (newLen % MN_HAND_SIZE === 0) {
    const groupIdx = (newLen / MN_HAND_SIZE) - 1;
    const sliceCoords = path.slice(groupIdx * MN_HAND_SIZE, (groupIdx + 1) * MN_HAND_SIZE);
    const sliceCards = sliceCoords.map(([r, c]) => mn_state.grid[r][c].card);
    const hand = mn_evaluateHand(sliceCards);
    mn_state.completedSlices.push({ cards: sliceCards, hand, coords: sliceCoords });
    if (typeof Sound !== 'undefined' && Sound.handLock) Sound.handLock();
    mn_updateComboBadge();
  }

  mn_updateSelectionVisuals();
}

function mn_invalidPathFeedback(row, col) {
  // 디바운스 (300ms 내 중복 차단)
  const now = Date.now();
  if (now - mn_state.blockShakeAt < 300) return;
  mn_state.blockShakeAt = now;
  // 직전 슬라이스 카드들 흔들림
  const path = mn_state.selectedPath;
  const lastSliceStart = path.length - MN_HAND_SIZE;
  const gridEl = document.getElementById('grid');
  for (let i = lastSliceStart; i < path.length; i++) {
    const [r, c] = path[i];
    const idx = r * MN_GRID_SIZE + c;
    const el = gridEl.children[idx];
    if (!el) continue;
    el.classList.add('invalid-shake');
    const orig = el.style.borderColor;
    el.style.borderColor = '#ff5252';
    setTimeout(() => { el.classList.remove('invalid-shake'); el.style.borderColor = orig; }, 400);
  }
  // 차단음 (베이직 stageFail 또는 짧은 부정음 — Sound.stageFail 활용)
  if (typeof Sound !== 'undefined' && Sound.stageFail) Sound.stageFail();
}

function mn_endDrag() {
  if (!mn_state.isDragging) return;
  mn_state.isDragging = false;
  if (mn_state.gameOver) { mn_clearSelection(); return; }

  const path = mn_state.selectedPath;
  // 5n장 미달 (불완전 콤보) → 캔슬
  if (path.length === 0 || path.length % MN_HAND_SIZE !== 0) {
    if (path.length > 0) showToast(i18n.t('toast.selectFiveCards'));
    mn_clearSelection();
    return;
  }

  // 모든 슬라이스 검증 (이미 completedSlices에 push됨)
  const slices = mn_state.completedSlices;
  if (slices.length === 0 || slices.some(s => !mn_isValidHand(s.hand))) {
    // 이론상 도달 불가 (5n+1 진입 시 차단됨) — 안전망
    showToast(i18n.t('toast.needHigherPair'));
    mn_clearSelection();
    return;
  }

  // 콤보 멀티 점수 = (각 슬라이스 점수 합) × 슬라이스 개수
  const n = slices.length;
  const sliceSum = slices.reduce((sum, s) => sum + mn_getRankScore(s.hand.rank), 0);
  const earnedScore = sliceSum * n;
  mn_state.currentScore += earnedScore;

  // hands에 모든 슬라이스 push (콤보 그룹 ID 부여)
  const comboGroupId = mn_state.nextComboGroupId++;
  for (const s of slices) {
    mn_state.hands.push({
      cards: [...s.cards],
      rank: s.hand.rank,
      rankValue: s.hand.rankValue,
      label: s.hand.label,
      comboGroupId,
      comboSize: n,
    });
  }

  // dragLog (베이직 형식: 슬라이스마다 hand 이벤트 push + extraData에 콤보 그룹)
  if (mn_serverSession.sessionId) {
    for (let i = 0; i < slices.length; i++) {
      mn_serverSession.dragLog.push({
        type: 'hand',
        cards: slices[i].coords.map(([r, c]) => [r, c]),
        comboGroupId,
        comboSize: n,
        ts: Date.now(),
      });
    }
  }

  // 사운드 — 콤보 중 최고 패 기준
  const bestRank = Math.max(...slices.map(s => s.hand.rankValue));
  if (typeof Sound !== 'undefined' && Sound.handComplete) Sound.handComplete(bestRank);

  // 점수 팝업 (콤보 정보 포함)
  mn_showScorePopup(slices, n, earnedScore);

  // 카드 제거 + 중력 + UI 갱신
  mn_removeCardsAndApplyGravity();
}

function mn_clearSelection() {
  mn_state.selectedPath = [];
  mn_state.completedSlices = [];
  mn_clearAllGlows();
  mn_hideComboBadge();
  mn_updateDragLine();
  mn_updateCumulativePreview();
}

// =============== [REWRITE] removeCardsAndApplyGravity ===============
function mn_removeCardsAndApplyGravity() {
  const gridEl = document.getElementById('grid');
  const positions = [...mn_state.selectedPath];
  positions.forEach(([r, c]) => {
    gridEl.children[r * MN_GRID_SIZE + c].classList.add('removing');
  });
  setTimeout(() => {
    positions.forEach(([r, c]) => { mn_state.grid[r][c].card = null; });
    const cols = [...new Set(positions.map(p => p[1]))];
    cols.forEach(col => mn_applyGravityToColumn(col));
    if (typeof Sound !== 'undefined' && Sound.cardDrop) Sound.cardDrop();

    mn_state.selectedPath = [];
    mn_state.completedSlices = [];
    mn_renderGrid();
    mn_updateHandPanel();
    mn_updateCumulativePreview();
    mn_updateScoreDisplay();
    mn_hideComboBadge();

    if (mn_state.hands.length >= MN_MAX_COMBO) {
      mn_endGame('complete');
    } else {
      setTimeout(() => {
        if (mn_state.phase === 'playing' && !mn_scanForValidMoves()) mn_endGame('nomoves');
      }, 500);
    }
  }, 320);
}

// =============== [REWRITE] Hand Panel + ×N 배지 ===============
function mn_updateHandPanel() {
  const slotsEl = document.getElementById('handSlots');
  const countEl = document.getElementById('handCount');
  countEl.textContent = mn_state.hands.length;
  const sorted = [...mn_state.hands].sort((a, b) => b.rankValue - a.rankValue);
  let html = '';
  for (let i = 0; i < MN_MAX_COMBO; i++) {
    if (i < sorted.length) {
      const h = sorted[i];
      const css = MN_RANK_CSS[h.rank] || '';
      const comboMark = (h.comboSize > 1) ? `<span class="mn-combo-mark">×${h.comboSize}</span>` : '';
      html += `<div class="hand-slot hand-badge ${css}">${h.label}${comboMark}</div>`;
    } else {
      html += `<div class="hand-badge empty-slot">—</div>`;
    }
  }
  slotsEl.innerHTML = html;
}

// =============== [REWRITE] Removed cards / Score / Toast / Popup ===============
function mn_renderRemovedCards() {
  const container = document.getElementById('removedCards');
  container.innerHTML = mn_state.removedCards.map(card => {
    const suitClass = 'suit-' + MN_SUIT_NAMES[card.suit];
    return `<div class="removed-card ${suitClass}"><span class="card-value">${MN_VALUE_NAMES[card.value]}</span><span class="card-suit">${card.suit}</span></div>`;
  }).join('');
}
function mn_updateScoreDisplay() {
  document.getElementById('currentScore').textContent = mn_state.currentScore;
  document.getElementById('highScoreDisplay').textContent = mn_getHighScore();
}
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}
function mn_showScorePopup(slices, n, earnedScore) {
  // 콤보 정보 + 점수 팝업
  const popup = document.createElement('div');
  popup.className = 'score-popup';
  const comboLabel = (n > 1) ? `×${n} COMBO` : slices[0].hand.label;
  popup.innerHTML = `<div class="popup-rank">${comboLabel}</div><div class="popup-pts">+${earnedScore}</div>`;
  if (n >= 4) popup.style.color = MN_GLOW_STROKE[Math.min(n - 1, MN_GLOW_STROKE.length - 1)];
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1800);
}

// =============== [REWRITE] Timer ===============
function mn_startTimer() {
  mn_state.timer = MN_TIMER_SECONDS;
  mn_updateTimerDisplay();
  mn_state.timerInterval = setInterval(() => {
    if (mn_state.phase !== 'playing') return;
    mn_state.timer--;
    mn_updateTimerDisplay();
    if (mn_state.timer <= 0) mn_endGame('gameover');
  }, 1000);
}
function mn_updateTimerDisplay() {
  const numEl = document.getElementById('timerNum');
  const ringEl = document.getElementById('timerRing');
  const circumference = 2 * Math.PI * 16;
  numEl.textContent = Math.max(0, mn_state.timer);
  const offset = circumference * (1 - mn_state.timer / MN_TIMER_SECONDS);
  ringEl.style.strokeDashoffset = offset;
  numEl.classList.remove('warning', 'urgent');
  if (mn_state.timer <= 10) { numEl.classList.add('urgent'); ringEl.style.stroke = '#ff3333'; }
  else if (mn_state.timer <= 30) { numEl.classList.add('warning'); ringEl.style.stroke = 'orange'; }
  else { ringEl.style.stroke = '#ff6ba3'; /* MANIAC 핑크 */ }
}

// =============== [REWRITE] endGame ===============
function mn_endGame(reason) {
  if (mn_state.isDragging) {
    mn_state.isDragging = false;
    mn_clearSelection();
  }
  mn_state.gameOver = true;
  if (typeof WakeLock !== 'undefined' && WakeLock.release) WakeLock.release();
  mn_state.phase = reason === 'complete' ? 'complete' : (reason === 'nomoves' ? 'nomoves' : 'gameover');
  clearInterval(mn_state.timerInterval);

  // 패널티/보너스 (베이직과 동일)
  const remaining = mn_countRemainingCards();
  const penalty = ScorePolicy.getPenalty(remaining);
  const timeBonus = ScorePolicy.getTimeBonus(Math.max(0, mn_state.timer));
  const finalScore = Math.max(0, mn_state.currentScore + timeBonus - penalty);

  // 콤보 통계 (모달 노출용)
  const sorted = [...mn_state.hands].sort((a, b) => b.rankValue - a.rankValue);
  const best = sorted[0];
  const maxCombo = mn_state.hands.reduce((m, h) => Math.max(m, h.comboSize || 1), 1);

  const isNewHi = mn_saveHighScore(finalScore);
  const highScore = Math.max(mn_getHighScore(), finalScore);

  // 모달
  const title = reason === 'complete' ? i18n.t('modal.complete')
              : reason === 'nomoves' ? i18n.t('modal.noMoreMoves')
              : i18n.t('modal.timeUp');

  let handListHTML = '';
  sorted.forEach((h, i) => {
    const cardsStr = h.cards.map(c => MN_VALUE_NAMES[c.value] + c.suit).join(' ');
    const pts = mn_getRankScore(h.rank);
    const comboMark = (h.comboSize > 1) ? ` <span style="color:#ff6ba3;">×${h.comboSize}</span>` : '';
    handListHTML += `<div class="hand-list-item"><span class="rank-label">${i === 0 ? '🏆 ' : ''}${h.label}${comboMark}</span><span class="cards-str">${cardsStr} (+${pts})</span></div>`;
  });

  const penaltyHTML = penalty > 0 ? `<div style="color:#ff5252;font-size:0.85rem;margin-bottom:6px;">${i18n.t('modal.cardPenalty', { total: remaining, over: remaining - 4, per: mn_getPenaltyPerCard(), penalty })}</div>` : '';
  const timeBonusHTML = timeBonus > 0 ? `<div style="color:#4CAF50;font-size:0.85rem;margin-bottom:6px;">${i18n.t('modal.timeBonus', { n: timeBonus })}</div>` : '';
  const newHiHTML = isNewHi ? `<div style="color:#ff6ba3;font-size:1rem;font-weight:700;margin-bottom:4px;">${i18n.t('modal.newHighScore')}</div>` : '';
  const hiHTML = `<div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:8px;">${i18n.t('modal.myHighScore', { score: highScore })}</div>`;
  const comboHTML = (maxCombo > 1) ? `<div style="color:#ff6ba3;font-size:0.85rem;margin-bottom:6px;">MAX COMBO ×${maxCombo}</div>` : '';

  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2 style="color:#ff6ba3;">${title}</h2>
    <div class="subtitle">${i18n.t('modal.handsCompleted', { n: mn_state.hands.length })}</div>
    ${best ? `<div class="best-hand">${i18n.t('modal.best', { hand: best.label })}</div>` : ''}
    <div class="score">${i18n.t('modal.score', { score: finalScore })}</div>
    ${comboHTML}
    ${timeBonusHTML}
    ${penaltyHTML}
    ${newHiHTML}
    ${hiHTML}
    <div class="hand-list">${handListHTML}</div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:12px;">
      <button class="btn-play-again" onclick="mn_replay()">${i18n.t('ui.playAgain')}</button>
      <a href="mode_select.html" data-flush-exit class="btn-play-again" style="background:rgba(255,255,255,0.1);color:#e0e0e0;text-decoration:none;display:flex;align-items:center;">${i18n.t('ui.gameEnd')}</a>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('active');
  if (typeof window.initFlushExitHandlers === 'function') window.initFlushExitHandlers(modal);

  // 서버 제출 (옵션 B: mode='maniac' 보내고 reject 시 콘솔 경고만)
  const submitPromise = mn_submitToServer(finalScore, reason)
    .catch(err => { console.warn('[maniac/submit] background error:', err); });

  // M2: batch 차감 flush
  submitPromise.finally(() => {
    if (typeof window.flushAllAccumulated === 'function') {
      window.flushAllAccumulated().catch(e => console.warn('[maniac/end] flush error:', e));
    }
  });
}

// =============== [REWRITE] Replay (Play Again) — 새 세션 ===============
async function mn_replay() {
  document.getElementById('modalOverlay').classList.remove('active');
  await mn_startWithServerSession();
}

// =============== [REWRITE] Reset (RESTART, 1G batch) ===============
async function mn_resetGame() {
  if (mn_state.phase !== 'playing') return;
  if (typeof window.accumulateSpend !== 'function') {
    console.warn('[maniac.restart] accumulateSpend not available');
    return;
  }
  const restartCost = ScorePolicy.getGoldCost('maniac', 'restart') || 1;
  const currentGold = parseInt(mn_loadLocal('poker_gold') || '0', 10);
  if (currentGold < restartCost) {
    showToast(i18n.t('toast.goldInsufficientN', { n: restartCost }));
    return;
  }
  if (!window.accumulateSpend(restartCost, 'maniac_restart_batch')) return;

  // 새 서버 세션 발급 → 새 시드로 초기화
  await mn_startWithServerSession({ skipOverlay: true });
}

// =============== Server session (옵션 B) ===============
async function mn_requestServerSession() {
  try {
    const session = (await sb.auth.getSession()).data.session;
    const token = session?.access_token;
    if (!token) return null;
    const url = `${typeof RENDER_SERVER === 'string' ? RENDER_SERVER : ''}/api/session/start`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ mode: 'maniac' }),
    });
    if (!res.ok) {
      console.warn('[maniac/session/start] server reject:', res.status, '— fallback to no-seed mode');
      return null;
    }
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('[maniac/session/start] error:', e, '— fallback to no-seed mode');
    return null;
  }
}
async function mn_submitToServer(claimedScore, reason) {
  if (!mn_serverSession.sessionId || mn_serverSession.submitted) return;
  try {
    const session = (await sb.auth.getSession()).data.session;
    const token = session?.access_token;
    if (!token) return;
    const url = `${typeof RENDER_SERVER === 'string' ? RENDER_SERVER : ''}/api/session/submit`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        sessionId: mn_serverSession.sessionId,
        dragLog: mn_serverSession.dragLog,
        claimedScore,
        timeRemaining: Math.max(0, mn_state.timer || 0),
        extraData: { reason: reason || 'gameover', mode: 'maniac' },
      }),
    });
    const data = await res.json();
    if (res.ok && data.accepted) {
      mn_serverSession.submitted = true;
      console.log('[maniac/submit] accepted:', data);
    } else {
      console.warn('[maniac/submit] rejected:', { status: res.status, data });
    }
  } catch (e) {
    console.warn('[maniac/submit] error:', e);
  }
}

// =============== Initial flow ===============
async function mn_startWithServerSession(opts) {
  opts = opts || {};
  // 서버 세션 발급
  const session = await mn_requestServerSession();
  const seed = session?.seed ?? null;
  mn_serverSession = {
    sessionId: session?.sessionId || null,
    seed,
    dragLog: [],
    serverStartedAt: session?.startedAt || null,
    mode: 'maniac',
    submitted: false,
  };

  mn_initState();
  mn_initGrid(seed);
  mn_renderGrid();
  mn_updateHandPanel();
  mn_renderRemovedCards();
  mn_updateScoreDisplay();
  if (typeof BGM !== 'undefined' && BGM.start) BGM.start();
  if (typeof WakeLock !== 'undefined' && WakeLock.acquire) WakeLock.acquire();
  clearInterval(mn_state.timerInterval);
  mn_startTimer();
  mn_gameStarted = true;
}

// =============== 진입 검증 (best_score >= 400) ===============
async function mn_checkUnlockOrRedirect() {
  try {
    const playerId = mn_loadLocal('poker_player_id');
    if (!playerId) {
      mn_redirectLocked();
      return false;
    }
    const { data, error } = await sb
      .from('player_period_stats')
      .select('best_score')
      .eq('player_id', playerId)
      .eq('board', 'basic')
      .eq('period_type', 'all_time')
      .maybeSingle();
    if (error) {
      console.warn('[maniac.unlock] query error:', error);
      mn_redirectLocked();
      return false;
    }
    const bestScore = data?.best_score ?? 0;
    if (bestScore < MN_UNLOCK_SCORE) {
      mn_redirectLocked();
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[maniac.unlock] exception:', e);
    mn_redirectLocked();
    return false;
  }
}
function mn_redirectLocked() {
  // 1초 토스트 후 redirect (사용자 인지 시간)
  showToast(i18n.t('maniac.entryDenied') || '베이직 400점 미달성으로 입장할 수 없습니다');
  setTimeout(() => mn_navigateTo('mode_select.html'), 1200);
}

// =============== Start overlay ===============
function mn_initStartOverlay() {
  const overlay = document.getElementById('startOverlay');
  const btn = document.getElementById('startBtn');
  if (!overlay || !btn) return;
  const handleStart = async () => {
    overlay.removeEventListener('click', handleStart);
    btn.removeEventListener('click', handleStart);
    if (typeof Sound !== 'undefined' && Sound.warmup) Sound.warmup();
    overlay.classList.add('hidden');
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
    await mn_startWithServerSession();
  };
  btn.addEventListener('click', handleStart);
  overlay.addEventListener('click', handleStart);
}

// =============== Event Listeners ===============
const mn_gridEl = document.getElementById('grid');
mn_gridEl.addEventListener('mousedown', e => {
  const cell = mn_getCellFromEvent(e);
  if (cell) mn_startDrag(cell[0], cell[1]);
});
mn_gridEl.addEventListener('mousemove', e => {
  const cell = mn_getCellFromEvent(e);
  if (cell) mn_extendPath(cell[0], cell[1]);
});
document.addEventListener('mouseup', () => {
  if (mn_state.isDragging) mn_endDrag();
});
mn_gridEl.addEventListener('touchstart', e => {
  e.preventDefault();
  const cell = mn_getCellFromEvent(e);
  if (cell) mn_startDrag(cell[0], cell[1]);
}, { passive: false });
document.addEventListener('touchmove', e => {
  if (!mn_state.isDragging) return;
  e.preventDefault();
  const cell = mn_getCellFromEvent(e);
  if (cell) mn_extendPath(cell[0], cell[1]);
}, { passive: false });
document.addEventListener('touchend', e => {
  if (mn_state.isDragging) { e.preventDefault(); mn_endDrag(); }
}, { passive: false });
document.addEventListener('touchcancel', () => {
  if (mn_state.isDragging) { mn_state.isDragging = false; mn_clearSelection(); }
});

document.getElementById('restartBtn').addEventListener('click', () => mn_resetGame());

// QR (도움말) 모달 — quickref.js 활용
document.querySelector('.qr-btn')?.addEventListener('click', () => {
  if (typeof window.openQuickRef === 'function') window.openQuickRef();
});

// =============== Init ===============
(async () => {
  // 진입 검증
  const ok = await mn_checkUnlockOrRedirect();
  if (!ok) return;

  // 초기 상태
  mn_initState();
  mn_initGrid();
  mn_renderGrid();
  mn_updateHandPanel();
  mn_updateScoreDisplay();
  mn_renderRemovedCards();

  // BGM (베이직 임시 재활용 — 정식 Maniac_Theme.mp3는 별도 도착 시 교체)
  if (typeof BGM !== 'undefined' && BGM.init) BGM.init('./audio/Main_Theme.mp3');
  mn_initStartOverlay();
})();

// =============================================
// EXPO 전환 체크리스트 (maniac_script.js)
// REUSE   : mn_createDeck, mn_shuffle, mn_cardFromId, mn_initGrid,
//           mn_evaluateHand, mn_partialEval, mn_isValidHand,
//           mn_getRankScore, mn_getPenaltyPerCard, mn_applyGravityToColumn,
//           mn_countRemainingCards, mn_scanForValidMoves, mn_dfsScan,
//           mn_getReachableCards, mn_initState, mn_groupIndexAt, mn_noteIndexAt
// ADAPTER : mn_saveLocal, mn_loadLocal, mn_navigateTo
//           mn_requestServerSession, mn_submitToServer (URL 동일, import 변경)
//           accumulateSpend / flushAllAccumulated 호출 (gold_client.js 헬퍼)
// REWRITE : mn_renderGrid, mn_updateSelectionVisuals, mn_updateDragLine,
//           mn_updateCumulativePreview, mn_updateComboBadge,
//           mn_startDrag, mn_extendPath, mn_endDrag, mn_clearSelection,
//           mn_invalidPathFeedback, mn_removeCardsAndApplyGravity,
//           mn_updateHandPanel, mn_renderRemovedCards, mn_updateScoreDisplay,
//           mn_showScorePopup, showToast, mn_startTimer, mn_updateTimerDisplay,
//           mn_endGame, mn_resetGame, mn_replay, mn_initStartOverlay,
//           Event listeners (mouse/touch), Init IIFE
// =============================================
