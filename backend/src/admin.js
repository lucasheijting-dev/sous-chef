'use strict';

const express = require('express');
const db = require('./supabase');

const router = express.Router();

const LUCAS_PHONE = '31630491259';

// Fixed monthly costs in EUR
const FIXED_COSTS = [
  { label: 'Render (backend)', eur: 7.00 },
  { label: 'Hetzner (CalDAV)', eur: 5.43 },
  { label: 'Supabase', eur: 0 },
  { label: 'EAS (Expo)', eur: 0 },
];

// Variable cost estimates per message
const EUR_PER_MSG_ANTHROPIC = 0.0022; // claude-sonnet avg ~500 tokens in+out
const EUR_PER_MSG_WHATSAPP  = 0.005;  // per-message approx (NL conversation window)

// GET /admin/stats?userId=<lucas-user-id>
router.get('/stats', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const me = await db.getUserById(userId);
    if (!me || me.whatsapp_number !== LUCAS_PHONE) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const users = await db.getAllUsersAdmin();

    const totalUsers    = users.length;
    const activeUsers   = users.filter(u => (u.message_count ?? 0) > 0).length;
    const totalMessages = users.reduce((s, u) => s + (u.message_count ?? 0), 0);

    const fixedTotal = FIXED_COSTS.reduce((s, c) => s + c.eur, 0);
    const varTotal   = totalMessages * (EUR_PER_MSG_ANTHROPIC + EUR_PER_MSG_WHATSAPP);
    const estMonthly = +(fixedTotal + varTotal).toFixed(2);

    const usersOut = users.map(u => ({
      id:           u.id,
      phone:        u.whatsapp_number ? `+${u.whatsapp_number}` : null,
      name:         u.user_context ? (u.user_context.match(/Naam:\s*([^\n]+)/)?.[1]?.trim() ?? null) : null,
      messages:     u.message_count ?? 0,
      active:       (u.message_count ?? 0) > 0,
      onboarded:    u.onboarding_completed ?? false,
      calendar:     u.calendar_provider ?? null,
      joined:       u.created_at,
    }));

    res.json({
      total_users:    totalUsers,
      active_users:   activeUsers,
      total_messages: totalMessages,
      est_monthly_eur: estMonthly,
      fixed_costs:    FIXED_COSTS,
      users:          usersOut,
    });
  } catch (err) {
    console.error('[Admin] stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
