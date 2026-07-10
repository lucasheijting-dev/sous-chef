'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('./supabase');
const { sendMessage }  = require('./whatsapp');
const { makeToken }    = require('./authMiddleware');

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizePhone(raw) {
  return raw.replace(/\D/g, '').replace(/^0/, '31');
}

// POST /auth/request-otp  { phone: "0612345678" }
router.post('/request-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const normalized = normalizePhone(String(phone));

    // Must be an existing user
    const user = await db.getUserByPhone(normalized);
    if (!user) return res.status(404).json({ error: 'Nummer niet gevonden. Heb je Sous-Chef al via WhatsApp gebruikt?' });

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    await db.createOTP(normalized, code, expiresAt);

    await sendMessage(normalized,
      `🔐 *Inlogcode: ${code}*\n\nVoer deze code in de Sous-Chef app in. Geldig voor 10 minuten.\n\n_(Niet jij? Negeer dit bericht.)_`
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[Auth] request-otp error:', err.message);
    res.status(500).json({ error: 'internal' });
  }
});

// POST /auth/verify-otp  { phone: "0612345678", code: "123456" }
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });

    const normalized = normalizePhone(String(phone));
    const result = await db.verifyOTP(normalized, String(code));

    if (!result.ok) {
      return res.status(401).json({ error: result.reason });
    }

    const user  = await db.getUserByPhone(normalized);
    const token = makeToken(user.id);
    res.json({ ok: true, user, token });
  } catch (err) {
    console.error('[Auth] verify-otp error:', err.message);
    res.status(500).json({ error: 'internal' });
  }
});

// ── Google Calendar OAuth ──────────────────────────────────────────────────────

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MS_AUTH_URL      = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL     = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

// GET /auth/google?userId=xxx
router.get('/google', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('userId required');

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${process.env.API_BASE_URL}/auth/google/callback`,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar',
    access_type:   'offline',
    prompt:        'consent',
    state:         userId,
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

// GET /auth/google/callback
router.get('/google/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  if (error || !code) return res.redirect('app://calendar-connected?error=access_denied');

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  `${process.env.API_BASE_URL}/auth/google/callback`,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokens.error_description ?? tokens.error);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await db.storeGoogleTokens(userId, tokens.access_token, tokens.refresh_token, expiresAt);
    await db.setCalendarProvider(userId, 'google');

    res.redirect('app://calendar-connected?provider=google');
  } catch (err) {
    console.error('[Auth] Google callback error:', err.message);
    res.redirect('app://calendar-connected?error=failed');
  }
});

// GET /auth/microsoft?userId=xxx
router.get('/microsoft', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('userId required');

  const params = new URLSearchParams({
    client_id:     process.env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  `${process.env.API_BASE_URL}/auth/microsoft/callback`,
    scope:         'Calendars.ReadWrite offline_access User.Read',
    state:         userId,
    response_mode: 'query',
  });
  res.redirect(`${MS_AUTH_URL}?${params}`);
});

// GET /auth/microsoft/callback
router.get('/microsoft/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  if (error || !code) return res.redirect('app://calendar-connected?error=access_denied');

  try {
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        client_id:     process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  `${process.env.API_BASE_URL}/auth/microsoft/callback`,
        scope:         'Calendars.ReadWrite offline_access User.Read',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokens.error_description ?? tokens.error);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await db.storeMicrosoftTokens(userId, tokens.access_token, tokens.refresh_token, expiresAt);
    await db.setCalendarProvider(userId, 'outlook');

    res.redirect('app://calendar-connected?provider=outlook');
  } catch (err) {
    console.error('[Auth] Microsoft callback error:', err.message);
    res.redirect('app://calendar-connected?error=failed');
  }
});

// POST /auth/calendar-provider  { userId, provider }
router.post('/calendar-provider', async (req, res) => {
  const { userId, provider } = req.body;
  if (!userId || !provider) return res.status(400).json({ error: 'userId and provider required' });
  if (!['iphone', 'google', 'outlook', 'none'].includes(provider)) return res.status(400).json({ error: 'invalid provider' });

  try {
    await db.setCalendarProvider(userId, provider);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
