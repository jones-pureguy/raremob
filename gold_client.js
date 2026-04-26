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
    // header.js의 갱신 함수가 있으면 호출, 없으면 noop
    try {
      if (typeof window.updateGoldDisplay === 'function') {
        window.updateGoldDisplay(value);
        return;
      }
      // fallback: 쿠키컷 #gold-display 등
      const el = document.getElementById('gold-display') || document.querySelector('[data-gold-display]');
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
      _showToast('toast.insufficientGold', '골드가 부족합니다.');
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

  // 전역 노출
  window.spendGold = spendGold;
  window.awardGold = awardGold;
  window.syncGoldFromServer = syncGoldFromServer;
  window.exchangeGoldToChip = exchangeGoldToChip;

  // 디버그 핸들 (검증용)
  window._goldClient = { spendGold, awardGold, syncGoldFromServer, exchangeGoldToChip, version: '2A-new-bundle3' };
})();

// === Expo 전환 체크리스트 ===
// [ADAPTER] localStorage → AsyncStorage 일괄 치환
// [ADAPTER] window.* 전역 노출 → import/export 모듈 형식
// [ADAPTER] RENDER_SERVER → process.env.EXPO_PUBLIC_RENDER_SERVER
// [REUSE]   spendGold/awardGold/syncGoldFromServer/exchangeGoldToChip 로직 그대로
