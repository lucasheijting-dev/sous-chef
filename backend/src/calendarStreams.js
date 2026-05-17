'use strict';

const express = require('express');
const db      = require('./supabase');
const caldav  = require('./caldav');

const router = express.Router();

router.get('/:userId', async (req, res) => {
  try {
    const streams = await db.getCalendarStreams(req.params.userId);
    res.json(streams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:userId', async (req, res) => {
  const { userId } = req.params;
  const { name, emoji, color, caldav_id, claude_key, sort_order } = req.body;

  if (!name || !caldav_id || !claude_key) {
    return res.status(400).json({ error: 'name, caldav_id and claude_key are required' });
  }

  try {
    const stream = await db.createCalendarStream(userId, {
      name,
      emoji: emoji ?? '📅',
      color: color ?? '#4A90D8',
      caldav_id,
      claude_key,
      sort_order: sort_order ?? 0,
    });

    if (caldav.isConfigured()) {
      const creds = await db.getCalDAVCredentials(userId);
      if (creds) {
        await caldav.createUserCalendar(creds.username, creds.password, caldav_id, name, color ?? '#4A90D8').catch(() => {});
      }
    }

    res.json(stream);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:userId/:streamId', async (req, res) => {
  const { userId, streamId } = req.params;
  const { name, emoji, color } = req.body;

  const updates = {};
  if (name  !== undefined) updates.name  = name;
  if (emoji !== undefined) updates.emoji = emoji;
  if (color !== undefined) updates.color = color;

  try {
    const updated = await db.updateCalendarStream(streamId, updates);

    if (color !== undefined && caldav.isConfigured()) {
      const creds = await db.getCalDAVCredentials(userId);
      if (creds) {
        await caldav.setCalendarColor(creds.username, creds.password, updated.caldav_id, color).catch(() => {});
      }
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:userId/:streamId', async (req, res) => {
  try {
    await db.deleteCalendarStream(req.params.streamId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
