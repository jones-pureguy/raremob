// [REUSE] JWT 인증 미들웨어 — 모든 쓰기 API에 적용
// Expo 전환 시: 로직 동일, supabase 클라이언트만 환경 차이 흡수
const supabase = require('../supabase');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: 'AUTH_MISSING',
        message: 'Authorization header required'
      });
    }

    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        ok: false,
        error: 'AUTH_INVALID',
        message: 'Invalid or expired token'
      });
    }

    req.userId = user.id;
    next();
  } catch (e) {
    console.error('[requireAuth] error:', e);
    return res.status(500).json({
      ok: false,
      error: 'AUTH_ERROR',
      message: 'Authentication failed'
    });
  }
}

module.exports = requireAuth;
