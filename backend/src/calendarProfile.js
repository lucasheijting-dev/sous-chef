'use strict';

const express = require('express');
const crypto  = require('crypto');
const { getCalDAVCredentials, storeCalDAVCredentials } = require('./supabase');
const caldav  = require('./caldav');

const router = express.Router();

const CALDAV_HOST = process.env.CALDAV_HOST ?? 'caldav.sous-chef.nl';

function buildMobileConfig(userId, username, password) {
  const accountUuid = crypto.randomUUID();
  const profileUuid = crypto.randomUUID();
  const principalUrl = `/${username}/`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>CalDAVAccountDescription</key>
      <string>Sous-Chef</string>
      <key>CalDAVHostName</key>
      <string>${CALDAV_HOST}</string>
      <key>CalDAVPort</key>
      <integer>443</integer>
      <key>CalDAVPrincipalURL</key>
      <string>${principalUrl}</string>
      <key>CalDAVUseSSL</key>
      <true/>
      <key>CalDAVUsername</key>
      <string>${username}</string>
      <key>CalDAVPassword</key>
      <string>${password}</string>
      <key>PayloadDescription</key>
      <string>Voegt Sous-Chef agenda toe aan je iPhone</string>
      <key>PayloadDisplayName</key>
      <string>Sous-Chef Agenda</string>
      <key>PayloadIdentifier</key>
      <string>nl.sous-chef.caldav.${username}</string>
      <key>PayloadType</key>
      <string>com.apple.caldav.account</string>
      <key>PayloadUUID</key>
      <string>${accountUuid}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Installeert de Sous-Chef agenda op je iPhone</string>
  <key>PayloadDisplayName</key>
  <string>Sous-Chef</string>
  <key>PayloadIdentifier</key>
  <string>nl.sous-chef.profile.${userId}</string>
  <key>PayloadOrganization</key>
  <string>Sous-Chef</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profileUuid}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`;
}

// GET /calendar-profile?userId=<uuid>
router.get('/', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  let creds = await getCalDAVCredentials(userId);

  if (!creds) {
    if (!caldav.isConfigured()) {
      return res.status(503).json({ error: 'CalDAV not configured' });
    }
    try {
      const { username, password } = caldav.generateCredentials(userId);
      await caldav.provisionUser(username, password);
      await storeCalDAVCredentials(userId, username, password);
      creds = { username, password };
      console.log(`[CalendarProfile] Provisioned CalDAV for user ${userId}`);
    } catch (err) {
      console.error('[CalendarProfile] Provisioning failed:', err.message);
      return res.status(500).json({ error: 'Agenda aanmaken mislukt. Probeer het opnieuw.' });
    }
  }

  const xml = buildMobileConfig(userId, creds.username, creds.password);
  res.setHeader('Content-Type', 'application/x-apple-aspen-config; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sous-chef.mobileconfig"');
  res.send(xml);
});

module.exports = router;
