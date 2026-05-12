'use strict';

// In-memory conversation session store — 10-minute TTL per user.
// Each session keeps the last 8 messages (4 user/assistant pairs) so Claude
// has context from the current conversation without unbounded memory growth.
// Swap the Map for Redis when running multiple instances.

const TTL_MS = 10 * 60 * 1000;
const MAX_MESSAGES = 8;

const store = new Map(); // Map<userId, { messages: [], lastSeen: number }>

function _live(userId) {
  const entry = store.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.lastSeen > TTL_MS) {
    store.delete(userId);
    return null;
  }
  return entry;
}

function getHistory(userId) {
  return _live(userId)?.messages ?? [];
}

function addExchange(userId, userText, assistantText) {
  const existing = _live(userId);
  const messages = existing?.messages ?? [];

  messages.push({ role: 'user',      content: userText });
  messages.push({ role: 'assistant', content: assistantText });

  store.set(userId, {
    messages: messages.slice(-MAX_MESSAGES),
    lastSeen: Date.now(),
  });
}

module.exports = { getHistory, addExchange };
