'use strict';

const { parseIntent }          = require('./claudeParser');
const { sendMessage, sendTyping } = require('./whatsapp');
const db                  = require('./supabase');
const caldav              = require('./caldav');
const session             = require('./sessionMemory');
const undo                = require('./undoManager');
const confirm             = require('./pendingConfirmations');

// ── Constants ──────────────────────────────────────────────────────────────────

const UNDO_TRIGGERS     = ['ongedaan', 'undo', 'terugdraaien', 'verwijder laatste', 'annuleer laatste'];
const HELP_TRIGGERS     = ['wat kun je', 'wat kan je', 'wat kan ik', 'help', 'hoe werkt'];
const GREETING_TRIGGERS = ['hoi', 'hallo', 'hey', 'hi', 'dag', 'goedemorgen', 'goedemiddag', 'goedenavond', 'hello', 'yo'];

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

// ── Push notification helper ───────────────────────────────────────────────────

async function sendCalendarPush(userId, event) {
  const token = await db.getUserPushToken(userId);
  if (!token || !token.startsWith('ExponentPushToken[')) return;

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      title: 'Nieuw agenda-event',
      body: event.title,
      data: {
        type: 'calendar_event',
        title: event.title,
        date: event.date,
        time: event.time ?? null,
        calendarStream: event.calendarStream ?? 'personal',
      },
      priority: 'high',
      _contentAvailable: true, // required for background delivery on iOS
    }),
  });
}

// ── Main handler ───────────────────────────────────────────────────────────────

async function handleMessage({ from, text }) {
  sendTyping(from); // fire-and-forget, shows typing indicator immediately

  const user   = await db.getOrCreateUserFull(from);
  const userId = user.id;
  const lc     = text.toLowerCase().trim();

  // Onboarding: send welcome on first ever message
  if (!user.onboarding_completed) {
    await db.markOnboardingComplete(userId);
    await sendSplit(from, buildWelcomeMessage());
    if (GREETING_TRIGGERS.some(t => lc === t || lc.startsWith(t + '!'))) {
      await db.incrementMessageCount(userId);
      return;
    }
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

  // Greeting shortcut — morning summary
  if (GREETING_TRIGGERS.some(t => lc === t || lc === t + '!' || lc === t + '!!' )) {
    if (user.onboarding_completed) {
      const [lists, activeHabits, todayEvents] = await Promise.all([
        db.getLists(userId),
        db.getActiveHabits(userId),
        db.getTodayEvents(userId),
      ]);
      const reply = buildGreetingReply(lists, activeHabits, todayEvents);
      session.addExchange(userId, text, reply);
      await sendSplit(from, reply);
    }
    await db.incrementMessageCount(userId);
    return;
  }

  // Load all context in parallel
  const [lists, activeHabits, userContext, calendarStreams, conversationHistory] = await Promise.all([
    db.getLists(userId),
    db.getActiveHabits(userId),
    db.getUserContext(userId),
    db.getCalendarStreams(userId),
    Promise.resolve(session.getHistory(userId)),
  ]);

  const intent = await parseIntent({ text, availableLists: lists, activeHabits, calendarStreams, conversationHistory, userContext });

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

  // Multi-action: process each sub-action and combine replies
  if (intent.category === 'multi_action' && Array.isArray(intent.actions) && intent.actions.length > 0) {
    const replies = [];
    for (const action of intent.actions) {
      const r = await processIntent({ ...action, confidence: intent.confidence }, userId, lists, activeHabits, text, from, calendarStreams);
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

  const baseReply = await processIntent(intent, userId, lists, activeHabits, text, from, calendarStreams);
  if (!baseReply) return;

  const confidenceSuffix = intent.confidence === 'medium'
    ? '\n\n_Klopt dit? Zo niet, laat het me weten._'
    : '';

  const reply = baseReply + confidenceSuffix + maybePersonality();
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
        if (caldav.isConfigured() && pending.caldavUid) {
          const creds = await db.getCalDAVCredentials(userId);
          if (creds) {
            try {
              await caldav.deleteEvent(creds.username, creds.password, pending.calendarStream ?? 'personal', pending.caldavUid);
            } catch (err) {
              console.error('CalDAV delete failed (continuing):', err.message);
            }
          }
        }
        await db.deleteEventById(userId, pending.eventId);
        return `🗑️ *${pending.eventTitle}* verwijderd uit je agenda.`;
      }
      case 'note_delete': {
        await db.deleteNote(pending.noteId);
        return `🗑️ Notitie *${pending.noteTitle}* verwijderd.`;
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
        await db.deleteListItem(last.data.itemId);
        undo.clear(userId);
        return `↩️ Ongedaan: *${last.data.text}* verwijderd uit ${last.data.listEmoji} ${last.data.listName}.`;
      }
      case 'add_items': {
        for (const id of last.data.itemIds) await db.deleteListItem(id);
        undo.clear(userId);
        return `↩️ Ongedaan: ${last.data.count} items verwijderd uit ${last.data.listEmoji} ${last.data.listName}.`;
      }
      case 'add_note': {
        await db.deleteNote(last.data.noteId);
        undo.clear(userId);
        return `↩️ Ongedaan: notitie *${last.data.title}* verwijderd.`;
      }
      case 'create_list': {
        await db.deleteList(last.data.listId);
        undo.clear(userId);
        return `↩️ Ongedaan: lijst *${last.data.name}* verwijderd.`;
      }
      case 'add_recurring': {
        await db.deleteRecurringItem(last.data.itemId);
        undo.clear(userId);
        return `↩️ Ongedaan: terugkerend item *${last.data.content}* verwijderd.`;
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

async function processIntent(intent, userId, lists, activeHabits, originalText, from, calendarStreams = []) {
  const { category } = intent;

  switch (category) {

    // ── Single list item ─────────────────────────────────────────────────────

    case 'list': {
      if (!intent.list_id) return intent.clarification_question ?? 'Welke lijst bedoel je?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';

      const itemText = intent.item_text ?? originalText;

      // Duplicate detection
      const existing = await db.getListItems(intent.list_id);
      const isDupe = existing.some(i => i.text.toLowerCase() === itemText.toLowerCase());
      if (isDupe) return `_${itemText}_ staat al op ${list.emoji ?? '📝'} ${list.name}.`;

      const added = await db.addListItem(intent.list_id, itemText);
      undo.record(userId, 'add_item', {
        itemId: added.id, text: added.text, listName: list.name, listEmoji: list.emoji ?? '📝',
      });
      return `✅ *${itemText}* toegevoegd aan ${list.emoji ?? '📝'} ${list.name}.`;
    }

    // ── Multiple list items ──────────────────────────────────────────────────

    case 'list_items': {
      if (!intent.list_id) return intent.clarification_question ?? 'Welke lijst bedoel je?';
      const list = lists.find(l => l.id === intent.list_id);
      if (!list) return 'Die lijst kon ik niet vinden.';

      const texts = Array.isArray(intent.item_texts) ? intent.item_texts.filter(Boolean) : [];
      if (texts.length === 0) return 'Geen items gevonden om toe te voegen.';

      const existing = await db.getListItems(intent.list_id);
      const existingLc = new Set(existing.map(i => i.text.toLowerCase()));

      const newTexts   = texts.filter(t => !existingLc.has(t.toLowerCase()));
      const dupeTexts  = texts.filter(t => existingLc.has(t.toLowerCase()));

      if (newTexts.length === 0) {
        return `Al op de lijst: ${dupeTexts.map(t => `_${t}_`).join(', ')}.`;
      }

      const added = await Promise.all(newTexts.map(t => db.addListItem(intent.list_id, t)));
      undo.record(userId, 'add_items', {
        itemIds: added.map(a => a.id), count: added.length,
        listName: list.name, listEmoji: list.emoji ?? '📝',
      });

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
      if (!last || !['add_item'].includes(last.action)) {
        return 'Er is geen recent toegevoegd item om te corrigeren.';
      }
      const newText = intent.correct_to;
      if (!newText) return 'Wat moet het item zijn?';

      await db.updateListItemText(last.data.itemId, newText);
      const oldText = last.data.text;
      undo.record(userId, 'add_item', { ...last.data, text: newText });
      return `✏️ *${oldText}* → *${newText}*.`;
    }

    // ── New list ─────────────────────────────────────────────────────────────

    case 'new_list': {
      const name  = intent.new_list_name ?? originalText;
      const emoji = intent.emoji ?? '📝';
      const newList = await db.createList(userId, name, emoji, intent.list_type ?? 'checklist');
      undo.record(userId, 'create_list', { listId: newList.id, name: newList.name });

      if (intent.item_text) {
        await db.addListItem(newList.id, intent.item_text);
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
      return `🔄 Terugkerend item aangemaakt: *${intent.item_text}* wordt ${label} toegevoegd aan ${list.emoji ?? '📝'} ${list.name}.\n_Eerste keer: ${formatDate(nextDue)}_`;
    }

    // ── Calendar ─────────────────────────────────────────────────────────────

    case 'calendar': {
      // Multi-event support: use events[] array if present, else fall back to single fields
      const eventList = Array.isArray(intent.events) && intent.events.length > 0
        ? intent.events
        : [{
            title:                  intent.event_title ?? originalText,
            date:                   intent.event_date,
            time:                   intent.event_time ?? null,
            recurrence:             intent.event_recurrence ?? null,
            reminder_days_before:   intent.reminder_days_before ?? null,
            reminder_minutes_before: intent.reminder_minutes_before ?? null,
            calendar_stream:        intent.calendar_stream ?? 'personal',
          }];

      // Ensure CalDAV user is provisioned (lazy)
      let caldavCreds = null;
      let isNewCalDAVUser = false;
      if (caldav.isConfigured()) {
        caldavCreds = await db.getCalDAVCredentials(userId);
        if (!caldavCreds) {
          const { username, password } = caldav.generateCredentials(userId);
          await caldav.provisionUser(username, password);
          await db.storeCalDAVCredentials(userId, username, password);
          caldavCreds = { username, password };
          isNewCalDAVUser = true;
        }
      }

      const lines = [];
      let lastSavedEvent = null;
      let hasBirthday = false;
      let birthdayInfo = null;

      for (const ev of eventList) {
        const evTitle         = ev.title ?? intent.event_title ?? originalText;
        const reminderDays    = ev.reminder_days_before ?? null;
        const reminderMinutes = ev.reminder_minutes_before ?? 30;
        const stream          = ev.calendar_stream ?? intent.calendar_stream ?? 'personal';

        // Conflict check: warn if another timed event exists at same time
        if (ev.time && ev.date) {
          const existing = await db.getEventsForDate(userId, ev.date);
          const conflict = existing.find(e => e.time === ev.time && e.title !== evTitle);
          if (conflict) {
            lines.push(`⚠️ Let op: *${conflict.title}* staat ook op ${formatDate(ev.date)} om ${ev.time}.`);
          }
        }

        let caldavUid = null;
        if (caldavCreds) {
          try {
            caldavUid = await caldav.createEvent(
              caldavCreds.username,
              caldavCreds.password,
              stream,
              { title: evTitle, date: ev.date, time: ev.time ?? null, recurrence: ev.recurrence ?? null, reminderDaysBefore: reminderDays, reminderMinutesBefore: reminderMinutes },
            );
          } catch (err) {
            console.error('CalDAV event creation failed, queuing retry:', err.message);
            await db.enqueueCalDAVOperation(userId, 'create_event', {
              stream, title: evTitle, date: ev.date, time: ev.time ?? null,
              recurrence: ev.recurrence ?? null, reminderDaysBefore: reminderDays,
            }).catch(() => {});
          }
        }

        const saved = await db.createEvent(userId, {
          title: evTitle,
          date: ev.date,
          time: ev.time ?? null,
          recurrence: ev.recurrence ?? null,
          reminderDaysBefore: reminderDays,
          caldavUid,
          calendarStream: stream,
        });

        lastSavedEvent = { id: saved.id, title: evTitle, date: ev.date, time: ev.time ?? null, caldavUid, calendarStream: stream };

        if (stream === 'birthdays') {
          hasBirthday = true;
          birthdayInfo = { title: evTitle, date: ev.date };
        }

        const builtinLabel = { appointments: 'Afspraak', birthdays: 'Verjaardag', work: 'Werkafspraak', personal: 'Ingepland' }[stream];
        const customStream = !builtinLabel ? calendarStreams.find(s => s.claude_key === stream) : null;
        const streamLabel  = builtinLabel ?? customStream?.name ?? 'Ingepland';
        const timeStr     = ev.time ? ` om ${ev.time}` : '';
        const dateStr     = ev.date ? ` — ${formatDate(ev.date)}${timeStr}` : '';
        const recurStr    = ev.recurrence === 'yearly' ? ' _(jaarlijks)_'
          : ev.recurrence?.startsWith('weekly:') ? ' _(wekelijks)_'
          : ev.recurrence?.startsWith('monthly:') ? ' _(maandelijks)_'
          : '';
        const reminderStr = reminderMinutes ? ` _(reminder ${reminderMinutes} min van tevoren)_` : reminderDays ? ` _(reminder ${reminderDays} dag${reminderDays !== 1 ? 'en' : ''} van tevoren)_` : '';
        lines.push(`• *${streamLabel}* — *${evTitle}*${dateStr}${recurStr}${reminderStr}`);
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

      // Update CalDAV: delete old + recreate with reminder
      const caldavCreds2 = caldav.isConfigured() ? await db.getCalDAVCredentials(userId) : null;
      if (caldavCreds2 && event.caldavUid) {
        try {
          await caldav.deleteEvent(caldavCreds2.username, caldavCreds2.password, event.calendarStream ?? 'personal', event.caldavUid);
          const newUid = await caldav.createEvent(
            caldavCreds2.username, caldavCreds2.password, event.calendarStream ?? 'personal',
            { title: event.title, date: event.date, time: event.time ?? null, recurrence: null, reminderMinutesBefore: mins },
          );
          await db.updateEventCalDAVUid(event.id, newUid);
          session.setLastEvent(userId, { ...event, caldavUid: newUid });
        } catch (err) {
          console.error('CalDAV reminder update failed:', err.message);
        }
      }

      const timeStr = event.date ? ` vóór *${event.title}* op ${formatDate(event.date)}` : ` vóór *${event.title}*`;
      return `⏰ Ik stuur je ${mins} minuten van tevoren een reminder${timeStr} via de agenda.`;
    }

    // ── Reschedule event ─────────────────────────────────────────────────────

    case 'event_reschedule': {
      const title = intent.event_title;
      if (!title) return 'Welke afspraak wil je verplaatsen?';
      const matches = await db.getEventsByTitle(userId, title);
      if (matches.length === 0) return `Geen afspraak gevonden met "${title}".`;
      const event = matches[0];

      const newDate = intent.event_date_new ?? event.date;
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

      // Sync to CalDAV: delete old event + recreate with new date/time
      const caldavCreds = caldav.isConfigured() ? await db.getCalDAVCredentials(userId) : null;
      if (caldavCreds && event.caldavUid) {
        try {
          await caldav.deleteEvent(caldavCreds.username, caldavCreds.password, event.calendarStream ?? 'personal', event.caldavUid);
          const newUid = await caldav.createEvent(
            caldavCreds.username, caldavCreds.password, event.calendarStream ?? 'personal',
            { title: event.title, date: newDate, time: newTime ?? null, recurrence: event.recurrence ?? null, reminderMinutesBefore: null },
          );
          await db.updateEventCalDAVUid(event.id, newUid);
          session.setLastEvent(userId, { ...event, caldavUid: newUid, date: newDate, time: newTime });
        } catch (err) {
          console.error('CalDAV reschedule failed:', err.message);
        }
      }

      const dateStr = newDate ? ` naar ${formatDate(newDate)}` : '';
      const timeStr = newTime ? ` om ${newTime}` : '';
      return `📅 *${event.title}* verplaatst${dateStr}${timeStr}.`;
    }

    // ── Search event ─────────────────────────────────────────────────────────

    case 'event_search': {
      const query = intent.event_search_query ?? intent.event_title;
      if (!query) return 'Welke afspraak zoek je?';
      const matches = await db.getEventsByTitle(userId, query);
      if (matches.length === 0) return `Geen afspraak gevonden voor "${query}".`;
      const lines = matches.slice(0, 3).map(e => {
        const timeStr = e.time ? ` om ${e.time}` : '';
        return `• *${e.title}* — ${formatDate(e.date)}${timeStr}`;
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
      if (filtered.length === 0) return `📅 Geen afspraken gevonden tussen ${formatDate(start)} en ${formatDate(end)}.`;
      const lines = filtered.map(e => {
        const timeStr = e.time ? ` om ${e.time}` : '';
        return `• *${e.title}* — ${formatDate(e.date)}${timeStr}`;
      });
      return `📅 *Planning ${formatDate(start)} t/m ${formatDate(end)}*\n\n${lines.join('\n')}`;
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
        return `• *${e.title}* — ${formatDate(e.date)}${timeStr}`;
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

    // ── Reminder ─────────────────────────────────────────────────────────────

    case 'reminder': {
      await db.createEvent(userId, {
        title: intent.reminder_text ?? originalText,
        date: intent.reminder_date,
        recurrence: null,
        reminderDaysBefore: 0,
      });
      const dateStr = intent.reminder_date ? ` op ${formatDate(intent.reminder_date)}` : '';
      return `⏰ Herinnering ingesteld: *${intent.reminder_text}*${dateStr}.`;
    }

    // ── Note ─────────────────────────────────────────────────────────────────

    case 'note': {
      const body  = intent.note_body ?? originalText;
      const title = intent.note_title ?? body.slice(0, 50);
      const note  = await db.createNote(userId, title, body);
      undo.record(userId, 'add_note', { noteId: note.id, title: note.title });
      return `📝 Notitie opgeslagen: *${note.title}*`;
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
      return `📝 Toegevoegd aan *${target.title}*.`;
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

    case 'learn_context':
      return intent.reply_text ?? `✅ Onthouden: _${intent.context_fact}_`;

    case 'greeting':
      return intent.reply_text ?? 'Hoi! Waarmee kan ik je helpen? 🍳';

    case 'clarification':
      return intent.clarification_question ?? 'Kun je dat iets duidelijker omschrijven?';

    case 'unknown':
    default:
      return intent.reply_text ?? 'Hmm, dat begreep ik niet helemaal. Stuur "wat kun je?" om te zien wat ik kan doen.';
  }
}

// ── Greeting / morning summary ─────────────────────────────────────────────────

function buildGreetingReply(lists, activeHabits, todayEvents) {
  const hour = new Date().getHours();
  let salutation;
  if (hour >= 5  && hour < 12) salutation = 'Goedemorgen! ☀️';
  else if (hour >= 12 && hour < 18) salutation = 'Goedemiddag! 🌤️';
  else salutation = 'Goedenavond! 🌙';

  const parts = [salutation];

  if (todayEvents.length > 0) {
    parts.push(`📅 *Vandaag:* ${todayEvents.map(e => e.title).join(', ')}`);
  }

  if (lists.length > 0) {
    const listLine = lists.slice(0, 3).map(l => `${l.emoji ?? '📝'} ${l.name}`).join(', ');
    parts.push(`📋 *Lijsten:* ${listLine}${lists.length > 3 ? ` +${lists.length - 3}` : ''}`);
  }

  if (activeHabits.length > 0) {
    parts.push(`🏋️ *Habits:* ${activeHabits.map(h => h.name).join(', ')}`);
  }

  if (parts.length === 1) parts.push('Waarmee kan ik je helpen? 🍳');

  return parts.join('\n');
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

function formatDate(isoDate) {
  if (!isoDate) return '';
  return new Date(isoDate).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

function levelLabel(level) {
  return { mini: 'Brons', good: 'Zilver', elite: 'Goud' }[level] ?? level;
}

module.exports = { handleMessage };
