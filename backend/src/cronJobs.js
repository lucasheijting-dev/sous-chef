'use strict';

const cron         = require('node-cron');
const db           = require('./supabase');
const { sendMessage } = require('./whatsapp');
const { sendWeeklySuggestions } = require('./suggestions');
const { buildContextForAllUsers } = require('./contextBuilder');

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

// ── Habit Reminders — every hour ──────────────────────────────────────────────

cron.schedule('0 * * * *', async () => {
  const currentHour = new Date().getHours();
  console.log(`[Habits] Checking reminders for hour ${currentHour}...`);

  try {
    const users = await db.getHabitReminderUsers(currentHour);
    for (const user of users) {
      const habits = await db.getActiveHabits(user.id);
      if (!habits.length) continue;

      const lines = habits.map(h =>
        `• *${h.name}* — 🥉 ${h.mini_goal} / 🥈 ${h.good_goal} / 🥇 ${h.elite_goal}`
      ).join('\n');
      await sendMessage(user.whatsapp_number, `🏋️ *Habit herinnering!*\n\n${lines}\n\nLog je voortgang door een berichtje te sturen.`);
      console.log(`[Habits] Reminder sent to ${user.whatsapp_number}`);
    }
  } catch (err) {
    console.error('[Habits] Error:', err);
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

// ── Weekly Suggestions — every Thursday at 10:00 ──────────────────────────────

cron.schedule('0 10 * * 4', async () => {
  await sendWeeklySuggestions();
});

// ── Context Building — every day at 02:00 ────────────────────────────────────

cron.schedule('0 2 * * *', async () => {
  console.log('[Context] Starting nightly context build...');
  await buildContextForAllUsers();
});

function start() {
  console.log('[CronJobs] Scheduled: digest Mon 09:00 | recurring daily 06:00 | habit reminders hourly | event reminders daily 08:00 | suggestions Thu 10:00 | context build daily 02:00');
}

module.exports = { start };
