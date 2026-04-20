// =============================================
// [LOGIC] Hidden Game 로직 — DragON POKER
// script.js가 먼저 로드된 상태에서 실행됩니다.
// (_pvpMode = true 로 script.js의 기본 시작 로직 비활성화)
// =============================================

// ─── 상수 ───
const HIDDEN_MAX_HANDS = 9;
const RESTART_COST  = ScorePolicy.getGoldCost('hidden', 'restart');  // 20
const SHUFFLE_COST  = ScorePolicy.getGoldCost('hidden', 'shuffle');  // 100
const HG_HIGH_SCORE_KEY = 'hidden_highScore';

// ─── 세션 카운터 ───
let hgResetCount   = 0;
let hgShuffleCount = 0;
let hgGameStarted  = false;

// ─── 진입 정보 로드 + 안전장치 ───
let hgBasicScore = 0;
(function loadEntry() {
  try {
    const raw = localStorage.getItem('hidden_entry');
    if (!raw) { location.href = 'index.html'; return; }
    const entry = JSON.parse(raw);
    hgBasicScore = entry.basicFinalScore || 0;
    if (hgBasicScore < 500) { location.href = 'index.html'; return; }
    // 유효 시간 10분 체크
    if (Date.now() - (entry.timestamp || 0) > 10 * 60 * 1000) {
      location.href = 'game.html'; return;
    }
    localStorage.removeItem('hidden_entry');
  } catch (e) {
    console.error('[HiddenGame] entry load error', e);
    location.href = 'index.html';
  }
})();

// ─── 핵심: endGame 오버라이드 ───
// script.js의 endGame을 히든 게임 종료 로직으로 교체
window.endGame = function endGame(reason) {
  if (state.phase === 'result') return;
  state.phase = 'result';

  const sorted = [...state.hands].sort((a, b) => b.rankValue - a.rankValue);
  const handScore = state.hands.reduce((sum, h) => sum + getRankScore(h.rank), 0);
  const best = sorted[0];

  // 카드 페널티 (베이직과 동일 — 타임 보너스 없음)
  const remainingCards = countRemainingCards();
  const penaltyPerCard = getPenaltyPerCard();
  const penalty = ScorePolicy.getPenalty(remainingCards);
  const finalScore = Math.max(0, handScore - penalty);

  // 하이스코어
  const prevHigh = parseInt(localStorage.getItem(HG_HIGH_SCORE_KEY) || '0');
  const isNewRecord = finalScore > prevHigh;
  if (isNewRecord) localStorage.setItem(HG_HIGH_SCORE_KEY, String(finalScore));
  const highScore = Math.max(prevHigh, finalScore);

  // NO MORE MOVES 연출 후 모달
  if (reason === 'nomoves') {
    const gc = document.getElementById('gridContainer');
    if (gc) gc.classList.add('no-moves-dim');
    const nmo = document.getElementById('noMovesOverlay');
    if (nmo) setTimeout(() => nmo.classList.add('active'), 300);
    setTimeout(() => {
      if (nmo) nmo.classList.remove('active');
      if (gc) gc.classList.remove('no-moves-dim');
      showHiddenEndModal(finalScore, highScore, best, sorted, penalty, remainingCards, penaltyPerCard, isNewRecord, reason);
    }, 1200);
  } else {
    showHiddenEndModal(finalScore, highScore, best, sorted, penalty, remainingCards, penaltyPerCard, isNewRecord, reason);
  }

  // DB 저장 (비동기)
  hgSaveSession(finalScore, best ? best.label : null, reason);
  hgUpsertLeaderboard(finalScore, best ? best.label : null, isNewRecord);
};

// ─── 종료 모달 ───
function showHiddenEndModal(score, highScore, best, sorted, penalty, remainingCards, penaltyPerCard, isNewRecord, reason) {
  const modal = document.getElementById('modal');
  const overlay = document.getElementById('modalOverlay');
  if (!modal || !overlay) return;

  let title;
  if (reason === 'complete') title = `🎴 ${i18n.t('modal.complete')}`;
  else if (reason === 'nomoves') title = i18n.t('modal.noMoreMoves');
  else title = i18n.t('hidden.gameOver');

  let handListHTML = '';
  sorted.forEach((h, i) => {
    const cardsStr = h.cards.map(c => cardDisplay(c)).join(' ');
    const pts = getRankScore(h.rank);
    handListHTML += `<div class="hand-list-item">
      <span class="rank-label">${i === 0 ? '🏆 ' : ''}${h.label}</span>
      <span class="cards-str">${cardsStr} (+${pts})</span>
    </div>`;
  });

  const recordHTML = isNewRecord
    ? `<div style="color:#ff4d8f;font-size:1rem;font-weight:700;margin-bottom:4px;">🏅 ${i18n.t('hidden.newRecord')}</div>`
    : '';
  const hiHTML = `<div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:8px;">HI: ${highScore}</div>`;
  const penaltyHTML = penalty > 0
    ? `<div style="color:#ff5252;font-size:0.85rem;margin-bottom:6px;">${i18n.t('modal.cardPenalty', { total: remainingCards, over: remainingCards - 4, per: penaltyPerCard, penalty })}</div>`
    : '';

  modal.innerHTML = `
    <h2 style="color:#ff4d8f;">${title}</h2>
    <div class="subtitle">${i18n.t('modal.handsCompleted', { n: state.hands.length })}</div>
    ${best ? `<div class="best-hand">${i18n.t('modal.best', { hand: best.label })}</div>` : ''}
    <div class="score">${i18n.t('modal.score', { score })}</div>
    ${penaltyHTML}
    ${recordHTML}
    ${hiHTML}
    <div class="hand-list">${handListHTML}</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">
      <a href="mode_select.html" class="btn-play-again" style="text-decoration:none;text-align:center;">${i18n.t('ui.gameEnd')}</a>
      <button class="btn-play-again" style="background:rgba(255,77,143,0.12);border-color:rgba(255,77,143,0.4);color:#ff6ba3;" onclick="hgViewLeaderboard()">${i18n.t('hidden.leaderboardTitle')}</button>
    </div>
  `;
  overlay.classList.add('active');
}

// ─── 셔플 ───
function doHiddenShuffle() {
  if (state.phase !== 'playing') return;
  if (!deductGoldLocal(SHUFFLE_COST, 'hidden_shuffle')) {
    showToast(i18n.t('hidden.notEnoughGold'));
    return;
  }
  syncGoldToDB('hidden_shuffle').catch(e => console.warn('[Hidden] 골드 싱크 실패:', e));
  hgShuffleCount++;

  // in-place 셔플 (빈 칸 위치 유지)
  const result = shuffleGridCards({ grid: state.grid, gridSize: GRID_SIZE, mode: 'in-place' });
  state.grid = result.newGrid;

  // 중력 불필요 (위치 유지) — 바로 렌더
  renderGrid();

  // 셔플 이펙트 (sound.js)
  try { if (typeof playCardDrop === 'function') playCardDrop(); } catch (e) {}
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:rgba(255,77,143,0.18);z-index:999;pointer-events:none;';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 350);
}

// ─── 리스타트 ───
function doHiddenRestart() {
  if (!deductGoldLocal(RESTART_COST, 'hidden_restart')) {
    showToast(i18n.t('hidden.notEnoughGold'));
    return;
  }
  syncGoldToDB('hidden_restart').catch(e => console.warn('[Hidden] 골드 싱크 실패:', e));
  hgResetCount++;

  document.getElementById('modalOverlay').classList.remove('active');
  document.getElementById('gridContainer').classList.remove('no-moves-dim');
  document.getElementById('noMovesOverlay').classList.remove('active');

  initState();
  initGrid();
  renderGrid();
  updateHandPanel();
  updateScoreDisplay();
  renderRemovedCards();

  state.phase = 'playing';
  hgUpdateStatus();
}

// ─── 상태 UI 업데이트 ───
function hgUpdateStatus() {
  const el = document.getElementById('handCountStatus');
  if (el) el.textContent = state.hands ? state.hands.length : 0;
}

// ─── 랭킹 보기 (추후 leaderboard.html 탭 추가 시 연결) ───
function hgViewLeaderboard() {
  location.href = 'leaderboard.html';
}
window.hgViewLeaderboard = hgViewLeaderboard;

// ─── DB: 세션 저장 ───
async function hgSaveSession(score, bestHand, reason) {
  try {
    const playerId = localStorage.getItem('poker_player_id');
    if (!playerId) return;
    await sbRetry(() => sb.from('hidden_sessions').insert({
      player_id: playerId,
      basic_final_score: hgBasicScore,
      hidden_score: score,
      best_hand: bestHand,
      reset_count: hgResetCount,
      shuffle_count: hgShuffleCount
    }));
  } catch (e) {
    console.warn('[HiddenGame] session save error', e);
  }
}

// ─── DB: 리더보드 갱신 ───
async function hgUpsertLeaderboard(score, bestHand, isNewRecord) {
  try {
    const playerId = localStorage.getItem('poker_player_id');
    const username = localStorage.getItem('poker_username');
    if (!playerId || !username) return;
    if (!isNewRecord) return;  // 본인 최고 점수 이상일 때만
    await sbRetry(() => sb.from('leaderboard_hidden').upsert({
      player_id: playerId,
      username,
      score,
      best_hand: bestHand,
      updated_at: new Date().toISOString()
    }));
  } catch (e) {
    console.warn('[HiddenGame] leaderboard upsert error', e);
  }
}

// ─── finalizePath 후 카운터 업데이트 ───
const _origFinalizePath = window.finalizePath;
window.finalizePath = function() {
  if (typeof _origFinalizePath === 'function') _origFinalizePath.call(this);
  hgUpdateStatus();
};

// ─── START 오버레이 초기화 ───
(function initHiddenStart() {
  const overlay = document.getElementById('hgStartOverlay');
  const btn = document.getElementById('hgStartBtn');
  if (!overlay || !btn) return;

  btn.addEventListener('click', () => {
    if (typeof Sound !== 'undefined' && Sound.warmup) Sound.warmup();
    try {
      if (typeof BGM !== 'undefined') {
        BGM.init('./audio/Hidden_Theme.mp3');
        BGM.start();
      }
    } catch (e) {}

    overlay.style.display = 'none';
    hgGameStarted = true;
    state.phase = 'playing';

    // 셔플 버튼
    const shuffleBtn = document.getElementById('shuffleBtn');
    if (shuffleBtn) shuffleBtn.addEventListener('click', doHiddenShuffle);

    // 리스타트 버튼
    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) restartBtn.addEventListener('click', () => {
      if (state.phase === 'playing') doHiddenRestart();
    });
  });
})();

// =============================================
// EXPO 전환 체크리스트
// REUSE   : hgSaveSession, hgUpsertLeaderboard, doHiddenShuffle 로직
// ADAPTER : localStorage → AsyncStorage; sbRetry 유지
// REWRITE : UI 렌더링 함수들 (showHiddenEndModal, hgUpdateStatus)
// =============================================
