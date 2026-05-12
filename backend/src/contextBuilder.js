'use strict';

// Derives a fresh user context summary from existing data and stores it.
// Runs nightly — no Claude call needed, just structured data.

const db = require('./supabase');

async function buildContextForUser(userId) {
  const [lists, habits, prefs] = await Promise.all([
    db.getLists(userId),
    db.getActiveHabits(userId),
    db.getUserPrefs(userId),
  ]);

  const parts = [];

  if (lists.length > 0) {
    const topLists = lists.slice(0, 3).map(l => l.name).join(', ');
    parts.push(`Meest recent gebruikte lijsten: ${topLists}`);
  }

  if (habits.length > 0) {
    parts.push(`Actieve habits: ${habits.map(h => h.name).join(', ')}`);
  }

  const counts = prefs?.active_hour_counts ?? {};
  if (Object.keys(counts).length > 0) {
    let bestHour = 20, max = 0;
    for (const [h, c] of Object.entries(counts)) {
      if (c > max) { max = c; bestHour = parseInt(h, 10); }
    }
    parts.push(`Meest actief rond ${bestHour}:00`);
  }

  const context = parts.join('. ');
  if (context) {
    await db.updateUserContext(userId, context);
  }

  return context;
}

async function buildContextForAllUsers() {
  const users = await db.getUsersForContextBuilding();
  let built = 0;
  for (const user of users) {
    try {
      await buildContextForUser(user.id);
      built++;
    } catch (err) {
      console.error(`[Context] Failed for ${user.id}:`, err);
    }
  }
  console.log(`[Context] Built context for ${built} users.`);
}

module.exports = { buildContextForUser, buildContextForAllUsers };
