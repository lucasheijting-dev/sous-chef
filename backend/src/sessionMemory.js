'use strict';

// In-memory conversation session store — 10-minute TTL per user.
// Each session keeps the last 8 messages (4 user/assistant pairs) so Claude
// has context from the current conversation without unbounded memory growth.
// Swap the Map for Redis when running multiple instances.

const TTL_MS = 30 * 60 * 1000;
const MAX_MESSAGES = 12;

const store         = new Map(); // Map<userId, { messages: [], lastSeen: number }>
const lastEvent     = new Map(); // Map<userId, { id, title, date, time, caldavUid, calendarStream, savedAt }>
const pendingRecurMap  = new Map(); // Map<userId, { eventData, savedAt }>
const pendingPhotoMap  = new Map(); // Map<userId, { items, listId, listName, listEmoji, savedAt }>


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

function setLastEvent(userId, eventData) {
  lastEvent.set(userId, { ...eventData, savedAt: Date.now() });
}

function getLastEvent(userId) {
  const ev = lastEvent.get(userId);
  if (!ev) return null;
  if (Date.now() - ev.savedAt > TTL_MS) {
    lastEvent.delete(userId);
    return null;
  }
  return ev;
}

function setPendingRecurring(userId, data) {
  pendingRecurMap.set(userId, { ...data, savedAt: Date.now() });
}

function getPendingRecurring(userId) {
  const pr = pendingRecurMap.get(userId);
  if (!pr) return null;
  if (Date.now() - pr.savedAt > TTL_MS) { pendingRecurMap.delete(userId); return null; }
  return pr;
}

function clearPendingRecurring(userId) {
  pendingRecurMap.delete(userId);
}

function setPendingPhotoItems(userId, data) {
  pendingPhotoMap.set(userId, { ...data, savedAt: Date.now() });
}
function getPendingPhotoItems(userId) {
  const p = pendingPhotoMap.get(userId);
  if (!p) return null;
  if (Date.now() - p.savedAt > TTL_MS) { pendingPhotoMap.delete(userId); return null; }
  return p;
}
function clearPendingPhotoItems(userId) {
  pendingPhotoMap.delete(userId);
}

module.exports = { getHistory, addExchange, setLastEvent, getLastEvent, setPendingRecurring, getPendingRecurring, clearPendingRecurring, setPendingPhotoItems, getPendingPhotoItems, clearPendingPhotoItems };
