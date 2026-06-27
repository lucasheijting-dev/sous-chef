'use strict';

const express = require('express');
const db = require('./supabase');

const router = express.Router();

const LUCAS_PHONE = '31630491259';

// Fixed monthly costs in EUR
const FIXED = [
  { label: 'Render (backend server)', eur: 7.00 },
  { label: 'Hetzner (CalDAV server)', eur: 5.43 },
  { label: 'Supabase (database)', eur: 0 },
  { label: 'EAS (Expo OTA builds)', eur: 0 },
];

// Variable cost rates per message
// claude-sonnet-4-6: ~1500 input + 400 output tokens avg
// Input:  1500 × $3/MTok  = $0.0045 ≈ €0.0042
// Output: 400  × $15/MTok = $0.0060 ≈ €0.0056  → total ~€0.0098
const EUR_PER_MSG_AI = 0.010;
// WhatsApp NL utility conversations ~€0.02/window, avg 4 messages/window → €0.005/msg
const EUR_PER_MSG_WHATSAPP = 0.005;

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

    const aiCost  = +(totalMessages * EUR_PER_MSG_AI).toFixed(2);
    const waCost  = +(totalMessages * EUR_PER_MSG_WHATSAPP).toFixed(2);
    const fixedTotal = FIXED.reduce((s, c) => s + c.eur, 0);
    const estMonthly = +(fixedTotal + aiCost + waCost).toFixed(2);

    // Full cost breakdown with formula labels for variable items
    const cost_items = [
      ...FIXED,
      {
        label: `Claude AI (${totalMessages} berichten × €${EUR_PER_MSG_AI.toFixed(3)})`,
        eur: aiCost,
        variable: true,
      },
      {
        label: `WhatsApp NL (${totalMessages} berichten × €${EUR_PER_MSG_WHATSAPP.toFixed(3)})`,
        eur: waCost,
        variable: true,
      },
    ];

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
      total_users:     totalUsers,
      active_users:    activeUsers,
      total_messages:  totalMessages,
      est_monthly_eur: estMonthly,
      cost_items,
      users:           usersOut,
    });
  } catch (err) {
    console.error('[Admin] stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
