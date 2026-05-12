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

    const [year, month, day] = e.date.split('-').map(Number);
    let start, end, allDay;

    if (e.time) {
      const [hour, minute] = e.time.split(':').map(Number);
      start  = new Date(year, month - 1, day, hour, minute);
      end    = new Date(year, month - 1, day, hour + 1, minute);
      allDay = false;
    } else {
      start  = new Date(year, month - 1, day);
      end    = new Date(year, month - 1, day + 1);
      allDay = true;
    }

    // Build alarm: reminder_days_before=0 means at the event time, N means N days before at 09:00
    const alarms = [];
    if (e.reminder_days_before === 0 && e.time) {
      alarms.push({ type: 'display', trigger: 0 });
    } else if ((e.reminder_days_before ?? 1) > 0) {
      alarms.push({ type: 'display', trigger: -e.reminder_days_before * 24 * 60 * 60 });
    }

    cal.createEvent({
      id:       e.id,
      summary:  e.title,
      start,
      end,
      allDay,
      timezone: 'Europe/Amsterdam',
      alarms,
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
