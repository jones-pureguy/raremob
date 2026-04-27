// gold_client.js
// [ADAPTER] Phase 2A-new — 골드 클라이언트 단일 모듈
// 서버 RPC(deduct_gold/grant_gold/exchange_gold_to_chip)를 호출하는 권위 헬퍼.
// 본 묶음(3)에서는 함수 정의만 박는다. 실제 호출부 마이그레이션은 묶음 6.
//
// 사용 가정:
//   - server_client.js가 먼저 로드되어 RENDER_SERVER 상수가 전역에 있음
//   - 각 페이지 인라인 <script>에 const sb = window.supabase.createClient(...)
//   - i18n.t() 사용 가능 (토스트 메시지)
//
// Expo 전환 시:
//   - localStorage → AsyncStorage
//   - sb.auth.getSession() → 동일 (Supabase JS SDK 호환)
//   - RENDER_SERVER → .env

(function () {
  'use strict';

  const GOLD_KEY = 'poker_gold';

  // ----- 내부 유틸 -----

  function _getLocalGold() {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(GOLD_KEY) : null;
    const n = parseInt(raw || '0', 10);
    return Number.isFinite(n) ? n : 0;
  }

  function _setLocalGold(value) {
    if (typeof localStorage === 'undefined') return;
    const v = Math.max(0, parseInt(value, 10) || 0);
    localStorage.setItem(GOLD_KEY, String(v));
  }

  function _updateGoldUI(value) {
    try {
      // 1) 직접 콜백 (외부 페이지가 정의했으면)
      if (typeof window.updateGoldDisplay === 'function') {
        window.updateGoldDisplay(value);
      }
      // 2) header.js 리스너 트리거 (Option A — 기본 경로)
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('goldUpdated', { detail: { gold: value } }));
      }
      // 3) fallback selector (Option C — header.js 미로드 페이지 대비)
      const el = document.getElementById('goldDisplay')
              || document.getElementById('gold-display')
              || document.querySelector('[data-gold-display]');
      if (el) el.textContent = String(value);
    } catch (_) { /* noop */ }
  }

  function _showToast(msgKey, fallback) {
    try {
      const msg = (typeof window.i18n !== 'undefined' && typeof window.i18n.t === 'function')
        ? window.i18n.t(msgKey) : (fallback || msgKey);
      if (typeof window.showToast === 'function') {
        window.showToast(msg);
      } else {
        console.warn('[gold_client]', msg);
      }
    } catch (_) { /* noop */ }
  }

  async function _getAuthToken() {
    try {
      if (typeof window.getAuthToken === 'function') {
        // server_client.js의 getAuthToken 재사용
        return await window.getAuthToken();
      }
      if (typeof sb === 'undefined' || !sb || !sb.auth) return null;
      const { data } = await sb.auth.getSession();
      return data?.session?.access_token || null;
    } catch (e) {
      console.warn('[gold_client] getAuthToken failed:', e);
      return null;
    }
  }

  function _genIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // fallback (구형 브라우저용)
    return 'idem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  function _isOnline() {
    return (typeof navigator === 'undefined') || (navigator.onLine !== false);
  }

  function _serverBase() {
    // TODO (post-bundle-8): migrate to callApi/getApi for unified Authorization handling
    // server_client.js의 const RENDER_SERVER (top-level script scope) 우선.
    // const는 window에 attach되지 않으므로 bare 식별자로 접근 (typeof 가드 필수).
    try {
      if (typeof RENDER_SERVER === 'string' && RENDER_SERVER) return RENDER_SERVER;
    } catch (_) { /* ReferenceError fallback */ }
    if (typeof window !== 'undefined' && typeof window.RENDER_SERVER === 'string' && window.RENDER_SERVER) {
      return window.RENDER_SERVER;
    }
    return '';
  }

  // ----- 공개 API -----

  /**
   * 골드 차감 (Optimistic UI + 롤백 + idempotency).
   * @param {number} amount  양수 정수
   * @param {string} reason  RPC 화이트리스트의 reason
   * @param {object} [meta]  부가 정보 (puzzle_id, stage_id 등) — RPC p_meta로 전달
   * @returns {Promise<boolean>}  성공 시 true. 실패 시 false (UI 롤백 완료된 상태).
   */
  async function spendGold(amount, reason, meta) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      console.warn('[gold_client.spendGold] invalid amount:', amount);
      return false;
    }
    if (typeof reason !== 'string' || !reason) {
      console.warn('[gold_client.spendGold] invalid reason:', reason);
      return false;
    }

    if (!_isOnline()) {
      _showToast('toast.offlineNoSpend', '오프라인 상태에서는 골드를 차감할 수 없습니다.');
      return false;
    }

    const before = _getLocalGold();
    if (before < amount) {
      _showToast('toast.goldInsufficient', '골드가 부족합니다.');
      return false;
    }

    // 1. Optimistic UI
    const optimistic = before - amount;
    _setLocalGold(optimistic);
    _updateGoldUI(optimistic);

    // 2. 서버 호출
    const token = await _getAuthToken();
    if (!token) {
      _setLocalGold(before);
      _updateGoldUI(before);
      _showToast('toast.authMissing', '로그인이 필요합니다.');
      return false;
    }

    const idempotencyKey = _genIdempotencyKey();
    try {
      const res = await fetch(`${_serverBase()}/api/gold/deduct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount, reason, idempotencyKey, meta: meta || null })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        // 3. 롤백
        _setLocalGold(before);
        _updateGoldUI(before);
        _showToast('toast.goldSyncFailed', '골드 동기화에 실패했습니다.');
        console.warn('[gold_client.spendGold] server reject:', json);
        return false;
      }
      // 4. 서버 권위 값으로 정정
      const balance = json?.data?.balance;
      if (typeof balance === 'number') {
        _setLocalGold(balance);
        _updateGoldUI(balance);
      }
      return true;
    } catch (e) {
      _setLocalGold(before);
      _updateGoldUI(before);
      _showToast('toast.goldSyncFailed', '골드 동기화에 실패했습니다.');
      console.warn('[gold_client.spendGold] error:', e);
      return false;
    }
  }

  /**
   * 골드 적립 (시스템 보상). 서버 RPC grant_gold 경유.
   * @param {number} amount  양수 정수
   * @param {string} reason  grant_gold 화이트리스트
   * @param {object} [meta]
   * @returns {Promise<boolean>}
   */
  async function awardGold(amount, reason, meta) {
    if (typeof amount !== 'number' || amount <= 0) return false;
    if (typeof reason !== 'string' || !reason) return false;
    if (!_isOnline()) return false;

    const token = await _getAuthToken();
    if (!token) return false;

    const idempotencyKey = _genIdempotencyKey();
    try {
      const res = await fetch(`${_serverBase()}/api/gold/grant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount, reason, idempotencyKey, meta: meta || null })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        console.warn('[gold_client.awardGold] server reject:', json);
        return false;
      }
      const balance = json?.data?.balance;
      if (typeof balance === 'number') {
        _setLocalGold(balance);
        _updateGoldUI(balance);
      }
      return true;
    } catch (e) {
      console.warn('[gold_client.awardGold] error:', e);
      return false;
    }
  }

  /**
   * 서버 권위 잔액으로 localStorage 정정.
   * 진입 시점, 멀티 디바이스 동기화 등에서 호출.
   * @returns {Promise<number|null>}  서버 잔액 또는 null
   */
  async function syncGoldFromServer() {
    if (!_isOnline()) return null;
    const token = await _getAuthToken();
    if (!token) return null;
    try {
      const res = await fetch(`${_serverBase()}/api/gold/balance`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) return null;
      const balance = json?.data?.balance;
      if (typeof balance === 'number') {
        _setLocalGold(balance);
        _updateGoldUI(balance);
        return balance;
      }
      return null;
    } catch (e) {
      console.warn('[gold_client.syncGoldFromServer] error:', e);
      return null;
    }
  }

  /**
   * 골드 → 칩 환전. 묶음 7에서 UI에 연결.
   * @param {number} goldAmount  차감할 골드량
   * @returns {Promise<{ok:boolean, gold?:number, chip?:number, error?:string}>}
   */
  async function exchangeGoldToChip(goldAmount) {
    if (typeof goldAmount !== 'number' || goldAmount <= 0) {
      return { ok: false, error: 'INVALID_AMOUNT' };
    }
    if (!_isOnline()) return { ok: false, error: 'OFFLINE' };

    const token = await _getAuthToken();
    if (!token) return { ok: false, error: 'AUTH_MISSING' };

    const idempotencyKey = _genIdempotencyKey();
    try {
      const res = await fetch(`${_serverBase()}/api/exchange/gold-to-chip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ goldAmount, idempotencyKey })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        return { ok: false, error: json?.error || 'SERVER_ERROR' };
      }
      const gold = json?.data?.gold;
      const chip = json?.data?.chip;
      if (typeof gold === 'number') {
        _setLocalGold(gold);
        _updateGoldUI(gold);
      }
      if (typeof chip === 'number' && typeof localStorage !== 'undefined') {
        localStorage.setItem('userChip', String(chip));
      }
      return { ok: true, gold, chip };
    } catch (e) {
      console.warn('[gold_client.exchangeGoldToChip] error:', e);
      return { ok: false, error: 'NETWORK_ERROR' };
    }
  }

  // ===== M2: Batch 차감 정책 =====
  // 작은~중간 액수 RESTART/셔플을 클라 측 누적 후 게임 종료/나가기 시점에 batch flush.
  // gold_transactions row 폭발 방지 (게임당 50 row → 1 row).
  // 정책 상세: docs/M2_POLICY_PLAN.md

  // 누적 state — reason별 { amount, meta } (모듈 스코프, IIFE 내부)
  const _accumulators = new Map();

  // [ADAPTER] 로딩 오버레이 (create-on-demand) — m2-loading-overlay CSS는 style.css 정의
  function _showLoadingOverlay() {
    let overlay = document.getElementById('goldFlushLoadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'goldFlushLoadingOverlay';
      overlay.className = 'm2-loading-overlay';
      const spinner = document.createElement('div');
      spinner.className = 'm2-loading-spinner';
      overlay.appendChild(spinner);
      const text = document.createElement('div');
      text.className = 'm2-loading-text';
      text.textContent = (typeof window.i18n !== 'undefined' && typeof window.i18n.t === 'function')
        ? window.i18n.t('ui.saving') : '저장 중...';
      overlay.appendChild(text);
      document.body.appendChild(overlay);
    } else {
      const text = overlay.querySelector('.m2-loading-text');
      if (text && typeof window.i18n !== 'undefined' && typeof window.i18n.t === 'function') {
        text.textContent = window.i18n.t('ui.saving');
      }
    }
    overlay.style.display = 'flex';
  }

  function _hideLoadingOverlay() {
    const overlay = document.getElementById('goldFlushLoadingOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  /**
   * [REUSE] 누적 차감 — 즉시 RPC 호출하지 않고 클라 측에 누적.
   * localStorage Optimistic UI는 즉시 반영. 게임 종료/나가기 시점에 flushAllAccumulated 호출.
   * 잔액 부족/오프라인/auth 누락 시 토스트 표시 + false 반환 (caller가 진행 중단 결정).
   * @param {number} amount  양수 정수
   * @param {string} reason  deduct_gold RPC 화이트리스트의 *_batch reason
   * @param {object} [meta]  부가 정보 (sessionId 등)
   * @returns {boolean}  성공 누적 시 true. 실패 시 false (caller는 차감 행위 중단).
   */
  function accumulateSpend(amount, reason, meta) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      console.warn('[gold_client.accumulateSpend] invalid amount:', amount);
      return false;
    }
    if (typeof reason !== 'string' || !reason) {
      console.warn('[gold_client.accumulateSpend] invalid reason:', reason);
      return false;
    }
    if (!_isOnline()) {
      _showToast('toast.offlineNoSpend', '오프라인 상태에서는 골드를 차감할 수 없습니다.');
      return false;
    }
    const before = _getLocalGold();
    if (before < amount) {
      _showToast('toast.goldInsufficient', '골드가 부족합니다.');
      return false;
    }
    const cur = _accumulators.get(reason) || { amount: 0, meta: meta || null };
    cur.amount += amount;
    if (!cur.meta && meta) cur.meta = meta;
    _accumulators.set(reason, cur);
    const next = before - amount;
    _setLocalGold(next);
    _updateGoldUI(next);
    return true;
  }

  /**
   * [REUSE] 누적 batch 한 reason flush — 서버 RPC 호출 + 잔액 정정.
   * 호출 시점에 accumulator에서 즉시 제거 (race condition 방지).
   * 실패 시 손실 인정 (다음 진입 시 syncGoldFromServer가 정정 — 정책 §1-3 어뷰징 허용 라인).
   * @param {string} reason
   * @returns {Promise<boolean>}
   */
  async function flushAccumulated(reason) {
    const acc = _accumulators.get(reason);
    if (!acc || acc.amount === 0) return true;
    _accumulators.delete(reason);

    if (!_isOnline()) {
      console.warn('[gold_client.flushAccumulated] offline, skipping:', reason, acc.amount);
      return false;
    }
    const token = await _getAuthToken();
    if (!token) {
      console.warn('[gold_client.flushAccumulated] no token, skipping:', reason);
      return false;
    }

    const idempotencyKey = _genIdempotencyKey();
    try {
      const res = await fetch(`${_serverBase()}/api/gold/deduct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          amount: acc.amount,
          reason,
          idempotencyKey,
          meta: acc.meta || null
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        console.warn('[gold_client.flushAccumulated] server reject:', json, reason, acc.amount);
        return false;
      }
      const balance = json?.data?.balance;
      if (typeof balance === 'number') {
        _setLocalGold(balance);
        _updateGoldUI(balance);
      }
      return true;
    } catch (e) {
      console.warn('[gold_client.flushAccumulated] error:', reason, acc.amount, e);
      return false;
    }
  }

  /**
   * [REUSE] 모든 누적 batch 한 번에 flush — 게임 종료 또는 나가기 시점에 호출.
   * Promise.allSettled로 일부 실패해도 다른 reason은 진행.
   * @returns {Promise<void>}
   */
  async function flushAllAccumulated() {
    const reasons = Array.from(_accumulators.keys());
    if (reasons.length === 0) return;
    await Promise.allSettled(reasons.map(r => flushAccumulated(r)));
  }

  /**
   * [ADAPTER] <a href> 클릭 인터셉트 헬퍼 — 로딩 오버레이 표시 → flush → navigate.
   * 사용: el.addEventListener('click', (e) => flushAndNavigate(e, href))
   * navigation race condition 방지를 위해 fire-and-forget 금지 — 반드시 await 흐름.
   * @param {Event} event  click event (preventDefault 처리)
   * @param {string} [href]  목적지 URL. 없으면 event.currentTarget.href 또는 closest('a').href.
   * @returns {Promise<void>}
   */
  async function flushAndNavigate(event, href) {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    let target = href || null;
    if (!target && event) {
      const ct = event.currentTarget;
      if (ct && typeof ct.href === 'string') target = ct.href;
      if (!target && event.target && typeof event.target.closest === 'function') {
        const a = event.target.closest('a');
        if (a && typeof a.href === 'string') target = a.href;
      }
    }
    if (!target) {
      console.warn('[gold_client.flushAndNavigate] no href');
      return;
    }
    _showLoadingOverlay();
    try {
      await flushAllAccumulated();
    } catch (e) {
      console.warn('[gold_client.flushAndNavigate] flush error:', e);
    } finally {
      _hideLoadingOverlay();
      window.location.href = target;
    }
  }

  /**
   * [ADAPTER] data-flush-exit 속성이 박힌 모든 요소에 click → flushAndNavigate 자동 부착.
   * 정적 HTML 마크업: <a href="..." data-flush-exit>
   * 동적 모달 마크업: innerHTML 갱신 후 window.initFlushExitHandlers() 호출.
   * 중복 부착 방지 (요소당 1회).
   */
  function _initFlushExitHandlers(root) {
    const scope = (root && typeof root.querySelectorAll === 'function') ? root : document;
    const els = scope.querySelectorAll('[data-flush-exit]');
    els.forEach(el => {
      if (el._m2FlushAttached) return;
      el._m2FlushAttached = true;
      el.addEventListener('click', flushAndNavigate);
    });
  }

  // 자동 초기화 (정적 HTML 마크업용)
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => _initFlushExitHandlers());
    } else {
      _initFlushExitHandlers();
    }
  }

  // 전역 노출
  window.spendGold = spendGold;
  window.awardGold = awardGold;
  window.syncGoldFromServer = syncGoldFromServer;
  window.exchangeGoldToChip = exchangeGoldToChip;
  // M2: batch deduction policy
  window.accumulateSpend = accumulateSpend;
  window.flushAccumulated = flushAccumulated;
  window.flushAllAccumulated = flushAllAccumulated;
  window.flushAndNavigate = flushAndNavigate;
  window.initFlushExitHandlers = _initFlushExitHandlers;

  // 디버그 핸들 (검증용)
  window._goldClient = {
    spendGold, awardGold, syncGoldFromServer, exchangeGoldToChip,
    accumulateSpend, flushAccumulated, flushAllAccumulated, flushAndNavigate,
    initFlushExitHandlers: _initFlushExitHandlers,
    _accumulators,  // M2 누적 state 디버그
    version: '2A-new-M2'
  };
})();

// === Expo 전환 체크리스트 ===
// [ADAPTER] localStorage → AsyncStorage 일괄 치환
// [ADAPTER] window.* 전역 노출 → import/export 모듈 형식
// [ADAPTER] RENDER_SERVER → process.env.EXPO_PUBLIC_RENDER_SERVER
// [REWRITE] _showLoadingOverlay/_hideLoadingOverlay → React 컴포넌트 + state
// [REWRITE] flushAndNavigate → React Navigation hook + 동일 flush 로직
// [REUSE]   spendGold/awardGold/syncGoldFromServer/exchangeGoldToChip 로직 그대로
// [REUSE]   accumulateSpend/flushAccumulated/flushAllAccumulated 로직 그대로 (Map state도 그대로)
