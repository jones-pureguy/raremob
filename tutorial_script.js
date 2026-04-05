// ── DragON POKER Tutorial Mode ──

// =============================================
// [ADAPTER] 플랫폼 어댑터 — Expo 전환 시 교체
// =============================================

// [ADAPTER] localStorage 래퍼 — Expo 전환 시 AsyncStorage로 교체
function saveLocal(key, value) { localStorage.setItem(key, value); }
function loadLocal(key) { return localStorage.getItem(key); }

// [ADAPTER] 페이지 이동 래퍼 — Expo 전환 시 React Navigation으로 교체
function navigateTo(page) { location.href = page; }

// =============================================
// [LOGIC] 게임 로직 — Expo 전환 시 재활용
// =============================================

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
let tutConfig = null;

// [REUSE] 게임 상태 초기화
function initState() {
  state = {
    grid: [], hands: [], selectedPath: [], isDragging: false,
    phase: 'playing',
  };
}

// ── Card ──
// [REUSE] 카드 ID에서 카드 객체 생성
function cardFromId(id) {
  const suitCode = id[id.length - 1];
  const valueName = id.slice(0, -1);
  return { suit: SUIT_BY_CODE[suitCode], value: VALUE_BY_NAME[valueName], id };
}
// [REUSE] 카드 표시 문자열
function cardDisplay(card) { return VALUE_NAMES[card.value] + card.suit; }

// ── Deck Loader ──
// [REUSE] 튜토리얼 덱 로드
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
// [REUSE] 랜덤 덱 로드
function loadRandomDeck() {
  const deck = [];
  for (const s of ['s','h','d','c']) {
    for (let v = 2; v <= 14; v++) {
      deck.push(VALUE_NAMES[v] + s);
    }
  }
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

// =============================================
// [UI] DOM / 렌더링 — Expo 전환 시 재작성
// =============================================

// ── Grid Render ──
// [REWRITE] 그리드 렌더링
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
// [REWRITE] 이벤트 좌표 추출
function getEventCoords(e) {
  if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches.length > 0) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

// [REWRITE] 이벤트에서 셀 좌표 추출
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

// [REWRITE] 선택 시각 효과 업데이트
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

// [REWRITE] 드래그 시작
function startDrag(row, col) {
  if (state.phase !== 'playing' || tutorialEnded) return;
  if (!waitingForMission) return;
  if (!state.grid[row][col].card) return;
  state.isDragging = true;
  state.selectedPath = [[row, col]];
  Sound.cardSelect(0);
  updateSelectionVisuals();
}

// [REUSE] 튜토리얼 이동 유효성 체크
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

// [REUSE] 경로 확장 로직
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

// [REUSE] 경로 확정 및 핸드 처리
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

// [REWRITE] 선택 초기화
function clearSelection() {
  state.selectedPath = [];
  updateSelectionVisuals();
}

// ── Drag Line & Preview ──
// [REWRITE] 드래그 라인 SVG 업데이트
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

// [REWRITE] 핸드 프리뷰 업데이트
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
// [REUSE] 족보 판정
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

// [REUSE] 부분 족보 판정 (5장 미만)
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

// [REUSE] 유효 핸드 판정
function isValidHand(hand) {
  if (hand.rank >= RANK.TWO_PAIR) return true;
  if (hand.rank === RANK.ONE_PAIR && hand.pairValue >= 10) return true;
  return false;
}

// ── Gravity ──
// [REWRITE] 카드 제거 애니메이션 + 중력 적용
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

// [REUSE] 컬럼 중력 적용
function applyGravityToColumn(col) {
  const cards = [];
  for (let r = GRID_SIZE - 1; r >= 0; r--) { if (state.grid[r][col].card) cards.push(state.grid[r][col].card); }
  for (let r = GRID_SIZE - 1; r >= 0; r--) { const idx = GRID_SIZE - 1 - r; state.grid[r][col].card = idx < cards.length ? cards[idx] : null; }
}

// [REUSE] 전체 그리드 중력 적용
function applyGravityToAll() {
  for (let col = 0; col < GRID_SIZE; col++) applyGravityToColumn(col);
}

// ── Score Popup ──
// [REUSE] 족보 티어 분류
function getHandTier(rank) {
  if (rank >= RANK.ROYAL_FLUSH_PLUS) return 6;
  if (rank >= RANK.ROYAL_FLUSH) return 5;
  if (rank >= RANK.STRAIGHT_FLUSH) return 4;
  if (rank >= RANK.FULL_HOUSE) return 3;
  if (rank >= RANK.THREE_KIND) return 2;
  return 1;
}

// [REWRITE] 화면 플래시 효과
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

// [REWRITE] 파티클 효과 생성
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

// [REWRITE] 점수 팝업 표시
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
// [REUSE] 튜토리얼 미션 조건 체크
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
    if (cond.type === 'unique_hands_gte') {
      const uniqueRanks = new Set(state.hands.map(h => h.rank));
      return uniqueRanks.size >= cond.count;
    }
    return false;
  });
}

// ══════════════════════════════════════
// ── Tutorial Dialog System ──
// ══════════════════════════════════════

const isReplay = new URLSearchParams(location.search).get('replay') === '1'; // [ADAPTER] URL 파싱 — Expo 전환 시 React Navigation params
let typingTimer = null;

// ─── Start Overlay ───
// [REWRITE] 스타트 오버레이 초기화
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

// [REWRITE] 튜토리얼 메인 초기화
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

// [REWRITE] 드래그 이벤트 설정
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

// [REWRITE] 다이얼로그 이벤트 설정
function setupDialogEvents() {
  const overlay = document.getElementById('tutDialogOverlay');

  let overlayTouched = false;
  overlay.addEventListener('touchend', e => {
    if (waitingForMission) return;
    if (tutorialEnded) return;
    if (!tutorialStarted) return;
    e.preventDefault();
    overlayTouched = true;
    onDialogClick();
  }, { passive: false });
  overlay.addEventListener('click', e => {
    if (waitingForMission) return;
    if (tutorialEnded) return;
    if (!tutorialStarted) return;
    if (overlayTouched) { overlayTouched = false; return; }
    onDialogClick();
  });
}

// ── Step Loading ──
// [REWRITE] 스텝 로드
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

  document.getElementById('tutProgress').textContent = `${idx + 1} / ${tutorials.length}`;

  const restartBtn = document.getElementById('tutRestartBtn');
  restartBtn.disabled = false;

  initState();
  loadTutorialDeck(step.initialDeck);
  applyGravityToAll();
  renderGrid();

  showCurrentDialog();
}

// ── Dialog Display ──
// [REWRITE] 현재 다이얼로그 표시
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
  const overlay = document.getElementById('tutDialogOverlay');

  typeText(textEl, text);

  const prompt = document.getElementById('tutActionPrompt');
  const promptText = document.getElementById('tutActionText');

  if (phase.phase === 'instruction') {
    overlay.classList.add('hidden');
    nextBtn.classList.add('hidden');
    waitingForMission = true;
    const instrText = text || i18n.t('tutorial.actionPrompt') || '드래그 해보세요!';
    if (promptText) promptText.textContent = instrText;
    if (prompt) prompt.classList.add('active');
  } else {
    overlay.classList.remove('hidden');
    nextBtn.classList.remove('hidden');
    waitingForMission = false;
    if (prompt) prompt.classList.remove('active');
  }

  if (phase.trigger === 'auto') {
    nextBtn.classList.remove('hidden');
    setTimeout(() => advanceDialog(), 3000);
  }
}

// [REWRITE] 타이핑 효과
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

// [REUSE] 타이핑 완료 여부
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

// [REWRITE] 타이핑 즉시 완료
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
// [REUSE] 다이얼로그 클릭 처리
function onDialogClick() {
  if (!tutorialStarted) return;
  if (waitingForMission) return;
  if (tutorialEnded) return;

  if (!isTypingComplete()) {
    forceCompleteTyping();
    return;
  }

  advanceDialog();
}

// ── Dialog Advance ──
// [REUSE] 다이얼로그 진행
function advanceDialog() {
  const step = tutorials[currentStep];
  const phase = step.dialogs[currentPhaseIdx];

  if (currentLineIdx < phase.lines.length - 1) {
    currentLineIdx++;
    showCurrentDialog();
    return;
  }

  if (currentPhaseIdx < step.dialogs.length - 1) {
    currentPhaseIdx++;
    currentLineIdx = 0;
    showCurrentDialog();
    return;
  }

  currentStep++;
  loadStep(currentStep);
}

// ── Mission Complete Handler ──
// [REWRITE] 미션 완료 처리
function onTutorialHandComplete(handData) {
  if (!waitingForMission) return;
  const step = tutorials[currentStep];
  if (!checkTutorialMission(step.mission, handData)) return;

  waitingForMission = false;
  currentPhaseIdx++;
  currentLineIdx = 0;
  const prompt = document.getElementById('tutActionPrompt');
  if (prompt) prompt.classList.remove('active');
  setTimeout(() => showCurrentDialog(), 500);
}

// ── Restart Button ──
// [REWRITE] 튜토리얼 리스타트
function tutorialRestart() {
  const step = tutorials[currentStep];

  if (step.restartMissionComplete && waitingForMission) {
    initState();
    loadRandomDeck();
    renderGrid();

    waitingForMission = false;
    currentPhaseIdx++;
    currentLineIdx = 0;
    document.getElementById('tutNextBtn').classList.remove('hidden');
    const prompt = document.getElementById('tutActionPrompt');
    if (prompt) prompt.classList.remove('active');
    setTimeout(() => showCurrentDialog(), 400);
    return;
  }

  initState();
  loadTutorialDeck(step.initialDeck);
  applyGravityToAll();
  orderedStraightCount = 0;
  renderGrid();

  const instrIdx = step.dialogs.findIndex(d => d.phase === 'instruction');
  if (instrIdx !== -1) {
    currentPhaseIdx = instrIdx;
    currentLineIdx = 0;
    waitingForMission = true;
    document.getElementById('tutDialogOverlay').classList.add('hidden');
    document.getElementById('tutNextBtn').classList.add('hidden');
    showCurrentDialog();
  }
}

// ── Skip ──
// [REWRITE] 튜토리얼 스킵
function skipTutorial() {
  const msg = i18n.t('tutorial.skipConfirm') || 'Skip tutorial?';
  if (confirm(msg)) {
    completeTutorial();
  }
}

// ── Complete ──
// [ADAPTER] 튜토리얼 완료 — localStorage + 페이지 이동
function completeTutorial() {
  tutorialEnded = true;
  saveLocal('poker_tutorial_done', '1');
  navigateTo(isReplay ? 'mode_select.html' : 'id.html');
}

// ── Boot ──
initTutorial();

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 16개 함수 (변경 불필요)
//   - initState, cardFromId, cardDisplay, loadTutorialDeck, loadRandomDeck
//   - isValidTutorialMove, extendPath, finalizePath
//   - evaluateHand, partialEval, isValidHand
//   - applyGravityToColumn, applyGravityToAll, getHandTier
//   - checkTutorialMission, isTypingComplete, onDialogClick, advanceDialog
// ADAPTER : 3개 함수 (내부 구현 교체 필요)
//   - saveLocal → AsyncStorage
//   - loadLocal → AsyncStorage
//   - navigateTo → React Navigation
//   - completeTutorial (uses saveLocal + navigateTo)
// REWRITE : 18개 함수 (전면 재작성)
//   - renderGrid, getEventCoords, getCellFromEvent, updateSelectionVisuals
//   - startDrag, clearSelection, updateDragLine, updateHandPreview
//   - removeCardsAndApplyGravity, triggerScreenFlash, spawnParticles
//   - showScorePopup, initStartOverlay, initTutorial
//   - setupDragEvents, setupDialogEvents, loadStep, showCurrentDialog
//   - typeText, forceCompleteTyping, onTutorialHandComplete
//   - tutorialRestart, skipTutorial
// =============================================
