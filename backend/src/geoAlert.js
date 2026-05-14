'use strict';

const express = require('express');
const db = require('./supabase');
const { sendMessage } = require('./whatsapp');

const router = express.Router();

// POST /geo-alert
// Called by the app when user has been near a supermarket for 4+ minutes
router.post('/', async (req, res) => {
  const { userId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    // Rate limit: max 1 alert per 2 hours (DB-level)
    const canSend = await db.canSendGeoAlert(userId);
    if (!canSend) {
      return res.json({ skipped: true, reason: 'cooldown' });
    }

    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'user not found' });

    const list = await db.getBoodschappenlijst(userId);
    if (!list) return res.json({ skipped: true, reason: 'no grocery list' });

    const items = await db.getListItems(list.id);
    const open = items.filter(i => !i.checked);

    if (open.length === 0) {
      return res.json({ skipped: true, reason: 'list empty' });
    }

    // Claim the slot atomically before sending
    const claimed = await db.markGeoAlertSent(userId);
    if (!claimed) return res.json({ skipped: true, reason: 'race' });

    const itemLines = open.map(i => `• ${i.text}`).join('\n');
    const msg = `🛒 *Je bent bij de supermarkt!*\n\nOpen items op "${list.name}":\n${itemLines}`;

    await sendMessage(user.whatsapp_number, msg);
    console.log(`[GeoAlert] Sent to ${user.whatsapp_number} — ${open.length} items`);

    res.json({ ok: true, items: open.length });
  } catch (err) {
    console.error('[GeoAlert] Error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

module.exports = router;
