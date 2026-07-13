'use strict';

const express = require('express');
const db = require('./supabase');

const router = express.Router();

// GET /user/notif-prefs?user_id=xxx
router.get('/notif-prefs', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    const prefs = await db.getNotifPrefs(user_id);
    res.json(prefs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /user/notif-prefs
router.put('/notif-prefs', async (req, res) => {
  try {
    const { user_id, prefs } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.saveNotifPrefs(user_id, prefs);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /user/profile?user_id=xxx — body: { display_name }
router.patch('/profile', async (req, res) => {
  try {
    const { user_id } = req.query;
    const { display_name } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.updateUserDisplayName(user_id, display_name?.trim() || null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
