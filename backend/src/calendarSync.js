'use strict';

const express = require('express');
const caldav  = require('./caldav');
const db      = require('./supabase');
const { syncUserCalendar } = require('./calendarSyncCore');

const router = express.Router();

// POST /calendar-sync/:userId — on-demand bi-directional sync
// Called by the app on tab focus or pull-to-refresh
router.post('/:userId', async (req, res) => {
  if (!caldav.isConfigured()) return res.json({ ok: true, skipped: true });

  try {
    const user = await db.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const creds = await db.getCalDAVCredentials(req.params.userId);
    if (!creds) return res.json({ ok: true, skipped: true, reason: 'no_caldav' });

    const result = await syncUserCalendar({ id: user.id, ...creds });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[CalendarSync] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
