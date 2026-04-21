// =============================================
// [LOGIC] Hidden Game 로직 — DragON POKER
// script.js가 먼저 로드된 상태에서 실행됩니다.
// (_pvpMode = true 로 script.js의 기본 시작 로직 비활성화)
// Phase 1-7.5-B: 서버 권위 모델로 전환 — 자체 세션 관리 + dragLog 수집.
// =============================================

// ─── 상수 ───
const HIDDEN_MAX_HANDS = 9;
const RESTART_COST  = ScorePolicy.getGoldCost('hidden', 'restart');  // 20
const SHUFFLE_COST  = ScorePolicy.getGoldCost('hidden', 'shuffle');  // 100
const HG_HIGH_SCORE_KEY = 'hidden_highScore';

// [REUSE] Phase 1-7.5-B: 서버 세션 관련 상수
const HG_SERVER_URL = (typeof RENDER_SERVER === 'string') ? RENDER_SERVER : 'https://dragon-poker-server.onrender.com';
const HG_SEED_MIX = 0x9E3779B9;
const HG_SHUFFLE_INDEX_OFFSET = 10000;

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

// ─── 방어선: script.js의 타이머 진입점 무력화 ───
// _pvpMode 게이팅을 우회하는 경로가 생기더라도 히든 모드에선 타이머가 절대 돌지 않도록 보장
if (state && state.timerInterval) clearInterval(state.timerInterval);
window.startTimer = function() {};

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

  // [REUSE] Phase 1-7.5-B: 서버 검증 경유 제출 (0점은 서버에서 skip)
  if (!window._offlineMode) {
    submitHiddenToServer(finalScore, reason).catch(err => {
      console.error('[HiddenGame] submit background error:', err);
    });
  } else if (finalScore > 0) {
    // 오프라인 모드: 기록 안 남김 (베이직과 동일 정책)
    console.log('[HiddenGame] 오프라인 — DB 저장 건너뜀');
  }
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
// [REUSE] Phase 1-7.5-B: seed 파생 PRNG로 결정론적 in-place 셔플. 서버 shuffleHiddenInPlace와 일치.
function doHiddenShuffle() {
  if (state.phase !== 'playing') return;
  if (!deductGoldLocal(SHUFFLE_COST, 'hidden_shuffle')) {
    showToast(i18n.t('hidden.notEnoughGold'));
    return;
  }
  syncGoldToDB('hidden_shuffle').catch(e => console.warn('[Hidden] 골드 싱크 실패:', e));

  // seed 파생 PRNG (hgShuffleCount = 현재 shuffleIndex, 서버와 동일 규칙)
  const session = window._hiddenSession;
  const shuffleRng = (session && typeof session.seed === 'number' && window.PRNG)
    ? window.PRNG.mulberry32(session.seed ^ ((hgShuffleCount + HG_SHUFFLE_INDEX_OFFSET) * HG_SEED_MIX))
    : null;

  // in-place 셔플 (빈 칸 위치 유지)
  const result = shuffleGridCards({
    grid: state.grid,
    gridSize: GRID_SIZE,
    mode: 'in-place',
    rng: shuffleRng,
  });
  state.grid = result.newGrid;
  renderGrid();

  // dragLog 기록
  if (session && session.sessionId) {
    session.dragLog.push({ type: 'shuffle', ts: Date.now() });
  }
  hgShuffleCount++;

  // 셔플 이펙트 (sound.js)
  try { if (typeof playCardDrop === 'function') playCardDrop(); } catch (e) {}
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:rgba(255,77,143,0.18);z-index:999;pointer-events:none;';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 350);
}

// ─── 리스타트 ───
// [REUSE] Phase 1-7.5-B: 리스타트 = 새 서버 세션 발급 + 그리드 초기화 (베이직 Phase 1-7.4 패턴)
//   골드 차감은 세션 성공 후 — 네트워크 실패 시 골드 유실 방지
async function doHiddenRestart() {
  const currentGold = parseInt(localStorage.getItem('poker_gold') || '0');
  if (currentGold < RESTART_COST) {
    showToast(i18n.t('hidden.notEnoughGold'));
    return;
  }

  document.getElementById('modalOverlay').classList.remove('active');
  document.getElementById('gridContainer').classList.remove('no-moves-dim');
  document.getElementById('noMovesOverlay').classList.remove('active');

  // 오프라인은 기존 경로
  if (window._offlineMode) {
    if (!deductGoldLocal(RESTART_COST, 'hidden_restart')) return;
    syncGoldToDB('hidden_restart').catch(e => console.warn('[Hidden] 골드 싱크 실패:', e));
    hgResetCount++;
    initState();
    initGrid();
    renderGrid();
    updateHandPanel();
    updateScoreDisplay();
    renderRemovedCards();
    state.phase = 'playing';
    hgUpdateStatus();
    return;
  }

  // 온라인: 세션 발급 성공 후 골드 차감
  try {
    const session = await requestHiddenServerSession();
    if (!deductGoldLocal(RESTART_COST, 'hidden_restart')) return;
    syncGoldToDB('hidden_restart').catch(e => console.warn('[Hidden] 골드 싱크 실패:', e));

    hgShuffleCount = 0;
    hgResetCount = 0;

    initState();
    initGrid(session.seed);
    renderGrid();
    updateHandPanel();
    updateScoreDisplay();
    renderRemovedCards();
    state.phase = 'playing';
    hgUpdateStatus();
  } catch (err) {
    console.error('[Hidden] restart session failed:', err);
    showHiddenSessionStartErrorModal(
      err.message || 'NETWORK',
      () => doHiddenRestart(),
      () => {
        window._offlineMode = true;
        doHiddenRestart();
      }
    );
  }
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

// =============================================
// [ADAPTER] Phase 1-7.5-B: 히든 서버 세션 API
// =============================================

// [ADAPTER] 서버에서 히든 세션 발급
async function requestHiddenServerSession() {
  const userId = localStorage.getItem('poker_player_id');
  if (!userId) throw new Error('NO_USER_ID');

  const res = await fetch(`${HG_SERVER_URL}/api/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, mode: 'hidden' }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP_${res.status}`);
  }

  const data = await res.json();
  window._hiddenSession = {
    sessionId: data.sessionId,
    seed: data.seed,
    gameTime: data.gameTime,
    startedAt: data.startedAt,
    dragLog: [],
    submitted: false,
  };
  console.log('[hidden/session/start] received:', { sessionId: data.sessionId.slice(0, 8), seed: data.seed });
  return window._hiddenSession;
}

// [ADAPTER] 히든 제출 — 검증 + hidden_sessions INSERT + leaderboard_hidden UPSERT (서버 처리)
async function submitHiddenToServer(claimedScore, reason) {
  const session = window._hiddenSession;
  if (!session || !session.sessionId || session.submitted) return;

  // 최고 족보 (순위 기준)
  let bestHandLabel = null;
  let bestRank = -1;
  for (const h of (state.hands || [])) {
    if (h.rankValue > bestRank) {
      bestRank = h.rankValue;
      bestHandLabel = h.label;
    }
  }

  try {
    const res = await fetch(`${HG_SERVER_URL}/api/session/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.sessionId,
        dragLog: session.dragLog,
        claimedScore,
        timeRemaining: 0, // 히든은 타이머 없음
        extraData: {
          reason: reason || 'complete',
          basic_final_score: hgBasicScore,
          reset_count: hgResetCount,
          shuffle_count: hgShuffleCount,
          best_hand_label: bestHandLabel,
        },
      }),
    });

    const data = await res.json();
    if (res.ok && data.accepted) {
      session.submitted = true;
      console.log('[hidden/submit] accepted:', data);
    } else {
      console.warn('[hidden/submit] rejected:', { status: res.status, data });
      console.warn('[hidden/submit] diagnosis:', {
        seed: session.seed,
        sessionId: session.sessionId,
        dragLog: session.dragLog,
        handCount: session.dragLog.filter(e => (e.type || 'hand') === 'hand').length,
        shuffleCount: session.dragLog.filter(e => e.type === 'shuffle').length,
        claimedScore,
      });
      showHiddenSubmitErrorModal(data, claimedScore, reason);
    }
  } catch (err) {
    console.error('[hidden/submit] network error:', err);
    showHiddenSubmitErrorModal({ error: 'NETWORK' }, claimedScore, reason);
    throw err;
  }
}

// [REWRITE] 히든 세션 발급 실패 모달
function showHiddenSessionStartErrorModal(errorCode, onRetry, onOfflineMode) {
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
        <button class="btn-play-again" id="_hgRetryStartBtn">재시도</button>
        <button class="btn-play-again" style="background:rgba(255,255,255,0.1)" id="_hgOfflineBtn">오프라인 연습 모드</button>
      </div>
      <div style="color:rgba(255,255,255,0.4);font-size:0.7rem;margin-top:12px;">에러: ${errorCode || 'UNKNOWN'}</div>
    </div>
  `;
  overlay.classList.add('active');
  document.getElementById('_hgRetryStartBtn').onclick = () => {
    overlay.classList.remove('active');
    onRetry();
  };
  document.getElementById('_hgOfflineBtn').onclick = () => {
    overlay.classList.remove('active');
    onOfflineMode();
  };
}

// [REWRITE] 히든 제출 실패 모달 (디바운스 2초)
let _hgLastSubmitRetryAt = 0;
function showHiddenSubmitErrorModal(errorData, claimedScore, reason) {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modal');
  if (!overlay || !modal) {
    console.warn('[hidden submit error]', errorData);
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
        <button class="btn-play-again" id="_hgRetrySubmitBtn">재시도</button>
        <button class="btn-play-again" style="background:rgba(255,255,255,0.1)" id="_hgAbandonBtn">기록 없이 종료</button>
      </div>
      <div style="color:rgba(255,255,255,0.4);font-size:0.7rem;margin-top:12px;">에러: ${errCode}</div>
    </div>
  `;
  overlay.classList.add('active');
  document.getElementById('_hgRetrySubmitBtn').onclick = async () => {
    const now = Date.now();
    if (now - _hgLastSubmitRetryAt < 2000) return;
    _hgLastSubmitRetryAt = now;
    overlay.classList.remove('active');
    await submitHiddenToServer(claimedScore, reason);
  };
  document.getElementById('_hgAbandonBtn').onclick = () => {
    if (window._hiddenSession) window._hiddenSession.submitted = true;
    overlay.classList.remove('active');
    location.href = './mode_select.html';
  };
}

// ─── finalizePath 후 카운터 업데이트 + dragLog 수집 ───
// [ADAPTER] Phase 1-7.5-B: 패가 유효하면(state.hands 증가) dragLog에 hand 이벤트 기록.
//   script.js의 dragLog push는 _pvpMode=true로 스킵되므로 여기서 히든 전용 세션에 push.
const _origFinalizePath = window.finalizePath;
window.finalizePath = function() {
  const prevHandsLen = state && state.hands ? state.hands.length : 0;
  const pathSnapshot = (state && state.selectedPath && state.selectedPath.length === 5)
    ? state.selectedPath.map(p => [p[0], p[1]])
    : null;

  if (typeof _origFinalizePath === 'function') _origFinalizePath.call(this);

  const newHandsLen = state && state.hands ? state.hands.length : 0;
  if (pathSnapshot && newHandsLen > prevHandsLen) {
    const session = window._hiddenSession;
    if (session && session.sessionId) {
      session.dragLog.push({
        type: 'hand',
        cards: pathSnapshot,
        ts: Date.now(),
      });
    }
  }

  hgUpdateStatus();
};

// ─── START 오버레이 초기화 ───
// [REUSE] Phase 1-7.5-B: START 탭 → 서버 세션 발급 → seed로 그리드 재생성
(function initHiddenStart() {
  const overlay = document.getElementById('hgStartOverlay');
  const btn = document.getElementById('hgStartBtn');
  if (!overlay || !btn) return;

  async function startHiddenFlow() {
    if (typeof Sound !== 'undefined' && Sound.warmup) Sound.warmup();
    try {
      if (typeof BGM !== 'undefined') {
        BGM.init('./audio/Hidden_Theme.mp3');
        BGM.start();
      }
    } catch (e) {}

    // 세션 발급 (오프라인이면 스킵)
    if (!window._offlineMode) {
      try {
        const session = await requestHiddenServerSession();
        initState();
        initGrid(session.seed);
        renderGrid();
        updateHandPanel();
        updateScoreDisplay();
        renderRemovedCards();
      } catch (err) {
        console.error('[hidden/session/start] failed:', err);
        showHiddenSessionStartErrorModal(
          err.message || 'NETWORK',
          () => startHiddenFlow(),
          () => {
            window._offlineMode = true;
            startHiddenFlow();
          }
        );
        return;
      }
    }

    overlay.style.display = 'none';
    hgGameStarted = true;
    state.phase = 'playing';

    // script.js가 #restartBtn에 붙여둔 resetGame() 핸들러 제거
    // (resetGame → startTimer()로 숨겨진 200초 타이머가 돌던 버그 차단)
    ['shuffleBtn', 'restartBtn'].forEach(id => {
      const oldBtn = document.getElementById(id);
      if (!oldBtn) return;
      const newBtn = oldBtn.cloneNode(true);
      oldBtn.parentNode.replaceChild(newBtn, oldBtn);
    });

    // 셔플 버튼
    const shuffleBtn = document.getElementById('shuffleBtn');
    if (shuffleBtn) shuffleBtn.addEventListener('click', doHiddenShuffle);

    // 리스타트 버튼
    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) restartBtn.addEventListener('click', () => {
      if (state.phase === 'playing') doHiddenRestart();
    });
  }

  btn.addEventListener('click', startHiddenFlow);
})();

// =============================================
// EXPO 전환 체크리스트
// REUSE   : doHiddenShuffle (PRNG 이식 후), doHiddenRestart (fetch URL 동일)
// ADAPTER : localStorage → AsyncStorage;
//           Phase 1-7.5-B 서버 세션 API: requestHiddenServerSession,
//           submitHiddenToServer (fetch URL 동일, import 방식만 교체)
// REWRITE : UI 렌더링 함수들 (showHiddenEndModal, hgUpdateStatus,
//           showHiddenSessionStartErrorModal, showHiddenSubmitErrorModal)
// =============================================
