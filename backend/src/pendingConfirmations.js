'use strict';

const TTL = 5 * 60 * 1000;
const pending = new Map();

function set(userId, data) {
  pending.set(userId, { ...data, expiresAt: Date.now() + TTL });
}

function get(userId) {
  const entry = pending.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { pending.delete(userId); return null; }
  return entry;
}

function clear(userId) {
  pending.delete(userId);
}

const CONFIRM = ['ja', 'yes', 'bevestig', 'ok', 'oke', 'doen', 'verder', 'jep', 'yep', 'yup', 'doe maar', 'prima'];
const CANCEL  = ['nee', 'nein', 'no', 'annuleer', 'stop', 'niet doen', 'cancel', 'laat maar'];

function isConfirm(text) {
  const lc = text.toLowerCase().trim();
  return CONFIRM.some(t => lc === t || lc.startsWith(t + ' '));
}

function isCancel(text) {
  const lc = text.toLowerCase().trim();
  return CANCEL.some(t => lc === t || lc.startsWith(t + ' '));
}

module.exports = { set, get, clear, isConfirm, isCancel };
