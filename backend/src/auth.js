'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('./supabase');
const { sendMessage } = require('./whatsapp');

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

    const user = await db.getUserByPhone(normalized);
    res.json({ ok: true, user });
  } catch (err) {
    console.error('[Auth] verify-otp error:', err.message);
    res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
