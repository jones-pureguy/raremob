// =============================================
// [REUSE] PvP ARCADE BATTLE 클라이언트 스크립트
// Expo 전환 시: 게임 로직 재활용, UI 부분만 교체
// =============================================

const pvpArcade = {
  roomId: null,
  opponent: null,
  myHands: [],
  opponentHands: [],
  gameStarted: false,
  rematchRequested: false,
  lastHandCount: 0,
  rematchTimer: null
};

// ─── 초기화 ───
(function initPvpArcade() {
  const pvpRoomRaw = sessionStorage.getItem('pvpRoom');
  if (!pvpRoomRaw) { location.href = 'pvp_lobby.html'; return; }

  const pvpRoom = JSON.parse(pvpRoomRaw);
  pvpArcade.roomId = pvpRoom.roomId;
  pvpArcade.opponent = pvpRoom.opponent;

  // 상대 정보 표시
  document.getElementById('oppName').textContent = pvpArcade.opponent.username;
  document.getElementById('oppChip').textContent = pvpArcade.opponent.chip.toLocaleString();

  // START 오버레이 설정
  document.getElementById('pvpStartTitle').textContent = i18n.t('pvp.arcade.title');
  document.getElementById('pvpStartSubtitle').textContent =
    i18n.t('pvp.arcade.vs').replace('{name}', pvpArcade.opponent.username);

  // 점수판 초기 렌더링
  renderScoreboard();

  // script.js의 endGame을 PvP용으로 오버라이드
  window._origEndGame = window.endGame;
  window.endGame = function(reason) {
    // PvP에서는 클라이언트 endGame 시 서버에 알림만
    if (pvpArcade.gameStarted && reason !== '_pvp_result') {
      state.phase = 'gameover';
      clearInterval(state.timerInterval);
      socket.emit('game:end', { roomId: pvpArcade.roomId });
    }
  };

  // finalizePath 래핑 — 패 완성 감지
  const origFinalizePath = window.finalizePath;
  window.finalizePath = function() {
    const prevCount = state.hands.length;
    origFinalizePath.call(this);
    const newCount = state.hands.length;

    if (newCount > prevCount) {
      const newHand = state.hands[state.hands.length - 1];
      const evalResult = evaluateHand(newHand.cards);

      // 가장 높은 카드의 suit
      const sortedCards = [...newHand.cards].sort((a, b) => b.value - a.value);
      const topSuit = sortedCards[0].suit;

      pvpArcade.myHands = state.hands.map(h => {
        const ev = evaluateHand(h.cards);
        const sc = [...h.cards].sort((a, b) => b.value - a.value);
        return { rank: ev.rank, label: ev.label, suit: sc[0].suit,
                 values: ev.values, suits: ev.suits, primaryVal: ev.primaryVal,
                 secondaryVal: ev.secondaryVal, kickers: ev.kickers, cards: h.cards };
      }).sort((a, b) => b.rank - a.rank);

      renderScoreboard();

      socket.emit('game:handComplete', {
        roomId: pvpArcade.roomId,
        hand: { rank: evalResult.rank, label: evalResult.label, suit: topSuit }
      });
    }
  };

  // initStartOverlay를 PvP용으로 오버라이드 (이미 script.js가 호출했지만 재설정)
  const overlay = document.getElementById('startOverlay');
  const startBtn = document.getElementById('startBtn');
  if (overlay && startBtn) {
    // script.js가 이미 핸들러를 붙였으므로 새로 생성
    const newBtn = startBtn.cloneNode(true);
    startBtn.parentNode.replaceChild(newBtn, startBtn);

    function handlePvpStart(e) {
      e.stopPropagation();
      Sound.warmup();
      socket.emit('game:start', { roomId: pvpArcade.roomId });
      newBtn.textContent = i18n.t('pvp.arcade.waiting');
      newBtn.disabled = true;
    }

    newBtn.addEventListener('click', handlePvpStart);
  }
})();

// ─── 소켓 이벤트 수신 ───

// game:waiting — 상대 대기 중
socket.on('game:waiting', () => {
  const btn = document.getElementById('startBtn');
  if (btn) {
    btn.textContent = i18n.t('pvp.arcade.waiting');
    btn.disabled = true;
  }
});

// game:started — 게임 시작 (서버에서 양쪽에 전송)
socket.on('game:started', ({ roomId, startedAt }) => {
  if (roomId !== pvpArcade.roomId) return;
  pvpArcade.gameStarted = true;

  // 오버레이 닫기
  const overlay = document.getElementById('startOverlay');
  if (overlay) {
    overlay.classList.add('hiding');
    setTimeout(() => {
      overlay.remove();
      const grid = document.getElementById('gridContainer');
      if (grid) grid.style.pointerEvents = '';
    }, 300);
  }

  // BGM 시작
  BGM.init('./audio/Main_Theme.mp3');
  BGM.start();

  // 타이머 시작
  state.phase = 'playing';
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const remaining = Math.max(1, TIMER_SECONDS - elapsed);
  startTimer();
  state.timer = remaining; // startTimer()가 200으로 덮어쓴 것을 재설정
  updateTimerDisplay();
});

// opponent:handComplete — 상대 패 완성
socket.on('opponent:handComplete', ({ hands }) => {
  console.log('[pvp] 상대 패 수신:', hands.length, hands);
  pvpArcade.opponentHands = hands;
  const el = document.getElementById('oppHandCount');
  if (el) el.textContent = `${hands.length}/9`;
  renderScoreboard();
});

// game:timeAttack — 타임어택 발동
socket.on('game:timeAttack', ({ triggeredBy, deadline }) => {
  const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));

  // 타이머 재설정
  clearInterval(state.timerInterval);
  state.timer = remaining;
  updateTimerDisplay();

  // 타이머 빨간색
  document.getElementById('timerNum').classList.add('time-attack');
  document.getElementById('timerRing').classList.add('time-attack');

  // 타이머 재시작
  state.timerInterval = setInterval(() => {
    if (state.phase !== 'playing') return;
    state.timer--;
    updateTimerDisplay();
    if (state.timer <= 0) {
      socket.emit('game:end', { roomId: pvpArcade.roomId });
    }
  }, 1000);

  // 배너 표시
  const banner = document.getElementById('timeAttackBanner');
  banner.textContent = `${i18n.t('pvp.arcade.timeAttack')} ${remaining}s`;
  banner.classList.add('active');
  setTimeout(() => banner.classList.remove('active'), 3000);
});

// game:result — 결과
socket.on('game:result', (data) => {
  if (data.roomId !== pvpArcade.roomId) return;
  state.phase = 'result';
  clearInterval(state.timerInterval);

  // localStorage 칩 업데이트
  const myChip = data.newChip[socket.id];
  if (myChip !== undefined) {
    localStorage.setItem('userChip', String(myChip));
    window.dispatchEvent(new Event('chipUpdated'));
  }

  showResult(data);
});

// room:opponentDisconnected — 상대 접속 종료
socket.on('room:opponentDisconnected', () => {
  state.phase = 'result';
  clearInterval(state.timerInterval);
  showDisconnectResult();
});

// rematch:requested — 상대가 재대결 요청
socket.on('rematch:requested', () => {
  // 본인도 이미 요청했으면 서버가 자동 처리
});

// rematch:declined — 재대결 거절
socket.on('rematch:declined', () => {
  showToast(i18n.t('pvp.arcade.rematchDeclined'));
  clearTimeout(pvpArcade.rematchTimer);
  const waitEl = document.getElementById('rematchWait');
  if (waitEl) waitEl.textContent = '';
  const rematchBtn = document.getElementById('btnRematch');
  if (rematchBtn) rematchBtn.style.display = 'none';
});

// ─── 점수판 렌더링 ───
function renderScoreboard() {
  console.log('[pvp] renderScoreboard:', 'my:', pvpArcade.myHands.length, 'opp:', pvpArcade.opponentHands.length);
  const container = document.getElementById('scoreboard');
  const myName = localStorage.getItem('poker_username') || 'ME';
  const oppName = pvpArcade.opponent ? pvpArcade.opponent.username : 'OPP';

  let html = `<div class="pvp-sb-header">
    <span class="pvp-sb-cell left">${myName}</span>
    <span class="pvp-sb-cell vs"></span>
    <span class="pvp-sb-cell right">${oppName}</span>
  </div>`;

  const mySorted = [...pvpArcade.myHands].sort((a, b) => b.rank - a.rank);
  const oppSorted = [...pvpArcade.opponentHands].sort((a, b) => b.rank - a.rank);

  for (let i = 0; i < 9; i++) {
    const my = mySorted[i];
    const opp = oppSorted[i];

    let myText = '—';
    let oppText = '—';
    let myClass = '';
    let oppClass = '';
    let vsIcon = '';

    if (my) myText = my.label;
    if (opp) oppText = opp.label;

    if (my && opp) {
      if (my.rank > opp.rank) {
        myClass = 'win'; vsIcon = '👑';
      } else if (opp.rank > my.rank) {
        oppClass = 'win'; vsIcon = '👑';
      } else {
        myClass = ''; oppClass = ''; vsIcon = '?';
      }
    } else if (my && !opp) {
      myClass = 'win';
    } else if (!my && opp) {
      oppClass = 'win';
    }

    const leftCrown = myClass === 'win' ? '👑 ' : '';
    const rightCrown = oppClass === 'win' ? ' 👑' : '';

    html += `<div class="pvp-sb-row">
      <span class="pvp-sb-cell left"><span class="${myClass}">${leftCrown}${myText}</span></span>
      <span class="pvp-sb-cell vs">${vsIcon}</span>
      <span class="pvp-sb-cell right"><span class="${oppClass}">${oppText}${rightCrown}</span></span>
    </div>`;
  }

  container.innerHTML = html;
}

// ─── 결과창 ───
function showResult(data) {
  const modal = document.getElementById('modal');
  const overlay = document.getElementById('modalOverlay');
  const myId = socket.id;
  const oppId = pvpArcade.opponent.socketId;

  const isWinner = data.winner === myId;
  const isDraw = data.winner === 'draw';
  const myDelta = data.chipDelta[myId] || 0;
  const myNewChip = data.newChip[myId] || 0;

  // 결과 비교표
  let tableHTML = '<div style="margin:12px 0;">';
  const mySorted = [...pvpArcade.myHands].sort((a, b) => b.rank - a.rank);
  const oppSorted = [...pvpArcade.opponentHands].sort((a, b) => b.rank - a.rank);

  for (let i = 0; i < 9; i++) {
    const r = data.results[i] || 'draw';
    const my = mySorted[i];
    const opp = oppSorted[i];
    const myLabel = my ? my.label : '—';
    const oppLabel = opp ? opp.label : '—';
    const myCls = r === 'A' ? 'color:var(--gold)' : 'color:rgba(255,255,255,0.4)';
    const oppCls = r === 'B' ? 'color:var(--gold)' : 'color:rgba(255,255,255,0.4)';
    const crown = r === 'A' ? '👑 ' : '';
    const crownR = r === 'B' ? ' 👑' : '';

    tableHTML += `<div style="display:flex;font-size:0.72rem;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="flex:1;text-align:left;${myCls}">${crown}${myLabel}</span>
      <span style="flex:1;text-align:right;${oppCls}">${oppLabel}${crownR}</span>
    </div>`;
  }
  tableHTML += '</div>';

  // 칩 정산
  let chipHTML = '';
  if (isDraw) {
    chipHTML = `<div style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin:8px 0;">${i18n.t('pvp.arcade.draw')}</div>`;
  } else {
    const sign = myDelta >= 0 ? '+' : '';
    const deltaColor = myDelta >= 0 ? '#4CAF50' : '#ff5252';
    chipHTML = `
      <div style="font-size:0.8rem;color:rgba(255,255,255,0.4);margin-top:8px;">${i18n.t('pvp.arcade.chipDelta')}</div>
      <div style="font-size:1.1rem;font-weight:700;color:${deltaColor};margin:4px 0;">${sign}${myDelta} chip</div>
      <div style="font-size:0.78rem;color:rgba(255,255,255,0.4);">
        <img src="./images/chip.png" style="width:14px;height:14px;vertical-align:-2px;"> ${myNewChip.toLocaleString()}
      </div>`;
  }

  // 버튼
  let buttonsHTML = '';
  if (data.reason === 'disconnect') {
    buttonsHTML = `
      <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin:8px 0;">${i18n.t('pvp.arcade.oppLeft')}</div>
      <button class="pvp-popup-btn" onclick="goToLobby()">${i18n.t('pvp.arcade.toLobby')}</button>`;
  } else if (data.canRematch) {
    buttonsHTML = `
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="pvp-popup-btn" id="btnRematch" onclick="requestRematch()" style="flex:1;">${i18n.t('pvp.arcade.rematch')}</button>
        <button class="pvp-popup-btn reject" onclick="goToLobby()" style="flex:1;">${i18n.t('pvp.arcade.toLobby')}</button>
      </div>
      <div id="rematchWait" style="color:rgba(255,255,255,0.4);font-size:0.75rem;margin-top:6px;"></div>`;
  } else {
    buttonsHTML = `
      <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;margin:8px 0;">${i18n.t('pvp.arcade.noChip')}</div>
      <button class="pvp-popup-btn" onclick="goToLobby()">${i18n.t('pvp.arcade.toLobby')}</button>`;
  }

  modal.innerHTML = `
    <h2 style="font-size:1.3rem;">${i18n.t('pvp.arcade.result')}</h2>
    ${tableHTML}
    <div style="display:flex;justify-content:center;gap:24px;font-size:0.85rem;margin:8px 0;">
      <span style="color:var(--gold);">${i18n.t('pvp.arcade.myWins').replace('{n}', data.winsA)}</span>
      <span style="color:rgba(255,255,255,0.5);">${i18n.t('pvp.arcade.oppWins').replace('{n}', data.winsB)}</span>
    </div>
    ${chipHTML}
    ${buttonsHTML}
  `;
  overlay.classList.add('active');
}

function showDisconnectResult() {
  const modal = document.getElementById('modal');
  const overlay = document.getElementById('modalOverlay');
  modal.innerHTML = `
    <h2 style="font-size:1.3rem;">${i18n.t('pvp.arcade.result')}</h2>
    <div style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin:16px 0;">${i18n.t('pvp.arcade.oppLeft')}</div>
    <button class="pvp-popup-btn" onclick="goToLobby()">${i18n.t('pvp.arcade.toLobby')}</button>
  `;
  overlay.classList.add('active');
}

// ─── 재대결 ───
function requestRematch() {
  if (pvpArcade.rematchRequested) return;
  pvpArcade.rematchRequested = true;

  socket.emit('rematch:request', { roomId: pvpArcade.roomId });

  const waitEl = document.getElementById('rematchWait');
  if (waitEl) waitEl.textContent = i18n.t('pvp.arcade.waiting');

  const btn = document.getElementById('btnRematch');
  if (btn) btn.disabled = true;

  // 30초 타임아웃
  pvpArcade.rematchTimer = setTimeout(() => {
    showToast(i18n.t('pvp.arcade.rematchDeclined'));
    if (waitEl) waitEl.textContent = '';
    if (btn) btn.style.display = 'none';
  }, 30000);
}

// ─── 로비로 ───
function goToLobby() {
  pvpCleanup();
  location.href = 'pvp_lobby.html';
}

function pvpCleanup() {
  clearTimeout(pvpArcade.rematchTimer);
  sessionStorage.removeItem('pvpRoom');
}

// ─── 페이지 이탈 처리 ───
window.addEventListener('beforeunload', pvpCleanup);
