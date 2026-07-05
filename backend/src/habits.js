'use strict';

const express = require('express');
const db      = require('./supabase');

const router = express.Router();

// POST /habits?user_id=xxx
router.post('/', async (req, res) => {
  try {
    const { user_id } = req.query;
    const { name, mini_goal, good_goal, elite_goal, sort_order } = req.body;
    if (!user_id || !name?.trim()) return res.status(400).json({ error: 'Missing user_id or name' });
    const habit = await db.createHabit(user_id, { name: name.trim(), mini_goal, good_goal, elite_goal, sort_order });
    res.json(habit);
  } catch (err) {
    console.error('[Habits] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /habits/goals?user_id=xxx
router.get('/goals', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    const goals = await db.getHabitGoals(user_id);
    res.json(goals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /habits/goals
router.post('/goals', async (req, res) => {
  try {
    const { user_id, habit_id, period, goal_type, target } = req.body;
    if (!user_id || !habit_id || !period || !goal_type || !target) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const goal = await db.createHabitGoal(user_id, { habit_id, period, goal_type, target });
    res.json(goal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /habits/goals/:id?user_id=xxx
router.delete('/goals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await db.deleteHabitGoal(id, user_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
