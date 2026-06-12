'use strict';

const express = require('express');
const db      = require('./supabase');
const { syncUserCalendar } = require('./calendarSyncCore');

const router = express.Router();

// POST /calendar-sync/:userId — on-demand bi-directional sync
// Called by the app on tab focus or pull-to-refresh
router.post('/:userId', async (req, res) => {
  try {
    const user = await db.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const calInfo  = await db.getCalendarProvider(req.params.userId);
    const provider = calInfo?.calendar_provider;

    if (!provider || provider === 'none') {
      return res.json({ ok: true, skipped: true, reason: 'no_calendar' });
    }
    if (provider === 'iphone' && !calInfo.caldav_username) {
      return res.json({ ok: true, skipped: true, reason: 'no_caldav' });
    }
    if (provider === 'google' && !calInfo.google_refresh_token) {
      return res.json({ ok: true, skipped: true, reason: 'no_google_token' });
    }
    if (provider === 'outlook' && !calInfo.ms_refresh_token) {
      return res.json({ ok: true, skipped: true, reason: 'no_ms_token' });
    }

    const result = await syncUserCalendar({ id: user.id, ...calInfo });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[CalendarSync] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
