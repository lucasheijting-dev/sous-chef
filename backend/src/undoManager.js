'use strict';

// Tracks the last 3 reversible actions per user for up to 10 minutes.

const TTL_MS   = 10 * 60 * 1000;
const MAX_STACK = 3;

const store = new Map(); // Map<userId, Array<{ action, data, at }>>

function record(userId, action, data) {
  const stack = store.get(userId) ?? [];
  stack.push({ action, data, at: Date.now() });
  if (stack.length > MAX_STACK) stack.shift();
  store.set(userId, stack);
}

function get(userId) {
  const stack = store.get(userId);
  if (!stack?.length) return null;
  const now = Date.now();
  const valid = stack.filter(e => now - e.at <= TTL_MS);
  if (!valid.length) { store.delete(userId); return null; }
  if (valid.length !== stack.length) store.set(userId, valid);
  return valid[valid.length - 1];
}

function pop(userId) {
  const stack = store.get(userId);
  if (!stack?.length) return null;
  const entry = stack.pop();
  if (!stack.length) store.delete(userId);
  else store.set(userId, stack);
  return entry;
}

function clear(userId) {
  store.delete(userId);
}

module.exports = { record, get, pop, clear };
