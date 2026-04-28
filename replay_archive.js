// replay_archive.js
// [ADAPTER] Phase 2 Maniac 단계 8+ Step 3
// 박제 슬롯 통합 헬퍼 — basic + maniac 독립 슬롯 (단일 키 + 객체)
//
// 슬롯 구조:
//   {
//     basic:  { dragLog?, seed?, score, bestHand, gameTime, startedAt, savedAt, ... } | null,
//     maniac: { dragLog,  seed,  score, bestHand, gameTime, startedAt, savedAt,
//               handCount, maxComboSize, timeRemaining, ... } | null
//   }
//
// 옛 키 'poker_last_replay'는 1회 마이그레이션 (DOMContentLoaded 자동 실행).

(function () {
  'use strict';

  const REPLAY_ARCHIVE_KEY = 'poker_replay_archive';
  const LEGACY_REPLAY_KEY = 'poker_last_replay';

  // [REUSE] 옛 키 → 새 키 basic 슬롯 1회 마이그레이션
  function migrateLegacyReplayKey() {
    try {
      const legacy = localStorage.getItem(LEGACY_REPLAY_KEY);
      if (!legacy) return;

      const archive = loadReplayArchive();
      if (archive.basic) {
        // 신규 슬롯에 이미 베이직 박제가 있음 → 옛 키만 정리
        localStorage.removeItem(LEGACY_REPLAY_KEY);
        console.log('[replay_archive] legacy key already migrated, removing legacy.');
        return;
      }

      const parsed = JSON.parse(legacy);
      archive.basic = { ...parsed, mode: 'basic', migratedAt: Date.now() };
      saveReplayArchive(archive);
      localStorage.removeItem(LEGACY_REPLAY_KEY);
      console.log('[replay_archive] migrated poker_last_replay → poker_replay_archive.basic');
    } catch (e) {
      console.warn('[replay_archive] migration failed:', e);
      // 실패 시 옛 키 보존 (다음 진입 시 재시도)
    }
  }

  // [REUSE] 슬롯 전체 로드 (정합성 보장)
  function loadReplayArchive() {
    try {
      const raw = localStorage.getItem(REPLAY_ARCHIVE_KEY);
      if (!raw) return { basic: null, maniac: null };
      const parsed = JSON.parse(raw);
      return {
        basic:  parsed.basic  || null,
        maniac: parsed.maniac || null,
      };
    } catch (e) {
      console.warn('[replay_archive] load failed:', e);
      return { basic: null, maniac: null };
    }
  }

  // [REUSE] 슬롯 전체 저장
  function saveReplayArchive(archive) {
    try {
      localStorage.setItem(REPLAY_ARCHIVE_KEY, JSON.stringify(archive));
    } catch (e) {
      console.error('[replay_archive] save failed:', e);
    }
  }

  // [REUSE] 슬롯 단위 박제 (mode: 'basic' | 'maniac')
  function saveReplayToSlot(mode, replayData) {
    if (mode !== 'basic' && mode !== 'maniac') {
      console.error('[replay_archive] invalid mode:', mode);
      return false;
    }
    const archive = loadReplayArchive();
    archive[mode] = { ...replayData, mode, savedAt: Date.now() };
    saveReplayArchive(archive);
    return true;
  }

  // [REUSE] 슬롯 단위 로드
  function loadReplayFromSlot(mode) {
    const archive = loadReplayArchive();
    return archive[mode] || null;
  }

  // [REUSE] 슬롯 단위 삭제
  function deleteReplaySlot(mode) {
    const archive = loadReplayArchive();
    archive[mode] = null;
    saveReplayArchive(archive);
  }

  // [REUSE] 박제된 슬롯 목록
  function listAvailableSlots() {
    const archive = loadReplayArchive();
    const slots = [];
    if (archive.basic)  slots.push('basic');
    if (archive.maniac) slots.push('maniac');
    return slots;
  }

  // 전역 노출
  window.ReplayArchive = {
    migrate: migrateLegacyReplayKey,
    load: loadReplayArchive,
    save: saveReplayArchive,
    saveSlot: saveReplayToSlot,
    loadSlot: loadReplayFromSlot,
    deleteSlot: deleteReplaySlot,
    listSlots: listAvailableSlots,
    KEY: REPLAY_ARCHIVE_KEY,
    LEGACY_KEY: LEGACY_REPLAY_KEY,
  };

  // 자동 마이그레이션 (DOMContentLoaded 시점)
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        try { migrateLegacyReplayKey(); } catch (_) {}
      });
    } else {
      try { migrateLegacyReplayKey(); } catch (_) {}
    }
  }
})();

// =============================================
// EXPO 전환 체크리스트
// REUSE   : migrateLegacyReplayKey, loadReplayArchive, saveReplayArchive,
//           saveReplayToSlot, loadReplayFromSlot, deleteReplaySlot, listAvailableSlots
// ADAPTER : localStorage → AsyncStorage
//           window.ReplayArchive → import/export
// REWRITE : DOMContentLoaded 자동 init → React useEffect 또는 앱 시작 hook
// =============================================
