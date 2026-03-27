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
      return null;
    }
    const uid = data.session.user.id;
    localStorage.setItem('poker_player_id', uid);
    return uid;
  } catch (e) {
    console.error('Auth init error:', e);
    return localStorage.getItem('poker_player_id') || null;
  }
}

// Listen for auth state changes
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    localStorage.setItem('poker_player_id', session.user.id);
  }
});
