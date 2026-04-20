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

function initState() { // [REUSE]
  state = {
    grid: [],
    hands: [],
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
function initGrid() { // [REUSE] (uses ADAPTER: saveLocal/loadLocal/removeLocal)
  let deck;
  const retryRaw = loadLocal('poker_retry_deck');
  if (retryRaw) {
    removeLocal('poker_retry_deck');
    const deckIds = JSON.parse(retryRaw);
    deck = deckIds.map(id => cardFromId(id));
    isRetryMode = true;
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
async function saveSessionAndGetStatus(data) { // [REUSE]
  console.log('[DragON] Saving session...', data);
  let leaderboardUpdated = false;
  let topScore = 0;

  try {
    const playerId = await getOrCreatePlayer(data.username);
    if (!playerId) { console.error('[DragON] No player ID, skipping save'); return { leaderboardUpdated, topScore }; }

    // Sync pending gold deductions before DB write
    await syncGoldToDB('game_end');

    // Insert game session
    const { data: sessionData, error: sessionError } = await sb
      .from('game_sessions')
      .insert({
        player_id: playerId,
        score: data.score,
        best_hand: data.best_hand || null,
        hands_collected: data.hands_collected || 0,
        time_remaining: data.time_remaining || 0,
        completed: true,
      })
      .select();
    if (sessionError) {
      console.error('[DragON] Session save error:', sessionError);
    } else {
      console.log('[DragON] Session saved:', sessionData);
    }

    // Upsert leaderboard — keep highest score per player
    const lbTable = isRetryMode ? 'leaderboard_r' : 'leaderboard';
    const { data: existing, error: fetchError } = await sb
      .from(lbTable)
      .select('score')
      .eq('player_id', playerId)
      .maybeSingle();

    if (fetchError) console.error('[DragON] Leaderboard fetch error:', fetchError);

    if (!existing || data.score > existing.score) {
      const { data: lbData, error: lbError } = await sb
        .from(lbTable)
        .upsert({
          player_id: playerId,
          username: data.username,
          score: data.score,
          best_hand: data.best_hand || null,
        }, { onConflict: 'player_id' })
        .select();
      if (lbError) {
        console.error('[DragON] Leaderboard upsert error:', lbError);
      } else {
        console.log(`[DragON] ${lbTable} updated:`, lbData);
        leaderboardUpdated = true;
      }
    }

    // Fetch #1 score from same table
    const { data: topRow } = await sb
      .from(lbTable)
      .select('score')
      .order('score', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (topRow) topScore = topRow.score;

  } catch (err) {
    console.error('[DragON] Save error:', err);
  }
  return { leaderboardUpdated, topScore };
}

// Fetch only the #1 leaderboard score (no save)
async function fetchTopScore() { // [REUSE]
  try {
    const lbTable = isRetryMode ? 'leaderboard_r' : 'leaderboard';
    const { data: topRow } = await sb
      .from(lbTable)
      .select('score')
      .order('score', { ascending: false })
      .limit(1)
      .maybeSingle();
    return topRow ? topRow.score : 0;
  } catch (err) { return 0; }
}

// ─── Replay Save to DB ───
// Returns replay id on success, null on failure
async function saveReplayToDB(linkToLeaderboard) { // [REUSE] (uses ADAPTER: loadLocal)
  const raw = loadLocal('poker_last_replay');
  if (!raw) { console.warn('[DragON] No replay data to save'); return null; }

  try {
    const data = JSON.parse(raw);
    const username = data.username || (loadLocal('poker_username') || '').trim();
    if (!username) return null;

    const playerId = await getOrCreatePlayer(username);
    if (!playerId) return null;

    const { data: inserted, error } = await sb
      .from('game_replays')
      .insert({
        player_id: playerId,
        replay_data: data,
        score: data.result ? data.result.finalScore : 0,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[DragON] Replay save error:', error);
      return null;
    }

    const replayId = inserted.id;
    console.log('[DragON] Replay saved to DB:', replayId);

    // Link replay to leaderboard entry
    if (linkToLeaderboard) {
      const lbTable = isRetryMode ? 'leaderboard_r' : 'leaderboard';
      const { error: linkErr } = await sb
        .from(lbTable)
        .update({ replay_id: replayId })
        .eq('player_id', playerId);
      if (linkErr) {
        console.error('[DragON] Replay link error:', linkErr);
      } else {
        console.log('[DragON] Replay linked to leaderboard');
      }
    }

    return replayId;
  } catch (err) {
    console.error('[DragON] Replay save error:', err);
    return null;
  }
}

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
    saveLocal('poker_last_replay', JSON.stringify(replayLog));
    console.log('[DragON] Replay saved to localStorage');
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
    // Hidden Game 진입 버튼 (500점 이상일 때만)
    const hiddenBtnHTML = score >= HIDDEN_UNLOCK_SCORE
      ? `<button class="btn-play-again btn-hidden-enter" onclick="onHiddenEnter(${score})" style="width:100%;margin-bottom:8px;">${i18n.t('hidden.enterButton') || '🎴 Hidden Game 시작'}</button>`
      : '';
    let buttonsHTML = `
      ${hiddenBtnHTML}
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="btn-play-again" onclick="resetGame()">${i18n.t('ui.playAgain')}</button>
        <a href="mode_select.html" class="btn-play-again" style="${btnSecondary}text-decoration:none;display:flex;align-items:center;">${i18n.t('ui.gameEnd')}</a>
        <button class="btn-play-again btn-gold-cost" id="btnSaveReplay" style="${btnSecondary}" onclick="saveReplayFromButton()">${i18n.t('ui.saveReplay')}<span class="gold-cost-badge"><img src="./images/coin.png" class="cost-icon" onerror="this.style.display='none'">100</span></button>
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

      if (result.leaderboardUpdated) {
        saveReplayToDB(true).then(id => {
          if (id) console.log('[DragON] Auto-replay saved:', id);
          else console.warn('[DragON] Auto-replay save failed');
        }).catch(err => console.error('[DragON] Auto-replay error:', err));
        const btnReplay = document.getElementById('btnSaveReplay');
        if (btnReplay) btnReplay.remove();
      }
    }).catch(err => {
      console.error('Session save failed:', err);
      const topScoreEl = document.getElementById('allUserTopScoreRow');
      if (topScoreEl) topScoreEl.textContent = i18n.t('modal.allUserHighScoreNone');
    });
  }
}

// ─── Hidden Game 진입 ───
function onHiddenEnter(finalScore) {
  // 진입 정보 임시 저장
  saveLocal('hidden_entry', JSON.stringify({
    basicFinalScore: finalScore,
    timestamp: Date.now()
  }));
  // BGM 페이드아웃 후 페이지 이동
  try { if (window.BGM && BGM.fadeOut) BGM.fadeOut(500); } catch (e) {}
  setTimeout(() => { location.href = 'hidden_game.html'; }, 500);
}

// ─── Game Reset ───
function resetGame() { // [REWRITE] (uses ADAPTER: loadLocal)
  const currentGold = parseInt(loadLocal('poker_gold') || '0');
  if (currentGold < 1) {
    showToast(i18n.t('toast.goldInsufficientN', { n: 1 }));
    return;
  }
  deductGoldLocal(1, 'restart');
  // [ADAPTER] 리스타트 즉시 골드 싱크 — 중간 이탈 시 유실 방지
  syncGoldToDB('restart').catch(e => console.warn('골드 싱크 실패:', e));

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

  // 골드 확인 및 차감
  const hasGold = deductGoldLocal(100, 'replay_save');
  if (!hasGold) return;

  btn.disabled = true;
  btn.textContent = i18n.t('ui.saving');

  try {
    // DB 즉시 싱크
    await syncGoldToDB('replay_save');

    const replayId = await saveReplayToDB(false);
    if (replayId) {
      // 저장 검증: DB에서 다시 읽어서 확인
      const { data: verify, error: verifyErr } = await sb
        .from('game_replays')
        .select('id')
        .eq('id', replayId)
        .single();

      if (verifyErr || !verify) {
        console.error('[DragON] Replay verify failed:', verifyErr);
        btn.textContent = i18n.t('ui.saveFailed');
        btn.style.color = '#ff5252';
        btn.disabled = false;
        return;
      }

      btn.textContent = i18n.t('ui.saved');
      btn.style.color = '#4CAF50';
      btn.style.borderColor = '#4CAF50';
      console.log('[DragON] Replay verified in DB:', replayId);
    } else {
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
    const lbTable = isRetryMode ? 'leaderboard_r' : 'leaderboard';
    const lbTitle = isRetryMode ? i18n.t('modal.leaderboardRetry') : i18n.t('modal.leaderboard');
    const { data: rows, error } = await sb
      .from(lbTable)
      .select('username, score, best_hand, replay_id')
      .order('score', { ascending: false })
      .limit(10);

    if (error) { console.error('Leaderboard error:', error); return; }

    let tableHTML = `<table class="leaderboard-table">
      <thead><tr><th>#</th><th>NAME</th><th>SCORE</th><th>BEST HAND</th><th></th></tr></thead><tbody>`;
    (rows || []).forEach((row, i) => {
      const hl = currentUser && row.username.toLowerCase() === currentUser.toLowerCase() ? ' class="highlight"' : '';
      const replayBtn = row.replay_id
        ? `<a href="replay.html?id=${row.replay_id}" class="lb-replay-btn" title="Replay">▶</a>`
        : '';
      tableHTML += `<tr${hl}><td>${i + 1}</td><td>${escapeHTML(row.username)}</td><td>${row.score}</td><td>${escapeHTML(row.best_hand || '-')}</td><td>${replayBtn}</td></tr>`;
    });
    tableHTML += '</tbody></table>';

    if (!rows || rows.length === 0) {
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
    startTimer();

    // Sanity check on start (reshuffle without gold cost)
    setTimeout(() => {
      if (!scanForValidMoves()) {
        console.warn('[DragON] No valid moves at game start — reshuffling');
        document.getElementById('modalOverlay').classList.remove('active');
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
    }, 100);
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
//     saveSessionAndGetStatus, fetchTopScore, saveReplayToDB
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
