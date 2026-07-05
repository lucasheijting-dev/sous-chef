'use strict';

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { sendMessage } = require('./whatsapp');
const db = require('./supabase');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const WELCOME = `👋 *Welkom bij Sous-Chef!*

Ik heb twee lijsten voor je klaargezet:
📋 *To-do* — stuur me alles wat je moet doen
🛒 *Boodschappen* — stuur me wat je nodig hebt

Elke ochtend om 09:00 herinner ik je aan je openstaande to-do's. Dit kun je aanpassen in de instellingen.

Je kunt me ook berichten sturen zoals:
📅 "tandarts vrijdag 14u" → agenda
🏃 "gesport" → habit loggen
📝 "onthoud: wifi-wachtwoord is 1234" → notitie

Stuur maar iets om te beginnen! 🍳`;

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

  // Create default lists (Boodschappen + To-do) for new user
  db.createDefaultLists(created.id).catch(err => console.error('[Register] Default lists failed:', err.message));

  // Create default calendar streams for new user
  const defaultStreams = [
    { name: 'Afspraken',    emoji: '📅', color: '#4A90D8', caldav_id: 'appointments', claude_key: 'appointments', sort_order: 0 },
    { name: 'Verjaardagen', emoji: '🎂', color: '#FF6B6B', caldav_id: 'birthdays',    claude_key: 'birthdays',    sort_order: 1 },
    { name: 'Werk',         emoji: '💼', color: '#6B8CFF', caldav_id: 'work',         claude_key: 'work',         sort_order: 2 },
    { name: 'Persoonlijk',  emoji: '🌿', color: '#4ECDC4', caldav_id: 'personal',     claude_key: 'personal',     sort_order: 3 },
  ];
  supabase.from('calendar_streams').insert(defaultStreams.map(s => ({ user_id: created.id, ...s })))
    .catch(err => console.error('[Register] Calendar streams failed:', err.message));

  // Send welcome WhatsApp in background (don't block the response)
  sendMessage(number, WELCOME).catch(err =>
    console.error('[Register] Welcome message failed:', err.message)
  );

  console.log(`[Register] New user: ${number}`);
  res.json({ user: { ...created, whatsapp_number: number }, isNew: true });
});

module.exports = router;
