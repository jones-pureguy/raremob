// server/api/player.js — Phase 2A-new 묶음 8-0
// 플레이어 등록/갱신 API (register_player RPC 경유)
// 묶음 8-4 RLS 잠금 전 선행 — id.html의 players upsert를 권위화

const supabase = require('../supabase');

function registerPlayerRoutes(app, requireAuth) {

  // ============================================================
  // POST /api/player/register
  // body: { username, locale? }
  // ============================================================
  app.post('/api/player/register', requireAuth, async (req, res) => {
    const userId = req.userId;
    const { username, locale } = req.body || {};

    // 입력 검증 (RPC 안에서도 길이 체크하지만 빠른 reject)
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ ok: false, error: 'INVALID_USERNAME', message: 'username required' });
    }
    if (username.length < 2 || username.length > 12) {
      return res.status(400).json({ ok: false, error: 'USERNAME_LENGTH', message: 'username must be 2-12 chars' });
    }
    if (locale != null && typeof locale !== 'string') {
      return res.status(400).json({ ok: false, error: 'INVALID_LOCALE', message: 'locale must be string' });
    }

    try {
      const { data, error } = await supabase.rpc('register_player', {
        p_user_id: userId,
        p_username: username,
        p_locale: locale || null,
      });

      if (error) {
        const msg = String(error.message || '');
        if (msg.includes('already taken')) {
          return res.status(409).json({ ok: false, error: 'USERNAME_TAKEN', message: msg });
        }
        if (msg.includes('2-12 characters')) {
          return res.status(400).json({ ok: false, error: 'USERNAME_LENGTH', message: msg });
        }
        console.error('[/api/player/register] RPC error:', error);
        return res.status(500).json({ ok: false, error: 'RPC_ERROR', message: msg });
      }

      console.log(`[/api/player/register] success: userId=${req.userId}, username=${username}`);
      return res.json({ ok: true, data });
    } catch (e) {
      console.error('[/api/player/register] error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: e.message });
    }
  });
}

module.exports = { registerPlayerRoutes };
