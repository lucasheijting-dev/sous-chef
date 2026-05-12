'use strict';

const express = require('express');
const ical    = require('ical-generator');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

router.get('/:userId.ics', async (req, res) => {
  const { userId } = req.params;

  const supabase = getSupabase();
  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('[Calendar] Supabase error:', error);
    return res.status(500).send('Error fetching events');
  }

  const cal = ical.default({
    name:   'Sous-Chef',
    method: 'PUBLISH',
    scale:  'GREGORIAN',
    ttl:    3600,
    prodId: { company: 'Sous-Chef', product: 'Calendar', language: 'NL' },
  });

  for (const e of events ?? []) {
    if (!e.date) continue;

    // Parse date parts to avoid timezone shifting
    const [year, month, day] = e.date.split('-').map(Number);
    const start = new Date(year, month - 1, day);
    const end   = new Date(year, month - 1, day + 1);

    cal.createEvent({
      id:          e.id,
      summary:     e.title,
      start,
      end,
      allDay:      true,
      timezone:    'Europe/Amsterdam',
      ...(e.recurrence === 'yearly'  && { repeating: { freq: 'YEARLY'  } }),
      ...(e.recurrence === 'monthly' && { repeating: { freq: 'MONTHLY' } }),
      ...(e.recurrence === 'weekly'  && { repeating: { freq: 'WEEKLY'  } }),
    });
  }

  res.setHeader('Content-Type',              'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition',       'inline; filename="sous-chef.ics"');
  res.setHeader('Cache-Control',             'no-cache, no-store');
  res.setHeader('ngrok-skip-browser-warning', 'true');
  res.send(cal.toString());
});

module.exports = router;
