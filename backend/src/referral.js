'use strict';

const express = require('express');
const db = require('./supabase');
const { sendMessage } = require('./whatsapp');

const router = express.Router();

const APP_STORE = 'https://apps.apple.com/nl/app/de-sous-chef/id6770052207';
const API_BASE = process.env.API_BASE_URL ?? 'https://sous-chef-pckg.onrender.com';

// GET /join?ref=PHONE — landing page that deep-links into the app
router.get('/', (req, res) => {
  const ref = (req.query.ref ?? '').toString().trim();
  const appLink = `app://invite?from=${encodeURIComponent(ref)}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>De Sous-Chef</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0D0D0D;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 20px;text-align:center}
    .emoji{font-size:72px;margin-bottom:24px}
    h1{font-size:28px;font-weight:700;color:#F3B500;margin-bottom:12px}
    p{font-size:16px;color:rgba(255,255,255,0.65);line-height:1.6;margin-bottom:32px}
    .btn{display:block;padding:16px 24px;border-radius:14px;font-size:16px;font-weight:700;text-decoration:none;margin-bottom:12px;width:100%;max-width:320px}
    .btn-primary{background:#F3B500;color:#000}
    .btn-secondary{background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15)}
  </style>
</head>
<body>
  <div class="emoji">🍳</div>
  <h1>Je bent uitgenodigd!</h1>
  <p>Iemand deelt De Sous-Chef met je — jouw persoonlijke assistent via WhatsApp voor lijsten, agenda en meer.</p>
  <a class="btn btn-primary" href="${appLink}" id="openApp">Open in app</a>
  <a class="btn btn-secondary" href="${APP_STORE}">Download in de App Store</a>
  <script>
    // Auto-attempt open app after short delay; fall through to buttons
    setTimeout(function(){ window.location.href = ${JSON.stringify(appLink)}; }, 800);
  </script>
</body>
</html>`);
});

// POST /join/referral?user_id=X&from=PHONE — record referral after app open
router.post('/referral', async (req, res) => {
  try {
    const { user_id, from } = req.query;
    if (!user_id || !from) return res.status(400).json({ error: 'Missing user_id or from' });

    const [newUser, inviter] = await Promise.all([
      db.getUserById(user_id),
      db.getUserByPhone(from),
    ]);

    if (!newUser || !inviter) return res.status(404).json({ error: 'User not found' });
    if (inviter.id === newUser.id) return res.json({ ok: true }); // same person

    // Notify inviter via WhatsApp
    const newPhone = newUser.whatsapp_number ? `+${newUser.whatsapp_number}` : 'Iemand';
    await sendMessage(
      inviter.whatsapp_number,
      `🎉 ${newPhone} heeft jouw uitnodiging voor De Sous-Chef geaccepteerd!`
    ).catch(() => {});

    res.json({ ok: true, inviter_id: inviter.id });
  } catch (err) {
    console.error('[Referral] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
