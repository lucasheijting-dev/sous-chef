'use strict';

const express = require('express');
const db      = require('./supabase');
const caldav  = require('./caldav');

const router = express.Router();

// POST /events?user_id=xxx
router.post('/', async (req, res) => {
  try {
    const { user_id } = req.query;
    const { title, date, time, calendar_stream } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (!title?.trim() || !date) return res.status(400).json({ error: 'Missing title or date' });
    const event = await db.createEvent(user_id, {
      title: title.trim(),
      date,
      time: time ?? null,
      calendarStream: calendar_stream ?? null,
    });
    res.json(event);
  } catch (err) {
    console.error('[Events] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /events/:eventId?user_id=xxx — update title, date, time, calendar_stream
router.patch('/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    const { title, date, time, calendar_stream } = req.body;
    await db.patchEvent(user_id, eventId, { title, date, time, calendar_stream });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Events] Patch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /events/:eventId?user_id=xxx
// Deletes from Supabase and, if the event has a caldav_uid, from CalDAV too.
router.delete('/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

    const event = await db.getEventById(user_id, eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (event.caldav_uid && event.calendar_stream) {
      const creds = await db.getCalDAVCredentials(user_id);
      if (creds) {
        await caldav.deleteEvent(creds.username, creds.password, event.calendar_stream, event.caldav_uid)
          .catch(err => console.warn('[Events] CalDAV delete failed (ignoring):', err.message));
      }
    }

    await db.deleteEventById(user_id, eventId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Events] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
