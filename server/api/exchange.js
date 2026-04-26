// server/api/exchange.js — Phase 2A-new
// 골드→칩 환전 API

const supabase = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function registerExchangeRoutes(app, requireAuth) {

  // ============================================================
  // POST /api/exchange/gold-to-chip
  // ============================================================
  app.post('/api/exchange/gold-to-chip', requireAuth, async (req, res) => {
    const userId = req.userId;
    const { chipAmount, idempotencyKey } = req.body || {};

    if (!Number.isInteger(chipAmount) || chipAmount < 10 || chipAmount > 100) {
      return res.status(400).json({ ok: false, error: 'INVALID_CHIP_AMOUNT', message: 'Chip amount must be 10~100' });
    }
    if (!idempotencyKey || !UUID_REGEX.test(idempotencyKey)) {
      return res.status(400).json({ ok: false, error: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency key must be UUID' });
    }

    try {
      const { data, error } = await supabase.rpc('exchange_gold_to_chip', {
        p_player_id: userId,
        p_chip_amount: chipAmount,
        p_idempotency_key: idempotencyKey
      });

      if (error) {
        if (error.code === 'P0001') return res.status(400).json({ ok: false, error: 'INVALID_REQUEST', message: error.message });
        if (error.code === 'P0002') return res.status(404).json({ ok: false, error: 'PLAYER_NOT_FOUND', message: error.message });
        if (error.code === 'P0003') return res.status(409).json({ ok: false, error: 'INSUFFICIENT_GOLD', message: error.message });
        if (error.code === 'P0004') return res.status(409).json({ ok: false, error: 'DAILY_LIMIT_REACHED', message: error.message });
        console.error('[/api/exchange/gold-to-chip] RPC error:', error);
        return res.status(500).json({ ok: false, error: 'RPC_ERROR', message: error.message });
      }

      console.log(`[/api/exchange/gold-to-chip] success: userId=${req.userId}, chipAmount=${chipAmount}, goldDeducted=${data.gold_spent}, chipReceived=${data.chip_received}, duplicated=${data.duplicated}`);
      return res.json({
        ok: true,
        data: {
          goldBalance: data.gold_balance,
          chipBalance: data.chip_balance,
          goldSpent: data.gold_spent,
          chipReceived: data.chip_received,
          duplicated: data.duplicated
        }
      });
    } catch (e) {
      console.error('[/api/exchange/gold-to-chip] error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: e.message });
    }
  });

  // ============================================================
  // GET /api/exchange/can-today
  // ============================================================
  app.get('/api/exchange/can-today', requireAuth, async (req, res) => {
    const userId = req.userId;

    try {
      const { data, error } = await supabase.rpc('can_exchange_today', {
        p_player_id: userId
      });

      if (error) {
        console.error('[/api/exchange/can-today] error:', error);
        return res.status(500).json({ ok: false, error: 'RPC_ERROR', message: error.message });
      }

      return res.json({ ok: true, data: { canExchange: data } });
    } catch (e) {
      console.error('[/api/exchange/can-today] error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: e.message });
    }
  });
}

module.exports = { registerExchangeRoutes };
