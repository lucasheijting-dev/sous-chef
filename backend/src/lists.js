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

// DELETE /lists/recipes/:recipeId?user_id=xxx — delete a recipe group (items only linked to this recipe get deleted; shared items get unlinked)
router.delete('/recipes/:recipeId', async (req, res) => {
  try {
    const { recipeId } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.deleteRecipeGroup(recipeId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Lists] Recipe delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /lists/:listId/emoji?user_id=xxx — body: { emoji }
router.patch('/:listId/emoji', async (req, res) => {
  try {
    const { listId } = req.params;
    const { user_id } = req.query;
    const { emoji } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (!emoji) return res.status(400).json({ error: 'Missing emoji' });
    await db.updateListEmoji(listId, emoji);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Lists] Emoji update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /lists/items/reorder?user_id=xxx — body: [{id, sort_order}]
router.patch('/items/reorder', async (req, res) => {
  try {
    const { user_id } = req.query;
    const items = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Missing items array' });
    await db.reorderListItems(items);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Lists] Reorder error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /lists/items/:itemId/image?user_id=xxx
router.post('/items/:itemId/image', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { user_id } = req.query;
    const { base64, mime_type } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (!base64)  return res.status(400).json({ error: 'Missing base64' });
    const imageUrl = await db.uploadUserImage(user_id, base64, mime_type || 'image/jpeg');
    await db.updateListItemImageUrl(user_id, itemId, imageUrl);
    res.json({ image_url: imageUrl });
  } catch (err) {
    console.error('[Lists] Item image error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /lists/:listId/members?user_id=xxx
router.get('/:listId/members', async (req, res) => {
  try {
    const { listId } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    const members = await db.getListMembers(listId);
    res.json(members);
  } catch (err) {
    console.error('[Lists] Members error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /lists/shared?user_id=xxx
router.get('/shared', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    const result = await db.getSharedListsForUser(user_id);
    res.json(result);
  } catch (err) {
    console.error('[Lists] Shared error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /lists/:listId/leave?user_id=xxx — leave a shared list (removes self from members)
router.delete('/:listId/leave', async (req, res) => {
  try {
    const { listId } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.leaveList(listId, user_id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Lists] Leave error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /lists/restore-defaults?user_id=xxx — recreate any missing default lists
router.post('/restore-defaults', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.createDefaultLists(user_id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Lists] Restore defaults error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
