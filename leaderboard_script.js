// ============================================
// DragON POKER — Phase 1-11 Leaderboard UI
// period-first 2단 탭 + sort 토글 + 하단 스탯
// 정책: PHASE_1_11_DECISIONS.md
// 시간대: UTC 내부, 표시 직전에만 로컬 변환 (TIMEZONE_POLICY.md)
// ============================================

(async function () {
  // [ADAPTER] 서버 URL — server_client.js의 RENDER_SERVER 재사용
  const API_BASE = (typeof RENDER_SERVER === 'string') ? RENDER_SERVER : 'https://dragon-poker-server.onrender.com';

  // 로그인 필수
  if (typeof requireRegistration === 'function' && !requireRegistration()) return;
  await i18n.init();

  const state = {
    period: 'all_time',
    board: 'basic',
    sort: 'best',
    offset: 0,
    limit: 20,
    topData: null,
    meData: null,
    loading: false,
  };

  // ───────── Boot ─────────
  applyStaticI18n();

  // [Phase 1-11.2] 진입 즉시 스피너 — /me /top 응답 대기 중 빈 화면 제거
  showLoading();

  // [Phase 1-11.2] /me와 /top 병렬 호출. /me 실패해도 /top은 계속 진행.
  const mePromise = loadMeData().catch(err => {
    console.warn('[leaderboard] /me load failed:', err.message);
  });
  const topPromise = loadTopData();

  await Promise.all([mePromise, topPromise]);

  renderAll();
  bindTabEvents();
  bindSortEvents();
  bindListEvents();

  // ───────── i18n 정적 주입 ─────────
  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const v = i18n.t(key);
      if (v && v !== key) el.textContent = v;
    });
    document.title = i18n.t('leaderboard.title') + ' — DragON POKER';
  }

  // ───────── API 호출 ─────────
  function getUserId() {
    return localStorage.getItem('poker_player_id') || '';
  }

  async function loadMeData() {
    const userId = getUserId();
    if (!userId) { state.meData = null; return; }
    const resp = await fetch(`${API_BASE}/api/leaderboard/me?userId=${encodeURIComponent(userId)}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP_${resp.status}`);
    }
    state.meData = await resp.json();
  }

  async function loadTopData() {
    const { board, period, sort, offset, limit } = state;
    const url = `${API_BASE}/api/leaderboard/top?board=${board}&period=${period}&sort=${sort}&offset=${offset}&limit=${limit}`;
    showLoading();
    state.loading = true;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP_${resp.status}`);
      }
      state.topData = await resp.json();
    } catch (err) {
      state.topData = null;
      showError(err.message);
    } finally {
      state.loading = false;
    }
  }

  // ───────── 렌더 ─────────
  function renderAll() {
    renderList();
    renderMyRankBar();
    renderMyStats();
    renderNextResetHint();
    updateBoardTabsVisibility();
  }

  function showLoading() {
    const area = document.getElementById('listArea');
    area.innerHTML = `<div class="state-loading"><div class="spinner"></div><div>${escapeHTML(i18n.t('leaderboard.state.loading'))}</div></div>`;
  }

  function showError(message) {
    const area = document.getElementById('listArea');
    area.innerHTML = `
      <div class="state-error">
        <p>${escapeHTML(i18n.t('leaderboard.state.errorTitle'))}</p>
        <p class="err-detail">${escapeHTML(message || '')}</p>
        <button class="btn-retry" type="button" data-action="retry">${escapeHTML(i18n.t('leaderboard.state.retry'))}</button>
      </div>
    `;
  }

  function renderList() {
    if (state.loading) return;
    const area = document.getElementById('listArea');
    const data = state.topData;
    if (!data) return; // showError가 이미 처리

    if (!data.rows || data.rows.length === 0) {
      area.innerHTML = `<div class="state-empty">${escapeHTML(i18n.t('leaderboard.state.emptyList') || '—')}</div>`;
      return;
    }

    const myId = getUserId();
    const playReplayLabel = escapeHTML(i18n.t('leaderboard.list.playReplay') || 'Play replay');
    const rowsHTML = data.rows.map(row => {
      const meCls = (row.player_id && row.player_id === myId) ? ' me' : '';
      const meta = metaForSort(row, state.sort);
      // [Phase 1-11.3] replay_id 있으면 ▶ 버튼, 없으면 같은 폭의 placeholder (grid 정렬 유지)
      const replayHTML = row.replay_id
        ? `<button class="btn-replay" type="button" data-action="replay" data-replay-id="${escapeHTML(row.replay_id)}" aria-label="${playReplayLabel}" title="${playReplayLabel}">▶</button>`
        : `<span class="btn-replay-placeholder" aria-hidden="true"></span>`;
      return `
        <div class="lb-row${meCls}">
          <span class="rank">${row.rank}</span>
          <span class="username">${escapeHTML(row.username)}</span>
          <span class="score">${formatNumber(row.score)}</span>
          <span class="meta">${meta}</span>
          ${replayHTML}
        </div>
      `;
    }).join('');

    const totalLoaded = state.offset + data.rows.length;
    const canMore = totalLoaded < (data.total_count || 0) && totalLoaded < 100;
    const moreBtn = canMore
      ? `<button class="btn-more" type="button" data-action="more">${escapeHTML(i18n.t('leaderboard.list.moreButton'))}</button>`
      : '';

    area.innerHTML = rowsHTML + moreBtn;
  }

  function metaForSort(row, sort) {
    // 보조 정보 — sort별 다른 메트릭 표시 (게임수 / 평균)
    if (sort === 'best') {
      return escapeHTML(i18n.t('leaderboard.list.gameCountShort', { n: row.game_count }));
    }
    if (sort === 'sum') {
      return escapeHTML(i18n.t('leaderboard.list.avgShort', { n: row.avg_score }));
    }
    // avg
    return escapeHTML(i18n.t('leaderboard.list.gameCountShort', { n: row.game_count }));
  }

  function renderMyRankBar() {
    const bar = document.getElementById('myRankBar');
    const boardData = state.meData && state.meData[state.board] ? state.meData[state.board][state.period] : null;
    if (!boardData) { bar.hidden = true; return; }

    let score, rank, exact, percentile;
    if (state.sort === 'best') {
      score = boardData.score;
      rank = boardData.rank_best;
      exact = boardData.exact_best;
      percentile = boardData.percentile_best;
    } else if (state.sort === 'sum') {
      score = boardData.sum;
      rank = boardData.rank_sum;
      exact = boardData.exact_sum;
      percentile = boardData.percentile_sum;
    } else {
      score = boardData.avg;
      rank = boardData.rank_avg;
      exact = boardData.exact_avg;
      percentile = boardData.percentile_avg;
    }

    const rankStr = formatRank(rank, exact, percentile);
    bar.textContent = i18n.t('leaderboard.myRankBar', { rank: rankStr, score: formatNumber(score) });
    bar.hidden = false;
  }

  function renderMyStats() {
    const container = document.getElementById('myStatsArea');
    const periodName = i18n.t(`leaderboard.period.${state.period}`);
    const title = i18n.t('leaderboard.mystats.title', { period: periodName });

    let html = `<h2>${escapeHTML(title)}</h2>`;

    const boards = ['basic', 'infinite', 'hidden', 'basic_retry'];
    for (const board of boards) {
      // RETRY는 all_time에서만 노출
      if (board === 'basic_retry' && state.period !== 'all_time') continue;
      const data = state.meData && state.meData[board] ? state.meData[board][state.period] : null;
      const labelKey = board === 'basic_retry' ? 'leaderboard.board.retry' : `leaderboard.board.${board}`;
      const boardLabel = i18n.t(labelKey);

      if (!data) {
        html += `
          <div class="stats-board">
            <div class="stats-board-name">${escapeHTML(boardLabel)}</div>
            <div class="stats-no-record">${escapeHTML(i18n.t('leaderboard.mystats.noRecord'))}</div>
          </div>
        `;
        continue;
      }

      const bestRankStr = formatRank(data.rank_best, data.exact_best, data.percentile_best);
      const sumRankStr  = formatRank(data.rank_sum,  data.exact_sum,  data.percentile_sum);
      const avgRankStr  = formatRank(data.rank_avg,  data.exact_avg,  data.percentile_avg);

      html += `
        <div class="stats-board">
          <div class="stats-board-name">${escapeHTML(boardLabel)}</div>
          <div class="stats-metrics">
            <span><span class="stats-metric-label">${escapeHTML(i18n.t('leaderboard.metrics.best'))}</span> ${formatNumber(data.score)}(${escapeHTML(bestRankStr)})</span>
            <span><span class="stats-metric-label">${escapeHTML(i18n.t('leaderboard.metrics.total'))}</span> ${formatNumber(data.sum)}(${escapeHTML(sumRankStr)})</span>
            <span><span class="stats-metric-label">${escapeHTML(i18n.t('leaderboard.metrics.avg'))}</span> ${formatNumber(data.avg)}(${escapeHTML(avgRankStr)})</span>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  }

  function formatRank(rank, exact, percentile) {
    if (exact && rank != null) return i18n.t('leaderboard.rank.exact', { n: rank });
    if (percentile != null)    return i18n.t('leaderboard.rank.percentile', { n: percentile });
    return '―';
  }

  function renderNextResetHint() {
    const hint = document.getElementById('nextResetHint');
    if (state.period === 'all_time') { hint.hidden = true; return; }

    const now = new Date();
    let nextReset;
    if (state.period === 'daily') {
      nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    } else if (state.period === 'weekly') {
      const dayOfWeek = now.getUTCDay(); // 0=일, 1=월, ..., 6=토
      const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
      nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
    } else if (state.period === 'monthly') {
      nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    } else {
      hint.hidden = true;
      return;
    }

    const localTime = nextReset.toLocaleString(navigator.language, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    hint.textContent = i18n.t('leaderboard.nextReset', { time: localTime });
    hint.hidden = false;
  }

  function updateBoardTabsVisibility() {
    const retryTab = document.querySelector('[data-board="basic_retry"]');
    if (!retryTab) return;
    if (state.period === 'all_time') {
      retryTab.hidden = false;
    } else {
      retryTab.hidden = true;
      if (state.board === 'basic_retry') {
        // 현재 선택이 RETRY였으면 basic으로 강제 복귀
        selectBoard('basic');
      }
    }
  }

  function selectBoard(board) {
    state.board = board;
    state.offset = 0;
    document.querySelectorAll('.tab-board').forEach(b => b.classList.toggle('active', b.dataset.board === board));
  }

  // ───────── 이벤트 바인딩 ─────────
  function bindTabEvents() {
    document.querySelectorAll('.tab-period').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.period === state.period) return;
        state.period = btn.dataset.period;
        state.offset = 0;
        updateTabUI('.tab-period', btn);
        updateBoardTabsVisibility();
        renderNextResetHint();
        renderMyStats();
        renderMyRankBar();
        await loadTopData();
        renderList();
      });
    });

    document.querySelectorAll('.tab-board').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.board === state.board) return;
        state.board = btn.dataset.board;
        state.offset = 0;
        updateTabUI('.tab-board', btn);
        renderMyRankBar();
        await loadTopData();
        renderList();
      });
    });
  }

  function bindSortEvents() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.sort === state.sort) return;
        state.sort = btn.dataset.sort;
        state.offset = 0;
        updateTabUI('.sort-btn', btn);
        renderMyRankBar();
        await loadTopData();
        renderList();
      });
    });
  }

  function bindListEvents() {
    document.getElementById('listArea').addEventListener('click', async (e) => {
      // 가장 가까운 data-action 요소까지 타고 올라감 (아이콘 span 클릭 대응)
      const trg = e.target.closest && e.target.closest('[data-action]');
      const action = trg && trg.dataset && trg.dataset.action;
      if (!action) return;
      if (action === 'retry') {
        await loadTopData();
        renderList();
      } else if (action === 'more') {
        state.offset += state.limit;
        await loadTopData();
        renderList();
      } else if (action === 'replay') {
        // [Phase 1-11.3] 리플레이 이동
        const id = trg.dataset.replayId;
        if (id) window.location.href = `replay.html?id=${encodeURIComponent(id)}`;
      }
    });
  }

  function updateTabUI(selector, activeBtn) {
    document.querySelectorAll(selector).forEach(b => b.classList.toggle('active', b === activeBtn));
  }

  // ───────── 유틸 ─────────
  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
  function formatNumber(n) {
    if (n === null || n === undefined) return '0';
    try { return Number(n).toLocaleString(navigator.language); }
    catch (e) { return String(n); }
  }
})();
