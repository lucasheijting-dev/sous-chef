'use strict';

const express = require('express');
const db      = require('./supabase');

const router = express.Router();

// POST /notes?user_id=xxx
router.post('/', async (req, res) => {
  try {
    const { user_id } = req.query;
    const { title, body } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (!body?.trim()) return res.status(400).json({ error: 'Missing body' });
    const note = await db.createNote(user_id, title?.trim() || null, body.trim());
    res.json(note);
  } catch (err) {
    console.error('[Notes] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /notes/:noteId?user_id=xxx
router.delete('/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.deleteNote(noteId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Notes] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /notes/:noteId/image?user_id=xxx
router.post('/:noteId/image', async (req, res) => {
  try {
    const { noteId } = req.params;
    const { user_id } = req.query;
    const { base64, mime_type } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (!base64)  return res.status(400).json({ error: 'Missing base64' });
    const imageUrl = await db.uploadUserImage(user_id, base64, mime_type || 'image/jpeg');
    await db.updateNoteImageUrl(user_id, noteId, imageUrl);
    res.json({ image_url: imageUrl });
  } catch (err) {
    console.error('[Notes] Image upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
