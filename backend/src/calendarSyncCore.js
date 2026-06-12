'use strict';

const caldav          = require('./caldav');
const googleCalendar  = require('./googleCalendar');
const outlookCalendar = require('./outlookCalendar');
const db              = require('./supabase');

/**
 * Bi-directional sync for one user. Routes to the correct calendar provider.
 * user must have: { id, calendar_provider, caldav_username?, caldav_password?,
 *                   google_refresh_token?, ms_refresh_token?, ... }
 * Returns { imported, deleted, updated }
 */
async function syncUserCalendar(user) {
  const provider = user.calendar_provider ?? (user.caldav_username ? 'iphone' : null);

  if (provider === 'google')  return _syncGoogle(user);
  if (provider === 'outlook') return _syncOutlook(user);
  if (provider === 'iphone' || provider === null) return _syncCalDAV(user);
  return { imported: 0, deleted: 0, updated: 0 };
}

// ── CalDAV (iPhone / iCloud) ───────────────────────────────────────────────────

async function _syncCalDAV(user) {
  if (!user.caldav_username) return { imported: 0, deleted: 0, updated: 0 };

  const caldavUidsOnServer = new Set();

  for (const cal of caldav.CALENDARS) {
    const events = await caldav.listCalendarEvents(user.caldav_username, user.caldav_password, cal.id);
    for (const { uid } of events) caldavUidsOnServer.add(uid);
  }

  const knownUids = await db.getCalDAVUidsByUser(user.id);
  let imported = 0, deleted = 0, updated = 0;

  for (const cal of caldav.CALENDARS) {
    const events = await caldav.listCalendarEvents(user.caldav_username, user.caldav_password, cal.id);
    for (const { href, uid } of events) {
      const ics    = await caldav.getEventIcal(user.caldav_username, user.caldav_password, href);
      const parsed = caldav.parseIcal(ics);
      if (!parsed || !parsed.date) continue;

      if (knownUids.has(uid)) {
        await db.updateEventFromCalDAV(user.id, uid, parsed).catch(() => {});
        updated++;
      } else {
        await db.createEventFromCalDAV(user.id, { ...parsed, calendar_stream: cal.stream });
        knownUids.add(uid);
        imported++;
      }
    }
  }

  const supabaseEvents = await db.getEventsWithCalDAVUid(user.id);
  const toDelete = supabaseEvents.filter(e => !caldavUidsOnServer.has(e.caldav_uid));
  if (toDelete.length > 0) {
    await db.deleteEventsByIds(user.id, toDelete.map(e => e.id));
    deleted += toDelete.length;
  }

  return { imported, deleted, updated };
}

// ── Google Calendar ────────────────────────────────────────────────────────────

async function _syncGoogle(user) {
  const now     = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString();

  const googleEvents = await googleCalendar.listEvents(user, db, timeMin, timeMax);
  const knownUids    = await db.getCalDAVUidsByUser(user.id);
  let imported = 0, deleted = 0, updated = 0;

  for (const gEvent of googleEvents) {
    const uid    = gEvent.id;
    const parsed = _parseGoogleEvent(gEvent);
    if (!parsed) continue;

    if (knownUids.has(uid)) {
      await db.updateEventFromCalDAV(user.id, uid, parsed).catch(() => {});
      updated++;
    } else {
      await db.createEventFromCalDAV(user.id, { ...parsed, calendar_stream: 'personal' });
      knownUids.add(uid);
      imported++;
    }
  }

  const googleUids     = new Set(googleEvents.map(e => e.id));
  const supabaseEvents = await db.getEventsWithCalDAVUid(user.id);
  const toDelete       = supabaseEvents.filter(e => e.caldav_uid && !googleUids.has(e.caldav_uid));
  if (toDelete.length > 0) {
    await db.deleteEventsByIds(user.id, toDelete.map(e => e.id));
    deleted += toDelete.length;
  }

  return { imported, deleted, updated };
}

function _parseGoogleEvent(gEvent) {
  let date = null, time = null;
  if (gEvent.start?.date) {
    date = gEvent.start.date;
  } else if (gEvent.start?.dateTime) {
    const dt = new Date(gEvent.start.dateTime);
    date = dt.toISOString().split('T')[0];
    time = dt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
  }
  if (!date) return null;
  return { title: gEvent.summary || 'Afspraak', date, time, uid: gEvent.id };
}

// ── Microsoft Outlook / 365 ───────────────────────────────────────────────────

async function _syncOutlook(user) {
  const now     = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString();

  const msEvents  = await outlookCalendar.listEvents(user, db, timeMin, timeMax);
  const knownUids = await db.getCalDAVUidsByUser(user.id);
  let imported = 0, deleted = 0, updated = 0;

  for (const msEvent of msEvents) {
    const uid    = msEvent.id;
    const parsed = _parseOutlookEvent(msEvent);
    if (!parsed) continue;

    if (knownUids.has(uid)) {
      await db.updateEventFromCalDAV(user.id, uid, parsed).catch(() => {});
      updated++;
    } else {
      await db.createEventFromCalDAV(user.id, { ...parsed, calendar_stream: 'personal' });
      knownUids.add(uid);
      imported++;
    }
  }

  const msUids         = new Set(msEvents.map(e => e.id));
  const supabaseEvents = await db.getEventsWithCalDAVUid(user.id);
  const toDelete       = supabaseEvents.filter(e => e.caldav_uid && !msUids.has(e.caldav_uid));
  if (toDelete.length > 0) {
    await db.deleteEventsByIds(user.id, toDelete.map(e => e.id));
    deleted += toDelete.length;
  }

  return { imported, deleted, updated };
}

function _parseOutlookEvent(msEvent) {
  if (!msEvent.start?.dateTime && !msEvent.isAllDay) return null;
  let date, time;
  if (msEvent.isAllDay) {
    date = msEvent.start.dateTime?.split('T')[0];
    time = null;
  } else {
    const dt = new Date(msEvent.start.dateTime);
    date = dt.toISOString().split('T')[0];
    time = dt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
  }
  if (!date) return null;
  return { title: msEvent.subject || 'Afspraak', date, time, uid: msEvent.id };
}

module.exports = { syncUserCalendar };
