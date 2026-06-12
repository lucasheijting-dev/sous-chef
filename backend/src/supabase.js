'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Users ──────────────────────────────────────────────────────────────────────

async function getOrCreateUserFull(whatsappNumber) {
  const { data: existing } = await supabase
    .from('users')
    .select('id, onboarding_completed, message_count, user_context')
    .eq('whatsapp_number', whatsappNumber)
    .single();

  if (existing) return { ...existing, whatsapp_number: whatsappNumber };

  const { data: created, error } = await supabase
    .from('users')
    .insert({ whatsapp_number: whatsappNumber })
    .select('id, onboarding_completed, message_count, user_context')
    .single();

  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return { ...created, whatsapp_number: whatsappNumber };
}

async function markOnboardingComplete(userId) {
  await supabase.from('users').update({ onboarding_completed: true }).eq('id', userId);
}

async function getUserPushToken(userId) {
  const { data } = await supabase
    .from('users')
    .select('push_token')
    .eq('id', userId)
    .single();
  return data?.push_token ?? null;
}

async function incrementMessageCount(userId) {
  await supabase.rpc('increment_user_message_count', { uid: userId });
}

async function getUserContext(userId) {
  const [{ data: user }, { data: prefs }] = await Promise.all([
    supabase.from('users').select('user_context, message_count').eq('id', userId).single(),
    supabase.from('user_prefs').select('profile_birth_year, profile_employer, profile_friends, profile_extra').eq('user_id', userId).single(),
  ]);
  if (!user) return '';
  const parts = [];
  if (user.message_count > 0) parts.push(`Totaal berichten: ${user.message_count}`);
  if (prefs?.profile_birth_year) {
    const age = new Date().getFullYear() - prefs.profile_birth_year;
    parts.push(`Leeftijd gebruiker: ${age} jaar (geb. ${prefs.profile_birth_year})`);
  }
  if (prefs?.profile_employer) parts.push(`Werkgever: ${prefs.profile_employer}`);
  if (prefs?.profile_friends) parts.push(`Vrienden/mensen die de gebruiker kent: ${prefs.profile_friends}`);
  if (prefs?.profile_extra) parts.push(`Extra context: ${prefs.profile_extra}`);
  if (user.user_context) parts.push(user.user_context);
  return parts.join('\n');
}

async function getUserPrefs(userId) {
  const { data } = await supabase
    .from('user_prefs')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (data) return data;

  const { data: created } = await supabase
    .from('user_prefs')
    .insert({ user_id: userId })
    .select('*')
    .single();

  return created;
}

async function updateUserPrefs(userId, updates) {
  await supabase
    .from('user_prefs')
    .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' });
}

async function trackActiveHour(userId, hour) {
  const { data } = await supabase
    .from('user_prefs')
    .select('active_hour_counts')
    .eq('user_id', userId)
    .single();

  const counts = data?.active_hour_counts ?? {};
  counts[String(hour)] = (counts[String(hour)] ?? 0) + 1;

  await supabase
    .from('user_prefs')
    .upsert({ user_id: userId, active_hour_counts: counts }, { onConflict: 'user_id' });
}

async function getBestReminderHour(userId) {
  const { data } = await supabase
    .from('user_prefs')
    .select('active_hour_counts')
    .eq('user_id', userId)
    .single();

  const counts = data?.active_hour_counts ?? {};
  let bestHour = 20; // default 20:00
  let max = 0;
  for (const [h, c] of Object.entries(counts)) {
    if (c > max) { max = c; bestHour = parseInt(h, 10); }
  }
  return bestHour;
}

async function getUsersForDigest() {
  const { data: prefs } = await supabase
    .from('user_prefs')
    .select('user_id')
    .eq('digest_enabled', true);

  if (!prefs?.length) return [];

  const { data: users } = await supabase
    .from('users')
    .select('id, whatsapp_number')
    .in('id', prefs.map(p => p.user_id));

  return users ?? [];
}

// ── Lists ──────────────────────────────────────────────────────────────────────

async function getLists(userId) {
  const { data, error } = await supabase
    .from('lists')
    .select('id, name, emoji, sort_order, last_activity_at')
    .eq('user_id', userId)
    .order('last_activity_at', { ascending: false, nullsFirst: false });

  if (error) throw new Error(`Failed to get lists: ${error.message}`);
  return data ?? [];
}

async function createList(userId, name, emoji = '📝', listType = 'checklist') {
  const existing = await getLists(userId);
  const maxOrder = existing.reduce((m, l) => Math.max(m, l.sort_order ?? 0), 0);

  const { data, error } = await supabase
    .from('lists')
    .insert({ user_id: userId, name, emoji, list_type: listType, sort_order: maxOrder + 1, last_activity_at: new Date().toISOString() })
    .select('id, name, emoji, list_type')
    .single();

  if (error) throw new Error(`Failed to create list: ${error.message}`);
  return data;
}

async function renameList(listId, newName) {
  await supabase.from('lists').update({ name: newName }).eq('id', listId);
}

async function deleteList(listId) {
  await supabase.from('lists').delete().eq('id', listId);
}

async function addListItem(listId, text) {
  const [{ data, error }] = await Promise.all([
    supabase.from('list_items').insert({ list_id: listId, text, checked: false }).select('id, text').single(),
    supabase.from('lists').update({ last_activity_at: new Date().toISOString() }).eq('id', listId),
  ]);

  if (error) throw new Error(`Failed to add list item: ${error.message}`);
  return data;
}

async function getListItems(listId) {
  const { data } = await supabase
    .from('list_items')
    .select('id, text, checked')
    .eq('list_id', listId)
    .order('created_at', { ascending: true });

  return data ?? [];
}

async function deleteListItem(itemId) {
  await supabase.from('list_items').delete().eq('id', itemId);
}

// ── Recurring Items ────────────────────────────────────────────────────────────

async function createRecurringItem(userId, listId, content, recurrence, nextDue) {
  const { data, error } = await supabase
    .from('recurring_items')
    .insert({ user_id: userId, list_id: listId, content, recurrence, next_due: nextDue })
    .select('id, content')
    .single();

  if (error) throw new Error(`Failed to create recurring item: ${error.message}`);
  return data;
}

async function getDueRecurringItems(date) {
  const { data } = await supabase
    .from('recurring_items')
    .select('id, user_id, list_id, content, recurrence')
    .lte('next_due', date);

  return data ?? [];
}

async function updateRecurringItemNextDue(itemId, nextDue) {
  await supabase.from('recurring_items').update({ next_due: nextDue }).eq('id', itemId);
}

async function deleteRecurringItem(itemId) {
  await supabase.from('recurring_items').delete().eq('id', itemId);
}

// ── Notes ──────────────────────────────────────────────────────────────────────

async function createNote(userId, title, body) {
  const { data, error } = await supabase
    .from('notes')
    .insert({ user_id: userId, title: title ?? body.slice(0, 50), body })
    .select('id, title')
    .single();

  if (error) throw new Error(`Failed to create note: ${error.message}`);
  return data;
}

async function deleteNote(noteId) {
  await supabase.from('notes').delete().eq('id', noteId);
}

// ── Events ─────────────────────────────────────────────────────────────────────

async function getCalDAVCredentials(userId) {
  const { data } = await supabase
    .from('users')
    .select('caldav_username, caldav_password')
    .eq('id', userId)
    .single();
  if (!data?.caldav_username) return null;
  return { username: data.caldav_username, password: data.caldav_password };
}

async function storeCalDAVCredentials(userId, username, password) {
  await supabase.from('users').update({ caldav_username: username, caldav_password: password }).eq('id', userId);
}

async function getUsersWithCalDAV() {
  const { data } = await supabase
    .from('users')
    .select('id, whatsapp_number')
    .not('caldav_username', 'is', null);
  return data ?? [];
}

async function getCalendarProvider(userId) {
  const { data } = await supabase
    .from('users')
    .select('calendar_provider, caldav_username, caldav_password, google_access_token, google_refresh_token, google_token_expiry, ms_access_token, ms_refresh_token, ms_token_expiry')
    .eq('id', userId)
    .single();
  if (!data) return null;
  const provider = data.calendar_provider ?? (data.caldav_username ? 'iphone' : null);
  return { ...data, calendar_provider: provider };
}

async function setCalendarProvider(userId, provider) {
  await supabase.from('users').update({ calendar_provider: provider }).eq('id', userId);
}

async function storeGoogleTokens(userId, accessToken, refreshToken, expiresAt) {
  await supabase.from('users').update({
    google_access_token:  accessToken,
    google_refresh_token: refreshToken,
    google_token_expiry:  expiresAt,
  }).eq('id', userId);
}

async function updateGoogleTokens(userId, accessToken, expiresAt) {
  await supabase.from('users').update({
    google_access_token: accessToken,
    google_token_expiry: expiresAt,
  }).eq('id', userId);
}

async function storeMicrosoftTokens(userId, accessToken, refreshToken, expiresAt) {
  await supabase.from('users').update({
    ms_access_token:  accessToken,
    ms_refresh_token: refreshToken,
    ms_token_expiry:  expiresAt,
  }).eq('id', userId);
}

async function updateMicrosoftTokens(userId, accessToken, refreshToken, expiresAt) {
  await supabase.from('users').update({
    ms_access_token:  accessToken,
    ms_refresh_token: refreshToken,
    ms_token_expiry:  expiresAt,
  }).eq('id', userId);
}

async function getUsersWithCalendar() {
  const { data } = await supabase
    .from('users')
    .select('id, whatsapp_number, calendar_provider, caldav_username, caldav_password, google_access_token, google_refresh_token, google_token_expiry, ms_access_token, ms_refresh_token, ms_token_expiry')
    .or('caldav_username.not.is.null,google_refresh_token.not.is.null,ms_refresh_token.not.is.null');
  return data ?? [];
}

async function createEvent(userId, { title, date, time, recurrence, reminderDaysBefore, caldavUid, calendarStream }) {
  const { data, error } = await supabase
    .from('events')
    .insert({
      user_id: userId,
      title,
      date,
      time: time ?? null,
      recurrence: recurrence ?? null,
      reminder_days_before: reminderDaysBefore ?? null,
      caldav_uid: caldavUid ?? null,
      calendar_stream: calendarStream ?? 'personal',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create event: ${error.message}`);
  return data;
}

async function getUpcomingEvents(userId, days = 7) {
  const today = new Date().toISOString().split('T')[0];
  const future = new Date();
  future.setDate(future.getDate() + days);

  const { data } = await supabase
    .from('events')
    .select('id, title, date, time, recurrence')
    .eq('user_id', userId)
    .gte('date', today)
    .lte('date', future.toISOString().split('T')[0])
    .order('date', { ascending: true });

  return data ?? [];
}

async function getEventsDueForReminder(today) {
  const { data } = await supabase
    .from('events')
    .select('id, user_id, title, date, reminder_days_before, users(whatsapp_number)')
    .is('reminder_sent_at', null)
    .not('date', 'is', null)
    .gte('reminder_days_before', 1);

  return (data ?? [])
    .filter(e => {
      const reminderDate = new Date(e.date);
      reminderDate.setDate(reminderDate.getDate() - e.reminder_days_before);
      return reminderDate.toISOString().split('T')[0] === today;
    })
    .map(e => ({ ...e, whatsapp_number: e.users?.whatsapp_number }));
}

async function markEventReminderSent(eventId) {
  await supabase.from('events').update({ reminder_sent_at: new Date().toISOString() }).eq('id', eventId);
}

async function getHabitReminderUsers(currentHour) {
  const today = new Date().toISOString().split('T')[0];

  const { data: prefs } = await supabase
    .from('user_prefs')
    .select('user_id, habits_reminder_time, habit_reminder_sent_date')
    .eq('habits_enabled', true)
    .not('habits_reminder_time', 'is', null);

  const matched = (prefs ?? []).filter(p => {
    const hour = parseInt((p.habits_reminder_time ?? '20:00').split(':')[0], 10);
    return hour === currentHour && p.habit_reminder_sent_date !== today;
  });

  if (!matched.length) return [];

  // Mark as sent before fetching users (race-condition safe)
  await supabase
    .from('user_prefs')
    .update({ habit_reminder_sent_date: today })
    .in('user_id', matched.map(p => p.user_id))
    .neq('habit_reminder_sent_date', today);

  const { data: users } = await supabase
    .from('users')
    .select('id, whatsapp_number, push_token')
    .in('id', matched.map(p => p.user_id));

  return users ?? [];
}

async function getEventsDueForPushReminder() {
  // Events starting within the next 35 minutes that haven't had a push reminder sent yet
  const now = new Date();
  const soon = new Date(now.getTime() + 35 * 60 * 1000);
  const today = now.toISOString().split('T')[0];
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const soonTime = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;

  const { data } = await supabase
    .from('events')
    .select('id, user_id, title, date, time, users(push_token)')
    .eq('date', today)
    .is('push_reminder_sent_at', null)
    .not('time', 'is', null)
    .gte('time', nowTime)
    .lte('time', soonTime);

  return (data ?? []).map(e => ({ ...e, push_token: e.users?.push_token }));
}

async function markEventPushReminderSent(eventId) {
  await supabase.from('events').update({ push_reminder_sent_at: new Date().toISOString() }).eq('id', eventId);
}

async function getUsersForSuggestions() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const { data: prefs } = await supabase
    .from('user_prefs')
    .select('user_id')
    .eq('suggestions_enabled', true)
    .or(`suggestion_last_sent_at.is.null,suggestion_last_sent_at.lt.${cutoff.toISOString()}`);

  if (!prefs?.length) return [];

  const { data: users } = await supabase
    .from('users')
    .select('id, whatsapp_number')
    .in('id', prefs.map(p => p.user_id));

  return users ?? [];
}

async function claimSuggestionSlot(userId) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  // Atomically claim the slot: only succeeds if still eligible (race-condition safe)
  const { count } = await supabase
    .from('user_prefs')
    .update({ suggestion_last_sent_at: new Date().toISOString() })
    .eq('user_id', userId)
    .or(`suggestion_last_sent_at.is.null,suggestion_last_sent_at.lt.${cutoff.toISOString()}`)
    .select('user_id', { count: 'exact', head: true });

  return (count ?? 0) > 0;
}

async function getUsersForContextBuilding() {
  const { data } = await supabase
    .from('users')
    .select('id, whatsapp_number, message_count')
    .gte('message_count', 5);

  return data ?? [];
}

async function updateUserContext(userId, context) {
  await Promise.all([
    supabase.from('users').update({ user_context: context }).eq('id', userId),
    supabase.from('user_prefs').upsert({ user_id: userId, context_last_built_at: new Date().toISOString() }, { onConflict: 'user_id' }),
  ]);
}

// ── Habits ─────────────────────────────────────────────────────────────────────

async function getActiveHabits(userId) {
  const { data } = await supabase
    .from('habits')
    .select('id, name, mini_goal, good_goal, elite_goal, sort_order')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  return data ?? [];
}

async function createHabit(userId, habitData) {
  const name      = habitData.name;
  const miniGoal  = habitData.miniGoal  ?? habitData.mini_goal  ?? null;
  const goodGoal  = habitData.goodGoal  ?? habitData.good_goal  ?? null;
  const eliteGoal = habitData.eliteGoal ?? habitData.elite_goal ?? null;

  if (!name)      throw new Error('Geef een naam op voor de habit.');
  if (!miniGoal)  throw new Error('Geef een mini-doel op (bijv. mini=5min).');
  if (!goodGoal)  throw new Error('Geef een goed-doel op (bijv. goed=20min).');
  if (!eliteGoal) throw new Error('Geef een elite-doel op (bijv. elite=45min).');

  const existing = await getActiveHabits(userId);
  if (existing.length >= 10) throw new Error('Maximaal 10 actieve habits bereikt.');

  const maxOrder = existing.reduce((m, h) => Math.max(m, h.sort_order ?? 0), 0);

  const { data, error } = await supabase
    .from('habits')
    .insert({ user_id: userId, name, mini_goal: miniGoal, good_goal: goodGoal, elite_goal: eliteGoal, is_active: true, sort_order: maxOrder + 1 })
    .select('id, name')
    .single();

  if (error) throw new Error(`Failed to create habit: ${error.message}`);
  return data;
}

async function deactivateHabit(habitId) {
  await supabase.from('habits').update({ is_active: false }).eq('id', habitId);
}

async function logHabit(userId, habitId, level, date) {
  const logDate = date ?? new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('habit_logs')
    .upsert(
      { habit_id: habitId, user_id: userId, date: logDate, level, logged_at: new Date().toISOString() },
      { onConflict: 'habit_id,date' }
    );

  if (error) throw new Error(`Failed to log habit: ${error.message}`);
}

// ── Extended List Operations ───────────────────────────────────────────────────

async function checkListItem(itemId, checked = true) {
  await supabase.from('list_items').update({ checked }).eq('id', itemId);
}

async function clearListItems(listId) {
  await supabase.from('list_items').delete().eq('list_id', listId);
}

async function checkAllListItems(listId) {
  await supabase.from('list_items').update({ checked: true }).eq('list_id', listId);
}

async function moveListItem(itemId, targetListId) {
  await supabase.from('list_items').update({ list_id: targetListId }).eq('id', itemId);
  await supabase.from('lists').update({ last_activity_at: new Date().toISOString() }).eq('id', targetListId);
}

async function updateListItemText(itemId, newText) {
  await supabase.from('list_items').update({ text: newText }).eq('id', itemId);
}

async function getAllUncheckedItems(userId) {
  const { data: lists } = await supabase
    .from('lists')
    .select('id, name, emoji')
    .eq('user_id', userId);

  if (!lists?.length) return [];

  const { data: items } = await supabase
    .from('list_items')
    .select('id, text, list_id')
    .in('list_id', lists.map(l => l.id))
    .eq('checked', false);

  const listMap = Object.fromEntries(lists.map(l => [l.id, l]));
  return (items ?? []).map(i => ({ ...i, list: listMap[i.list_id] }));
}

// ── Extended Event Operations ──────────────────────────────────────────────────

async function getTodayEvents(userId) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('events')
    .select('id, title, date, time, recurrence')
    .eq('user_id', userId)
    .eq('date', today)
    .order('time', { ascending: true, nullsFirst: false });
  return data ?? [];
}

async function getEventsForDate(userId, date) {
  const { data } = await supabase
    .from('events')
    .select('id, title, date, time, calendar_stream')
    .eq('user_id', userId)
    .eq('date', date)
    .not('time', 'is', null);
  return data ?? [];
}

async function getEventsByTitle(userId, title) {
  const { data } = await supabase
    .from('events')
    .select('id, title, date, time, recurrence, caldav_uid, calendar_stream')
    .eq('user_id', userId)
    .ilike('title', `%${title}%`);
  return (data ?? []).map(e => ({ ...e, caldavUid: e.caldav_uid, calendarStream: e.calendar_stream }));
}

async function updateEventTitle(eventId, title) {
  await supabase.from('events').update({ title, updated_at: new Date().toISOString() }).eq('id', eventId);
}

async function getEventsForDateRange(userId, startDate, endDate) {
  const { data } = await supabase
    .from('events')
    .select('id, title, date, time, caldav_uid, calendar_stream')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('time', { ascending: true, nullsFirst: false });
  return (data ?? []).map(e => ({ ...e, caldavUid: e.caldav_uid, calendarStream: e.calendar_stream }));
}

async function bulkUpdateEventDate(userId, eventIds, newDate) {
  await supabase.from('events').update({ date: newDate, updated_at: new Date().toISOString() }).in('id', eventIds).eq('user_id', userId);
}

async function moveAllListItems(fromListId, toListId) {
  await supabase.from('list_items').update({ list_id: toListId }).eq('list_id', fromListId).eq('checked', false);
  await supabase.from('lists').update({ last_activity_at: new Date().toISOString() }).eq('id', toListId);
}

async function searchNotes(userId, query) {
  const { data } = await supabase
    .from('notes')
    .select('id, title, body')
    .eq('user_id', userId)
    .or(`title.ilike.%${query}%,body.ilike.%${query}%`);
  return data ?? [];
}

async function sortListItemsAlphabetically(listId) {
  const { data: items } = await supabase.from('list_items').select('id, text, checked').eq('list_id', listId);
  if (!items?.length) return;
  const sorted = [...items].sort((a, b) => a.text.localeCompare(b.text, 'nl', { sensitivity: 'base' }));
  await supabase.from('list_items').delete().eq('list_id', listId);
  if (sorted.length > 0) {
    await supabase.from('list_items').insert(sorted.map(i => ({ list_id: listId, text: i.text, checked: i.checked })));
  }
}

async function updateEvent(userId, eventId, { date, time }) {
  const { error } = await supabase
    .from('events')
    .update({ date, time, updated_at: new Date().toISOString() })
    .eq('id', eventId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

async function deleteEventById(userId, eventId) {
  await supabase.from('events').delete().eq('id', eventId).eq('user_id', userId);
}

async function updateEventCalDAVUid(eventId, caldavUid) {
  await supabase.from('events').update({ caldav_uid: caldavUid }).eq('id', eventId);
}

// ── Extended Note Operations ───────────────────────────────────────────────────

async function getNotes(userId) {
  const { data } = await supabase
    .from('notes')
    .select('id, title, body')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

async function appendToNote(noteId, appendText) {
  const { data } = await supabase.from('notes').select('body').eq('id', noteId).single();
  const newBody = (data?.body ?? '') + '\n' + appendText;
  await supabase.from('notes').update({ body: newBody }).eq('id', noteId);
}

// ── Extended Habit Operations ──────────────────────────────────────────────────

async function getHabitStreak(userId, habitId) {
  const { data } = await supabase
    .from('habit_logs')
    .select('date')
    .eq('user_id', userId)
    .eq('habit_id', habitId)
    .order('date', { ascending: false });

  if (!data?.length) return 0;

  const dates = new Set(data.map(r => r.date));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let streak = 0;
  const check = new Date(today);

  for (let i = 0; i < 365; i++) {
    const dateStr = check.toISOString().split('T')[0];
    if (dates.has(dateStr)) {
      streak++;
      check.setDate(check.getDate() - 1);
    } else if (i === 0) {
      check.setDate(check.getDate() - 1); // today not yet logged, check from yesterday
    } else {
      break;
    }
  }

  return streak;
}

async function getTodayBirthdayEvents() {
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const thisYear = today.getFullYear().toString();

  const { data } = await supabase
    .from('events')
    .select('id, user_id, title, date, reminder_sent_at, users(whatsapp_number)')
    .eq('calendar_stream', 'birthdays')
    .eq('recurrence', 'yearly')
    .like('date', `%-${mm}-${dd}`);

  return (data ?? [])
    .filter(e => !e.reminder_sent_at || !e.reminder_sent_at.startsWith(thisYear))
    .map(e => ({ ...e, whatsapp_number: e.users?.whatsapp_number }));
}

async function getWhatsAppRemindersForHour(date, hour) {
  const hourStr = String(hour).padStart(2, '0');
  const { data } = await supabase
    .from('events')
    .select('id, user_id, title, time, users(whatsapp_number)')
    .eq('calendar_stream', 'wa_reminder')
    .eq('date', date)
    .like('time', `${hourStr}:%`)
    .is('reminder_sent_at', null);

  return (data ?? []).map(e => ({ ...e, whatsapp_number: e.users?.whatsapp_number }));
}

// ── CalDAV Sync Queue ──────────────────────────────────────────────────────────

async function enqueueCalDAVOperation(userId, operation, payload) {
  await supabase.from('caldav_sync_queue').insert({ user_id: userId, operation, payload });
}

async function getDueCalDAVOperations() {
  const { data } = await supabase
    .from('caldav_sync_queue')
    .select('*')
    .lt('attempts', 5)
    .lte('next_retry_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(50);
  return data ?? [];
}

async function markCalDAVOperationDone(id) {
  await supabase.from('caldav_sync_queue').delete().eq('id', id);
}

async function markCalDAVOperationFailed(id, error, attempts) {
  const backoffMinutes = Math.pow(2, attempts); // 2, 4, 8, 16, 32 min
  const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
  await supabase.from('caldav_sync_queue').update({
    attempts: attempts + 1,
    last_error: error,
    next_retry_at: nextRetry,
  }).eq('id', id);
}

// ── CalDAV Inbound Sync ────────────────────────────────────────────────────────

async function getUsersWithCalDAV() {
  const { data } = await supabase
    .from('users')
    .select('id, whatsapp_number, caldav_username, caldav_password')
    .not('caldav_username', 'is', null)
    .not('caldav_password', 'is', null);
  return data ?? [];
}

async function getCalDAVUidsByUser(userId) {
  const { data } = await supabase
    .from('events')
    .select('caldav_uid')
    .eq('user_id', userId)
    .not('caldav_uid', 'is', null);
  return new Set((data ?? []).map(e => e.caldav_uid));
}

async function getEventsWithCalDAVUid(userId) {
  const { data } = await supabase
    .from('events')
    .select('id, caldav_uid')
    .eq('user_id', userId)
    .not('caldav_uid', 'is', null);
  return data ?? [];
}

async function deleteEventsByIds(userId, ids) {
  if (!ids.length) return;
  await supabase.from('events').delete().eq('user_id', userId).in('id', ids);
}

async function updateEventFromCalDAV(userId, caldavUid, { title, date, time }) {
  await supabase.from('events')
    .update({ title, date, time: time ?? null })
    .eq('caldav_uid', caldavUid)
    .eq('user_id', userId);
}

async function createEventFromCalDAV(userId, { uid, title, date, time, calendar_stream }) {
  const { error } = await supabase.from('events').insert({
    user_id: userId,
    title,
    date,
    time: time ?? null,
    calendar_stream: calendar_stream ?? 'personal',
    caldav_uid: uid,
    reminder_days_before: null,
  });
  if (error) throw new Error(`createEventFromCalDAV: ${error.message}`);
}

// ── Geo Alert ──────────────────────────────────────────────────────────────────

async function getUserById(userId) {
  const { data } = await supabase
    .from('users')
    .select('id, whatsapp_number')
    .eq('id', userId)
    .single();
  return data ?? null;
}

async function getBoodschappenlijst(userId) {
  const { data } = await supabase
    .from('lists')
    .select('id, name, emoji')
    .eq('user_id', userId);
  if (!data) return null;
  const keywords = ['boodschappen', 'supermarkt', 'groceries', 'ah', 'jumbo', 'lidl', 'albert heijn', 'plus', 'aldi'];
  return data.find(l => keywords.some(k => l.name.toLowerCase().includes(k))) ?? null;
}

const GEO_COOLDOWN_MS = 2 * 60 * 60 * 1000;

async function canSendGeoAlert(userId) {
  const { data } = await supabase
    .from('user_prefs')
    .select('geo_alert_last_sent_at')
    .eq('user_id', userId)
    .single();
  if (!data?.geo_alert_last_sent_at) return true;
  return Date.now() - new Date(data.geo_alert_last_sent_at).getTime() >= GEO_COOLDOWN_MS;
}

async function markGeoAlertSent(userId) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - GEO_COOLDOWN_MS).toISOString();
  // Atomic update: only succeeds if cooldown has passed (race-safe)
  const { data, error } = await supabase
    .from('user_prefs')
    .upsert({ user_id: userId, geo_alert_last_sent_at: now }, { onConflict: 'user_id' })
    .select('user_id')
    .single();
  return !error && !!data;
}

// ── Calendar Streams ──────────────────────────────────────────────────────────

async function getCalendarStreams(userId) {
  const { data, error } = await supabase
    .from('calendar_streams')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Failed to get calendar streams: ${error.message}`);
  return data ?? [];
}

async function createCalendarStream(userId, stream) {
  const { data, error } = await supabase
    .from('calendar_streams')
    .insert({ user_id: userId, ...stream })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create calendar stream: ${error.message}`);
  return data;
}

async function updateCalendarStream(streamId, updates) {
  const { data, error } = await supabase
    .from('calendar_streams')
    .update(updates)
    .eq('id', streamId)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to update calendar stream: ${error.message}`);
  return data;
}

async function deleteCalendarStream(streamId) {
  await supabase.from('calendar_streams').delete().eq('id', streamId);
}

// ── Message Log ────────────────────────────────────────────────────────────────

async function logMessage(userId, rawText, category) {
  await supabase.from('messages_log').insert({ user_id: userId, raw_text: rawText, category });
}

// ── OTP Auth ──────────────────────────────────────────────────────────────────

async function getUserByPhone(phone) {
  const { data } = await supabase
    .from('users')
    .select('id, whatsapp_number, push_token')
    .eq('whatsapp_number', phone)
    .single();
  return data ?? null;
}

async function createOTP(phone, code, expiresAt) {
  // Invalidate any existing unused OTPs for this number first
  await supabase.from('otp_codes').update({ used: true }).eq('phone', phone).eq('used', false);
  await supabase.from('otp_codes').insert({ phone, code, expires_at: expiresAt });
}

async function verifyOTP(phone, code) {
  const { data } = await supabase
    .from('otp_codes')
    .select('id, code, expires_at, used')
    .eq('phone', phone)
    .eq('used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return { ok: false, reason: 'Geen actieve code gevonden. Vraag een nieuwe aan.' };
  if (data.used) return { ok: false, reason: 'Code al gebruikt.' };
  if (new Date(data.expires_at) < new Date()) return { ok: false, reason: 'Code verlopen. Vraag een nieuwe aan.' };
  if (data.code !== code) return { ok: false, reason: 'Onjuiste code.' };

  await supabase.from('otp_codes').update({ used: true }).eq('id', data.id);
  return { ok: true };
}

module.exports = {
  getOrCreateUserFull,
  markOnboardingComplete,
  incrementMessageCount,
  getUserContext,
  getUserPrefs,
  updateUserPrefs,
  trackActiveHour,
  getBestReminderHour,
  getUsersForDigest,
  getLists,
  createList,
  renameList,
  deleteList,
  addListItem,
  getListItems,
  deleteListItem,
  createRecurringItem,
  getDueRecurringItems,
  updateRecurringItemNextDue,
  deleteRecurringItem,
  getCalDAVCredentials,
  storeCalDAVCredentials,
  getUsersWithCalDAV,
  createNote,
  deleteNote,
  createEvent,
  getUpcomingEvents,
  getEventsDueForReminder,
  markEventReminderSent,
  getHabitReminderUsers,
  getEventsDueForPushReminder,
  markEventPushReminderSent,
  getUserByPhone,
  createOTP,
  verifyOTP,
  getUsersForSuggestions,
  claimSuggestionSlot,
  getUsersForContextBuilding,
  updateUserContext,
  getActiveHabits,
  createHabit,
  deactivateHabit,
  logHabit,
  checkListItem,
  clearListItems,
  checkAllListItems,
  moveListItem,
  updateListItemText,
  getAllUncheckedItems,
  getTodayEvents,
  getEventsForDate,
  getEventsByTitle,
  updateEvent,
  updateEventTitle,
  getEventsForDateRange,
  bulkUpdateEventDate,
  moveAllListItems,
  searchNotes,
  sortListItemsAlphabetically,
  deleteEventById,
  getNotes,
  appendToNote,
  getHabitStreak,
  logMessage,
  enqueueCalDAVOperation,
  getDueCalDAVOperations,
  markCalDAVOperationDone,
  markCalDAVOperationFailed,
  updateEventCalDAVUid,
  getUserById,
  getUserPushToken,
  getBoodschappenlijst,
  canSendGeoAlert,
  markGeoAlertSent,
  getUsersWithCalDAV,
  getUsersWithCalendar,
  getCalendarProvider,
  setCalendarProvider,
  storeGoogleTokens,
  updateGoogleTokens,
  storeMicrosoftTokens,
  updateMicrosoftTokens,
  getCalDAVUidsByUser,
  getEventsWithCalDAVUid,
  deleteEventsByIds,
  updateEventFromCalDAV,
  createEventFromCalDAV,
  getCalendarStreams,
  createCalendarStream,
  updateCalendarStream,
  deleteCalendarStream,
  getTodayBirthdayEvents,
  getWhatsAppRemindersForHour,
  uploadReceiptImage,
  createReceipt,
  getReceipts,
  deleteReceipt,
  getReceiptCategories,
  createReceiptCategory,
  updateReceiptCategory,
  deleteReceiptCategory,
  assignReceiptCategory,
};

// ── Receipts ────────────────────────────────────────────────────────────────────

async function ensureReceiptImagesBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.find(b => b.name === 'receipt-images')) return;
  const { error } = await supabase.storage.createBucket('receipt-images', { public: true });
  if (error && !error.message?.includes('already exists')) {
    throw new Error(`Could not create receipt-images bucket: ${error.message}`);
  }
}

async function uploadReceiptImage(userId, buffer, mimeType) {
  await ensureReceiptImagesBucket();

  const ext  = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('receipt-images').upload(path, buffer, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from('receipt-images').getPublicUrl(path);
  return data.publicUrl;
}

async function createReceipt(userId, { store, date, total, currency, items, category, description, imageUrl, receiptCategoryId = null }) {
  const { data, error } = await supabase.from('receipts').insert({
    user_id: userId, store, date, total, currency,
    items, category, description, image_url: imageUrl,
    receipt_category_id: receiptCategoryId,
  }).select('*').single();
  if (error) throw new Error(`createReceipt failed: ${error.message}`);
  return data;
}

async function getReceipts(userId, { limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('receipts').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error(`getReceipts failed: ${error.message}`);
  return data ?? [];
}

async function deleteReceipt(receiptId) {
  await supabase.from('receipts').delete().eq('id', receiptId);
}

async function getReceiptCategories(userId) {
  const { data, error } = await supabase.from('receipt_categories').select('*').eq('user_id', userId).order('created_at');
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function createReceiptCategory(userId, { name, emoji, color }) {
  const { data, error } = await supabase.from('receipt_categories').insert({ user_id: userId, name, emoji, color }).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateReceiptCategory(catId, updates) {
  const patch = {};
  if (updates.name  !== undefined) patch.name  = updates.name;
  if (updates.emoji !== undefined) patch.emoji = updates.emoji;
  if (updates.color !== undefined) patch.color = updates.color;
  const { data, error } = await supabase.from('receipt_categories').update(patch).eq('id', catId).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteReceiptCategory(catId) {
  await supabase.from('receipt_categories').delete().eq('id', catId);
}

async function assignReceiptCategory(receiptId, categoryId) {
  const { data, error } = await supabase.from('receipts').update({ receipt_category_id: categoryId }).eq('id', receiptId).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}
