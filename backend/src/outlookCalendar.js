'use strict';

const GRAPH_API    = 'https://graph.microsoft.com/v1.0';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

async function _refreshAccessToken(refreshToken) {
  const res = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      scope:         'Calendars.ReadWrite offline_access',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`MS token refresh failed: ${data.error_description ?? data.error}`);
  return {
    accessToken:      data.access_token,
    newRefreshToken:  data.refresh_token ?? refreshToken,
    expiresAt:        new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

async function _getToken(user, db) {
  if (user.ms_access_token && user.ms_token_expiry) {
    if (new Date(user.ms_token_expiry).getTime() > Date.now() + 5 * 60 * 1000) {
      return user.ms_access_token;
    }
  }
  const { accessToken, newRefreshToken, expiresAt } = await _refreshAccessToken(user.ms_refresh_token);
  await db.updateMicrosoftTokens(user.id, accessToken, newRefreshToken, expiresAt);
  return accessToken;
}

function _buildEvent({ title, date, time, recurrence, reminderMinutesBefore, durationMinutes }) {
  const isAllDay = !time;
  const startDt  = time ? `${date}T${time}:00` : `${date}T00:00:00`;
  const dur       = durationMinutes ?? 60;
  const endDt    = time
    ? new Date(new Date(startDt).getTime() + dur * 60 * 1000).toISOString().slice(0, 19)
    : `${date}T23:59:59`;

  const event = {
    subject: title,
    start:   { dateTime: startDt, timeZone: 'Europe/Amsterdam' },
    end:     { dateTime: endDt,   timeZone: 'Europe/Amsterdam' },
    isAllDay,
  };

  if (recurrence === 'yearly') {
    const [, m, d] = date.split('-').map(Number);
    event.recurrence = {
      pattern: { type: 'absoluteYearly', interval: 1, month: m, dayOfMonth: d },
      range:   { type: 'noEnd', startDate: date },
    };
  } else if (recurrence === 'weekly' || recurrence?.startsWith('weekly:')) {
    event.recurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: [] },
      range:   { type: 'noEnd', startDate: date },
    };
  } else if (recurrence === 'monthly' || recurrence?.startsWith('monthly:')) {
    event.recurrence = {
      pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: parseInt(date.split('-')[2], 10) },
      range:   { type: 'noEnd', startDate: date },
    };
  }

  if (reminderMinutesBefore != null) {
    event.isReminderOn     = true;
    event.reminderMinutesBeforeStart = reminderMinutesBefore;
  }

  return event;
}

async function listEvents(user, db, startDate, endDate) {
  const token = await _getToken(user, db);
  const start = startDate ?? new Date().toISOString();
  const end   = endDate   ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const res = await fetch(
    `${GRAPH_API}/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=500&$select=id,subject,start,end,isAllDay`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`MS Graph listEvents failed: ${res.status}`);
  const data = await res.json();
  return data.value ?? [];
}

async function createEvent(user, db, params) {
  const token = await _getToken(user, db);
  const event = _buildEvent(params);
  const res = await fetch(`${GRAPH_API}/me/calendar/events`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(event),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`MS Graph createEvent failed: ${err.error?.message ?? res.status}`);
  }
  const data = await res.json();
  return data.id;
}

async function updateEvent(user, db, msId, params) {
  const token = await _getToken(user, db);
  const event = _buildEvent(params);
  const res = await fetch(`${GRAPH_API}/me/calendar/events/${encodeURIComponent(msId)}`, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(event),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`MS Graph updateEvent failed: ${err.error?.message ?? res.status}`);
  }
  const data = await res.json();
  return data.id;
}

async function deleteEvent(user, db, msId) {
  if (!msId) return;
  const token = await _getToken(user, db);
  await fetch(`${GRAPH_API}/me/calendar/events/${encodeURIComponent(msId)}`, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

module.exports = { listEvents, createEvent, updateEvent, deleteEvent };
