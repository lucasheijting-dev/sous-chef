'use strict';

const { parseIntent }          = require('./claudeParser');
const { sendMessage, sendTyping } = require('./whatsapp');
const db                  = require('./supabase');
const caldav              = require('./caldav');
const googleCalendar      = require('./googleCalendar');
const outlookCalendar     = require('./outlookCalendar');
const session             = require('./sessionMemory');
const undo                = require('./undoManager');
const confirm             = require('./pendingConfirmations');
const timeDefaults        = require('./timeDefaults');
const onboarding          = require('./onboarding');

// ── Calendar helpers ───────────────────────────────────────────────────────────

async function _calCreate(userId, calProvider, calInfo, caldavCreds, stream, params) {
  if (calProvider === 'google' && calInfo?.google_refresh_token) {
    return googleCalendar.createEvent({ id: userId, ...calInfo }, db, params);
  }
  if (calProvider === 'outlook' && calInfo?.ms_refresh_token) {
    return outlookCalendar.createEvent({ id: userId, ...calInfo }, db, params);
  }
  if (caldavCreds) {
    return caldav.createEvent(caldavCreds.username, caldavCreds.password, stream, {
      title: params.title, date: params.date, time: params.time ?? null,
      recurrence: params.recurrence ?? null, recurrenceUntil: params.recurrenceUntil ?? null,
      reminderDaysBefore: params.reminderDaysBefore ?? null,
      reminderMinutesBefore: params.reminderMinutesBefore ?? 30,
      durationMinutes: params.durationMinutes ?? null,
      attendees: params.attendees ?? null,
      location: params.location ?? null,
    });
  }
  return null;
}

async function _calDelete(userId, calProvider, calInfo, caldavCreds, stream, caldavUid) {
  if (!caldavUid) return;
  if (calProvider === 'google' && calInfo?.google_refresh_token) {
    await googleCalendar.deleteEvent({ id: userId, ...calInfo }, db, caldavUid).catch(() => {});
  } else if (calProvider === 'outlook' && calInfo?.ms_refresh_token) {
    await outlookCalendar.deleteEvent({ id: userId, ...calInfo }, db, caldavUid).catch(() => {});
  } else if (caldavCreds) {
    await caldav.deleteEvent(caldavCreds.username, caldavCreds.password, stream ?? 'personal', caldavUid).catch(() => {});
  }
}

async function _calUpdate(userId, calProvider, calInfo, caldavCreds, stream, caldavUid, params) {
  if (!caldavUid) return null;
  if (calProvider === 'google' && calInfo?.google_refresh_token) {
    return googleCalendar.updateEvent({ id: userId, ...calInfo }, db, caldavUid, params);
  }
  if (calProvider === 'outlook' && calInfo?.ms_refresh_token) {
    return outlookCalendar.updateEvent({ id: userId, ...calInfo }, db, caldavUid, params);
  }
  if (caldavCreds) {
    await caldav.deleteEvent(caldavCreds.username, caldavCreds.password, stream ?? 'personal', caldavUid).catch(() => {});
    return caldav.createEvent(caldavCreds.username, caldavCreds.password, stream ?? 'personal', {
      title: params.title, date: params.date, time: params.time ?? null,
      recurrence: params.recurrence ?? null, reminderMinutesBefore: params.reminderMinutesBefore ?? null,
    });
  }
  return null;
}

// ── Recurring event expansion ─────────────────────────────────────────────────

function generateRecurringDates(startDate, intervalType, untilDate, max = 104) {
  const pad = n => String(n).padStart(2, '0');
  const dates = [];
  let cur = new Date(startDate + 'T00:00:00');
  const until = new Date(untilDate + 'T23:59:59');
  while (cur <= until && dates.length < max) {
    dates.push(`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`);
    if (intervalType === 'daily')        cur.setDate(cur.getDate() + 1);
    else if (intervalType === 'monthly') cur.setMonth(cur.getMonth() + 1);
    else                                 cur.setDate(cur.getDate() + 7);
  }
  return dates;
}

async function handleRecurringAnswer(text, userId, from, pending) {
  const lc = text.toLowerCase().trim();
  const pad = n => String(n).padStart(2, '0');

  // Parse duration from user's answer
  const maandenMatch = lc.match(/(\d+)\s*maand/);
  const wekenMatch   = lc.match(/(\d+)\s*week/);
  const keerMatch    = lc.match(/(\d+)\s*keer/);
  const jarenMatch   = lc.match(/(\d+)\s*jaar/);
  const eeuwigMatch  = /altijd|voor altijd|eeuwig|onbepaald/.test(lc);

  // Determine interval type
  const rec = pending.eventRecurrence ?? '';
  let intervalType = 'weekly';
  if (rec === 'daily'          || /dagelijks|elke dag/.test(lc)) intervalType = 'daily';
  else if (rec.startsWith('monthly') || /maandelijks|elke maand/.test(lc)) intervalType = 'monthly';

  const startDate = pending.startDate ?? new Date().toISOString().split('T')[0];
  const start = new Date(startDate + 'T00:00:00');
  let until = null;

  if (eeuwigMatch) {
    until = new Date(start); until.setFullYear(until.getFullYear() + 2);
  } else if (maandenMatch) {
    until = new Date(start); until.setMonth(until.getMonth() + parseInt(maandenMatch[1]));
  } else if (jarenMatch) {
    until = new Date(start); until.setFullYear(until.getFullYear() + parseInt(jarenMatch[1]));
  } else if (wekenMatch) {
    until = new Date(start); until.setDate(until.getDate() + parseInt(wekenMatch[1]) * 7);
  } else if (keerMatch) {
    const n = parseInt(keerMatch[1]);
    until = new Date(start);
    if (intervalType === 'daily')        until.setDate(until.getDate() + n - 1);
    else if (intervalType === 'monthly') until.setMonth(until.getMonth() + n - 1);
    else                                 until.setDate(until.getDate() + (n - 1) * 7);
  }

  if (!until) return { handled: false };

  const untilStr = `${until.getFullYear()}-${pad(until.getMonth()+1)}-${pad(until.getDate())}`;
  const dates = generateRecurringDates(startDate, intervalType, untilStr);
  if (dates.length === 0) return { handled: false };

  // Get calendar provider
  const calInfo = await db.getCalendarProvider(userId).catch(() => null);
  const calProvider = calInfo?.calendar_provider ?? (calInfo?.caldav_username ? 'iphone' : null);
  let caldavCreds = null;
  if (calProvider !== 'none' && calProvider !== 'google' && calProvider !== 'outlook') {
    if (caldav.isConfigured()) caldavCreds = await db.getCalDAVCredentials(userId).catch(() => null);
  }

  // One RRULE CalDAV event for iPhone sync
  const rrule = intervalType === 'daily' ? 'daily' : intervalType === 'monthly' ? 'monthly' : 'weekly';
  let caldavUid = null;
  try {
    caldavUid = await _calCreate(userId, calProvider, calInfo, caldavCreds, pending.calendarStream, {
      title: pending.eventTitle, date: startDate, time: pending.eventTime ?? null,
      recurrence: rrule, recurrenceUntil: untilStr,
      reminderMinutesBefore: pending.reminderMinutes ?? 30,
      durationMinutes: pending.durationMinutes ?? null,
    });
  } catch (err) {
    console.error('Recurring CalDAV create failed:', err.message);
  }

  // Individual DB events for app agenda display
  for (let i = 0; i < dates.length; i++) {
    await db.createEvent(userId, {
      title: pending.eventTitle,
      date: dates[i],
      time: pending.eventTime ?? null,
      recurrence: null,
      reminderDaysBefore: null,
      caldavUid: i === 0 ? caldavUid : null,
      calendarStream: pending.calendarStream,
    }).catch(() => {});
  }

  sendCalendarPush(userId, { title: pending.eventTitle, date: dates[0], time: pending.eventTime ?? null, calendarStream: pending.calendarStream }).catch(() => {});

  const intervalLabel = intervalType === 'daily' ? 'dagelijks' : intervalType === 'monthly' ? 'elke maand' : 'elke week';
  const reply = `📅 *${pending.eventTitle}* ingepland!\n\n🔄 ${dates.length}× ${intervalLabel} — t/m ${formatDate(dates[dates.length - 1])}.\n\n_Staat nu in je agenda._ ✅`;
  return { handled: true, reply };
}

// ── Constants ──────────────────────────────────────────────────────────────────

const UNDO_TRIGGERS     = ['ongedaan', 'undo', 'terugdraaien', 'verwijder laatste', 'annuleer laatste'];
const HELP_TRIGGERS     = ['wat kun je', 'wat kan je', 'wat kan ik', 'help', 'hoe werkt'];
const GREETING_TRIGGERS = ['hoi', 'hallo', 'hey', 'hi', 'dag', 'goedemorgen', 'goedemiddag', 'goedenavond', 'hello', 'yo'];
const FEEDBACK_TRIGGERS = ['feedback:', 'bug:', 'suggestie:'];
const LUCAS_WHATSAPP    = '31630491259';
const FRUSTRATION_WORDS = ['werkt niet', 'irritant', 'fout', 'kapot', 'klopt niet', 'gaat mis', 'buggy'];

const PERSONALITY_LINES = [
  '_(Sous-chef goedgekeurd! 👨‍🍳)_',
  '_(Goed bezig — zelfs Gordon Ramsay zou trots zijn! 🍳)_',
  '_(Efficiëntie is de smaak van productiviteit! 🥘)_',
  '_(Niets vergeten is het geheim van een goede kok! 🧑‍🍳)_',
  '_(Keep calm en stuur Sous-Chef een berichtje! 🫶)_',
  '_(Een georganiseerd leven smaakt beter! 🫙)_',
];

const SEASONAL_LINES = () => {
  const m = new Date().getMonth();
  if (m >= 11 || m <= 1) return ['_(Lekker warm binnenzitten en georganiseerd blijven! ❄️)_'];
  if (m >= 2 && m <= 4)  return ['_(Lente is de perfecte tijd voor een schone lei! 🌸)_'];
  if (m >= 5 && m <= 7)  return ['_(Zomerse productiviteit op z\'n best! ☀️)_'];
  return ['_(Herfst is herfstig, maar jouw lijsten zijn op orde! 🍂)_'];
};

const DAYS_NL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

// ── Push notification helpers ──────────────────────────────────────────────────

async function sendPush(token, { title, body, data = {}, silent = false }) {
  if (!token || !token.startsWith('ExponentPushToken[')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: token,
        title,
        body,
        data,
        priority: silent ? 'normal' : 'high',
        ...(silent ? { _contentAvailable: true } : {}),
      }),
    });
  } catch (err) {
    console.error('[push] Failed to send push notification:', err?.message ?? err);
  }
}

async function sendCalendarPush(userId, event) {
  const token = await db.getUserPushToken(userId);
  await sendPush(token, {
    title: 'Nieuw agenda-event',
    body: event.title,
    data: {
      type: 'calendar_event',
      title: event.title,
      date: event.date,
      time: event.time ?? null,
      calendarStream: event.calendarStream ?? 'personal',
    },
    silent: true,
  });
}

// ── Main handler ───────────────────────────────────────────────────────────────

async function handleMessage({ from, text }) {
  sendTyping(from); // fire-and-forget, shows typing indicator immediately

  const user   = await db.getOrCreateUserFull(from);
  const userId = user.id;
  const lc     = text.toLowerCase().trim();

  // Onboarding: guided conversation for new users
  if (!user.onboarding_completed) {
    const handled = await onboarding.handleOnboardingMessage({ from, text, userId, user });
    if (handled) {
      await db.incrementMessageCount(userId);
      return;
    }
    // Onboarding just finished — fall through to process the message normally
  }

  // Pending confirmation check (destructive actions)
  const pending = confirm.get(userId);
  if (pending) {
    if (confirm.isConfirm(lc)) {
      confirm.clear(userId);
      const reply = await executePendingAction(pending, userId);
      await sendSplit(from, reply);
      await db.incrementMessageCount(userId);
      return;
    }
    if (confirm.isCancel(lc)) {
      confirm.clear(userId);
      await sendMessage(from, '↩️ Geannuleerd.');
      await db.incrementMessageCount(userId);
      return;
    }
    // Not a confirm/cancel → clear pending and continue processing
    confirm.clear(userId);
  }

  // Share invite check (JA / NEE for pending WhatsApp invites stored in DB)
  if (confirm.isConfirm(lc) || confirm.isCancel(lc)) {
    const invites = await db.getPendingShareInvites(userId).catch(() => []);
    if (invites.length > 0) {
      const invite = invites[0]; // most recent pending invite
      if (confirm.isConfirm(lc)) {
        await db.acceptShareInvite(invite.id);
        const resourceName = invite.list?.name
          ? `${invite.list.emoji ?? '📋'} ${invite.list.name}`
          : invite.note?.title ?? 'de notitie';
        const inviterName = invite.inviter?.display_name ?? invite.inviter?.whatsapp_number ?? 'Iemand';
        await sendMessage(from, `✅ Welkom! Je hebt nu toegang tot *${resourceName}* van ${inviterName}. Open Sous-Chef om de lijst te bekijken.`);
      } else {
        await db.declineShareInvite(invite.id);
        await sendMessage(from, '↩️ Uitnodiging geweigerd.');
      }
      await db.incrementMessageCount(userId);
      return;
    }
  }

  // Undo shortcut
  if (UNDO_TRIGGERS.some(t => lc.includes(t))) {
    const reply = await handleUndo(userId);
    await sendSplit(from, reply);
    await db.incrementMessageCount(userId);
    return;
  }

  // Help shortcut
  if (HELP_TRIGGERS.some(t => lc.includes(t)) && lc.length < 60) {
    await sendSplit(from, buildHelpMessage());
    await db.incrementMessageCount(userId);
    return;
  }

  // Greeting shortcut — smart morning summary
  if (GREETING_TRIGGERS.some(t => lc === t || lc === t + '!' || lc === t + '!!' )) {
    if (!user.onboarding_completed) {
      await sendMessage(from, 'Hoi! 👋 Laten we eerst je account instellen. Wat is je naam?');
      await db.incrementMessageCount(userId);
      return;
    }
    const [greetLists, greetHabits, greetEvents, greetUnchecked] = await Promise.all([
      db.getLists(userId),
      db.getActiveHabits(userId),
      db.getTodayEvents(userId),
      db.getAllUncheckedItems(userId),
    ]);
    const reply = buildGreetingReply(greetLists, greetHabits, greetEvents, greetUnchecked);
    session.addExchange(userId, text, reply);
    await sendSplit(from, reply);
    await db.incrementMessageCount(userId);
    return;
  }

  // E5 — Feedback command
  if (FEEDBACK_TRIGGERS.some(t => lc.startsWith(t))) {
    const feedbackText = text.trim();
    try {
      await db.saveFeedback(userId, feedbackText);
      // Forward to Lucas's WhatsApp
      await sendMessage(LUCAS_WHATSAPP, `📮 Feedback van ${from}:\n\n${feedbackText}`).catch(() => {});
    } catch (err) {
      console.error('[Feedback] Failed to save:', err.message);
    }
    await sendMessage(from, '📮 Doorgestuurd naar de maker. Dank je!');
    await db.incrementMessageCount(userId);
    return;
  }

  // Check for pending photo items — user is confirming a handwritten list
  const pendingPhoto = session.getPendingPhotoItems(userId);
  if (pendingPhoto) {
    if (confirm.isConfirm(lc)) {
      session.clearPendingPhotoItems(userId);
      const targetList = pendingPhoto.listId
        ? { id: pendingPhoto.listId, name: pendingPhoto.listName, emoji: pendingPhoto.listEmoji }
        : null;
      if (!targetList) {
        await sendMessage(from, 'Ik kon geen lijst vinden om de items op te zetten. Maak eerst een lijst aan.');
        await db.incrementMessageCount(userId);
        return;
      }
      for (const item of pendingPhoto.items) {
        await db.addListItem(targetList.id, item, null, userId).catch(() => {});
      }
      await sendMessage(from, `✓ ${pendingPhoto.items.length} items toegevoegd aan ${pendingPhoto.listEmoji ?? '📝'} *${pendingPhoto.listName}*.`);
      await db.incrementMessageCount(userId);
      return;
    }
    if (confirm.isCancel(lc)) {
      session.clearPendingPhotoItems(userId);
      await sendMessage(from, '↩️ Geannuleerd — er zijn geen items toegevoegd.');
      await db.incrementMessageCount(userId);
      return;
    }
    // User specified a different list: "nee, op To-do" or just a list name
    const altListName = text.replace(/^nee[,.]?\s*/i, '').replace(/^op\s*/i, '').trim();
    if (altListName) {
      const allLists = await db.getLists(userId);
      const altList = allLists.find(l => l.name.toLowerCase().includes(altListName.toLowerCase()));
      if (altList) {
        session.clearPendingPhotoItems(userId);
        for (const item of pendingPhoto.items) {
          await db.addListItem(altList.id, item, null, userId).catch(() => {});
        }
        await sendMessage(from, `✓ ${pendingPhoto.items.length} items toegevoegd aan ${altList.emoji ?? '📝'} *${altList.name}*.`);
        await db.incrementMessageCount(userId);
        return;
      }
    }
    // Can't parse → clear and treat as new message
    session.clearPendingPhotoItems(userId);
  }

  // Check for pending recurring event — user is answering "tot wanneer?" question
  const pendingRec = session.getPendingRecurring(userId);
  if (pendingRec) {
    const result = await handleRecurringAnswer(text, userId, from, pendingRec);
    if (result.handled) {
      session.clearPendingRecurring(userId);
      session.addExchange(userId, text, result.reply);
      await sendSplit(from, result.reply);
      await db.incrementMessageCount(userId);
      return;
    }
    session.clearPendingRecurring(userId); // can't parse → treat as new message
  }

  // Load all context in parallel
  const [lists, activeHabits, userContext, calendarStreams, conversationHistory, userPrefs, noteTitles] = await Promise.all([
    db.getLists(userId),
    db.getActiveHabits(userId),
    db.getUserContext(userId),
    db.getCalendarStreams(userId),
    Promise.resolve(session.getHistory(userId)),
    db.getUserPrefs(userId),
    db.getNotes(userId).then(ns => ns.map(n => ({ id: n.id, title: n.title }))).catch(() => []),
  ]);
  const timezone = userPrefs?.timezone ?? 'Europe/Amsterdam';

  // B1 — Verbosity: compact mode for experienced users (≥100 messages) or explicit pref
  const verbosityPref = userPrefs?.reply_verbosity ?? null; // 'verbose' | 'compact' | null
  const isCompact = verbosityPref === 'compact' || (verbosityPref !== 'verbose' && user.message_count >= 100);

  // Note the message_count BEFORE incrementing, for B8 onboarding tips
  const messageCountBeforeIncrement = user.message_count ?? 0;

  let intent;
  try {
    intent = await parseIntent({ text, availableLists: lists, activeHabits, calendarStreams, notes: noteTitles, conversationHistory, userContext, timezone });
  } catch (err) {
    // B7 — Human-readable Claude API error
    console.error('[parseIntent] Claude API failure:', err.message);
    await sendMessage(from, 'Ik kan even niet nadenken 🤯 Probeer het over een minuutje nog eens.');
    await db.incrementMessageCount(userId).catch(() => {});
    return;
  }

  Promise.all([
    db.logMessage(userId, text, intent.category),
    db.incrementMessageCount(userId),
    db.trackActiveHour(userId, new Date().getHours()),
  ]).catch(err => console.error('Bookkeeping error:', err));

  if (intent.confidence === 'low') {
    const reply = intent.clarification_question ?? 'Kun je dat iets duidelijker omschrijven?';
    session.addExchange(userId, text, reply);
    await sendSplit(from, reply);
    return;
  }

  // E5 — Frustration detection: nudge unknown angry messages toward feedback
  if (intent.category === 'unknown' && FRUSTRATION_WORDS.some(w => lc.includes(w))) {
    const reply = "Dat klinkt als feedback. Zal ik dit doorsturen naar de maker? Stuur 'feedback: [jouw bericht]' om het te doen.";
    session.addExchange(userId, text, reply);
    await sendSplit(from, reply);
    return;
  }

  // Multi-action: process each sub-action and combine replies
  if (intent.category === 'multi_action' && Array.isArray(intent.actions) && intent.actions.length > 0) {
    const replies = [];
    for (const action of intent.actions) {
      const r = await processIntent({ ...action, confidence: intent.confidence }, userId, lists, activeHabits, text, from, calendarStreams, timezone, isCompact);
      if (r) replies.push(r);
    }
    const combined = replies.join('\n');
    session.addExchange(userId, text, combined);
    await sendSplit(from, combined);
    return;
  }

  // Persist any context fact Claude extracted (works alongside any intent)
  if (intent.context_fact) {
    const existing = await db.getUserContext(userId);
    const existingFacts = existing.split('\n').filter(l => !l.startsWith('Totaal berichten:'));
    if (!existingFacts.some(f => f.toLowerCase() === intent.context_fact.toLowerCase())) {
      const updated = [...existingFacts, intent.context_fact].filter(Boolean).join('\n');
      db.updateUserContext(userId, updated).catch(() => {});
    }
  }

  const baseReply = await processIntent(intent, userId, lists, activeHabits, text, from, calendarStreams, timezone, isCompact);
  if (!baseReply) return;

  const confidenceSuffix = intent.confidence === 'medium'
    ? '\n\n_Klopt dit? Zo niet, laat het me weten._'
    : '';

  // B8 — Onboarding tips for first 3 messages
  let onboardingTip = '';
  if (messageCountBeforeIncrement === 0) {
    onboardingTip = '\n\n_Tip: je kunt me ook afspraken en taken sturen._';
  } else if (messageCountBeforeIncrement === 1) {
    onboardingTip = "\n\n_Tip: Vraag me gerust 'wat staat er op mijn lijstjes?'_";
  } else if (messageCountBeforeIncrement === 2) {
    onboardingTip = "\n\n_Laatste tip: stuur 'help' als je wilt zien wat ik allemaal kan._";
  }

  const reply = baseReply + confidenceSuffix + onboardingTip + maybePersonality();
  session.addExchange(userId, text, reply);
  await sendSplit(from, reply);
}

// ── Pending action execution ───────────────────────────────────────────────────

async function executePendingAction(pending, userId) {
  try {
    switch (pending.type) {
      case 'list_clear': {
        await db.clearListItems(pending.listId);
        return `🗑️ Lijst *${pending.listName}* leeggemaakt.`;
      }
      case 'list_check_all': {
        await db.checkAllListItems(pending.listId);
        return `✅ Alle items op *${pending.listName}* afgevinkt!`;
      }
      case 'event_delete': {
        const _ci = await db.getCalendarProvider(userId).catch(() => null);
        const _cp = _ci?.calendar_provider;
        const _cc = _cp === 'iphone' || !_cp ? await db.getCalDAVCredentials(userId).catch(() => null) : null;
        await _calDelete(userId, _cp, _ci, _cc, pending.calendarStream, pending.caldavUid);
        await db.deleteEventById(userId, pending.eventId);
        return `🗑️ *${pending.eventTitle}* verwijderd uit je agenda.`;
      }
      case 'note_delete': {
        await db.deleteNote(pending.noteId);
        return `🗑️ Notitie *${pending.noteTitle}* verwijderd.`;
      }
      case 'deep_work': {
        const ci   = await db.getCalendarProvider(userId).catch(() => null);
        const cp   = ci?.calendar_provider;
        const cc   = cp === 'iphone' || !cp ? await db.getCalDAVCredentials(userId).catch(() => null) : null;
        const created = [];
        for (const slot of (pending.slots ?? [])) {
          const eventRow = await db.createEvent(userId, {
            title: '🧠 Deep work',
            date: slot.date,
            time: slot.time,
            recurrence: null,
            reminderDaysBefore: null,
            caldavUid: null,
            calendarStream: 'work',
            duration_minutes: slot.durationMins,
            is_deep_work: true,
          });
          const uid = await _calCreate(userId, cp, ci, cc, 'work', {
            title: '🧠 Deep work',
            date: slot.date,
            time: slot.time,
            durationMinutes: slot.durationMins,
          }).catch(() => null);
          if (uid && eventRow?.id) await db.updateEventCalDAVUid(eventRow.id, uid).catch(() => {});
          created.push(slot);
        }
        const lines = created.map(s => {
          const d = new Date(s.date + 'T00:00:00');
          const day = d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
          const [h, m] = s.time.split(':').map(Number);
          const endH = h + Math.floor((m + s.durationMins) / 60);
          const endM = (m + s.durationMins) % 60;
          const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
          return `• ${day} ${s.time}–${endTime}`;
        });
        return `✅ *${created.length} deep work blok${created.length === 1 ? '' : 'ken'} ingepland!*\n\n${lines.join('\n')}\n\n_Je krijgt 30 minuten van tevoren een melding. 🧠_`;
      }

      case 'birthday_gift': {
        const birthdayDate = pending.birthdayDate;
        const [y, m, d] = birthdayDate.split('-').map(Number);
        const giftDate = new Date(y, m - 1, d - 7);
        const pad = n => String(n).padStart(2, '0');
        const giftDateStr = `${giftDate.getFullYear()}-${pad(giftDate.getMonth() + 1)}-${pad(giftDate.getDate())}`;

        await db.createEvent(userId, {
          title: `🎁 Cadeau kopen voor ${pending.personName}`,
          date: giftDateStr,
          time: null,
          recurrence: 'yearly',
          reminderDaysBefore: null,
          caldavUid: null,
          calendarStream: 'personal',
        });
        return `✅ Toegevoegd: *Cadeau kopen voor ${pending.personName}* op ${formatDate(giftDateStr)} _(jaarlijks)_.`;
      }

      default:
        return 'Kan die actie niet uitvoeren.';
    }
  } catch (err) {
    console.error('Pending action error:', err);
    return 'Er ging iets mis. Probeer het opnieuw.';
  }
}

// ── Undo ───────────────────────────────────────────────────────────────────────

async function handleUndo(userId) {
  const last = undo.get(userId);
  if (!last) return 'Er is niets om ongedaan te maken (of het is meer dan 10 minuten geleden).';

  try {
    switch (last.action) {
      case 'add_item': {
        const exists = await db.listItemExists(last.data.itemId);
        if (!exists) { undo.pop(userId); return 'Er is niets om ongedaan te maken — het item bestaat niet meer.'; }
        await db.deleteListItem(last.data.itemId);
        undo.pop(userId);
        return `↩️ Ongedaan: *${last.data.text}* verwijderd uit ${last.data.listEmoji} ${last.data.listName}.`;
      }
      case 'add_items': {
        const stillExist = (await Promise.all(last.data.itemIds.map(id => db.listItemExists(id)))).filter(Boolean);
        if (!stillExist.length) { undo.pop(userId); return 'Er is niets om ongedaan te maken — de items bestaan niet meer.'; }
        for (const id of last.data.itemIds) await db.deleteListItem(id);
        undo.pop(userId);
        return `↩️ Ongedaan: ${last.data.count} items verwijderd uit ${last.data.listEmoji} ${last.data.listName}.`;
      }
      case 'add_note': {
        await db.deleteNote(last.data.noteId);
        undo.pop(userId);
        return `↩️ Ongedaan: notitie *${last.data.title}* verwijderd.`;
      }
      case 'create_list': {
        await db.deleteList(last.data.listId);
        undo.pop(userId);
        return `↩️ Ongedaan: lijst *${last.data.name}* verwijderd.`;
      }
      case 'add_recurring': {
        await db.deleteRecurringItem(last.data.itemId);
        undo.pop(userId);
        return `↩️ Ongedaan: terugkerend item *${last.data.content}* verwijderd.`;
      }
      case 'add_event': {
        const { eventId, caldavUid, calendarStream, title } = last.data;
        await db.deleteEventById(userId, eventId);
        if (caldavUid) {
          const _ci = await db.getCalendarProvider(userId).catch(() => null);
          const _cp = _ci?.calendar_provider;
          const _cc = _cp === 'iphone' || !_cp ? await db.getCalDAVCredentials(userId).catch(() => null) : null;
          await _calDelete(userId, _cp, _ci, _cc, calendarStream, caldavUid);
        }
        undo.pop(userId);
        return `↩️ Ongedaan: afspraak *${title}* verwijderd.`;
      }
      default:
        return 'Kan die actie niet ongedaan maken.';
    }
  } catch (err) {
    console.error('Undo error:', err);
    return 'Er ging iets mis bij het ongedaan maken. Probeer het opnieuw.';
  }
}

// ── Intent processing ──────────────────────────────────────────────────────────

async function processIntent(intent, userId, lists, activeHabits, originalText, from, calendarStreams = [], timezone = 'Europe/Amsterdam', isCompact = false) {
  const fmtDate = (d) => formatDate(d, timezone);
  const { category } = intent;

  switch (category) {

    // ── Single list item ─────────────────────────────────────────────────────

    case 'list': {
      if (!intent.list_id) return intent.clarification_question ?? 'Ik kan die lijst niet vinden. Welke bedoel je?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Ik kan die lijst niet vinden. Welke bedoel je?';

      const itemText = intent.item_text ?? originalText;
      const quantity  = intent.item_quantity ?? null;

      // Duplicate detection
      const existing = await db.getListItems(intent.list_id);
      const isDupe = existing.some(i => i.text.toLowerCase() === itemText.toLowerCase());
      if (isDupe) return `_${itemText}_ staat al op ${list.emoji ?? '📝'} ${list.name}.`;

      const added = await db.addListItem(intent.list_id, itemText, quantity, userId);
      undo.record(userId, 'add_item', {
        itemId: added.id, text: added.text, listName: list.name, listEmoji: list.emoji ?? '📝',
      });

      if (isCompact) return `✓ ${list.emoji ?? '📝'} ${list.name}`;
      return `✅ *${itemText}* toegevoegd aan ${list.emoji ?? '📝'} ${list.name}.`;
    }

    // ── Multiple list items ──────────────────────────────────────────────────

    case 'list_items': {
      if (!intent.list_id) return intent.clarification_question ?? 'Ik kan die lijst niet vinden. Welke bedoel je?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Ik kan die lijst niet vinden. Welke bedoel je?';

      const texts = Array.isArray(intent.item_texts) ? intent.item_texts.filter(Boolean) : [];
      if (texts.length === 0) return 'Geen items gevonden om toe te voegen.';

      const existing = await db.getListItems(intent.list_id);
      const existingLc = new Set(existing.map(i => i.text.toLowerCase()));

      const newTexts   = texts.filter(t => !existingLc.has(t.toLowerCase()));
      const dupeTexts  = texts.filter(t => existingLc.has(t.toLowerCase()));

      if (newTexts.length === 0) {
        return `Al op de lijst: ${dupeTexts.map(t => `_${t}_`).join(', ')}.`;
      }

      // For single-item list_items, pass quantity; for multi-item, quantity is per-item (not supported in Claude output for arrays)
      const singleQty = newTexts.length === 1 ? (intent.item_quantity ?? null) : null;
      const added = await Promise.all(newTexts.map(t => db.addListItem(intent.list_id, t, singleQty, userId)));
      undo.record(userId, 'add_items', {
        itemIds: added.map(a => a.id), count: added.length,
        listName: list.name, listEmoji: list.emoji ?? '📝',
      });

      if (isCompact) return `✓ ${list.emoji ?? '📝'} ${list.name} (+${newTexts.length})`;

      const addedLine = newTexts.map(t => `• ${t}`).join('\n');
      const dupeLine  = dupeTexts.length ? `\n_Al aanwezig: ${dupeTexts.join(', ')}_` : '';
      return `✅ ${newTexts.length} item(s) toegevoegd aan ${list.emoji ?? '📝'} ${list.name}:\n${addedLine}${dupeLine}`;
    }

    // ── Check if item exists on list ─────────────────────────────────────────

    case 'list_contains': {
      if (!intent.item_text) return 'Welk item wil je controleren?';
      const list = intent.list_id ? lists.find(l => l.id === intent.list_id) : lists[0];
      if (!list) return 'Je hebt nog geen lijsten.';
      const items = await db.getListItems(list.id);
      const found = fuzzyFindItem(items, intent.item_text);
      if (!found) return `_${intent.item_text}_ staat niet op ${list.emoji ?? '📝'} ${list.name}.`;
      const status = found.checked ? '✅ al afgevinkt' : '▫️ nog open';
      return `Ja, *${found.text}* staat op ${list.emoji ?? '📝'} ${list.name} (${status}).`;
    }

    // ── Query list ───────────────────────────────────────────────────────────

    case 'list_query': {
      const list = intent.list_id ? lists.find(l => l.id === intent.list_id) : lists[0];
      if (!list) return 'Je hebt nog geen lijsten.';
      const items = await db.getListItems(list.id);
      if (items.length === 0) return `${list.emoji ?? '📝'} *${list.name}* is leeg.`;
      const open   = items.filter(i => !i.checked);
      const done   = items.filter(i => i.checked);
      const lines  = open.map((i, idx) => `${idx + 1}. ▫️ ${i.text}`).join('\n');
      const suffix = done.length ? `\n\n_${done.length} item(s) al afgevinkt._` : '';
      return `${list.emoji ?? '📝'} *${list.name}*\n\n${lines}${suffix}`;
    }

    // ── Query all lists ──────────────────────────────────────────────────────

    case 'list_all_query': {
      if (lists.length === 0) return 'Je hebt nog geen lijsten aangemaakt.';
      const summaries = await Promise.all(lists.map(async l => {
        const items = await db.getListItems(l.id);
        const open = items.filter(i => !i.checked).length;
        return `${l.emoji ?? '📝'} *${l.name}* — ${open} open`;
      }));
      return `📋 *Jouw lijsten*\n\n${summaries.join('\n')}`;
    }

    // ── All open items ───────────────────────────────────────────────────────

    case 'list_all_open': {
      const allOpen = await db.getAllUncheckedItems(userId);
      if (allOpen.length === 0) return '🎉 Alles is afgevinkt! Niets open.';

      const byList = {};
      for (const item of allOpen) {
        const key = item.list_id;
        if (!byList[key]) byList[key] = { list: item.list, items: [] };
        byList[key].items.push(item.text);
      }

      const blocks = Object.values(byList).map(({ list, items }) =>
        `${list.emoji ?? '📝'} *${list.name}*\n${items.map(t => `• ${t}`).join('\n')}`
      );
      return `📋 *Alles wat nog open staat*\n\n${blocks.join('\n\n')}`;
    }

    // ── Rename list ──────────────────────────────────────────────────────────

    case 'list_rename': {
      if (!intent.list_id || !intent.list_name) return 'Welke lijst wil je hernomen en naar wat?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';
      await db.renameList(intent.list_id, intent.list_name);
      return `✅ Lijst hernoemd naar *${intent.list_name}*.`;
    }

    // ── Check/uncheck item ───────────────────────────────────────────────────

    case 'list_check': {
      if (!intent.list_id || !intent.item_text) return 'Welk item op welke lijst?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';

      const items  = await db.getListItems(intent.list_id);
      const target = fuzzyFindItem(items, intent.item_text);
      if (!target) return `_${intent.item_text}_ staat niet op ${list.emoji ?? '📝'} ${list.name}.`;

      const checked = intent.checked !== false;
      await db.checkListItem(target.id, checked);
      return checked
        ? `✅ *${target.text}* afgevinkt op ${list.emoji ?? '📝'} ${list.name}.`
        : `↩️ *${target.text}* teruggezet op ${list.emoji ?? '📝'} ${list.name}.`;
    }

    // ── Rename item ──────────────────────────────────────────────────────────

    case 'list_item_rename': {
      if (!intent.list_id || !intent.old_text || !intent.new_text) return 'Geef op: welke lijst, de huidige tekst en de nieuwe tekst.';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';

      const items  = await db.getListItems(intent.list_id);
      const target = fuzzyFindItem(items, intent.old_text);
      if (!target) return `_${intent.old_text}_ staat niet op ${list.emoji ?? '📝'} ${list.name}.`;

      await db.updateListItemText(target.id, intent.new_text);
      return `✏️ *${target.text}* → *${intent.new_text}* op ${list.emoji ?? '📝'} ${list.name}.`;
    }

    // ── Remove item ──────────────────────────────────────────────────────────

    case 'list_remove': {
      if (!intent.list_id || !intent.item_text) return 'Welk item wil je verwijderen?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';

      const items  = await db.getListItems(intent.list_id);
      const target = fuzzyFindItem(items, intent.item_text);
      if (!target) return `_${intent.item_text}_ staat niet op ${list.emoji ?? '📝'} ${list.name}.`;

      await db.deleteListItem(target.id);
      return `🗑️ *${target.text}* verwijderd van ${list.emoji ?? '📝'} ${list.name}.`;
    }

    // ── Clear list (with confirmation) ───────────────────────────────────────

    case 'list_clear': {
      if (!intent.list_id) return 'Welke lijst wil je leegmaken?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';

      confirm.set(userId, { type: 'list_clear', listId: list.id, listName: list.name });
      return `⚠️ *${list.emoji ?? '📝'} ${list.name}* leegmaken? Alle items worden verwijderd.\n\nStuur *ja* om te bevestigen of *nee* om te annuleren.`;
    }

    // ── Check all items (with confirmation) ──────────────────────────────────

    case 'list_check_all': {
      if (!intent.list_id) return 'Welke lijst wil je volledig afvinken?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';

      confirm.set(userId, { type: 'list_check_all', listId: list.id, listName: list.name });
      return `Alle items op *${list.emoji ?? '📝'} ${list.name}* afvinken?\n\nStuur *ja* om te bevestigen.`;
    }

    // ── Move item ────────────────────────────────────────────────────────────

    case 'list_move': {
      if (!intent.list_id || !intent.target_list_id || !intent.item_text) {
        return 'Geef op: welk item, van welke lijst, naar welke lijst.';
      }
      const srcList = lists.find(l => l.id === intent.list_id);
      const dstList = lists.find(l => l.id === intent.target_list_id);
      if (!srcList || !dstList) return 'Een van de lijsten kon ik niet vinden.';

      const items  = await db.getListItems(intent.list_id);
      const target = fuzzyFindItem(items, intent.item_text);
      if (!target) return `_${intent.item_text}_ staat niet op ${srcList.emoji ?? '📝'} ${srcList.name}.`;

      await db.moveListItem(target.id, intent.target_list_id);
      return `↗️ *${target.text}* verplaatst naar ${dstList.emoji ?? '📝'} ${dstList.name}.`;
    }

    // ── Correct last item ────────────────────────────────────────────────────

    case 'correct_last': {
      const last = undo.get(userId);
      if (!last) return 'Er is niets om te corrigeren.';

      const newText = intent.correct_to;
      if (!newText) return 'Wat moet het worden?';

      if (last.action === 'add_item') {
        await db.updateListItemText(last.data.itemId, newText);
        const oldText = last.data.text;
        undo.pop(userId);
        undo.record(userId, 'add_item', { ...last.data, text: newText });
        return `✏️ *${oldText}* → *${newText}*.`;
      }

      if (last.action === 'add_event') {
        await db.updateEventTitle(last.data.eventId, newText);
        const oldTitle = last.data.title;
        undo.pop(userId);
        undo.record(userId, 'add_event', { ...last.data, title: newText });
        return `✏️ Afspraak *${oldTitle}* → *${newText}*.`;
      }

      return 'Kan die actie niet corrigeren.';
    }

    // ── New list ─────────────────────────────────────────────────────────────

    case 'new_list': {
      const name  = intent.new_list_name ?? originalText;
      const emoji = intent.emoji ?? '📝';
      const newList = await db.createList(userId, name, emoji, intent.list_type ?? 'checklist');
      undo.record(userId, 'create_list', { listId: newList.id, name: newList.name });

      if (intent.item_text) {
        await db.addListItem(newList.id, intent.item_text, null, userId);
        return `✅ Nieuwe lijst ${emoji} *${newList.name}* aangemaakt met *${intent.item_text}*.`;
      }
      return `✅ Nieuwe lijst ${emoji} *${newList.name}* aangemaakt.`;
    }

    // ── Recurring item ───────────────────────────────────────────────────────

    case 'recurring_item': {
      if (!intent.list_id || !intent.item_text || !intent.recurrence) {
        return 'Geef op: welk item, op welke lijst, en hoe vaak (bijv. "elke vrijdag: koffie kopen op de boodschappenlijst").';
      }
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';

      const nextDue = calcFirstDue(intent.recurrence);
      const created = await db.createRecurringItem(userId, intent.list_id, intent.item_text, intent.recurrence, nextDue);
      undo.record(userId, 'add_recurring', { itemId: created.id, content: created.content });

      const label = recurrenceToLabel(intent.recurrence);
      return `🔄 Terugkerend item aangemaakt: *${intent.item_text}* wordt ${label} toegevoegd aan ${list.emoji ?? '📝'} ${list.name}.\n_Eerste keer: ${fmtDate(nextDue)}_`;
    }

    // ── Calendar ─────────────────────────────────────────────────────────────

    case 'calendar': {
      // Multi-event support: use events[] array if present, else fall back to single fields
      const eventList = Array.isArray(intent.events) && intent.events.length > 0
        ? intent.events
        : [{
            title:                   intent.event_title ?? originalText,
            date:                    intent.event_date,
            time:                    intent.event_time ?? null,
            recurrence:              intent.event_recurrence ?? null,
            reminder_days_before:    intent.reminder_days_before ?? null,
            reminder_minutes_before: intent.reminder_minutes_before ?? null,
            calendar_stream:         intent.calendar_stream ?? 'personal',
            duration_minutes:        intent.event_duration_minutes ?? null,
            attendees:               intent.event_attendees ?? null,
            location:                intent.event_location ?? null,
          }];

      // If non-yearly recurring event without end date → ask for clarification first
      const recurEv = eventList.find(ev => ev.recurrence && ev.recurrence !== 'yearly' && !intent.recurrence_until);
      if (recurEv) {
        const recLabel = recurEv.recurrence === 'daily' ? 'dagelijks'
          : recurEv.recurrence?.startsWith('monthly') ? 'maandelijks'
          : 'wekelijks';
        const example = recurEv.recurrence?.startsWith('monthly')
          ? 'een half jaar lang elke maand (6×)'
          : recurEv.recurrence === 'daily'
          ? '2 weken lang elke dag (14×)'
          : '3 maanden lang elke week (13×)';

        session.setPendingRecurring(userId, {
          eventTitle:      recurEv.title ?? intent.event_title ?? originalText,
          eventTime:       recurEv.time ?? null,
          eventRecurrence: recurEv.recurrence,
          calendarStream:  recurEv.calendar_stream ?? intent.calendar_stream ?? 'personal',
          startDate:       recurEv.date ?? new Date().toISOString().split('T')[0],
          durationMinutes: recurEv.duration_minutes ?? null,
          reminderMinutes: intent.reminder_minutes_before ?? 30,
        });
        return `🔄 *${recurEv.title ?? intent.event_title}* — ${recLabel} inplannen.\n\nTot wanneer en hoe vaak?\n_Bijv: ${example}_`;
      }

      // Determine calendar provider + credentials
      const calInfo   = await db.getCalendarProvider(userId).catch(() => null);
      const calProvider = calInfo?.calendar_provider ?? (calInfo?.caldav_username ? 'iphone' : null);

      let caldavCreds = null;
      let isNewCalDAVUser = false;

      if (calProvider === 'none') {
        // User explicitly opted out — no calendar sync
      } else if (calProvider === 'google' || calProvider === 'outlook') {
        // External OAuth provider — tokens already stored, nothing to provision
      } else {
        // iPhone / CalDAV (including null = not set yet, backward compat)
        if (caldav.isConfigured()) {
          caldavCreds = await db.getCalDAVCredentials(userId);
          if (!caldavCreds) {
            try {
              const { username, password } = caldav.generateCredentials(userId);
              await caldav.provisionUser(username, password);
              await db.storeCalDAVCredentials(userId, username, password);
              caldavCreds = { username, password };
              isNewCalDAVUser = true;
            } catch (err) {
              console.error('CalDAV provisioning failed:', err.message);
              return '⚠️ Er is een technisch probleem met je agenda. Probeer het later nog eens of neem contact op met Lucas.';
            }
          }
        }
      }

      const lines = [];
      let lastSavedEvent = null;
      let hasBirthday = false;
      let birthdayInfo = null;

      for (const ev of eventList) {
        const evTitle         = ev.title ?? intent.event_title ?? originalText;
        const reminderDays    = ev.reminder_days_before ?? null;
        const reminderMinutes = ev.reminder_minutes_before ?? (intent.urgent ? 60 : 30);

        // Smart time default: fill in learned preferred time if user omitted time
        if (!ev.time) {
          const suggested = await timeDefaults.getSuggestedTime(userId, evTitle);
          if (suggested) ev.time = suggested;
        }
        const stream          = ev.calendar_stream ?? intent.calendar_stream ?? 'personal';
        const durationMinutes    = ev.duration_minutes ?? null;
        const attendees          = Array.isArray(ev.attendees) && ev.attendees.length > 0 ? ev.attendees : null;
        const location           = ev.location ?? null;
        const recurrenceUntil    = intent.recurrence_until ?? null;

        // D3 — Conflict check: warn if another timed event is within 30 minutes
        if (ev.time && ev.date) {
          const existing = await db.getEventsForDate(userId, ev.date);
          const [newH, newM] = ev.time.split(':').map(Number);
          const newTotalMins = newH * 60 + newM;
          const conflict = existing.find(e => {
            if (e.title === evTitle) return false;
            const [eH, eM] = (e.time ?? '').split(':').map(Number);
            if (isNaN(eH)) return false;
            const eTotalMins = eH * 60 + eM;
            return Math.abs(newTotalMins - eTotalMins) <= 30;
          });
          if (conflict) {
            lines.push(`⚠️ Let op: *${conflict.title}* staat ook op ${fmtDate(ev.date)} om ${conflict.time} (binnen 30 min).`);
          }
        }

        let caldavUid = null;
        try {
          caldavUid = await _calCreate(userId, calProvider, calInfo, caldavCreds, stream, {
            title: evTitle, date: ev.date, time: ev.time ?? null,
            recurrence: ev.recurrence ?? null, recurrenceUntil,
            reminderDaysBefore: reminderDays, reminderMinutesBefore: reminderMinutes,
            durationMinutes, attendees, location,
          });
        } catch (err) {
          console.error('Calendar event creation failed, queuing retry:', err.message);
          if (calProvider === 'iphone' || !calProvider) {
            await db.enqueueCalDAVOperation(userId, 'create_event', {
              stream, title: evTitle, date: ev.date, time: ev.time ?? null,
              recurrence: ev.recurrence ?? null, reminderDaysBefore: reminderDays,
            }).catch(() => {});
          }
        }

        // If non-yearly recurring with end date: expand to individual DB events for app display
        if (ev.recurrence && ev.recurrence !== 'yearly' && recurrenceUntil) {
          const intervalType = ev.recurrence === 'daily' ? 'daily' : ev.recurrence.startsWith('monthly') ? 'monthly' : 'weekly';
          const dates = generateRecurringDates(ev.date, intervalType, recurrenceUntil);
          for (let i = 0; i < dates.length; i++) {
            const s = await db.createEvent(userId, {
              title: evTitle, date: dates[i], time: ev.time ?? null,
              recurrence: null, reminderDaysBefore: null,
              caldavUid: i === 0 ? caldavUid : null, calendarStream: stream,
            }).catch(() => null);
            if (i === 0 && s) lastSavedEvent = { id: s.id, title: evTitle, date: dates[0], time: ev.time ?? null, caldavUid, calendarStream: stream };
          }
          const intervalLabel = intervalType === 'daily' ? 'dagelijks' : intervalType === 'monthly' ? 'elke maand' : 'elke week';
          lines.push(`• *Ingepland* — *${evTitle}* 🔄 ${dates.length}× ${intervalLabel} t/m ${fmtDate(recurrenceUntil)}`);
          continue;
        }

        // D2 — Store birth_year if provided (for birthday age display in reminders)
        const birthYear = (stream === 'birthdays' && intent.birth_year) ? intent.birth_year : null;
        const saved = await db.createEventWithBirthYear(userId, {
          title: evTitle,
          date: ev.date,
          time: ev.time ?? null,
          recurrence: ev.recurrence ?? null,
          reminderDaysBefore: reminderDays,
          caldavUid,
          calendarStream: stream,
          birth_year: birthYear,
        });

        lastSavedEvent = { id: saved.id, title: evTitle, date: ev.date, time: ev.time ?? null, caldavUid, calendarStream: stream };
        undo.record(userId, 'add_event', { eventId: saved.id, title: evTitle, caldavUid, calendarStream: stream });
        if (ev.time) timeDefaults.recordEventTime(userId, evTitle, ev.time).catch(() => {});

        if (stream === 'birthdays') {
          hasBirthday = true;
          birthdayInfo = { title: evTitle, date: ev.date };
        }

        const builtinLabel = { appointments: 'Afspraak', birthdays: 'Verjaardag', work: 'Werkafspraak', personal: 'Ingepland' }[stream];
        const customStream = !builtinLabel ? calendarStreams.find(s => s.claude_key === stream) : null;
        const streamLabel  = builtinLabel ?? customStream?.name ?? 'Ingepland';
        const timeStr     = ev.time ? ` om ${ev.time}` : '';
        const dateStr     = ev.date ? ` — ${fmtDate(ev.date)}${timeStr}` : '';
        const recurStr    = ev.recurrence === 'yearly' ? ' _(jaarlijks)_'
          : ev.recurrence?.startsWith('weekly:') ? ' _(wekelijks)_'
          : ev.recurrence?.startsWith('monthly:') ? ' _(maandelijks)_'
          : '';
        const reminderStr = reminderMinutes ? ` _(reminder ${reminderMinutes} min van tevoren)_` : reminderDays ? ` _(reminder ${reminderDays} dag${reminderDays !== 1 ? 'en' : ''} van tevoren)_` : '';
        const durationStr = durationMinutes ? ` _(${durationMinutes % 60 === 0 ? `${durationMinutes / 60}u` : `${durationMinutes}min`})_` : '';
        const attendeeStr = attendees ? ` _(met ${attendees.join(', ')})_` : '';
        const locationStr = location ? ` _(📍 ${location})_` : '';
        const mapsUrl    = location ? `\nhttps://maps.google.com/?q=${encodeURIComponent(location)}` : '';
        lines.push(`• *${streamLabel}* — *${evTitle}*${dateStr}${recurStr}${durationStr}${attendeeStr}${locationStr}${reminderStr}${mapsUrl}`);
      }

      if (lastSavedEvent) {
        session.setLastEvent(userId, lastSavedEvent);
        // Fire-and-forget push to sync event directly to native iOS calendar
        sendCalendarPush(userId, lastSavedEvent).catch(() => {});
      }

      // Send CalDAV onboarding as a follow-up message on first provisioning
      if (isNewCalDAVUser && caldavCreds) {
        setTimeout(() => sendMessage(from, buildCalDAVOnboardingMessage(caldavCreds.username, caldavCreds.password)), 800);
      }

      // Birthday gift follow-up
      if (hasBirthday && birthdayInfo) {
        const personName = birthdayInfo.title.replace(/verjaardag\s*/i, '').trim();
        confirm.set(userId, { type: 'birthday_gift', birthdayTitle: birthdayInfo.title, birthdayDate: birthdayInfo.date, personName });
        setTimeout(() => sendMessage(from, `🎁 Wil je dat ik ook het kopen van een cadeautje voor *${personName}* 1 week van tevoren in je agenda zet?`), 600);
      }

      if (lines.length === 1) {
        return `📅 ${lines[0].slice(2)}.`;
      }
      return `📅 Ingepland:\n${lines.join('\n')}`;
    }

    // ── Add reminder to existing event ───────────────────────────────────────

    case 'event_update_reminder': {
      const lastEv = session.getLastEvent(userId);
      const searchTitle = intent.event_title ?? lastEv?.title;
      if (!searchTitle && !lastEv) return 'Welke afspraak bedoel je?';

      const matches = searchTitle ? await db.getEventsByTitle(userId, searchTitle) : [];
      const event   = matches[0] ?? lastEv;
      if (!event) return 'Geen recente afspraak gevonden om een reminder aan toe te voegen.';

      const mins = intent.reminder_minutes_before ?? 30;

      // Update calendar: delete old + recreate with reminder (or update in-place for Google/Outlook)
      const _ci2 = await db.getCalendarProvider(userId).catch(() => null);
      const _cp2 = _ci2?.calendar_provider;
      const caldavCreds2 = _cp2 === 'iphone' || !_cp2 ? (caldav.isConfigured() ? await db.getCalDAVCredentials(userId) : null) : null;
      if (event.caldavUid) {
        try {
          const newUid = await _calUpdate(userId, _cp2, _ci2, caldavCreds2, event.calendarStream, event.caldavUid, {
            title: event.title, date: event.date, time: event.time ?? null,
            recurrence: event.recurrence ?? null, reminderMinutesBefore: mins,
          });
          if (newUid && newUid !== event.caldavUid) {
            await db.updateEventCalDAVUid(event.id, newUid);
          }
          session.setLastEvent(userId, { ...event, caldavUid: newUid ?? event.caldavUid });
        } catch (err) {
          console.error('Calendar reminder update failed:', err.message);
        }
      }
      const timeStr = event.date ? ` vóór *${event.title}* op ${fmtDate(event.date)}` : ` vóór *${event.title}*`;
      return `⏰ Ik stuur je ${mins} minuten van tevoren een reminder${timeStr} via de agenda.`;
    }

    // ── Reschedule event ─────────────────────────────────────────────────────

    case 'event_reschedule': {
      const title = intent.event_title;
      if (!title) return 'Welke afspraak wil je verplaatsen?';
      const matches = await db.getEventsByTitle(userId, title);
      if (matches.length === 0) return `Geen afspraak gevonden met "${title}".`;
      const event = matches[0];

      // Support date offsets like "+1d", "-2d"
      let newDate = intent.event_date_new ?? event.date;
      if (intent.event_date_offset && event.date) {
        const match = String(intent.event_date_offset).match(/^([+-])(\d+)d$/);
        if (match) {
          const d = new Date(event.date);
          d.setDate(d.getDate() + parseInt(match[1] + match[2]));
          newDate = d.toISOString().split('T')[0];
        }
      }
      let newTime = intent.event_time_new ?? event.time;

      // Handle relative time: "relatief:+1h"
      if (newTime?.startsWith('relatief:')) {
        const offset = newTime.replace('relatief:', '');
        if (offset.startsWith('+') && offset.endsWith('h') && event.time) {
          const [h, m] = event.time.split(':').map(Number);
          const addH = parseInt(offset.slice(1));
          const newH = (h + addH) % 24;
          newTime = `${String(newH).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
        } else {
          newTime = event.time;
        }
      }

      await db.updateEvent(userId, event.id, { date: newDate, time: newTime });

      // Sync to calendar provider
      if (event.caldavUid) {
        try {
          const _ci3 = await db.getCalendarProvider(userId).catch(() => null);
          const _cp3 = _ci3?.calendar_provider;
          const _cc3 = _cp3 === 'iphone' || !_cp3 ? (caldav.isConfigured() ? await db.getCalDAVCredentials(userId) : null) : null;
          const newUid = await _calUpdate(userId, _cp3, _ci3, _cc3, event.calendarStream, event.caldavUid, {
            title: event.title, date: newDate, time: newTime ?? null,
            recurrence: event.recurrence ?? null, reminderMinutesBefore: null,
          });
          if (newUid && newUid !== event.caldavUid) {
            await db.updateEventCalDAVUid(event.id, newUid);
          }
          session.setLastEvent(userId, { ...event, caldavUid: newUid ?? event.caldavUid, date: newDate, time: newTime });
        } catch (err) {
          console.error('Calendar reschedule failed:', err.message);
        }
      }

      const dateStr = newDate ? ` naar ${fmtDate(newDate)}` : '';
      const timeStr = newTime ? ` om ${newTime}` : '';
      return `📅 *${event.title}* verplaatst${dateStr}${timeStr}.`;
    }

    // ── Rename event ─────────────────────────────────────────────────────────

    case 'event_rename': {
      const renameTitle = intent.event_title;
      const newTitle    = intent.new_title;
      if (!renameTitle || !newTitle) return 'Geef de huidige naam van de afspraak en de nieuwe naam.';
      const matches = await db.getEventsByTitle(userId, renameTitle);
      if (matches.length === 0) return `Geen afspraak gevonden met "${renameTitle}".`;
      const event = matches[0];

      await db.updateEventTitle(event.id, newTitle);

      // Update CalDAV/Google/Outlook if synced
      if (event.caldavUid) {
        try {
          const _ci4 = await db.getCalendarProvider(userId).catch(() => null);
          const _cp4 = _ci4?.calendar_provider ?? (_ci4?.caldav_username ? 'iphone' : null);
          const _cc4 = _cp4 === 'iphone' || !_cp4 ? (caldav.isConfigured() ? await db.getCalDAVCredentials(userId) : null) : null;
          const newUid = await _calUpdate(userId, _cp4, _ci4, _cc4, event.calendarStream, event.caldavUid, {
            title: newTitle, date: event.date, time: event.time ?? null,
            recurrence: event.recurrence ?? null, reminderMinutesBefore: null,
          });
          if (newUid && newUid !== event.caldavUid) {
            await db.updateEventCalDAVUid(event.id, newUid);
          }
        } catch (err) {
          console.error('Calendar rename sync failed:', err.message);
        }
      }

      return `📅 *${event.title}* hernoemd naar *${newTitle}*.`;
    }

    // ── Search event ─────────────────────────────────────────────────────────

    case 'event_search': {
      const query = intent.event_search_query ?? intent.event_title;
      if (!query) return 'Welke afspraak zoek je?';
      const matches = await db.getEventsByTitle(userId, query);
      if (matches.length === 0) return `Geen afspraak gevonden voor "${query}".`;
      const lines = matches.slice(0, 3).map(e => {
        const timeStr = e.time ? ` om ${e.time}` : '';
        return `• *${e.title}* — ${fmtDate(e.date)}${timeStr}`;
      });
      return `📅 Gevonden:\n${lines.join('\n')}`;
    }

    // ── Events summary (other period) ────────────────────────────────────────

    case 'events_summary': {
      const start = intent.summary_start;
      const end   = intent.summary_end;
      if (!start || !end) return 'Voor welke periode wil je een overzicht?';
      const events = await db.getUpcomingEvents(userId, 365);
      const filtered = events.filter(e => e.date && e.date >= start && e.date <= end);
      if (filtered.length === 0) return `📅 Geen afspraken gevonden tussen ${fmtDate(start)} en ${fmtDate(end)}.`;
      const lines = filtered.map(e => {
        const timeStr = e.time ? ` om ${e.time}` : '';
        return `• *${e.title}* — ${fmtDate(e.date)}${timeStr}`;
      });
      return `📅 *Planning ${fmtDate(start)} t/m ${fmtDate(end)}*\n\n${lines.join('\n')}`;
    }

    // ── Receipt query ─────────────────────────────────────────────────────────

    case 'receipt_query': {
      const period = intent.query_period ?? 'this_month';
      const now = new Date();
      let startDate, endDate;

      if (period === 'this_month') {
        startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        endDate = now.toISOString().split('T')[0];
      } else if (period === 'last_month') {
        const lm  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lme = new Date(now.getFullYear(), now.getMonth(), 0);
        startDate = lm.toISOString().split('T')[0];
        endDate   = lme.toISOString().split('T')[0];
      } else if (period === 'this_week') {
        const d = new Date(); d.setHours(0, 0, 0, 0);
        const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
        d.setDate(d.getDate() - dow);
        startDate = d.toISOString().split('T')[0];
        endDate   = now.toISOString().split('T')[0];
      } else {
        startDate = null; endDate = null;
      }

      const receipts = await db.getReceipts(userId);
      const filtered = startDate
        ? receipts.filter(r => r.date && r.date >= startDate && r.date <= endDate)
        : receipts;

      if (filtered.length === 0) return '🧾 Geen bonnetjes gevonden voor die periode.';

      const total = filtered.reduce((s, r) => s + (r.total ?? 0), 0);
      const byStore = {};
      for (const r of filtered) {
        const store = r.store ?? 'Onbekend';
        byStore[store] = (byStore[store] ?? 0) + (r.total ?? 0);
      }
      const topStores = Object.entries(byStore)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([store, amt]) => `• ${store}: €${Number(amt).toFixed(2)}`)
        .join('\n');

      const periodLabel = period === 'this_month' ? 'deze maand'
        : period === 'last_month' ? 'vorige maand'
        : period === 'this_week' ? 'deze week'
        : 'totaal';
      return `🧾 *Uitgaven ${periodLabel}*\n\n💶 *€${total.toFixed(2)}* bij ${filtered.length} aankopen\n\nTop winkels:\n${topStores}`;
    }

    // ── Events today ─────────────────────────────────────────────────────────

    case 'events_today': {
      const todayEvents = await db.getTodayEvents(userId);
      if (todayEvents.length === 0) return '📅 Je hebt vandaag geen afspraken.';
      const lines = todayEvents.map(e => `• *${e.title}*${e.time ? ` — ${e.time}` : ''}`).join('\n');
      return `📅 *Vandaag*\n\n${lines}`;
    }

    // ── Events this week ─────────────────────────────────────────────────────

    case 'events_week': {
      const weekEvents = await db.getUpcomingEvents(userId, 7);
      if (weekEvents.length === 0) return '📅 Je hebt deze week geen afspraken.';
      const lines = weekEvents.map(e => {
        const timeStr = e.time ? ` ${e.time}` : '';
        return `• *${e.title}* — ${fmtDate(e.date)}${timeStr}`;
      }).join('\n');
      return `📅 *Planning deze week*\n\n${lines}`;
    }

    // ── Delete event (with confirmation) ─────────────────────────────────────

    case 'event_delete': {
      const title = intent.event_title;
      if (!title) return 'Welke afspraak wil je verwijderen?';

      const matches = await db.getEventsByTitle(userId, title);
      if (matches.length === 0) return `Geen afspraak gevonden met "${title}".`;

      const event = matches[0];
      confirm.set(userId, { type: 'event_delete', eventId: event.id, eventTitle: event.title, caldavUid: event.caldav_uid ?? null, calendarStream: event.calendar_stream ?? 'personal' });
      return `⚠️ *${event.title}* verwijderen uit je agenda?\n\nStuur *ja* om te bevestigen.`;
    }

    // ── Events conflict check ─────────────────────────────────────────────────

    case 'events_conflict': {
      const checkDate = intent.conflict_date ?? new Date().toISOString().split('T')[0];
      const events = await db.getEventsForDate(userId, checkDate);
      const timed = events.filter(e => e.time).sort((a, b) => (a.time > b.time ? 1 : -1));
      const conflicts = [];
      for (let i = 0; i < timed.length - 1; i++) {
        if (timed[i].time === timed[i + 1].time) {
          conflicts.push(`• *${timed[i].title}* en *${timed[i + 1].title}* — beiden om ${timed[i].time}`);
        }
      }
      if (conflicts.length === 0) return `✅ Geen dubbel geplande afspraken op ${fmtDate(checkDate)}.`;
      return `⚠️ *Dubbel geplande afspraken op ${fmtDate(checkDate)}:*\n\n${conflicts.join('\n')}`;
    }

    // ── Bulk reschedule ───────────────────────────────────────────────────────

    case 'events_bulk_reschedule': {
      const fromDate = intent.from_date;
      const toDate   = intent.to_date;
      if (!fromDate || !toDate) return 'Geef op: van welke datum en naar welke datum.';
      const events = await db.getEventsForDateRange(userId, fromDate, fromDate);
      if (events.length === 0) return `📅 Geen afspraken gevonden op ${fmtDate(fromDate)}.`;
      await db.bulkUpdateEventDate(userId, events.map(e => e.id), toDate);
      return `📅 ${events.length} afspraak${events.length !== 1 ? 'en' : ''} verplaatst van ${fmtDate(fromDate)} naar ${fmtDate(toDate)}.`;
    }

    // ── Find free slots ───────────────────────────────────────────────────────

    case 'find_free_slots': {
      const slotDate = intent.slot_date ?? new Date().toISOString().split('T')[0];
      const events = await db.getEventsForDate(userId, slotDate);
      const timed  = events.filter(e => e.time).sort((a, b) => a.time > b.time ? 1 : -1);

      const slots   = [];
      const dayStart = '09:00';
      const dayEnd   = '20:00';
      let prevEnd = dayStart;

      for (const e of timed) {
        if (e.time > prevEnd) slots.push(`${prevEnd} – ${e.time}`);
        const [h, m] = e.time.split(':').map(Number);
        const endH = (h + 1) % 24;
        prevEnd = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
      if (prevEnd < dayEnd) slots.push(`${prevEnd} – ${dayEnd}`);

      if (slots.length === 0) return `📅 Geen vrije slots op ${fmtDate(slotDate)} (09:00–20:00). Je agenda zit vol!`;
      return `📅 *Vrije slots op ${fmtDate(slotDate)}:*\n\n${slots.map(s => `• ${s}`).join('\n')}`;
    }

    // ── Schedule deep work blocks ─────────────────────────────────────────────

    case 'schedule_deep_work': {
      const blockCount    = Math.min(intent.block_count ?? 1, 7);
      const durationMins  = intent.block_duration_minutes ?? 90;
      const prefTime      = intent.preferred_time ?? 'any'; // 'morning' | 'afternoon' | 'any'
      const weekOff       = intent.week_offset ?? 0;

      const timeToMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const minsToTime = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

      const winStart = prefTime === 'afternoon' ? 800  : 540;  // 13:20 or 09:00 (in mins)
      const winEnd   = prefTime === 'morning'   ? 720  : (prefTime === 'afternoon' ? 1080 : 1080); // 12:00 or 18:00

      // Build date range: this/next week Mon–Sun (skip past days)
      const todayStr = new Date().toISOString().split('T')[0];
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOff * 7);

      const weekDates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday); d.setDate(monday.getDate() + i);
        return d.toISOString().split('T')[0];
      }).filter(d => d >= todayStr);

      const foundSlots = [];
      for (const date of weekDates) {
        if (foundSlots.length >= blockCount) break;
        const dayEvents = await db.getEventsForDate(userId, date);
        const timed = dayEvents.filter(e => e.time).sort((a, b) => a.time.localeCompare(b.time));
        let prev = winStart;

        for (const e of timed) {
          const eStart = timeToMins(e.time);
          const gap = Math.min(eStart, winEnd) - prev;
          if (gap >= durationMins) {
            foundSlots.push({ date, time: minsToTime(prev), durationMins });
            if (foundSlots.length >= blockCount) break;
          }
          prev = Math.max(prev, eStart + (e.duration_minutes ?? 60));
        }

        if (foundSlots.length < blockCount) {
          const remaining = winEnd - prev;
          if (remaining >= durationMins) {
            foundSlots.push({ date, time: minsToTime(prev), durationMins });
          }
        }
      }

      if (foundSlots.length === 0) {
        return `📅 Ik kon geen vrije blokken van ${durationMins} minuten vinden ${weekOff === 0 ? 'deze week' : 'volgende week'}. Je agenda zit vol in die periode!`;
      }
      if (foundSlots.length < blockCount) {
        // Found fewer than requested — still offer what we have
      }

      const lines = foundSlots.map((s, i) => {
        const d = new Date(s.date + 'T00:00:00');
        const day = d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' });
        const endMins = timeToMins(s.time) + s.durationMins;
        const endTime = minsToTime(endMins);
        return `${i + 1}. ${day} — ${s.time}–${endTime}`;
      });

      const prefix = foundSlots.length < blockCount
        ? `Ik vond maar ${foundSlots.length} vrij${foundSlots.length === 1 ? '' : 'e'} blok${foundSlots.length === 1 ? '' : 'ken'} (je vroeg er ${blockCount}):`
        : `Hier zijn ${foundSlots.length} deep work blok${foundSlots.length === 1 ? '' : 'ken'} die ik voor je kan inplannen:`;

      confirm.set(userId, { type: 'deep_work', slots: foundSlots });
      return `🧠 ${prefix}\n\n${lines.join('\n')}\n\nTyp *ja* om ze in te plannen.`;
    }

    // ── List categorize ───────────────────────────────────────────────────────

    case 'list_categorize': {
      if (!intent.list_id) return 'Welke lijst wil je gecategoriseerd zien?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';
      const items = await db.getListItems(intent.list_id);
      const open  = items.filter(i => !i.checked);
      if (open.length === 0) return `${list.emoji ?? '📝'} ${list.name} heeft geen open items.`;

      const CAT_MAP = {
        '🥦 Groenten & fruit':    ['appel', 'peer', 'banaan', 'sinaasappel', 'citroen', 'tomaat', 'komkommer', 'paprika', 'ui', 'knoflook', 'aardappel', 'wortel', 'broccoli', 'sla', 'spinazie', 'avocado', 'druiven', 'aardbei', 'mango', 'ananas', 'courgette', 'champignon', 'bloemkool', 'prei', 'sperzieboon', 'bospeen'],
        '🥛 Zuivel & eieren':     ['melk', 'yoghurt', 'kwark', 'kaas', 'boter', 'room', 'ei', 'eieren', 'creme fraiche', 'vla', 'slagroom', 'halfvolle', 'skyr', 'karnemelk'],
        '🍞 Brood & bakkerij':    ['brood', 'croissant', 'beschuit', 'cracker', 'pita', 'wrap', 'bagel', 'broodje', 'stokbrood', 'toast', 'knäckebröd'],
        '🥩 Vlees & vis':         ['kip', 'gehakt', 'biefstuk', 'varkensvlees', 'lam', 'spek', 'worst', 'ham', 'zalm', 'tonijn', 'makreel', 'garnalen', 'mosselen', 'tartaar', 'kipfilet'],
        '🥫 Houdbaar':            ['pasta', 'rijst', 'bonen', 'kikkererwten', 'linzen', 'tomatensaus', 'soep', 'bouillon', 'havermout', 'müsli', 'pindakaas', 'jam', 'honing', 'olie', 'azijn', 'ketjap', 'kokosmelk', 'meel', 'suiker', 'zout', 'peper', 'noten'],
        '🧃 Dranken':             ['water', 'sap', 'limonade', 'cola', 'bier', 'wijn', 'koffie', 'thee', 'frisdrank', 'smoothie', 'chocolademelk', 'spa'],
        '🧴 Verzorging':          ['shampoo', 'zeep', 'tandpasta', 'deodorant', 'wasmiddel', 'afwasmiddel', 'schoonmaakmiddel', 'toiletpapier', 'wc-papier', 'conditioner'],
        '🍫 Snacks & zoet':       ['chips', 'chocolade', 'koekje', 'snoep', 'drop', 'popcorn', 'cake', 'stroopwafel', 'kauwgom'],
        '🧊 Diepvries':           ['frietjes', 'pizza', 'diepvries', 'ijs', 'sorbet'],
      };

      const categorized = {};
      const uncategorized = [];

      for (const item of open) {
        const lc = item.text.toLowerCase();
        let found = false;
        for (const [cat, keywords] of Object.entries(CAT_MAP)) {
          if (keywords.some(k => lc.includes(k))) {
            (categorized[cat] ??= []).push(item.text);
            found = true;
            break;
          }
        }
        if (!found) uncategorized.push(item.text);
      }

      const parts = Object.entries(categorized).map(([cat, its]) =>
        `${cat}\n${its.map(t => `• ${t}`).join('\n')}`
      );
      if (uncategorized.length > 0) {
        parts.push(`📦 Overig\n${uncategorized.map(t => `• ${t}`).join('\n')}`);
      }

      return `${list.emoji ?? '📝'} *${list.name} — per categorie*\n\n${parts.join('\n\n')}`;
    }

    // ── Note to list ──────────────────────────────────────────────────────────

    case 'note_to_list': {
      const n2lTitle = intent.note_title;
      if (!n2lTitle) return 'Welke notitie wil je omzetten naar actiepunten?';
      const notes  = await db.getNotes(userId);
      const target = fuzzyFindByTitle(notes, n2lTitle);
      if (!target) return `Geen notitie gevonden met "${n2lTitle}".`;

      const Anthropic = require('@anthropic-ai/sdk');
      const aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const aiRes = await aiClient.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `Haal alle concrete actiepunten/taken uit deze notitie. Geef ALLEEN een JSON array van korte taakomschrijvingen terug (max 10). Geen uitleg, geen markdown. Voorbeeld: ["Bellen met Jan","Contract opsturen"]\n\nNotitie:\n${target.body}`,
        }],
      });

      let items = [];
      try {
        const raw = (aiRes.content[0]?.text ?? '[]').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        items = JSON.parse(raw);
      } catch {}

      if (!Array.isArray(items) || items.length === 0) {
        return `📝 Geen actiepunten gevonden in notitie *${target.title}*.`;
      }

      const targetList = intent.list_id ? lists.find(l => l.id === intent.list_id) : lists[0];
      if (!targetList) return 'Maak eerst een lijst aan om de actiepunten aan toe te voegen.';

      await Promise.all(items.map(t => db.addListItem(targetList.id, String(t), null, userId)));
      return `✅ ${items.length} actiepunten uit *${target.title}* toegevoegd aan ${targetList.emoji ?? '📝'} *${targetList.name}*:\n${items.map(t => `• ${t}`).join('\n')}`;
    }

    // ── List count ────────────────────────────────────────────────────────────

    case 'list_count': {
      if (!intent.list_id) return 'Welke lijst bedoel je?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';
      const items = await db.getListItems(intent.list_id);
      const open  = items.filter(i => !i.checked).length;
      const done  = items.filter(i => i.checked).length;
      if (items.length === 0) return `${list.emoji ?? '📝'} ${list.name} is leeg.`;
      return `${list.emoji ?? '📝'} *${list.name}*: ${items.length} item${items.length !== 1 ? 's' : ''} — ${open} open, ${done} klaar.`;
    }

    // ── List sort ─────────────────────────────────────────────────────────────

    case 'list_sort': {
      if (!intent.list_id) return 'Welke lijst wil je sorteren?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';
      const items = await db.getListItems(intent.list_id);
      if (items.length < 2) return `${list.emoji ?? '📝'} ${list.name} heeft te weinig items om te sorteren.`;
      await db.sortListItemsAlphabetically(intent.list_id);
      return `✅ ${list.emoji ?? '📝'} *${list.name}* gesorteerd op alfabet (${items.length} items).`;
    }

    // ── List move all ─────────────────────────────────────────────────────────

    case 'list_move_all': {
      if (!intent.list_id || !intent.target_list_id) return 'Geef op: van welke lijst en naar welke lijst.';
      const srcList = lists.find(l => l.id === intent.list_id);
      const dstList = lists.find(l => l.id === intent.target_list_id);
      if (!srcList || !dstList) return 'Een van de lijsten kon ik niet vinden.';
      const items = await db.getListItems(intent.list_id);
      const open  = items.filter(i => !i.checked);
      if (open.length === 0) return `${srcList.emoji ?? '📝'} ${srcList.name} heeft geen open items om te verplaatsen.`;
      await db.moveAllListItems(intent.list_id, intent.target_list_id);
      return `↗️ ${open.length} item${open.length !== 1 ? 's' : ''} verplaatst van ${srcList.emoji ?? '📝'} *${srcList.name}* naar ${dstList.emoji ?? '📝'} *${dstList.name}*.`;
    }

    // ── List share ────────────────────────────────────────────────────────────

    case 'list_share': {
      if (!intent.list_id) return 'Welke lijst wil je delen?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';
      const items = await db.getListItems(intent.list_id);
      const open  = items.filter(i => !i.checked);
      if (open.length === 0) return `${list.emoji ?? '📝'} ${list.name} heeft geen open items.`;
      const lines = open.map(i => `• ${i.text}`).join('\n');
      return `${list.emoji ?? '📝'} *${list.name}*\n\n${lines}\n\n_(Kopieer deze tekst om te delen)_`;
    }

    // ── Note search ───────────────────────────────────────────────────────────

    case 'note_search': {
      const query = intent.note_query ?? intent.note_title;
      if (!query) return 'Waar wil je naar zoeken in je notities?';
      const results = await db.searchNotes(userId, query);
      if (results.length === 0) return `📝 Geen notities gevonden voor "${query}".`;
      const lines = results.slice(0, 5).map(n => `• *${n.title}*`).join('\n');
      return `📝 *Gevonden notities:*\n\n${lines}`;
    }

    // ── Note read ─────────────────────────────────────────────────────────────

    case 'note_read': {
      const readTitle = intent.note_title;
      if (!readTitle) return 'Welke notitie wil je lezen?';
      const notes  = await db.getNotes(userId);
      const target = fuzzyFindByTitle(notes, readTitle);
      if (!target) return `Geen notitie gevonden met "${readTitle}".`;
      return `📝 *${target.title}*\n\n${target.body}`;
    }

    // ── Profile query ─────────────────────────────────────────────────────────

    case 'profile_query': {
      const ctx = await db.getUserContext(userId);
      const facts = ctx.split('\n').filter(l => l && !l.startsWith('Totaal berichten:'));
      if (facts.length === 0) return 'Ik heb nog geen persoonlijke informatie over je opgeslagen.';
      return `👤 *Wat ik over je weet:*\n\n${facts.map(f => `• ${f}`).join('\n')}`;
    }

    // ── Smart summary ─────────────────────────────────────────────────────────

    case 'smart_summary': {
      const [todayEvts, unchecked] = await Promise.all([
        db.getTodayEvents(userId),
        db.getAllUncheckedItems(userId),
      ]);

      const parts = [];

      if (todayEvts.length > 0) {
        const evLines = todayEvts.map(e => `• *${e.title}*${e.time ? ` om ${e.time}` : ''}`).join('\n');
        parts.push(`📅 *Vandaag:*\n${evLines}`);
      }

      if (unchecked.length > 0) {
        const byList = {};
        for (const i of unchecked) {
          const key = i.list?.name ?? 'Onbekend';
          const emoji = i.list?.emoji ?? '📝';
          if (!byList[key]) byList[key] = { emoji, items: [] };
          byList[key].items.push(i.text);
        }
        const listLines = Object.entries(byList).slice(0, 3).map(([name, { emoji, items }]) =>
          `${emoji} *${name}*: ${items.slice(0, 3).join(', ')}${items.length > 3 ? ` +${items.length - 3}` : ''}`
        ).join('\n');
        parts.push(`📋 *Open items:*\n${listLines}`);
      }

      if (activeHabits.length > 0) {
        parts.push(`🏋️ *Habits vandaag:* ${activeHabits.map(h => h.name).join(', ')}`);
      }

      if (parts.length === 0) return '✅ Alles lijkt op orde — geen open items of afspraken vandaag.';
      return `*Hier is een overzicht:*\n\n${parts.join('\n\n')}`;
    }

    // ── Reminder ─────────────────────────────────────────────────────────────

    case 'reminder': {
      const reminderText = intent.reminder_text ?? originalText;
      const reminderTime = intent.reminder_time ?? null;
      await db.createEvent(userId, {
        title: reminderText,
        date: intent.reminder_date,
        time: reminderTime,
        recurrence: null,
        reminderDaysBefore: null,
        caldavUid: null,
        calendarStream: reminderTime ? 'wa_reminder' : 'personal',
      });
      const dateStr = intent.reminder_date ? ` op ${fmtDate(intent.reminder_date)}` : '';
      const timeStr = reminderTime ? ` om ${reminderTime}` : '';
      return `⏰ Herinnering ingesteld: *${reminderText}*${dateStr}${timeStr}. Ik stuur je dan een WhatsApp${timeStr ? '' : ' die ochtend'}.`;
    }

    // ── Note ─────────────────────────────────────────────────────────────────

    case 'note': {
      const rawBody = intent.note_body ?? originalText;
      const rawTitle = intent.note_title ?? rawBody.slice(0, 50);

      // Save immediately with raw text, then structure async in background
      const existingNotes = await db.getNotes(userId);
      const matchingNote = fuzzyFindByTitle(existingNotes, rawTitle);
      if (matchingNote) {
        await db.appendToNote(matchingNote.id, rawBody);
        // Structure the updated note in background
        const { structureNote } = require('./claudeParser');
        const fullBody = matchingNote.body + '\n\n' + rawBody;
        structureNote(matchingNote.title, fullBody)
          .then(({ title, body }) => db.updateNote(matchingNote.id, title, body))
          .catch(() => {});
        return `📝 Toegevoegd aan *${matchingNote.title}*`;
      }

      const note = await db.createNote(userId, rawTitle, rawBody);
      undo.record(userId, 'add_note', { noteId: note.id, title: note.title });
      // Structure in background — update note once done
      const { structureNote } = require('./claudeParser');
      structureNote(rawTitle, rawBody)
        .then(({ title, body }) => db.updateNote(note.id, title, body))
        .catch(() => {});
      return `📝 *${note.title}* opgeslagen`;
    }

    // ── Update (replace) note body ───────────────────────────────────────────

    case 'note_update': {
      const updateTitle = intent.note_title;
      if (!updateTitle) return 'Welke notitie wil je bijwerken?';
      const notes  = await db.getNotes(userId);
      const target = fuzzyFindByTitle(notes, updateTitle);
      if (!target) return `Geen notitie gevonden met "${updateTitle}".`;
      const newBody = intent.new_body ?? intent.note_body ?? originalText;
      await db.updateNote(target.id, newBody);
      return `📝 Notitie *${target.title}* bijgewerkt.`;
    }

    // ── Append to note ───────────────────────────────────────────────────────

    case 'note_append': {
      const appendTitle = intent.note_title;
      if (!appendTitle) return 'Aan welke notitie wil je toevoegen?';

      const notes  = await db.getNotes(userId);
      const target = fuzzyFindByTitle(notes, appendTitle);
      if (!target) return `Geen notitie gevonden met "${appendTitle}".`;

      const appendText = intent.note_body ?? originalText;
      await db.appendToNote(target.id, appendText);
      return `📝 Toegevoegd aan *${target.title}*:\n\n${appendText}`;
    }

    // ── Delete note (with confirmation) ──────────────────────────────────────

    case 'note_delete': {
      const deleteTitle = intent.note_title;
      if (!deleteTitle) return 'Welke notitie wil je verwijderen?';

      const notes  = await db.getNotes(userId);
      const target = fuzzyFindByTitle(notes, deleteTitle);
      if (!target) return `Geen notitie gevonden met "${deleteTitle}".`;

      confirm.set(userId, { type: 'note_delete', noteId: target.id, noteTitle: target.title });
      return `⚠️ Notitie *${target.title}* verwijderen?\n\nStuur *ja* om te bevestigen.`;
    }

    // ── Log habit ────────────────────────────────────────────────────────────

    case 'habit_log': {
      if (!intent.habit_id) {
        const names = activeHabits.map(h => h.name).join(', ');
        return `Welke habit? Je actieve habits: ${names || 'geen'}.`;
      }
      const habit = activeHabits.find(h => h.id === intent.habit_id);
      if (!intent.habit_level) {
        return `🏅 *${habit?.name}*: Brons (${habit?.mini_goal}), Zilver (${habit?.good_goal}) of Goud (${habit?.elite_goal})?`;
      }

      const badge = { mini: '🥉', good: '🥈', elite: '🥇' }[intent.habit_level] ?? '✅';

      // Multi-day logging
      if (Array.isArray(intent.log_dates) && intent.log_dates.length > 1) {
        for (const d of intent.log_dates) await db.logHabit(userId, intent.habit_id, intent.habit_level, d);
        return `${badge} *${habit?.name ?? 'Habit'}* gelogd voor ${intent.log_dates.length} dagen!`;
      }

      const logDate = resolveLogDate(intent.log_date);
      await db.logHabit(userId, intent.habit_id, intent.habit_level, logDate);

      const streak = await db.getHabitStreak(userId, intent.habit_id);
      const streakLine = streak > 1 ? `\n🔥 *${streak} dagen op rij!*` : '';
      return `${badge} *${habit?.name ?? 'Habit'}* gelogd als ${levelLabel(intent.habit_level)}!${streakLine}`;
    }

    // ── Log multiple habits ──────────────────────────────────────────────────

    case 'habit_log_multi': {
      const ids = Array.isArray(intent.habit_ids) ? intent.habit_ids : [];
      if (ids.length === 0) return 'Welke habits wil je loggen?';

      const dates = Array.isArray(intent.log_dates) && intent.log_dates.length > 1
        ? intent.log_dates
        : [resolveLogDate(intent.log_date)];
      const level   = intent.habit_level ?? 'good';
      const results = [];

      for (const hId of ids) {
        const habit = activeHabits.find(h => h.id === hId);
        if (!habit) continue;
        for (const d of dates) await db.logHabit(userId, hId, level, d);
        results.push(habit.name);
      }

      if (results.length === 0) return 'Geen habits gevonden.';
      const badge = { mini: '🥉', good: '🥈', elite: '🥇' }[level] ?? '✅';
      return `${badge} Gelogd: ${results.map(n => `*${n}*`).join(', ')}.`;
    }

    // ── Manage habit ─────────────────────────────────────────────────────────

    case 'habit_manage': {
      if (!intent.new_habit) return 'Geef de habit details op: naam, mini-doel, goed-doel en elite-doel.';
      try {
        const habit = await db.createHabit(userId, intent.new_habit);
        return `✅ Habit *${habit.name}* aangemaakt!`;
      } catch (err) {
        return err.message;
      }
    }

    // ── Query habits ─────────────────────────────────────────────────────────

    case 'habit_query': {
      if (activeHabits.length === 0) return 'Je hebt nog geen actieve habits.';
      const lines = activeHabits.map(h =>
        `• *${h.name}*\n  🥉 ${h.mini_goal} | 🥈 ${h.good_goal} | 🥇 ${h.elite_goal}`
      ).join('\n\n');
      return `🏋️ *Jouw habits*\n\n${lines}`;
    }

    // ── Setting change ───────────────────────────────────────────────────────

    case 'setting_change': {
      if (!intent.setting_key) return 'Welke instelling wil je wijzigen?';
      await db.updateUserPrefs(userId, { [intent.setting_key]: intent.setting_value });
      return `⚙️ Instelling bijgewerkt.`;
    }

    // ── Greeting (fallback via Claude) ───────────────────────────────────────

    case 'learn_context': {
      // Auto-create yearly calendar event for birthday facts
      if (intent.birthday_date && intent.birthday_person) {
        const [bMonth, bDay] = intent.birthday_date.split('-').map(Number);
        const year = new Date().getMonth() + 1 > bMonth ||
          (new Date().getMonth() + 1 === bMonth && new Date().getDate() > bDay)
          ? new Date().getFullYear() + 1
          : new Date().getFullYear();
        const dateStr = `${year}-${String(bMonth).padStart(2, '0')}-${String(bDay).padStart(2, '0')}`;
        const evTitle = `Verjaardag ${intent.birthday_person}`;
        let caldavUid = null;
        const _biCi = await db.getCalendarProvider(userId).catch(() => null);
        const _biCp = _biCi?.calendar_provider;
        const _biCc = _biCp === 'iphone' || !_biCp ? (caldav.isConfigured() ? await db.getCalDAVCredentials(userId) : null) : null;
        caldavUid = await _calCreate(userId, _biCp, _biCi, _biCc, 'birthdays', {
          title: evTitle, date: dateStr, time: null, recurrence: 'yearly', reminderDaysBefore: 7,
        }).catch(() => null);
        await db.createEvent(userId, { title: evTitle, date: dateStr, recurrence: 'yearly', reminderDaysBefore: 7, caldavUid, calendarStream: 'birthdays' });
        return `✅ Onthouden — en verjaardag *${intent.birthday_person}* (${intent.birthday_date}) jaarlijks in je agenda gezet! 🎂`;
      }
      return intent.reply_text ?? `✅ Onthouden: _${intent.context_fact}_`;
    }

    case 'greeting':
      return intent.reply_text ?? 'Hoi! Wat staat er op de planning?';

    case 'clarification':
      return intent.clarification_question ?? 'Kun je dat iets duidelijker omschrijven?';

    case 'unknown':
    default:
      return intent.reply_text ?? 'Dat snap ik niet helemaal. Bedoel je een boodschap, taak of afspraak?';
  }
}

// ── Greeting / morning summary ─────────────────────────────────────────────────

function buildGreetingReply(lists, activeHabits, todayEvents, uncheckedItems = []) {
  const hour = new Date().getHours();
  let salutation;
  if (hour >= 5  && hour < 12) salutation = 'Goedemorgen ☀️';
  else if (hour >= 12 && hour < 18) salutation = 'Hey 👋';
  else salutation = 'Goedenavond';

  const parts = [salutation];

  if (todayEvents.length > 0) {
    const evLines = todayEvents.map(e => `  • *${e.title}*${e.time ? ` om ${e.time}` : ''}`).join('\n');
    parts.push(`📅 *Vandaag:*\n${evLines}`);
  }

  if (uncheckedItems.length > 0) {
    const total = uncheckedItems.length;
    const topList = lists[0];
    const topItems = uncheckedItems.filter(i => i.list?.id === topList?.id).slice(0, 3);
    const itemStr = topItems.length > 0
      ? ` (${topList?.emoji ?? '📝'} ${topItems.map(i => i.text).join(', ')}${total > topItems.length ? ` +${total - topItems.length} meer` : ''})`
      : ` — ${total} open`;
    parts.push(`📋 *Open:* ${total}${itemStr}`);
  }

  if (activeHabits.length > 0) {
    parts.push(`🏋️ *Habits:* ${activeHabits.map(h => h.name).join(' · ')}`);
  }

  if (parts.length === 1) parts.push('Wat staat er op de planning?');

  return parts.join('\n\n');
}

// ── Utility: fuzzy find ────────────────────────────────────────────────────────

function fuzzyFindItem(items, searchText) {
  const lc = searchText.toLowerCase();
  return (
    items.find(i => i.text.toLowerCase() === lc) ??
    items.find(i => i.text.toLowerCase().includes(lc)) ??
    items.find(i => lc.includes(i.text.toLowerCase()))
  );
}

function fuzzyFindByTitle(records, searchText) {
  const lc = searchText.toLowerCase();
  return (
    records.find(r => r.title.toLowerCase() === lc) ??
    records.find(r => r.title.toLowerCase().includes(lc)) ??
    records.find(r => lc.includes(r.title.toLowerCase()))
  );
}

// ── Utility: dates ────────────────────────────────────────────────────────────

function resolveLogDate(logDate) {
  if (!logDate || logDate === 'today') return new Date().toISOString().split('T')[0];
  if (logDate === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }
  return logDate;
}

function calcFirstDue(recurrence) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (recurrence === 'daily') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  if (recurrence.startsWith('weekly:')) {
    const target = parseInt(recurrence.split(':')[1], 10);
    const d = new Date(today);
    let daysUntil = (target - d.getDay() + 7) % 7;
    if (daysUntil === 0) daysUntil = 7;
    d.setDate(d.getDate() + daysUntil);
    return d.toISOString().split('T')[0];
  }

  if (recurrence.startsWith('monthly:')) {
    const dayOfMonth = parseInt(recurrence.split(':')[1], 10);
    const d = new Date(today);
    d.setMonth(d.getMonth() + 1);
    d.setDate(dayOfMonth);
    return d.toISOString().split('T')[0];
  }

  const d = new Date(today);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function recurrenceToLabel(recurrence) {
  if (recurrence === 'daily') return 'dagelijks';
  if (recurrence.startsWith('weekly:')) {
    const day = parseInt(recurrence.split(':')[1], 10);
    return `elke ${DAYS_NL[day]}`;
  }
  if (recurrence.startsWith('monthly:')) {
    const d = parseInt(recurrence.split(':')[1], 10);
    return `maandelijks op de ${d}e`;
  }
  return recurrence;
}

// ── Utility: messaging ─────────────────────────────────────────────────────────

function maybePersonality() {
  const r = Math.random();
  if (r < 0.03) {
    const seasonal = SEASONAL_LINES();
    return '\n\n' + seasonal[Math.floor(Math.random() * seasonal.length)];
  }
  if (r < 0.08) {
    return '\n\n' + PERSONALITY_LINES[Math.floor(Math.random() * PERSONALITY_LINES.length)];
  }
  return '';
}

async function sendSplit(to, text) {
  if (!text || text.length <= 1600) {
    return sendMessage(to, text);
  }

  const parts = [];
  let remaining = text;
  while (remaining.length > 1600) {
    let cutAt = remaining.lastIndexOf('\n', 1600);
    if (cutAt < 800) cutAt = remaining.lastIndexOf(' ', 1600);
    if (cutAt < 800) cutAt = 1600;
    parts.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) parts.push(remaining);

  for (const part of parts) {
    await sendMessage(to, part);
  }
}

function buildWelcomeMessage() {
  return `👋 *Welkom bij Sous-Chef!*

Ik ben jouw persoonlijke WhatsApp-assistent voor lijsten, agenda, notities en habits.

*Wat ik kan:*
📝 Lijsten bijhouden — _"melk, koffie, biefstuk op de boodschappenlijst"_
📅 Afspraken plannen — _"tandarts vrijdag 14u"_
🗒️ Notities opslaan — _"onthoud: Jan altijd bellen voor bezoek"_
🏆 Habits volgen — _"mediteren gedaan, 20 minuten"_
🔄 Terugkerende taken — _"elke vrijdag: koffie halen"_

*Handige commando's:*
• *"ongedaan"* — laatste actie terugdraaien
• *"wat staat er op [lijst]?"* — lijst opvragen
• *"wat moet ik nog doen?"* — alles open over alle lijsten
• *"wat kun je?"* — dit menu opnieuw zien

Stuur maar gewoon een berichtje — ik snap je vanzelf! 🍳`;
}

function buildHelpMessage() {
  return `🍳 *Sous-Chef — wat kan ik voor je doen?*

*Lijsten*
• Toevoegen: _"melk, koffie, brood"_ of _"melk op de boodschappenlijst"_
• Opvragen: _"wat staat er op de boodschappenlijst?"_
• Afvinken: _"melk gedaan"_
• Verwijderen: _"melk van de lijst halen"_
• Leegmaken: _"boodschappenlijst leegmaken"_
• Verplaatsen: _"melk naar de jumbolijst"_
• Alle open: _"wat moet ik nog doen?"_
• Alle lijsten: _"welke lijsten heb ik?"_
• Nieuwe lijst: _"maak een lijst: Todo werk"_
• Terugkerend: _"elke vrijdag: koffie kopen"_

*Agenda*
• Afspraak: _"tandarts dinsdag 14u"_
• Verjaardag: _"verjaardag Stan 27 juli"_
• Vandaag: _"wat heb ik vandaag?"_
• Annuleren: _"tandarts afzeggen"_

*Notities*
• Opslaan: _"onthoud: altijd bellen voor bezoek bij Jan"_
• Toevoegen: _"voeg toe aan Jan-notitie: ook de hond meenemen"_

*Habits*
• Log: _"gesport en mediteerd"_
• Gisteren: _"gisteren gesport"_
• Aanmaken: _"voeg habit toe: mediteren, mini=5min, goed=20min, elite=45min"_

*Ongedaan maken*
• _"ongedaan"_ of _"verwijder laatste"_
• Corrigeren: _"ik bedoelde koffie"_

Via de app zie je alles visueel. 📱`;
}

function buildCalDAVOnboardingMessage(username, password) {
  const server = (process.env.CALDAV_URL ?? '').replace(/^https?:\/\//, '');
  return `📅 *Je persoonlijke agenda is aangemaakt!*

Voeg hem toe aan je iPhone:

1. Ga naar *Instellingen → Agenda → Accounts*
2. Tik op *Voeg account toe → Overige*
3. Kies *Voeg CalDAV-account toe*
4. Vul in:
   • Server: ${server}
   • Gebruikersnaam: ${username}
   • Wachtwoord: ${password}
   • Beschrijving: Sous-Chef

Je agenda's (Afspraken, Verjaardagen, Werk, Persoonlijk) verschijnen automatisch. Alle afspraken die je via WhatsApp instuurt komen er direct in.`;
}

function formatDate(isoDate, tz = 'Europe/Amsterdam') {
  if (!isoDate) return '';
  // Parse as local date (not UTC) by treating YYYY-MM-DD as noon in the user tz
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return dt.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
}

function levelLabel(level) {
  return { mini: 'Brons', good: 'Zilver', elite: 'Goud' }[level] ?? level;
}

module.exports = { handleMessage, sendPush };
