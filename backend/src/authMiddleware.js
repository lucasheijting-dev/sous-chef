'use strict';

const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET;

function makeToken(userId) {
  if (!SECRET) return null;
  const sig = crypto.createHmac('sha256', SECRET).update(userId).digest('hex');
  return `${userId}.${sig}`;
}

function verifyToken(token) {
  if (!SECRET || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const userId = token.slice(0, dot);
  const sig    = token.slice(dot + 1);
  if (!userId || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(userId).digest('hex');
  try {
    const sigBuf      = Buffer.from(sig,      'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  } catch { return null; }
  return userId;
}

// Resolves req.user_id from Authorization header or legacy query/body param.
// If a token is present but invalid, rejects with 401.
// If no token: falls back to user_id in query/body (transition compatibility).
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    const token  = authHeader.slice(7);
    const userId = verifyToken(token);
    if (!userId) return res.status(401).json({ error: 'Ongeldige sessie. Log opnieuw in.' });
    req.user_id = userId;
    return next();
  }
  // Legacy: accept caller-supplied user_id (removed once all clients send tokens)
  req.user_id = req.query.user_id || req.body?.user_id || null;
  next();
}

module.exports = { makeToken, authMiddleware };
