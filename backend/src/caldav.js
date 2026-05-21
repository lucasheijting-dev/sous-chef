'use strict';

const crypto = require('crypto');

async function fetchWithRetry(url, options, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 300 * attempt));
      }
    }
  }
  throw lastError;
}

const CALDAV_URL         = process.env.CALDAV_URL;
const CALDAV_ADMIN_URL   = process.env.CALDAV_ADMIN_URL;
const CALDAV_ADMIN_SECRET = process.env.CALDAV_ADMIN_SECRET;

const CALENDARS = [
  { id: 'appointments', name: 'Afspraken',    stream: 'appointments', color: '#4A90D8' },
  { id: 'birthdays',    name: 'Verjaardagen', stream: 'birthdays',    color: '#FF6B6B' },
  { id: 'work',         name: 'Werk',         stream: 'work',         color: '#6B8CFF' },
  { id: 'personal',     name: 'Persoonlijk',  stream: 'personal',     color: '#4ECDC4' },
];

function isConfigured() {
  return !!(CALDAV_URL && CALDAV_ADMIN_URL && CALDAV_ADMIN_SECRET);
}

function generateCredentials(userId) {
  const username = 'u' + userId.replace(/-/g, '').slice(0, 16);
  const password = crypto.randomBytes(16).toString('hex');
  return { username, password };
}

async function provisionUser(username, password) {
  const res = await fetchWithRetry(`${CALDAV_ADMIN_URL}/create-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': CALDAV_ADMIN_SECRET,
    },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CalDAV provision failed: ${text}`);
  }

  for (const cal of CALENDARS) {
    await mkcalendar(username, password, cal.id, cal.name);
    await setCalendarColor(username, password, cal.id, cal.color).catch(() => {});
  }
}

async function mkcalendar(username, password, calendarId, displayName) {
  const url = `${CALDAV_URL}/${username}/${calendarId}/`;
  const body = `<?xml version="1.0" encoding="UTF-8"?><C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:"><D:set><D:prop><D:displayname>${displayName}</D:displayname></D:prop></D:set></C:mkcalendar>`;

  await fetchWithRetry(url, {
    method: 'MKCALENDAR',
    headers: {
      'Content-Type': 'application/xml',
      'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
    },
    body,
  });
}

async function setCalendarColor(username, password, calendarId, hexColor) {
  const url = `${CALDAV_URL}/${username}/${calendarId}/`;
  const body = `<?xml version="1.0" encoding="UTF-8"?><D:propertyupdate xmlns:D="DAV:" xmlns:ICAL="http://apple.com/ns/ical/"><D:set><D:prop><ICAL:calendar-color>${hexColor}FF</ICAL:calendar-color></D:prop></D:set></D:propertyupdate>`;

  await fetchWithRetry(url, {
    method: 'PROPPATCH',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
    },
    body,
  });
}

async function createUserCalendar(username, password, calendarId, displayName, hexColor) {
  await mkcalendar(username, password, calendarId, displayName);
  await setCalendarColor(username, password, calendarId, hexColor).catch(() => {});
}

async function createEvent(username, password, calendarStream, event) {
  const uid = crypto.randomUUID();
  const calendarId = streamToCalendarId(calendarStream);
  const ical = buildIcal(event, uid, event.reminderMinutesBefore ?? null);
  const url = `${CALDAV_URL}/${username}/${calendarId}/${uid}.ics`;

  const res = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
    },
    body: ical,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CalDAV event creation failed: ${res.status} ${text}`);
  }

  return uid;
}

async function deleteEvent(username, password, calendarStream, uid) {
  const calendarId = streamToCalendarId(calendarStream);
  const url = `${CALDAV_URL}/${username}/${calendarId}/${uid}.ics`;

  await fetchWithRetry(url, {
    method: 'DELETE',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
    },
  });
}

function streamToCalendarId(stream) {
  const cal = CALENDARS.find(c => c.stream === stream);
  return cal?.id ?? stream; // custom streams: caldav_id === claude_key, pass through directly
}

function buildIcal(event, uid, reminderMinutesBefore = null) {
  const now = toUtcStamp(new Date());
  let dtstart, dtend;

  if (event.time) {
    const [year, month, day] = event.date.split('-').map(Number);
    const [hour, minute] = event.time.split(':').map(Number);
    const start = new Date(year, month - 1, day, hour, minute);
    const durationMins = event.durationMinutes ?? 60;
    const end   = new Date(start.getTime() + durationMins * 60 * 1000);
    dtstart = `DTSTART:${toLocalStamp(start)}`;
    dtend   = `DTEND:${toLocalStamp(end)}`;
  } else {
    dtstart = `DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`;
    dtend   = `DTEND;VALUE=DATE:${shiftDateStr(event.date, 1)}`;
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sous-Chef//NL',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    dtstart,
    dtend,
    `SUMMARY:${event.title}`,
  ];

  if (event.recurrence === 'yearly') {
    lines.push('RRULE:FREQ=YEARLY');
  }

  if (Array.isArray(event.attendees) && event.attendees.length > 0) {
    for (const name of event.attendees) {
      lines.push(`ATTENDEE;CN=${name}:invalid:nomail`);
    }
  }

  if (event.location) {
    lines.push(`LOCATION:${event.location.replace(/\n/g, '\\n')}`);
  }

  if (reminderMinutesBefore !== null && reminderMinutesBefore !== undefined) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${event.title}`,
      `TRIGGER:-PT${reminderMinutesBefore}M`,
      'END:VALARM',
    );
  } else if (event.reminderDaysBefore !== null && event.reminderDaysBefore !== undefined) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${event.title}`,
      `TRIGGER:-P${event.reminderDaysBefore}DT0H0M0S`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function toUtcStamp(d) {
  return d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
}

function toLocalStamp(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

function shiftDateStr(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}

// ── Inbound sync helpers ───────────────────────────────────────────────────────

async function listCalendarEvents(username, password, calendarId) {
  const url = `${CALDAV_URL}/${username}/${calendarId}/`;
  const body = `<?xml version="1.0" encoding="UTF-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>`;

  let res;
  try {
    res = await fetchWithRetry(url, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml',
        'Depth': '1',
        'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
      },
      body,
    });
  } catch {
    return [];
  }

  if (!res.ok) return [];
  const text = await res.text();

  const hrefs = [...text.matchAll(/<[Dd]:[Hh]ref>([^<]+\.ics)<\/[Dd]:[Hh]ref>/g)].map(m => m[1]);
  const etags = [...text.matchAll(/<[Dd]:[Gg]etetag>"?([^"<\r\n]+)"?<\/[Dd]:[Gg]etetag>/g)].map(m => m[1]);

  return hrefs.map((href, i) => ({
    href,
    etag: etags[i] ?? '',
    uid: href.split('/').pop().replace('.ics', ''),
  }));
}

async function getEventIcal(username, password, href) {
  const base = CALDAV_URL.replace(/\/$/, '');
  const url = href.startsWith('http') ? href : `${base}${href}`;
  try {
    const res = await fetchWithRetry(url, {
      method: 'GET',
      headers: { 'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') },
    });
    return res.ok ? res.text() : null;
  } catch {
    return null;
  }
}

function parseIcal(ics) {
  if (!ics) return null;
  const block = ics.match(/BEGIN:VEVENT([\s\S]+?)END:VEVENT/)?.[1];
  if (!block) return null;

  function prop(name) {
    const m = block.match(new RegExp(`^${name}[^:\\r\\n]*:(.+)`, 'm'));
    return m ? m[1].trim() : null;
  }

  const uid   = prop('UID');
  const title = prop('SUMMARY');
  if (!uid || !title) return null;

  const dtstart = prop('DTSTART');
  function parseIcalDate(dt) {
    if (!dt) return { date: null, time: null };
    const clean = dt.replace(/Z$/, '');
    const date = `${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}`;
    if (!clean.includes('T')) return { date, time: null };
    const time = `${clean.slice(9,11)}:${clean.slice(11,13)}`;
    return { date, time };
  }

  const { date, time } = parseIcalDate(dtstart);
  return { uid, title, date, time };
}

module.exports = { isConfigured, generateCredentials, provisionUser, createEvent, deleteEvent, CALENDARS, listCalendarEvents, getEventIcal, parseIcal, setCalendarColor, createUserCalendar };
