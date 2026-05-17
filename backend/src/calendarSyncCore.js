'use strict';

const caldav = require('./caldav');
const db     = require('./supabase');

/**
 * Bi-directional sync for one user.
 * user must have: { id, caldav_username, caldav_password }
 * Returns { imported, deleted, updated }
 */
async function syncUserCalendar(user) {
  const caldavUidsOnServer = new Set();

  // 1. Collect all UIDs currently on the CalDAV server across all calendars
  for (const cal of caldav.CALENDARS) {
    const events = await caldav.listCalendarEvents(user.caldav_username, user.caldav_password, cal.id);
    for (const { uid } of events) caldavUidsOnServer.add(uid);
  }

  // 2. Import new events + update changed events
  const knownUids = await db.getCalDAVUidsByUser(user.id);
  let imported = 0, deleted = 0, updated = 0;

  for (const cal of caldav.CALENDARS) {
    const events = await caldav.listCalendarEvents(user.caldav_username, user.caldav_password, cal.id);

    for (const { href, uid } of events) {
      const ics = await caldav.getEventIcal(user.caldav_username, user.caldav_password, href);
      const parsed = caldav.parseIcal(ics);
      if (!parsed || !parsed.date) continue;

      if (knownUids.has(uid)) {
        // Already in Supabase — sync any title/date/time changes
        await db.updateEventFromCalDAV(user.id, uid, parsed).catch(() => {});
        updated++;
      } else {
        // New on CalDAV — import to Supabase
        await db.createEventFromCalDAV(user.id, { ...parsed, calendar_stream: cal.stream });
        knownUids.add(uid);
        imported++;
      }
    }
  }

  // 3. Delete Supabase events whose caldav_uid no longer exists on the server
  const supabaseEvents = await db.getEventsWithCalDAVUid(user.id);
  const toDelete = supabaseEvents.filter(e => !caldavUidsOnServer.has(e.caldav_uid));
  if (toDelete.length > 0) {
    await db.deleteEventsByIds(user.id, toDelete.map(e => e.id));
    deleted += toDelete.length;
  }

  return { imported, deleted, updated };
}

module.exports = { syncUserCalendar };
