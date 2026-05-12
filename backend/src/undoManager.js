'use strict';

// Tracks the last reversible action per user for up to 10 minutes.
// Supported action types: add_item, add_note, create_list, add_recurring.

const TTL_MS = 10 * 60 * 1000;

const store = new Map(); // Map<userId, { action, data, at }>

function record(userId, action, data) {
  store.set(userId, { action, data, at: Date.now() });
}

function get(userId) {
  const entry = store.get(userId);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    store.delete(userId);
    return null;
  }
  return entry;
}

function clear(userId) {
  store.delete(userId);
}

module.exports = { record, get, clear };
