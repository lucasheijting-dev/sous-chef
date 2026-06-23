'use strict';

const cron         = require('node-cron');
const db           = require('./supabase');
const caldav       = require('./caldav');
const { sendMessage } = require('./whatsapp');
const { sendPush } = require('./messageHandler');
const { sendWeeklySuggestions } = require('./suggestions');
const { buildContextForAllUsers } = require('./contextBuilder');
const { syncUserCalendar } = require('./calendarSyncCore');

// ── Weekly Digest — every Monday at 09:00 ─────────────────────────────────────

cron.schedule('0 9 * * 1', async () => {
  console.log('[Digest] Sending weekly digests...');
  try {
    const users = await db.getUsersForDigest();
    for (const user of users) {
      await sendDigestToUser(user).catch(err =>
        console.error(`[Digest] Failed for ${user.whatsapp_number}:`, err)
      );
    }
    console.log(`[Digest] Done — sent to ${users.length} users.`);
  } catch (err) {
    console.error('[Digest] Fatal error:', err);
  }
});

async function sendDigestToUser(user) {
  const [lists, events, habits] = await Promise.all([
    db.getLists(user.id),
    db.getUpcomingEvents(user.id, 7),
    db.getActiveHabits(user.id),
  ]);

  const lines = ['📋 *Jouw weekoverzicht — Sous-Chef*\n'];
  let hasContent = false;

  // Lists with open items
  const listsWithOpen = (
    await Promise.all(lists.map(async l => {
      const items = await db.getListItems(l.id);
      return { ...l, openCount: items.filter(i => !i.checked).length };
    }))
  ).filter(l => l.openCount > 0);

  if (listsWithOpen.length > 0) {
    lines.push('*Openstaande lijsten:*');
    for (const l of listsWithOpen) {
      lines.push(`${l.emoji ?? '📝'} ${l.name}: ${l.openCount} item${l.openCount === 1 ? '' : 's'}`);
    }
    lines.push('');
    hasContent = true;
  }

  // Upcoming events this week
  if (events.length > 0) {
    lines.push('*Aankomende afspraken:*');
    for (const e of events) {
      const dateStr = e.date
        ? new Date(e.date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
        : '';
      lines.push(`📅 ${e.title}${dateStr ? ` — ${dateStr}` : ''}`);
    }
    lines.push('');
    hasContent = true;
  }

  // Habits summary
  if (habits.length > 0) {
    lines.push(`*${habits.length} actieve habit${habits.length === 1 ? '' : 's'} — houd ze bij!* 🏆`);
    hasContent = true;
  }

  if (!hasContent) return; // Nothing to digest, skip

  lines.push('\n_Tot volgende week! 🍳_');
  await sendMessage(user.whatsapp_number, lines.join('\n'));
  console.log(`[Digest] Sent to ${user.whatsapp_number}`);
}

// ── Recurring Items — every day at 06:00 ──────────────────────────────────────

cron.schedule('0 6 * * *', async () => {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[Recurring] Processing items due by ${today}...`);

  try {
    const dueItems = await db.getDueRecurringItems(today);

    for (const item of dueItems) {
      await db.addListItem(item.list_id, item.content);
      const nextDue = calcNextDue(item.recurrence, today);
      await db.updateRecurringItemNextDue(item.id, nextDue);
      console.log(`[Recurring] Added "${item.content}" to list ${item.list_id}, next: ${nextDue}`);
    }

    if (dueItems.length > 0) {
      console.log(`[Recurring] Processed ${dueItems.length} item(s).`);
    }
  } catch (err) {
    console.error('[Recurring] Error:', err);
  }
});

function calcNextDue(recurrence, fromDate) {
  const d = new Date(fromDate);

  if (recurrence === 'daily') {
    d.setDate(d.getDate() + 1);
  } else if (recurrence.startsWith('weekly:')) {
    const target = parseInt(recurrence.split(':')[1], 10);
    d.setDate(d.getDate() + 1);
    while (d.getDay() !== target) d.setDate(d.getDate() + 1);
  } else if (recurrence.startsWith('monthly:')) {
    d.setMonth(d.getMonth() + 1);
    d.setDate(parseInt(recurrence.split(':')[1], 10));
  } else {
    d.setDate(d.getDate() + 7); // safe fallback
  }

  return d.toISOString().split('T')[0];
}

// ── Habit Reminders + WhatsApp Timed Reminders — every hour ──────────────────

cron.schedule('0 * * * *', async () => {
  const now = new Date();
  const currentHour = now.getHours();
  const today = now.toISOString().split('T')[0];
  console.log(`[Hourly] Hour ${currentHour} — checking habits + timed reminders...`);

  try {
    const users = await db.getHabitReminderUsers(currentHour);
    for (const user of users) {
      const habits = await db.getActiveHabits(user.id);
      if (!habits.length) continue;

      const lines = habits.map(h =>
        `• *${h.name}* — 🥉 ${h.mini_goal} / 🥈 ${h.good_goal} / 🥇 ${h.elite_goal}`
      ).join('\n');
      await sendMessage(user.whatsapp_number, `🏋️ *Habit herinnering!*\n\n${lines}\n\nLog je voortgang door een berichtje te sturen.`);

      // Also send push notification
      if (user.push_token) {
        await sendPush(user.push_token, {
          title: '🏋️ Habit herinnering',
          body: `${habits.length} habit${habits.length === 1 ? '' : 's'} wachten op jou`,
          data: { type: 'habit_reminder', screen: 'habits' },
        }).catch(() => {});
      }
      console.log(`[Habits] Reminder sent to ${user.whatsapp_number}`);
    }
  } catch (err) {
    console.error('[Habits] Error:', err);
  }

  // WhatsApp timed reminders (stored as events with calendar_stream='wa_reminder')
  try {
    const reminders = await db.getWhatsAppRemindersForHour(today, currentHour);
    for (const r of reminders) {
      if (!r.whatsapp_number) continue;
      await sendMessage(r.whatsapp_number, `⏰ *Herinnering: ${r.title}*`);
      await db.markEventReminderSent(r.id);
      console.log(`[Reminder] Sent "${r.title}" to ${r.whatsapp_number}`);
    }
  } catch (err) {
    console.error('[Reminder] Error:', err);
  }
});

// ── Event Push Reminders — every 5 minutes ───────────────────────────────────
// Sends a push notification 30 min before an event starts

cron.schedule('*/5 * * * *', async () => {
  try {
    const events = await db.getEventsDueForPushReminder();
    for (const e of events) {
      if (!e.push_token) continue;
      const timeStr = e.time ? ` om ${e.time}` : '';
      await sendPush(e.push_token, {
        title: `📅 Zo te beginnen: ${e.title}`,
        body: `Begint${timeStr} — over ongeveer 30 minuten`,
        data: { type: 'event_reminder', screen: 'agenda' },
      }).catch(() => {});
      await db.markEventPushReminderSent(e.id);
      console.log(`[PushReminder] Sent for "${e.title}"`);
    }
  } catch (err) {
    console.error('[PushReminder] Error:', err.message);
  }
});

// ── Event Reminders — every day at 08:00 ─────────────────────────────────────

cron.schedule('0 8 * * *', async () => {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[Events] Checking reminders for ${today}...`);

  try {
    const events = await db.getEventsDueForReminder(today);
    for (const e of events) {
      if (!e.whatsapp_number) continue;
      const dateStr = new Date(e.date).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
      await sendMessage(e.whatsapp_number, `📅 *Herinnering: ${e.title}*\n\nDit staat gepland op ${dateStr}.`);
      await db.markEventReminderSent(e.id);
      console.log(`[Events] Reminder sent for "${e.title}" to ${e.whatsapp_number}`);
    }
  } catch (err) {
    console.error('[Events] Error:', err);
  }
});

// ── Birthday Reminders — every day at 08:30 ──────────────────────────────────

cron.schedule('30 8 * * *', async () => {
  console.log('[Birthdays] Checking birthday reminders...');
  try {
    const birthdays = await db.getTodayBirthdayEvents();
    for (const e of birthdays) {
      if (!e.whatsapp_number) continue;
      const personName = e.title.replace(/verjaardag\s*/i, '').trim();
      await sendMessage(e.whatsapp_number, `🎂 *Vandaag is het de verjaardag van ${personName}!* Vergeet niet te feliciteren 🎉`);
      await db.markEventReminderSent(e.id);
      console.log(`[Birthdays] Sent reminder for "${e.title}" to ${e.whatsapp_number}`);
    }
  } catch (err) {
    console.error('[Birthdays] Error:', err);
  }
});

// ── Timed WhatsApp Reminders — checked every hour ─────────────────────────────

// ── Weekly Suggestions — every Thursday at 10:00 ──────────────────────────────

cron.schedule('0 10 * * 4', async () => {
  await sendWeeklySuggestions();
});

// ── Context Building — every day at 02:00 ────────────────────────────────────

cron.schedule('0 2 * * *', async () => {
  console.log('[Context] Starting nightly context build...');
  await buildContextForAllUsers();
});

// ── CalDAV Sync Queue — every 15 minutes ─────────────────────────────────────

cron.schedule('*/15 * * * *', async () => {
  if (!caldav.isConfigured()) return;

  const ops = await db.getDueCalDAVOperations();
  if (!ops.length) return;

  console.log(`[CalDAV] Retrying ${ops.length} failed operation(s)...`);

  for (const op of ops) {
    try {
      const creds = await db.getCalDAVCredentials(op.user_id);
      if (!creds) {
        await db.markCalDAVOperationFailed(op.id, 'No credentials found', op.attempts);
        continue;
      }

      if (op.operation === 'create_event') {
        const uid = await caldav.createEvent(creds.username, creds.password, op.payload.stream, op.payload);
        if (uid && op.payload.event_id) {
          await db.updateEventCalDAVUid(op.payload.event_id, uid);
        }
      } else if (op.operation === 'delete_event') {
        await caldav.deleteEvent(creds.username, creds.password, op.payload.stream, op.payload.uid);
      }

      await db.markCalDAVOperationDone(op.id);
      console.log(`[CalDAV] Retry succeeded: ${op.operation} (${op.id})`);
    } catch (err) {
      console.error(`[CalDAV] Retry failed: ${op.operation} (${op.id}):`, err.message);
      await db.markCalDAVOperationFailed(op.id, err.message, op.attempts);
    }
  }
});

// ── Calendar Bi-directional Sync — every 5 minutes ───────────────────────────

cron.schedule('*/5 * * * *', async () => {
  let users;
  try {
    users = await db.getUsersWithCalendar();
  } catch (err) {
    console.error('[Calendar Sync] Failed to fetch users:', err.message);
    return;
  }

  for (const user of users) {
    const provider = user.calendar_provider ?? (user.caldav_username ? 'iphone' : null);
    if (!provider || provider === 'none') continue;

    try {
      const { imported, deleted, updated } = await syncUserCalendar(user);
      if (imported > 0 || deleted > 0) {
        console.log(`[Calendar Sync] user ${user.id} (${provider}): +${imported} imported, -${deleted} deleted, ~${updated} checked`);
      }
    } catch (err) {
      console.error(`[Calendar Sync] Failed for user ${user.id}:`, err.message);
    }
  }
});

// ── Auto-delete old lists — every day at 03:30 ───────────────────────────────

cron.schedule('30 3 * * *', async () => {
  console.log('[AutoDelete] Running auto-delete for opted-in users...');
  try {
    const users = await db.getUsersWithAutoDelete();
    let total = 0;
    for (const { user_id } of users) {
      try {
        const deleted = await db.deleteOldListsForUser(user_id, 30);
        if (deleted.length > 0) {
          console.log(`[AutoDelete] user ${user_id}: deleted ${deleted.length} list(s): ${deleted.map(l => l.name).join(', ')}`);
          total += deleted.length;
        }
      } catch (err) {
        console.error(`[AutoDelete] Error for user ${user_id}:`, err.message);
      }
    }
    console.log(`[AutoDelete] Done — ${total} list(s) deleted across ${users.length} user(s).`);
  } catch (err) {
    console.error('[AutoDelete] Fatal:', err);
  }
});

// ── Render Keepalive — every 13 minutes ──────────────────────────────────────
// Prevents Render free tier from spinning down (15 min inactivity threshold)

cron.schedule('*/13 * * * *', async () => {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return; // not running on Render (local dev), skip
  try {
    await fetch(`${url}/health`);
  } catch {}
});

// ── CalDAV health check — every day at 07:30 ─────────────────────────────────

cron.schedule('30 7 * * *', async () => {
  if (!caldav.isConfigured()) return;
  console.log('[CalDAV Health] Checking sync status for all users...');

  try {
    const users = await db.getUsersWithCalDAV();
    for (const user of users) {
      try {
        const creds = await db.getCalDAVCredentials(user.id);
        if (!creds) continue;

        // Try a lightweight propfind to verify credentials still work
        const ok = await caldav.checkConnection(creds.username, creds.password).catch(() => false);
        if (!ok) {
          const prefs = await db.getUserPrefs(user.id) ?? {};
          const lastAlert = prefs.caldav_health_alerted_at;
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

          // Only send once per day to avoid spam
          if (!lastAlert || new Date(lastAlert).getTime() < oneDayAgo) {
            await sendMessage(user.whatsapp_number,
              `⚠️ *Kalender-sync onderbroken.*\n\nSous-Chef kan geen afspraken meer toevoegen aan je agenda. Ga naar *Instellingen → Agenda* in de app om opnieuw te verbinden.`
            );
            await db.updateUserPrefs(user.id, { caldav_health_alerted_at: new Date().toISOString() });
          }
        } else {
          // Clear alert flag on successful check
          await db.updateUserPrefs(user.id, { caldav_health_alerted_at: null }).catch(() => {});
        }
      } catch (err) {
        console.error(`[CalDAV Health] Error for user ${user.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[CalDAV Health] Fatal:', err);
  }
});

function start() {
  console.log('[CronJobs] Scheduled: digest Mon 09:00 | recurring daily 06:00 | habit+wa reminders hourly | event reminders daily 08:00 | birthdays daily 08:30 | suggestions Thu 10:00 | context build daily 02:00 | caldav retry+sync every 15min | caldav health check daily 07:30 | keepalive every 13min');
}

module.exports = { start, syncUserCalendar };
