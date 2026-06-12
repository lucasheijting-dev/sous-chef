'use strict';

const CALENDAR_API    = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function _refreshAccessToken(refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token refresh failed: ${data.error_description ?? data.error}`);
  return {
    accessToken: data.access_token,
    expiresAt:   new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

async function _getToken(user, db) {
  if (user.google_access_token && user.google_token_expiry) {
    if (new Date(user.google_token_expiry).getTime() > Date.now() + 5 * 60 * 1000) {
      return user.google_access_token;
    }
  }
  const { accessToken, expiresAt } = await _refreshAccessToken(user.google_refresh_token);
  await db.updateGoogleTokens(user.id, accessToken, expiresAt);
  return accessToken;
}

function _buildEvent({ title, date, time, recurrence, reminderMinutesBefore, durationMinutes }) {
  let start, end;
  if (time) {
    const startDt  = `${date}T${time}:00`;
    const dur      = durationMinutes ?? 60;
    const endDt    = new Date(new Date(startDt).getTime() + dur * 60 * 1000).toISOString().slice(0, 19);
    start          = { dateTime: startDt, timeZone: 'Europe/Amsterdam' };
    end            = { dateTime: endDt,   timeZone: 'Europe/Amsterdam' };
  } else {
    const nextDay = new Date(date + 'T00:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    start = { date };
    end   = { date: nextDay.toISOString().split('T')[0] };
  }

  const event = { summary: title, start, end };

  if (recurrence === 'yearly')         event.recurrence = ['RRULE:FREQ=YEARLY'];
  else if (recurrence === 'weekly')    event.recurrence = ['RRULE:FREQ=WEEKLY'];
  else if (recurrence === 'monthly')   event.recurrence = ['RRULE:FREQ=MONTHLY'];
  else if (recurrence?.startsWith('weekly:'))  event.recurrence = ['RRULE:FREQ=WEEKLY'];
  else if (recurrence?.startsWith('monthly:')) event.recurrence = ['RRULE:FREQ=MONTHLY'];

  if (reminderMinutesBefore != null) {
    event.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: reminderMinutesBefore }] };
  }

  return event;
}

async function listEvents(user, db, timeMin, timeMax) {
  const token = await _getToken(user, db);
  const params = new URLSearchParams({
    timeMin:       timeMin ?? new Date().toISOString(),
    timeMax:       timeMax ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents:  'true',
    maxResults:    '2500',
  });
  const res = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google Calendar listEvents failed: ${res.status}`);
  const data = await res.json();
  return data.items ?? [];
}

async function createEvent(user, db, params) {
  const token = await _getToken(user, db);
  const event = _buildEvent(params);
  const res = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(event),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google Calendar createEvent failed: ${err.error?.message ?? res.status}`);
  }
  const data = await res.json();
  return data.id;
}

async function updateEvent(user, db, googleId, params) {
  const token = await _getToken(user, db);
  const event = _buildEvent(params);
  const res = await fetch(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(googleId)}`, {
    method:  'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(event),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google Calendar updateEvent failed: ${err.error?.message ?? res.status}`);
  }
  const data = await res.json();
  return data.id;
}

async function deleteEvent(user, db, googleId) {
  if (!googleId) return;
  const token = await _getToken(user, db);
  await fetch(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(googleId)}`, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

module.exports = { listEvents, createEvent, updateEvent, deleteEvent };
