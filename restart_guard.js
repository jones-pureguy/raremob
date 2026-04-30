// restart_guard.js
// [REUSE] 리스타트 응답 대기 가드 — 베이직/히든/매니악/챌린지 4개 모드 공용
//
// 베이직 모드(script.js Phase 1-11.1) 패턴을 추출 — 응답 대기 중
// 연타 차단(잠금) + 화면 커버 오버레이 + 버튼 비활성을 한 번에 처리.
//
// API:
//   RestartGuard.begin(btnId?)  진입. 이미 진행 중이면 false 반환.
//   RestartGuard.end(btnId?)    종료. try/finally의 finally에서 호출.
//   RestartGuard.busy()         진행 중 여부.
//
// 의존: style.css의 .restart-overlay / .restart-spinner (이미 정의됨).
// DOM: #restartOverlay 는 최초 begin 호출 시 자동 부트스트랩.

(function () {
  'use strict';

  function _ensureOverlay() {
    let overlay = document.getElementById('restartOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'restartOverlay';
      overlay.className = 'restart-overlay';
      overlay.innerHTML = '<div class="restart-spinner"></div>';
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  window.RestartGuard = {
    begin: function (btnId) {
      if (window._resetInProgress) return false;
      window._resetInProgress = true;
      const overlay = _ensureOverlay();
      overlay.classList.add('active');
      const btn = document.getElementById(btnId || 'restartBtn');
      if (btn) btn.style.pointerEvents = 'none';
      return true;
    },
    end: function (btnId) {
      const overlay = document.getElementById('restartOverlay');
      if (overlay) overlay.classList.remove('active');
      const btn = document.getElementById(btnId || 'restartBtn');
      if (btn) btn.style.pointerEvents = '';
      window._resetInProgress = false;
    },
    busy: function () { return !!window._resetInProgress; },
  };
})();

// =============================================
// EXPO 전환 체크리스트
// REUSE   : RestartGuard.busy (순수 상태 조회)
// ADAPTER : RestartGuard.begin/end (DOM/CSS 의존 — RN에선 모달 컴포넌트로 교체)
// REWRITE : _ensureOverlay (DOM 직접 조작)
// =============================================
