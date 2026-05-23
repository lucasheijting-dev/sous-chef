'use strict';

// Learns and applies per-user time defaults for recurring activity types.
// When the user plans "gym vrijdag" without a time, we check if they always
// do gym at 07:00 and fill it in automatically.

const db = require('./supabase');

// Keyword buckets → activity key
const ACTIVITY_KEYWORDS = {
  gym:        ['gym', 'sporten', 'sport', 'fitness', 'crossfit', 'krachtsport'],
  hardlopen:  ['hardlopen', 'rennen', 'hardloop', 'joggen', 'run'],
  yoga:       ['yoga', 'pilates', 'stretchen'],
  zwemmen:    ['zwemmen', 'zwem', 'baantjes'],
  mediteren:  ['mediteren', 'meditatie'],
  werk:       ['werk', 'kantoor', 'office', 'werken'],
  standup:    ['standup', 'stand-up', 'daily', 'scrum'],
  lunch:      ['lunch', 'lunchen'],
  koffie:     ['koffie', 'koffiemoment', 'koffieafspraak'],
};

function detectActivityKey(title) {
  const lc = (title ?? '').toLowerCase();
  for (const [key, words] of Object.entries(ACTIVITY_KEYWORDS)) {
    if (words.some(w => lc.includes(w))) return key;
  }
  return null;
}

// Record a confirmed event time to learn defaults
async function recordEventTime(userId, title, time) {
  if (!time || !title) return;
  const key = detectActivityKey(title);
  if (!key) return;

  const prefs = await db.getUserPrefs(userId) ?? {};
  const timeCounts = prefs.activity_time_counts ?? {};
  const bucket = timeCounts[key] ?? {};
  bucket[time] = (bucket[time] ?? 0) + 1;
  timeCounts[key] = bucket;
  await db.updateUserPrefs(userId, { activity_time_counts: timeCounts });
}

// Return the most-used time for an activity, or null if < 2 data points
function getBestTime(timeCounts, key) {
  const bucket = timeCounts?.[key];
  if (!bucket) return null;
  const entries = Object.entries(bucket);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (total < 2) return null;
  return entries.sort(([, a], [, b]) => b - a)[0][0];
}

// Return suggested default time for a title, or null
async function getSuggestedTime(userId, title) {
  const key = detectActivityKey(title);
  if (!key) return null;
  const prefs = await db.getUserPrefs(userId) ?? {};
  return getBestTime(prefs.activity_time_counts, key);
}

module.exports = { recordEventTime, getSuggestedTime };
