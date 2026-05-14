'use strict';

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { sendMessage } = require('./whatsapp');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const WELCOME = `👋 *Welkom bij Sous-Chef!*

Je bent nu gekoppeld aan de app. Stuur me berichten zoals:

🛒 "melk kopen" → lijst
📅 "tandarts vrijdag 14u" → agenda
🏃 "gesport" → habit loggen
📝 "onthoud: wifi-wachtwoord is 1234" → notitie

Typ *help* als je wilt zien wat ik allemaal kan. Veel plezier! 🍳`;

// POST /register
router.post('/', async (req, res) => {
  const raw = req.body?.whatsapp_number ?? '';
  const number = raw.trim().replace(/^\+/, '').replace(/\s/g, '');

  if (!number) return res.status(400).json({ error: 'whatsapp_number required' });

  // Check if user already exists
  const { data: existing } = await supabase
    .from('users')
    .select('id, whatsapp_number, onboarding_completed, message_count, user_context')
    .eq('whatsapp_number', number)
    .single();

  if (existing) {
    return res.json({ user: { ...existing, whatsapp_number: number }, isNew: false });
  }

  // Create new user
  const { data: created, error } = await supabase
    .from('users')
    .insert({ whatsapp_number: number })
    .select('id, whatsapp_number, onboarding_completed, message_count, user_context')
    .single();

  if (error) {
    console.error('[Register] Failed to create user:', error.message);
    return res.status(500).json({ error: 'Could not create user' });
  }

  // Send welcome WhatsApp in background (don't block the response)
  sendMessage(number, WELCOME).catch(err =>
    console.error('[Register] Welcome message failed:', err.message)
  );

  console.log(`[Register] New user: ${number}`);
  res.json({ user: { ...created, whatsapp_number: number }, isNew: true });
});

module.exports = router;
