'use strict';

const express = require('express');
const db      = require('./supabase');

const router = express.Router();

router.get('/:userId', async (req, res) => {
  try { res.json(await db.getReceiptCategories(req.params.userId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:userId', async (req, res) => {
  const { name, emoji, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try { res.json(await db.createReceiptCategory(req.params.userId, { name, emoji: emoji ?? '📁', color: color ?? '#4A90D8' })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:userId/:catId', async (req, res) => {
  const { name, emoji, color } = req.body;
  try { res.json(await db.updateReceiptCategory(req.params.catId, { name, emoji, color })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:userId/:catId', async (req, res) => {
  try { await db.deleteReceiptCategory(req.params.catId); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Assign a receipt to a category (or null to unassign)
router.patch('/:userId/assign', async (req, res) => {
  const { receipt_id, category_id } = req.body;
  if (!receipt_id) return res.status(400).json({ error: 'receipt_id required' });
  try { res.json(await db.assignReceiptCategory(receipt_id, category_id ?? null)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
