// =============================================
// [ADAPTER] 플랫폼 어댑터 — Expo 전환 시 교체
// =============================================

// [ADAPTER] localStorage wrapper → Expo: AsyncStorage / SecureStore
function saveLocal(key, value) {
  localStorage.setItem(key, value);
}

// [ADAPTER] localStorage wrapper → Expo: AsyncStorage / SecureStore
function loadLocal(key) {
  return localStorage.getItem(key);
}

// [ADAPTER] localStorage wrapper → Expo: AsyncStorage / SecureStore
function removeLocal(key) {
  localStorage.removeItem(key);
}

// [ADAPTER] page navigation → Expo: navigation.navigate() / expo-router
function navigateTo(page) {
  location.href = page;
}

// =============================================
// [LOGIC] 게임 로직 — Expo 전환 시 재활용
// =============================================

// ─── Constants ─── // [REUSE]
const TIMER_SECONDS = window._arcadeTimerSeconds || 200;
let GRID_SIZE = window._duelGridSize || 7;
const MAX_HANDS = 9;
const HAND_SIZE = 5;
const HIDDEN_UNLOCK_SCORE = 500; // 히든 게임 진입 최소 점수

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const VALUE_NAMES = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };

const RANK = { // [REUSE]
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
  ROYAL_FLUSH_PLUS: 10,
};

const RANK_NAME_BY_VALUE = {}; // [REUSE]
Object.entries(RANK).forEach(([k, v]) => RANK_NAME_BY_VALUE[v] = k);

function getRankScore(rank) { // [REUSE]
  return ScorePolicy.getHandScore(RANK_NAME_BY_VALUE[rank] || 'HIGH_CARD');
}

function getPenaltyPerCard() { // [REUSE]
  return ScorePolicy.get().penalty.perCard;
}

const RANK_LABELS = { // [REUSE]
  [RANK.HIGH_CARD]: 'High Card',
  [RANK.ONE_PAIR]: 'One Pair',
  [RANK.TWO_PAIR]: 'Two Pair',
  [RANK.THREE_KIND]: 'Three of a Kind',
  [RANK.STRAIGHT]: 'Straight',
  [RANK.FLUSH]: 'Flush',
  [RANK.FULL_HOUSE]: 'Full House',
  [RANK.FOUR_KIND]: 'Four of a Kind',
  [RANK.STRAIGHT_FLUSH]: 'Straight Flush',
  [RANK.ROYAL_FLUSH]: 'Royal Flush',
  [RANK.ROYAL_FLUSH_PLUS]: 'Royal Flush+',
};

const RANK_CSS = { // [REUSE]
  [RANK.ONE_PAIR]: 'one-pair',
  [RANK.TWO_PAIR]: 'two-pair',
  [RANK.THREE_KIND]: 'three-kind',
  [RANK.STRAIGHT]: 'straight',
  [RANK.FLUSH]: 'flush',
  [RANK.FULL_HOUSE]: 'full-house',
  [RANK.FOUR_KIND]: 'four-kind',
  [RANK.STRAIGHT_FLUSH]: 'straight-flush',
  [RANK.ROYAL_FLUSH]: 'royal-flush',
  [RANK.ROYAL_FLUSH_PLUS]: 'royal-flush-plus',
};

// ─── Game State ─── // [REUSE]
let state = {};
let currentPlayerId = null; // cached player uuid
let replayLog = null; // current game replay data
let isRetryMode = false; // true when game started via GAME RETRY

// [REUSE] Phase 1-7: 서버 세션 상태 (싱글플레이만 사용, PvP는 무시)
window._serverSession = window._serverSession || {
  sessionId: null,
  seed: null,
  dragLog: [],
  serverStartedAt: null,
  mode: 'basic',
  submitted: false,
};

function initState() { // [REUSE]
  state = {
    grid: [],
    hands: [],
    selectedPath: [],
    isDragging: false,
    gameOver: false,
    timer: TIMER_SECONDS,
    phase: 'playing',
    timerInterval: null,
    debugMode: false,
    currentScore: 0,
    removedCards: [],
  };
}

// ─── Card / Deck Utilities ───
function createDeck() { // [REUSE]
  const deck = [];
  for (const suit of SUITS) {
    for (let v = 2; v <= 14; v++) {
      deck.push({ suit, value: v, id: VALUE_NAMES[v] + SUIT_NAMES[suit] });
    }
  }
  return deck;
}

function shuffle(arr) { // [REUSE]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardDisplay(card) { // [REUSE]
  return VALUE_NAMES[card.value] + card.suit;
}

function isRedSuit(suit) { // [REUSE]
  return suit === '♥' || suit === '♦';
}

// ─── Card ID Parser ───
const SUIT_BY_CODE = { s: '♠', h: '♥', d: '♦', c: '♣' }; // [REUSE]
const VALUE_BY_NAME = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 }; // [REUSE]

function cardFromId(id) { // [REUSE]
  const suitCode = id[id.length - 1];
  const valueName = id.slice(0, -1);
  return { suit: SUIT_BY_CODE[suitCode], value: VALUE_BY_NAME[valueName], id };
}

// ─── Grid Init ───
function initGrid(seed = null) { // [REUSE] (uses ADAPTER: saveLocal/loadLocal/removeLocal)
  let deck;
  const retryRaw = loadLocal('poker_retry_deck');
  if (retryRaw) {
    removeLocal('poker_retry_deck');
    const deckIds = JSON.parse(retryRaw);
    deck = deckIds.map(id => cardFromId(id));
    isRetryMode = true;
  } else if (seed !== null && window.PRNG) {
    // [REUSE] Phase 1-7: 서버 seed 기반 결정론적 셔플
    deck = window.PRNG.shuffleFromSeed(createDeck(), seed);
    isRetryMode = false;
  } else {
    deck = shuffle(createDeck());
    isRetryMode = false;
  }

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

  // Init replay log with initial deck
  replayLog = {
    version: 1,
    timestamp: new Date().toISOString(),
    username: (loadLocal('poker_username') || '').trim(),
    initialDeck: [...state.removedCards, ...cards].map(c => c.id),
    actions: [],
    result: null,
  };
}

// ─── Hand Evaluation (Poker Logic) ───
function evaluateHand(cards) { // [REUSE]
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

  // ─── PvP 확장 필드 ───
  const sortedValues = values.slice().sort((a, b) => b - a);
  const sortedCountKeys = countKeys.map(([v, c]) => [parseInt(v), c]);

  let primaryVal = 0, secondaryVal = 0, kickers = [];

  if (rank === RANK.FOUR_KIND) {
    primaryVal = sortedCountKeys[0][0];
    kickers = sortedValues.filter(v => v !== primaryVal);
  } else if (rank === RANK.FULL_HOUSE) {
    primaryVal = sortedCountKeys[0][0];
    secondaryVal = sortedCountKeys[1][0];
  } else if (rank === RANK.THREE_KIND) {
    primaryVal = sortedCountKeys[0][0];
    kickers = sortedValues.filter(v => v !== primaryVal).sort((a, b) => b - a);
  } else if (rank === RANK.TWO_PAIR) {
    const pairVals = sortedCountKeys.filter(([, c]) => c === 2).map(([v]) => v).sort((a, b) => b - a);
    primaryVal = pairVals[0];
    secondaryVal = pairVals[1];
    kickers = sortedValues.filter(v => v !== primaryVal && v !== secondaryVal);
  } else if (rank === RANK.ONE_PAIR) {
    primaryVal = sortedCountKeys[0][0];
    kickers = sortedValues.filter(v => v !== primaryVal).sort((a, b) => b - a);
  } else {
    kickers = sortedValues;
  }

  return {
    rank, rankValue: rank, label,
    pairValue: countValues[0] === 2 ? parseInt(countKeys[0][0]) : 0,
    cards, values: sortedValues, suits, counts,
    countKeys: sortedCountKeys, primaryVal, secondaryVal, kickers
  };
}

function partialEval(cards) { // [REUSE]
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

function isValidHand(hand) { // [REUSE]
  if (hand.rank >= RANK.TWO_PAIR) return true;
  if (hand.rank === RANK.ONE_PAIR && hand.pairValue >= 10) return true;
  return false;
}

// ─── Grid State Utilities ───
function applyGravityToColumn(col) { // [REUSE]
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

// ─── No More Moves Scanner (8방향 + 빈칸 건너뛰기) ───

function scanForValidMoves() { // [REUSE]
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!state.grid[r][c].card) continue;
      const visited = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(false));
      if (dfsScan(r, c, [state.grid[r][c].card], visited)) return true;
    }
  }
  return false;
}

// 8방향에서 빈칸을 건너뛰어 도달 가능한 카드 좌표 목록 반환
function getReachableCards(r, c, visited) { // [REUSE]
  const results = [];
  // 8방향: 상하좌우 + 대각선
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  for (const [dr, dc] of dirs) {
    let nr = r + dr;
    let nc = c + dc;
    // 빈칸은 건너뛰고, 카드가 있는 첫 칸을 찾는다
    while (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
      if (state.grid[nr][nc].card) {
        if (!visited[nr][nc]) results.push([nr, nc]);
        break; // 카드가 있으면 그 뒤는 볼 수 없음
      }
      nr += dr;
      nc += dc;
    }
  }
  return results;
}

function dfsScan(r, c, cards, visited) { // [REUSE]
  visited[r][c] = true;

  if (cards.length === HAND_SIZE) {
    const hand = evaluateHand(cards);
    visited[r][c] = false;
    return isValidHand(hand);
  }

  for (const [nr, nc] of getReachableCards(r, c, visited)) {
    cards.push(state.grid[nr][nc].card);
    if (dfsScan(nr, nc, cards, visited)) return true;
    cards.pop();
  }

  visited[r][c] = false;
  return false;
}

// ─── Remaining Cards Count ───
function countRemainingCards() { // [REUSE]
  let count = 0;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (state.grid[r][c].card) count++;
    }
  }
  return count;
}

function getHandTier(rank) { // [REUSE]
  if (rank >= RANK.ROYAL_FLUSH_PLUS) return 6;
  if (rank >= RANK.ROYAL_FLUSH) return 5;
  if (rank >= RANK.STRAIGHT_FLUSH) return 4;
  if (rank >= RANK.FULL_HOUSE) return 3;
  if (rank >= RANK.THREE_KIND) return 2;
  return 1;
}

// ─── High Score ───
function saveHighScore(score) { // [REUSE] (uses ADAPTER: saveLocal/loadLocal)
  const current = parseInt(loadLocal('poker_highscore') || '0', 10);
  if (score > current) {
    saveLocal('poker_highscore', score);
    return true;
  }
  return false;
}

function getHighScore() { // [REUSE] (uses ADAPTER: loadLocal)
  return parseInt(loadLocal('poker_highscore') || '0', 10);
}

function escapeHTML(str) { // [REUSE]
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Supabase / Players / Leaderboard ───

// Get or create player, returns player uuid
async function getOrCreatePlayer() { // [REUSE] (uses ADAPTER: loadLocal)
  // Use auth.uid() from initAuth
  if (currentPlayerId) return currentPlayerId;

  try {
    const uid = await initAuth();
    if (!uid) { console.error('[DragON] No auth uid'); return null; }
    currentPlayerId = uid;
    return uid;
  } catch (err) {
    console.error('[DragON] Player error:', err);
    return loadLocal('poker_player_id') || null;
  }
}

// Returns { leaderboardUpdated: boolean, topScore: number }
// [REUSE] [Phase 1-13 후속] 클라 leaderboard 직접 호출 제거 + game_sessions 중복 INSERT 제거.
// 서버 /api/session/submit이 game_sessions INSERT + player_period_stats UPSERT 처리.
// 여기서는 골드 싱크 + Top score 조회만.
async function saveSessionAndGetStatus(data) {
  console.log('[DragON] Saving session...', data);
  let topScore = 0;

  try {
    const playerId = await getOrCreatePlayer(data.username);
    if (!playerId) {
      console.error('[DragON] No player ID, skipping save');
      return { leaderboardUpdated: false, topScore };
    }

    // [PHASE_2A_NEW bundle 8-5] syncGoldToDB('game_end') 제거 — spendGold/awardGold RPC가 실시간 동기화 처리

    // Top score 조회 (서버 /top API)
    const board = isRetryMode ? 'basic_retry' : 'basic';
    try {
      const url = `${SERVER_URL}/api/leaderboard/top?board=${board}&period=all_time&sort=best&limit=1`;
      const apiRes = await fetch(url);
      if (apiRes.ok) {
        const json = await apiRes.json();
        const top = json?.rows?.[0];
        topScore = top?.best_score ?? top?.score ?? 0;
      }
    } catch (e) {
      console.warn('[DragON] Top score fetch error:', e);
    }

  } catch (err) {
    console.error('[DragON] Save error:', err);
  }

  // leaderboardUpdated는 현재 호출자에서 사용 안 함 (죽은 변수).
  // Phase 2D-pre에서 서버 /api/session/submit 응답의 isNewRecord와 통합 시 정식 처리.
  return { leaderboardUpdated: false, topScore };
}

// Fetch only the #1 leaderboard score (no save)
// [REUSE] [Phase 1-13 후속] /top API 호출로 교체 (구 leaderboard 테이블 DROP됨)
async function fetchTopScore() {
  try {
    const board = isRetryMode ? 'basic_retry' : 'basic';
    const url = `${SERVER_URL}/api/leaderboard/top?board=${board}&period=all_time&sort=best&limit=1`;
    const apiRes = await fetch(url);
    if (!apiRes.ok) return 0;
    const json = await apiRes.json();
    const top = json?.rows?.[0];
    return top?.best_score ?? top?.score ?? 0;
  } catch (err) {
    return 0;
  }
}

// [Phase 1-8-prep] saveReplayToDB 함수 제거 — 클라 game_replays INSERT 경로 차단.
//   · 신기록 자동 저장: 서버 saveSessionToDb / retry/submit이 처리
//   · 50골드 박제: localStorage 전용 (saveReplayFromButton 참조)

// =============================================
// [UI] DOM / 렌더링 — Expo 전환 시 재작성
// =============================================

// ─── Grid Render ───
function renderGrid() { // [REWRITE]
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
function getEventCoords(e) { // [REWRITE]
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function getCellFromEvent(e) { // [REWRITE]
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
function updateSelectionVisuals() { // [REWRITE]
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

function startDrag(row, col) { // [REWRITE]
  if (state.phase !== 'playing') return;
  if (!state.grid[row][col].card) return;
  state.isDragging = true;
  state.selectedPath = [[row, col]];
  Sound.cardSelect(0);
  updateSelectionVisuals();
}

function extendPath(row, col) { // [REWRITE]
  if (!state.isDragging) return;
  if (!state.grid[row][col].card) return;

  // Already in path? Allow backtracking even at 5 cards
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

  // Can't add beyond 5
  if (state.selectedPath.length >= HAND_SIZE) return;

  const last = state.selectedPath[state.selectedPath.length - 1];

  // 8방향 + 빈칸 건너뛰기
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

  state.selectedPath.push([row, col]);
  const pathLen = state.selectedPath.length;
  if (pathLen >= 1 && pathLen <= 4) {
    Sound.cardSelect(pathLen - 1);
  }
  updateSelectionVisuals();
}

function finalizePath() { // [REWRITE]
  if (!state.isDragging) return;
  state.isDragging = false;

  // [Phase 1-11.3] endGame 후 race-late mouseup 차단
  if (state.gameOver) {
    clearSelection();
    return;
  }

  if (state.selectedPath.length < HAND_SIZE) {
    showToast(i18n.t('toast.selectFiveCards'));
    clearSelection();
    return;
  }

  const cards = state.selectedPath.map(([r, c]) => state.grid[r][c].card);
  const hand = evaluateHand(cards);

  // Royal Flush+ : Royal Flush with perfect drag order (10→J→Q→K→A)
  if (hand.rank === RANK.ROYAL_FLUSH) {
    const dragValues = cards.map(c => c.value);
    if (dragValues[0] === 10 && dragValues[1] === 11 && dragValues[2] === 12 && dragValues[3] === 13 && dragValues[4] === 14) {
      hand.rank = RANK.ROYAL_FLUSH_PLUS;
      hand.rankValue = RANK.ROYAL_FLUSH_PLUS;
      hand.label = 'Royal Flush+';
    }
  }

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
    showToast(i18n.t('toast.needHigherPair'));
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

  // Record action for replay
  if (replayLog) {
    replayLog.actions.push({
      t: state.timer,
      path: state.selectedPath.map(([r, c]) => [r, c]),
      hand: hand.label,
      score: earnedScore,
    });
  }

  // [REUSE] Phase 1-7: 서버 세션 dragLog 수집 (싱글플레이 + 세션 있을 때만)
  if (!window._pvpMode && window._serverSession && window._serverSession.sessionId) {
    window._serverSession.dragLog.push({
      cards: state.selectedPath.map(([r, c]) => [r, c]),
      ts: Date.now(),
    });
  }

  Sound.handComplete(hand.rankValue);
  updateScoreDisplay();
  showScorePopup(hand.label, earnedScore, hand.rank);
  removeCardsAndApplyGravity(hand.rank);
}

function clearSelection() { // [REWRITE]
  state.selectedPath = [];
  updateSelectionVisuals();
}

function updateDragLine() { // [REWRITE]
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

function updateHandPreview() { // [REWRITE]
  const previewEl = document.getElementById('handPreview');
  if (state.selectedPath.length === 0) {
    previewEl.textContent = '';
    previewEl.className = 'hand-preview';
    return;
  }

  const cards = state.selectedPath.map(([r, c]) => state.grid[r][c].card).filter(Boolean);
  if (cards.length < 2) {
    previewEl.textContent = i18n.t('ui.selecting', { count: cards.length });
    previewEl.className = 'hand-preview';
    return;
  }

  const hand = evaluateHand(cards);
  const valid = cards.length === 5 && isValidHand(hand);
  const mark = cards.length === 5 ? (valid ? '✓' : '✗') : '';

  previewEl.textContent = `${hand.label} ${mark}`;
  previewEl.className = 'hand-preview ' + (cards.length === 5 ? (valid ? 'valid' : 'invalid') : '');
}

// ─── Event Listeners ─── // [REWRITE]
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

document.getElementById('restartBtn').addEventListener('click', () => {
  resetGame();
});

// ─── Card Removal + Gravity ───
function removeCardsAndApplyGravity(rank) { // [REWRITE]
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
    positions.forEach(([r, c]) => {
      state.grid[r][c].card = null;
    });
    const affectedCols = [...new Set(positions.map(p => p[1]))];
    affectedCols.forEach(col => {
      applyGravityToColumn(col);
    });
    Sound.cardDrop();

    state.selectedPath = [];
    renderGrid();
    updateHandPanel();
    updateHandPreview();

    if (state.hands.length >= MAX_HANDS) {
      endGame('complete');
    } else {
      setTimeout(() => {
        if (state.phase === 'playing' && !scanForValidMoves()) {
          endGame('nomoves');
        }
      }, 500);
    }
  }, 300 + totalRemovalTime);
}

// ─── Timer ───
function startTimer() { // [REWRITE]
  state.timer = TIMER_SECONDS;
  updateTimerDisplay();

  state.timerInterval = setInterval(() => {
    if (state.phase !== 'playing') return;
    state.timer--;
    updateTimerDisplay();
    if (state.timer <= 0) {
      endGame('gameover');
    }
  }, 1000);
}

function updateTimerDisplay() { // [REWRITE]
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
function updateHandPanel() { // [REWRITE]
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

// ─── Game End ───
function endGame(reason) { // [REWRITE] (uses ADAPTER: saveLocal/loadLocal)
  // [Phase 1-11.3] 진행 중 드래그 처리 — gameOver 플래그 세팅 전에 finalize
  if (state.isDragging) {
    if (state.selectedPath.length === HAND_SIZE) {
      finalizePath();
    } else {
      state.isDragging = false;
      clearSelection();
    }
  }
  state.gameOver = true;

  WakeLock.release();
  state.phase = reason === 'complete' ? 'complete' : (reason === 'nomoves' ? 'nomoves' : 'gameover');
  clearInterval(state.timerInterval);

  const sorted = [...state.hands].sort((a, b) => b.rankValue - a.rankValue);
  const handScore = state.hands.reduce((sum, h) => sum + getRankScore(h.rank), 0);
  const best = sorted[0];

  // Time bonus
  const timeBonus = ScorePolicy.getTimeBonus(Math.max(0, state.timer));

  // Remaining cards penalty
  const remainingCards = countRemainingCards();
  const penaltyPerCard = getPenaltyPerCard();
  const penalty = ScorePolicy.getPenalty(remainingCards);
  const score = Math.max(0, handScore + timeBonus - penalty);

  // High score
  const prevHighScore = getHighScore();
  const isNewHighScore = saveHighScore(score);
  const highScore = Math.max(prevHighScore, score);

  // Finalize replay log
  if (replayLog) {
    replayLog.result = {
      reason,
      finalScore: score,
      handsCollected: state.hands.length,
      bestHand: best ? best.label : null,
      timeRemaining: Math.max(0, state.timer),
    };
    // [Phase 1-8-prep] 자동 localStorage 저장 제거 — 100골드 박제 버튼 클릭 시에만 저장
  }

  const modal = document.getElementById('modal');
  let title;
  if (reason === 'complete') title = i18n.t('modal.complete');
  else if (reason === 'nomoves') title = i18n.t('modal.noMoreMoves');
  else title = i18n.t('modal.timeUp');

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
    timeBonusHTML = `<div style="color:#4CAF50;font-size:0.85rem;margin-bottom:4px;">${i18n.t('modal.timeBonus', { n: timeBonus })}</div>`;
  }

  let penaltyHTML = '';
  if (penalty > 0) {
    penaltyHTML = `<div style="color:#ff5252;font-size:0.85rem;margin-bottom:8px;">${i18n.t('modal.cardPenalty', { total: remainingCards, over: remainingCards - 4, per: penaltyPerCard, penalty })}</div>`;
  }

  // NO MORE MOVES: special animated sequence
  if (reason === 'nomoves') {
    const gridContainer = document.getElementById('gridContainer');
    gridContainer.classList.add('no-moves-dim');

    const noMovesOverlay = document.getElementById('noMovesOverlay');
    setTimeout(() => {
      noMovesOverlay.classList.add('active');
    }, 300);

    setTimeout(() => {
      noMovesOverlay.classList.remove('active');
      gridContainer.classList.remove('no-moves-dim');
      buildAndShowEndModal();
    }, 1200);
  } else {
    buildAndShowEndModal();
  }

  function buildAndShowEndModal() {
    const username = (loadLocal('poker_username') || '').trim();

    let highScoreHTML = '';
    if (isNewHighScore && score > 0) {
      highScoreHTML = `<div style="color:var(--gold);font-size:1rem;font-weight:700;margin-bottom:4px;">${i18n.t('modal.newHighScore')}</div>`;
    }
    highScoreHTML += `<div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:4px;">${i18n.t('modal.myHighScore', { score: highScore })}</div>`;
    highScoreHTML += `<div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:8px;" id="allUserTopScoreRow">${i18n.t('modal.allUserHighScore', { score: '...' })}</div>`;

    const modalClass = reason === 'nomoves' ? ' nomoves' : '';
    modal.className = 'modal' + modalClass;

    const btnSecondary = 'background:rgba(255,255,255,0.1);color:#e0e0e0;';
    // [Phase 1-7.5-C] Hidden Game 진입 버튼 — NORMAL 500+ 만. RETRY는 시드 재사용 치팅 방지로 제외.
    const hiddenBtnHTML = (score >= HIDDEN_UNLOCK_SCORE && !isRetryMode)
      ? `<button class="btn-play-again btn-hidden-enter" onclick="onHiddenEnter(${score})" style="width:100%;margin-bottom:8px;">${i18n.t('hidden.enterButton') || '🎴 Hidden Game 시작'}</button>`
      : '';
    let buttonsHTML = `
      ${hiddenBtnHTML}
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="btn-play-again" onclick="resetGame()">${i18n.t('ui.playAgain')}</button>
        <a href="mode_select.html" data-flush-exit class="btn-play-again" style="${btnSecondary}text-decoration:none;display:flex;align-items:center;">${i18n.t('ui.gameEnd')}</a>
        <button class="btn-play-again btn-gold-cost" id="btnSaveReplay" style="${btnSecondary}" onclick="saveReplayFromButton()">${i18n.t('ui.saveReplay')}<span class="gold-cost-badge"><img src="./images/coin.png" class="cost-icon" onerror="this.style.display='none'">${(typeof ScorePolicy !== 'undefined') ? ScorePolicy.getGoldCost('replay', 'save') : 50}</span></button>
      </div>`;

    // Show modal immediately (no DB delay)
    modal.innerHTML = `
      <h2>${title}</h2>
      <div class="subtitle">${i18n.t('modal.handsCompleted', { n: state.hands.length })}</div>
      ${best ? `<div class="best-hand">${i18n.t('modal.best', { hand: best.label })}</div>` : ''}
      <div class="score">${i18n.t('modal.score', { score })}</div>
      ${timeBonusHTML}
      ${penaltyHTML}
      ${highScoreHTML}
      <div class="hand-list">${handListHTML}</div>
      ${buttonsHTML}
    `;
    document.getElementById('modalOverlay').classList.add('active');

    // [M2] 모달 내 data-flush-exit <a>에 click → flushAndNavigate 부착
    if (typeof window.initFlushExitHandlers === 'function') {
      window.initFlushExitHandlers(modal);
    }

    // Save to server in background and update modal when done (skip leaderboard if score is 0)
    const dbPromise = (username && score > 0)
      ? saveSessionAndGetStatus({
          username,
          score,
          best_hand: best ? best.label : null,
          hands_collected: state.hands.length,
          time_remaining: Math.max(0, state.timer),
        })
      : fetchTopScore().then(topScore => ({ leaderboardUpdated: false, topScore }));

    dbPromise.then(result => {
      const topScoreEl = document.getElementById('allUserTopScoreRow');
      if (topScoreEl) topScoreEl.textContent = i18n.t('modal.allUserHighScore', { score: result.topScore });
      // [Phase 1-8-prep] 신기록 여부와 무관하게 100골드 박제 버튼 유지 — 플레이어가 직접 localStorage 저장 선택.
      //   신기록 DB 저장은 서버가 처리, 박제(localStorage)는 플레이어 선택.
    }).catch(err => {
      console.error('Session save failed:', err);
      const topScoreEl = document.getElementById('allUserTopScoreRow');
      if (topScoreEl) topScoreEl.textContent = i18n.t('modal.allUserHighScoreNone');
    }).finally(() => {
      // [M2] 점수 등록 완료(성공/실패 무관) 후 batch 차감 flush
      if (typeof window.flushAllAccumulated === 'function') {
        window.flushAllAccumulated().catch(e => console.warn('[basic/end] flush error:', e));
      }
    });

    // [REUSE] Phase 1-7: 서버 세션 제출 (싱글플레이만, 백그라운드)
    if (!window._pvpMode && !isRetryMode && window._serverSession && window._serverSession.sessionId && !window._offlineMode) {
      submitSessionToServer(score, reason).catch(err => {
        console.error('[session/submit] background error:', err);
      });
    }
    if (!window._pvpMode && isRetryMode && !window._offlineMode) {
      submitRetryToServer(score, reason).catch(err => {
        console.error('[retry/submit] background error:', err);
      });
    }
  }
}

// ─── Hidden Game 진입 ───
// [Phase 1-7.5-C] basicSessionId (game_sessions.id)를 localStorage로 전달 — 서버가 히든 진입 자격 검증용
function onHiddenEnter(finalScore) {
  const basicSessionId = window._serverSession?.sessionRecordId || null;
  if (!basicSessionId) {
    // submit이 아직 완료 안 됐거나 실패 — 잠깐 기다리거나 재시도
    showToast(i18n.t('hidden.waitForSubmit') || '점수 저장 완료 후 다시 눌러주세요');
    return;
  }

  saveLocal('hidden_entry', JSON.stringify({
    basicFinalScore: finalScore,
    basicSessionId,
    timestamp: Date.now()
  }));
  try { if (window.BGM && BGM.fadeOut) BGM.fadeOut(500); } catch (e) {}
  setTimeout(() => { location.href = 'hidden_game.html'; }, 500);
}

// ─── Game Reset ───
// [ADAPTER] Phase 1-7.4: 리스타트 — 서버 세션 재발급 통합
async function resetGame() { // [REWRITE] (uses ADAPTER: loadLocal)
  // [Phase 1-11.1] 중복 실행 방지 — 응답 대기 중 연타 차단
  if (window._resetInProgress) return;

  const currentGold = parseInt(loadLocal('poker_gold') || '0');
  if (currentGold < 1) {
    showToast(i18n.t('toast.goldInsufficientN', { n: 1 }));
    return;
  }

  // PvP / 오프라인 / RETRY 모드: 기존 레거시 경로 (오버레이 불필요 — 즉시 실행)
  if (window._pvpMode || window._offlineMode || isRetryMode) {
    _resetGameLegacy();
    return;
  }

  // 온라인 싱글플레이: 새 서버 세션 발급 후 리스타트
  window._resetInProgress = true;
  showRestartOverlay();
  const prevSessionId = window._serverSession?.sessionId;
  try {
    const sessionData = await requestServerSession('basic');
    console.log('[restart] new session:', sessionData.sessionId.slice(0, 8), 'seed:', sessionData.seed, '(was:', prevSessionId?.slice(0, 8) || 'none', ')');

    // [M2] 세션 발급 성공 후 batch 누적 차감 (RPC 호출 X — 게임 종료/나가기 시 flush)
    if (typeof window.accumulateSpend !== 'function') {
      console.warn('[basic.restart] accumulateSpend not available');
      return;
    }
    const restartCost = (typeof ScorePolicy !== 'undefined')
      ? ScorePolicy.getGoldCost('basic', 'restart')
      : 1;
    if (!window.accumulateSpend(restartCost, 'restart_batch')) return;

    document.getElementById('modalOverlay').classList.remove('active');
    document.getElementById('gridContainer').classList.remove('no-moves-dim');
    document.getElementById('noMovesOverlay').classList.remove('active');
    clearInterval(state.timerInterval);
    initState();
    initGrid(sessionData.seed);
    renderGrid();
    updateHandPanel();
    updateHandPreview();
    updateScoreDisplay();
    renderRemovedCards();
    startTimerNormal();
  } catch (err) {
    console.error('[restart] session request failed:', err);
    showSessionStartErrorModal(
      err.message || 'NETWORK',
      () => resetGame(),
      () => {
        window._offlineMode = true;
        _resetGameLegacy();
      }
    );
  } finally {
    hideRestartOverlay();
    window._resetInProgress = false;
  }
}

// [REUSE] Phase 1-11.1: 리스타트 응답 대기 오버레이
function showRestartOverlay() {
  let overlay = document.getElementById('restartOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'restartOverlay';
    overlay.className = 'restart-overlay';
    overlay.innerHTML = '<div class="restart-spinner"></div>';
    document.body.appendChild(overlay);
  }
  overlay.classList.add('active');
  const btn = document.getElementById('restartBtn');
  if (btn) btn.style.pointerEvents = 'none';
}

function hideRestartOverlay() {
  const overlay = document.getElementById('restartOverlay');
  if (overlay) overlay.classList.remove('active');
  const btn = document.getElementById('restartBtn');
  if (btn) btn.style.pointerEvents = '';
}

// [REUSE] 레거시 리스타트 (PvP / 오프라인 / RETRY 전용)
// [M2] batch 누적 차감 (PvP 컨텍스트에서 accumulateSpend 미정의 시 안전 차단)
async function _resetGameLegacy() {
  if (typeof window.accumulateSpend !== 'function') {
    console.warn('[basic.restart legacy] accumulateSpend not available — likely PvP context, blocking restart');
    return;
  }
  const restartCost = (typeof ScorePolicy !== 'undefined')
    ? ScorePolicy.getGoldCost('basic', 'restart')
    : 1;
  if (!window.accumulateSpend(restartCost, 'restart_batch')) return;

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
  renderRemovedCards();
  startTimer();
}

// ─── Score Display ───
function updateScoreDisplay() { // [REWRITE]
  document.getElementById('currentScore').textContent = state.currentScore;
  document.getElementById('highScoreDisplay').textContent = getHighScore();
  const retryLabel = document.getElementById('retryLabel');
  if (retryLabel) retryLabel.style.display = isRetryMode ? 'inline' : 'none';
}

function triggerScreenFlash(tier) { // [REWRITE]
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

function spawnParticles(count) { // [REWRITE]
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

function showScorePopup(label, pts, rank) { // [REWRITE]
  const tier = getHandTier(rank != null ? rank : RANK.ONE_PAIR);
  const popup = document.createElement('div');
  popup.className = `score-popup tier-${tier}`;
  const ptsHTML = (pts !== undefined)
    ? `<div class="popup-pts">+${pts}</div>` : '';
  popup.innerHTML = `<div class="popup-rank">${label}</div>${ptsHTML}`;
  if (tier >= 6) {
    popup.style.animationDelay = '0.32s';
    popup.style.opacity = '0';
  }
  document.body.appendChild(popup);
  if (tier >= 4) triggerScreenFlash(tier);
  if (tier >= 6) spawnParticles(4);
  setTimeout(() => popup.remove(), 1800);
}

// ─── Removed Cards ───
function renderRemovedCards() { // [REWRITE]
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
function showToast(msg) { // [REWRITE]
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ─── Debug Mode ─── // [REWRITE]
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  if (e.key === 'd' || e.key === 'D') {
    state.debugMode = !state.debugMode;
    document.body.classList.toggle('debug-mode', state.debugMode);
    if (state.debugMode) {
      console.log('Debug mode ON');
      console.log('Selected path:', state.selectedPath);
      console.log('Current hand eval:', state.selectedPath.length >= 2 ?
        evaluateHand(state.selectedPath.map(([r,c]) => state.grid[r][c].card).filter(Boolean)) : 'N/A');
      const hasValid = scanForValidMoves();
      console.log('Valid moves remaining:', hasValid ? 'YES' : 'NO');
    } else {
      console.log('Debug mode OFF');
    }
  }

  if (e.key === 's' || e.key === 'S') {
    const t0 = performance.now();
    const result = scanForValidMoves();
    const elapsed = (performance.now() - t0).toFixed(2);
    console.log(`[SCAN] Valid moves: ${result ? 'YES' : 'NO'} (${elapsed}ms)`);
  }
});

window.validateGrid = function() { // [REWRITE]
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

async function saveReplayFromButton() { // [REWRITE]
  const btn = document.getElementById('btnSaveReplay');
  if (!btn) return;

  // [PHASE_2A_NEW bundle 6] RPC 차감 (D6 가드 + D7 헬퍼 캐싱)
  if (typeof window.spendGold !== 'function') {
    console.warn('[replay_save] spendGold not available');
    return;
  }
  const saveCost = (typeof ScorePolicy !== 'undefined')
    ? ScorePolicy.getGoldCost('replay', 'save')
    : 50;

  // [PHASE_2A_NEW bundle 8-2.10] 사전 잔액 체크 + 토스트 (gameRetry 패턴 차용)
  const currentGold = parseInt(loadLocal('poker_gold') || '0');
  if (currentGold < saveCost) {
    showToast(i18n.t('toast.goldInsufficientN', { n: saveCost }));
    return;
  }

  const hasGold = await window.spendGold(saveCost, 'replay_save');
  if (!hasGold) return;

  btn.disabled = true;
  btn.textContent = i18n.t('ui.saving');

  try {
    // [Phase 2 Maniac Step 3-2] 박제 슬롯 분리 — basic 슬롯에 저장
    //   ReplayArchive.saveSlot('basic', ...) 경유 (replay_archive.js)
    //   옛 'poker_last_replay' 키는 자동 마이그레이션됨 (replay_archive.js DOMContentLoaded)
    if (replayLog && replayLog.result) {
      if (typeof window.ReplayArchive !== 'undefined' && window.ReplayArchive.saveSlot) {
        window.ReplayArchive.saveSlot('basic', replayLog);
      } else {
        // fallback (replay_archive.js 미로드 시 — 안전망)
        saveLocal('poker_last_replay', JSON.stringify(replayLog));
        console.warn('[DragON] ReplayArchive missing, used legacy key');
      }
      console.log('[DragON] Replay saved to archive.basic (50-gold paid)');
      btn.textContent = i18n.t('ui.saved');
      btn.style.color = '#4CAF50';
      btn.style.borderColor = '#4CAF50';
    } else {
      console.warn('[DragON] No replayLog.result to save');
      btn.textContent = i18n.t('ui.saveFailed');
      btn.style.color = '#ff5252';
      btn.disabled = false;
    }
  } catch (err) {
    console.error('[DragON] saveReplayFromButton error:', err);
    btn.textContent = i18n.t('ui.saveFailed');
    btn.style.color = '#ff5252';
    btn.disabled = false;
  }
}

async function showLeaderboard(currentUser) { // [REWRITE] (uses ADAPTER: loadLocal)
  if (!currentUser) currentUser = (loadLocal('poker_username') || '').trim();
  try {
    const board = isRetryMode ? 'basic_retry' : 'basic';
    const lbTitle = isRetryMode ? i18n.t('modal.leaderboardRetry') : i18n.t('modal.leaderboard');

    // [Phase 1-13 후속] /top API 호출로 교체. best_hand 컬럼은 응답 스키마에 없어서 모달에서 제외.
    const url = `${SERVER_URL}/api/leaderboard/top?board=${board}&period=all_time&sort=best&limit=10`;
    const apiRes = await fetch(url);
    if (!apiRes.ok) {
      console.error('Leaderboard API error:', apiRes.status);
      return;
    }
    const json = await apiRes.json();
    const rows = json?.rows || [];

    let tableHTML = `<table class="leaderboard-table">
      <thead><tr><th>#</th><th>NAME</th><th>SCORE</th><th></th></tr></thead><tbody>`;
    rows.forEach((row, i) => {
      const username = row.username || 'Anonymous';
      const score = row.best_score ?? row.score ?? 0;
      const hl = currentUser && username.toLowerCase() === currentUser.toLowerCase() ? ' class="highlight"' : '';
      const replayBtn = row.replay_id
        ? `<a href="replay.html?id=${row.replay_id}" class="lb-replay-btn" title="Replay">▶</a>`
        : '';
      tableHTML += `<tr${hl}><td>${i + 1}</td><td>${escapeHTML(username)}</td><td>${score}</td><td>${replayBtn}</td></tr>`;
    });
    tableHTML += '</tbody></table>';

    if (rows.length === 0) {
      tableHTML = '<div style="padding:16px;color:rgba(255,255,255,0.5);">' + i18n.t('modal.noScores') + '</div>';
    }

    const modal = document.getElementById('leaderboardModal');
    modal.innerHTML = `
      <h2>${lbTitle}</h2>
      <div class="subtitle">${i18n.t('modal.top10')}</div>
      ${tableHTML}
      <button class="btn-close-lb" onclick="document.getElementById('leaderboardOverlay').classList.remove('active')">${i18n.t('ui.close')}</button>
    `;
    document.getElementById('leaderboardOverlay').classList.add('active');
  } catch (err) {
    console.error('Leaderboard error:', err);
  }
}

// ─── Display saved username (read-only) ─── // [REWRITE] (uses ADAPTER: loadLocal)
(function() {
  const saved = loadLocal('poker_username') || '';
  const el = document.getElementById('usernameDisplay');
  if (el) el.textContent = saved;
})();

// ─── Start Overlay ───
function initStartOverlay(onStart) { // [REWRITE]
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
    WakeLock.acquire();
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

// =============================================
// [ADAPTER] Phase 1-7: 서버 세션 API 호출
// =============================================
const SERVER_URL = window._serverUrl || 'https://dragon-poker-server.onrender.com';

// [ADAPTER] 서버에서 세션 발급 받기 (basic)
async function requestServerSession(mode) {
  const userId = loadLocal('poker_player_id');
  if (!userId) throw new Error('NO_USER_ID');

  // Phase 2D-pre: JWT 토큰 첨부
  const session = (await sb.auth.getSession()).data.session;
  const token = session?.access_token;
  if (!token) throw new Error('NO_TOKEN');

  const t0 = Date.now();
  const res = await fetch(`${SERVER_URL}/api/session/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ userId, mode }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP_${res.status}`);
  }

  const data = await res.json();
  window._serverSession = {
    sessionId: data.sessionId,
    seed: data.seed,
    dragLog: [],
    serverStartedAt: data.startedAt,
    mode,
    submitted: false,
  };
  console.log(`[session/start] took ${Date.now() - t0}ms (mode=${mode}):`, { sessionId: data.sessionId.slice(0, 8), seed: data.seed });
  return data;
}

// [ADAPTER] 서버에 세션 제출 (검증 포함)
async function submitSessionToServer(claimedScore, reason) {
  const session = window._serverSession;
  if (!session || !session.sessionId || session.submitted) return;

  const timeRemaining = Math.max(0, state.timer || 0);

  try {
    // Phase 2D-pre: JWT 토큰 첨부
    const authSession = (await sb.auth.getSession()).data.session;
    const token = authSession?.access_token;
    if (!token) {
      console.warn('[session/submit] no token, skipping');
      return null;
    }

    const res = await fetch(`${SERVER_URL}/api/session/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        sessionId: session.sessionId,
        dragLog: session.dragLog,
        claimedScore,
        timeRemaining,
        extraData: {
          reason: reason || 'complete', // [Phase 1-7.5-prep] 게임 종료 이유 → 서버 replay_data.result.reason
        },
      }),
    });

    const data = await res.json();

    if (res.ok && data.accepted) {
      session.submitted = true;
      // [Phase 1-7.5-C] 히든 진입 시 DB row id 전달용 (game_sessions.id)
      session.sessionRecordId = data.sessionRecordId || null;
      console.log('[session/submit] accepted:', data);
      return data;
    } else {
      console.warn('[session/submit] rejected:', { status: res.status, data });
      showSubmitErrorModal(data, claimedScore, reason);
      return null;
    }
  } catch (err) {
    console.error('[session/submit] network error:', err);
    showSubmitErrorModal({ error: 'NETWORK' }, claimedScore, reason);
    throw err;
  }
}

// [ADAPTER] RETRY 서버 경유 (검증 없음 — leaderboard_r 박제용)
async function submitRetryToServer(claimedScore, reason) {
  const userId = loadLocal('poker_player_id');
  if (!userId) return;

  // 최고 족보
  let bestHand = null;
  let bestRank = -1;
  for (const h of state.hands) {
    if (h.rankValue > bestRank) { bestRank = h.rankValue; bestHand = h.label; }
  }

  // 초기 덱 / 드래그 경로 — replayLog에서 추출
  const grid = replayLog?.initialDeck || [];
  const moves = (replayLog?.actions || []).map(a => a.path || []);
  // [Phase 1-7.5-prep] 서버 replay_data.actions 구조 A 통일 — 클라가 가진 정확한 hand/score/t 그대로 전달
  const actions = replayLog?.actions || [];

  try {
    // Phase 2D-pre: JWT 토큰 첨부
    const authSession = (await sb.auth.getSession()).data.session;
    const token = authSession?.access_token;
    if (!token) {
      console.warn('[retry/submit] no token, skipping');
      return;
    }

    const res = await fetch(`${SERVER_URL}/api/session/retry/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        userId,
        parentSessionId: null,
        grid,
        moves,
        score: claimedScore,
        handsCollected: state.hands.length,
        timeRemaining: Math.max(0, state.timer || 0),
        bestHand,
        actions, // [Phase 1-7.5-prep] replay.html 호환을 위한 actions 정보 (서버는 그대로 저장)
        reason: reason || 'complete', // [Phase 1-7.5-prep] 게임 종료 이유
      }),
    });

    const data = await res.json();
    if (res.ok && data.accepted) {
      console.log('[retry/submit] recorded:', data);
    } else {
      console.warn('[retry/submit] failed:', { status: res.status, data });
    }
  } catch (err) {
    console.error('[retry/submit] network error:', err);
  }
}

// [REWRITE] Phase 1-7: 세션 발급 실패 시 모달
function showSessionStartErrorModal(errorCode, onRetry, onOfflineMode) {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modal');
  if (!overlay || !modal) {
    if (confirm(`서버 연결 실패 (${errorCode}). 재시도할까요? (취소 시 오프라인 연습 모드)`)) {
      onRetry();
    } else {
      onOfflineMode();
    }
    return;
  }

  modal.innerHTML = `
    <div style="text-align:center;padding:20px;">
      <h3 style="color:#ff6b6b;margin-bottom:12px;">서버 연결 실패</h3>
      <p style="color:rgba(255,255,255,0.7);margin-bottom:20px;font-size:0.9rem;">
        리더보드에 기록되려면 서버 연결이 필요합니다.<br>
        오프라인 모드는 연습용이며 기록되지 않습니다.
      </p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="btn-play-again" id="_retrySessionStartBtn">재시도</button>
        <button class="btn-play-again" style="background:rgba(255,255,255,0.1)" id="_enterOfflineModeBtn">오프라인 연습 모드</button>
      </div>
      <div style="color:rgba(255,255,255,0.4);font-size:0.7rem;margin-top:12px;">
        에러: ${errorCode || 'UNKNOWN'}
      </div>
    </div>
  `;
  overlay.classList.add('active');

  document.getElementById('_retrySessionStartBtn').onclick = () => {
    overlay.classList.remove('active');
    onRetry();
  };
  document.getElementById('_enterOfflineModeBtn').onclick = () => {
    overlay.classList.remove('active');
    onOfflineMode();
  };
}

// [REWRITE] Phase 1-7: 제출 실패 시 모달 (디바운스 2초)
let _lastSubmitRetryAt = 0;
function showSubmitErrorModal(errorData, claimedScore, reason) {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modal');
  if (!overlay || !modal) {
    console.warn('[submit error]', errorData);
    return;
  }

  const errCode = errorData.error || errorData.reason || 'UNKNOWN';
  modal.innerHTML = `
    <div style="text-align:center;padding:20px;">
      <h3 style="color:#ff6b6b;margin-bottom:12px;">점수 전송 실패</h3>
      <p style="color:rgba(255,255,255,0.7);margin-bottom:20px;font-size:0.9rem;">
        서버에 점수를 기록하지 못했습니다.<br>
        재시도하거나 기록 없이 종료할 수 있습니다.
      </p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="btn-play-again" id="_retrySubmitBtn">재시도</button>
        <button class="btn-play-again" style="background:rgba(255,255,255,0.1)" id="_abandonSessionBtn">기록 없이 종료</button>
      </div>
      <div style="color:rgba(255,255,255,0.4);font-size:0.7rem;margin-top:12px;">
        에러: ${errCode}
      </div>
    </div>
  `;
  overlay.classList.add('active');

  document.getElementById('_retrySubmitBtn').onclick = async () => {
    const now = Date.now();
    if (now - _lastSubmitRetryAt < 2000) return;
    _lastSubmitRetryAt = now;
    overlay.classList.remove('active');
    await submitSessionToServer(claimedScore, reason);
  };
  document.getElementById('_abandonSessionBtn').onclick = () => {
    window._serverSession.submitted = true;
    overlay.classList.remove('active');
    navigateTo('./mode_select.html');
  };
}

// [REUSE] Phase 1-7: 서버 세션 받아서 게임 시작 (싱글플레이 basic 전용)
async function startWithServerSession() {
  // RETRY 모드: 서버 세션 없이 기존 replay_data 복원 경로 유지
  if (isRetryMode) {
    console.log('[session] RETRY mode — skipping /api/session/start');
    startTimerNormal();
    return;
  }

  try {
    const sessionData = await requestServerSession('basic');

    // seed로 그리드 재생성
    initState();
    initGrid(sessionData.seed);
    renderGrid();
    updateHandPanel();
    updateScoreDisplay();
    renderRemovedCards();

    startTimerNormal();
  } catch (err) {
    console.error('[session/start] failed:', err);
    showSessionStartErrorModal(
      err.message,
      () => startWithServerSession(),
      () => {
        // 오프라인 모드: 기존 Math.random 방식
        window._offlineMode = true;
        initState();
        initGrid();
        renderGrid();
        updateHandPanel();
        updateScoreDisplay();
        renderRemovedCards();
        startTimerNormal();
      }
    );
  }
}

// [REUSE] 타이머 시작 + 초기 NMM sanity check
function startTimerNormal() {
  startTimer();

  // Sanity check on start (reshuffle without gold cost)
  setTimeout(() => {
    if (!scanForValidMoves()) {
      console.warn('[DragON] No valid moves at game start — reshuffling');
      document.getElementById('modalOverlay').classList.remove('active');
      clearInterval(state.timerInterval);

      // 서버 모드면 새 세션 요청, 오프라인이면 기존 방식
      if (!window._offlineMode && !isRetryMode) {
        startWithServerSession();
      } else {
        initState();
        initGrid();
        renderGrid();
        updateHandPanel();
        updateHandPreview();
        updateScoreDisplay();
        renderRemovedCards();
        startTimer();
      }
    }
  }, 100);
}

// ─── Init ─── // [REWRITE]
initState();
initGrid();
renderGrid();
updateHandPanel();
updateScoreDisplay();
renderRemovedCards();

if (!window._pvpMode) {
  BGM.init('./audio/Main_Theme.mp3');
  initStartOverlay(() => {
    // Phase 1-7: START 탭 → 서버 세션 요청 → 성공 시 seed로 그리드 재생성
    startWithServerSession();
  });
}

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 22개 함수 (변경 불필요)
//   - getRankScore, getPenaltyPerCard, initState, createDeck, shuffle,
//     cardDisplay, isRedSuit, cardFromId, initGrid, evaluateHand,
//     partialEval, isValidHand, applyGravityToColumn, scanForValidMoves,
//     getReachableCards, dfsScan, countRemainingCards, getHandTier,
//     saveHighScore, getHighScore, escapeHTML, getOrCreatePlayer,
//     saveSessionAndGetStatus, fetchTopScore
// ADAPTER : 4개 함수 (내부 구현 교체 필요)
//   - saveLocal(key, value)  → AsyncStorage.setItem / SecureStore.setItemAsync
//   - loadLocal(key)         → AsyncStorage.getItem / SecureStore.getItemAsync
//   - removeLocal(key)       → AsyncStorage.removeItem / SecureStore.deleteItemAsync
//   - navigateTo(page)       → navigation.navigate() / expo-router push
// REWRITE : 24개 함수/블록 (전면 재작성)
//   - renderGrid, getEventCoords, getCellFromEvent, updateSelectionVisuals,
//     startDrag, extendPath, finalizePath, clearSelection, updateDragLine,
//     updateHandPreview, removeCardsAndApplyGravity, startTimer,
//     updateTimerDisplay, updateHandPanel, endGame, resetGame,
//     updateScoreDisplay, triggerScreenFlash, spawnParticles,
//     showScorePopup, renderRemovedCards, showToast, saveReplayFromButton,
//     showLeaderboard, initStartOverlay,
//     Event listeners (mouse/touch/keyboard), Debug mode, Init block,
//     Username display IIFE, validateGrid
// =============================================
