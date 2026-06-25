'use strict';

const express = require('express');
const db      = require('./supabase');

const router = express.Router();

// POST /lists?user_id=xxx
router.post('/', async (req, res) => {
  try {
    const { user_id } = req.query;
    const { name, emoji } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (!name?.trim()) return res.status(400).json({ error: 'Missing name' });
    const list = await db.createList(user_id, name.trim(), emoji || '📝');
    res.json(list);
  } catch (err) {
    console.error('[Lists] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /lists/:listId?user_id=xxx
router.delete('/:listId', async (req, res) => {
  try {
    const { listId } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.deleteList(listId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Lists] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /lists/items/:itemId?user_id=xxx
router.delete('/items/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.deleteListItem(itemId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Lists] Item delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
