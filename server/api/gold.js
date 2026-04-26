// server/api/gold.js — Phase 2A-new
// 골드 차감/적립/조회 API
// 모든 라우트는 requireAuth 적용. body의 player_id는 무시 (req.userId 사용).

const supabase = require('../supabase');

// UUID v4 형식 검증 (client 측은 randomUUID 사용)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function registerGoldRoutes(app, requireAuth) {

  // ============================================================
  // POST /api/gold/deduct
  // ============================================================
  app.post('/api/gold/deduct', requireAuth, async (req, res) => {
    const userId = req.userId;
    const { amount, reason, idempotencyKey, meta } = req.body || {};

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'INVALID_AMOUNT', message: 'Amount must be positive integer' });
    }
    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({ ok: false, error: 'INVALID_REASON', message: 'Reason required' });
    }
    if (!idempotencyKey || !UUID_REGEX.test(idempotencyKey)) {
      return res.status(400).json({ ok: false, error: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency key must be UUID' });
    }

    try {
      const { data, error } = await supabase.rpc('deduct_gold', {
        p_player_id: userId,
        p_amount: amount,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
        p_meta: meta || null
      });

      if (error) {
        if (error.code === 'P0001') return res.status(400).json({ ok: false, error: 'INVALID_REQUEST', message: error.message });
        if (error.code === 'P0002') return res.status(404).json({ ok: false, error: 'PLAYER_NOT_FOUND', message: error.message });
        if (error.code === 'P0003') return res.status(409).json({ ok: false, error: 'INSUFFICIENT_GOLD', message: error.message });
        console.error('[/api/gold/deduct] RPC error:', error);
        return res.status(500).json({ ok: false, error: 'RPC_ERROR', message: error.message });
      }

      console.log(`[/api/gold/deduct] success: userId=${req.userId}, amount=${amount}, reason=${reason}, balance=${data.balance}, duplicated=${data.duplicated}`);
      return res.json({
        ok: true,
        data: {
          balance: data.balance,
          transactionId: data.transaction_id,
          duplicated: data.duplicated
        }
      });
    } catch (e) {
      console.error('[/api/gold/deduct] error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: e.message });
    }
  });

  // ============================================================
  // POST /api/gold/grant
  // ============================================================
  app.post('/api/gold/grant', requireAuth, async (req, res) => {
    const userId = req.userId;
    const { amount, reason, idempotencyKey, meta } = req.body || {};

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'INVALID_AMOUNT', message: 'Amount must be positive integer' });
    }
    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({ ok: false, error: 'INVALID_REASON', message: 'Reason required' });
    }
    if (!idempotencyKey || !UUID_REGEX.test(idempotencyKey)) {
      return res.status(400).json({ ok: false, error: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency key must be UUID' });
    }

    try {
      const { data, error } = await supabase.rpc('grant_gold', {
        p_player_id: userId,
        p_amount: amount,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
        p_meta: meta || null
      });

      if (error) {
        if (error.code === 'P0001') return res.status(400).json({ ok: false, error: 'INVALID_REQUEST', message: error.message });
        if (error.code === 'P0002') return res.status(404).json({ ok: false, error: 'PLAYER_NOT_FOUND', message: error.message });
        console.error('[/api/gold/grant] RPC error:', error);
        return res.status(500).json({ ok: false, error: 'RPC_ERROR', message: error.message });
      }

      console.log(`[/api/gold/grant] success: userId=${req.userId}, amount=${amount}, reason=${reason}, balance=${data.balance}, duplicated=${data.duplicated}`);
      return res.json({
        ok: true,
        data: {
          balance: data.balance,
          transactionId: data.transaction_id,
          duplicated: data.duplicated
        }
      });
    } catch (e) {
      console.error('[/api/gold/grant] error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: e.message });
    }
  });

  // ============================================================
  // GET /api/gold/balance
  // ============================================================
  app.get('/api/gold/balance', requireAuth, async (req, res) => {
    const userId = req.userId;

    try {
      const { data, error } = await supabase
        .from('players')
        .select('gold')
        .eq('id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return res.status(404).json({ ok: false, error: 'PLAYER_NOT_FOUND', message: 'Player not found' });
        console.error('[/api/gold/balance] error:', error);
        return res.status(500).json({ ok: false, error: 'DB_ERROR', message: error.message });
      }

      return res.json({ ok: true, data: { balance: data.gold } });
    } catch (e) {
      console.error('[/api/gold/balance] error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: e.message });
    }
  });
}

module.exports = { registerGoldRoutes };
