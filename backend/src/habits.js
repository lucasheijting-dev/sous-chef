'use strict';

const express = require('express');
const db      = require('./supabase');

const router = express.Router();

// DELETE /habits/:habitId?user_id=xxx
router.delete('/:habitId', async (req, res) => {
  try {
    const { habitId } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.deleteHabit(habitId, user_id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Habits] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /habits/logs/:logId?user_id=xxx
router.delete('/logs/:logId', async (req, res) => {
  try {
    const { logId } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.deleteHabitLog(logId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Habits] Log delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
