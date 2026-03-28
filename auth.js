// ─── Supabase Anonymous Auth ───
// Shared auth initialization for all pages

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

// DB 요청 재시도 헬퍼 (최대 2회 재시도, 1초 간격)
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

// Listen for auth state changes
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    localStorage.setItem('poker_player_id', session.user.id);
  }
});
