// ─── Supabase Anonymous Auth ───
// Shared auth initialization for all pages

// =============================================
// [ADAPTER] 플랫폼 어댑터 — Expo 전환 시 교체
// =============================================

// [ADAPTER] 익명 인증 초기화 — Expo 전환 시 Supabase React Native SDK로 교체
async function initAuth() {
  try {
    const { data: { session } } = await sb.auth.getSession();

    if (session) {
      localStorage.setItem('poker_player_id', session.user.id);
      return session.user.id;
    }

    // No session → sign in anonymously
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
      console.error('Anonymous auth failed:', error);
      return localStorage.getItem('poker_player_id') || null;
    }
    const uid = data.session.user.id;
    localStorage.setItem('poker_player_id', uid);
    return uid;
  } catch (e) {
    console.error('Auth init error:', e);
    return localStorage.getItem('poker_player_id') || null;
  }
}

// =============================================
// [LOGIC] 게임 로직 — Expo 전환 시 재활용
// =============================================

// [REUSE] DB 요청 재시도 헬퍼 (최대 2회 재시도, 1초 간격)
async function sbRetry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await fn();
      if (result.error && i < retries) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return result;
    } catch(e) {
      if (i < retries) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return { data: null, error: e };
    }
  }
  return { data: null, error: 'max retries' };
}

// [ADAPTER] 유저 등록 상태 체크 — 미등록 시 id.html로 리다이렉트
function requireRegistration() {
  const username = localStorage.getItem('poker_username');
  if (!username) {
    window.location.href = 'id.html?from=guard';
    return false;
  }
  return true;
}

// [ADAPTER] 인증 상태 변경 리스너 — Expo 전환 시 Supabase React Native onAuthStateChange
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    localStorage.setItem('poker_player_id', session.user.id);
  }
});

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 1개 함수 (변경 불필요)
//   - sbRetry
// ADAPTER : 2개 함수/블록 (내부 구현 교체 필요)
//   - initAuth → Supabase React Native SDK
//   - onAuthStateChange 리스너 → Supabase React Native SDK
//   - localStorage → AsyncStorage
// REWRITE : 0개
// =============================================
