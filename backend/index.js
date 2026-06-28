require('dotenv').config();
const express       = require('express');
const webhookRouter           = require('./src/webhook');
const calendarFeedRouter      = require('./src/calendarFeed');
const calendarProfileRouter   = require('./src/calendarProfile');
const geoAlertRouter          = require('./src/geoAlert');
const registerRouter          = require('./src/register');
const calendarStreamsRouter   = require('./src/calendarStreams');
const receiptsRouter          = require('./src/receipts');
const receiptCategoriesRouter = require('./src/receiptCategories');
const calendarSyncRouter      = require('./src/calendarSync');
const authRouter              = require('./src/auth');
const recipesRouter           = require('./src/recipes');
const sharingRouter           = require('./src/sharing');
const eventsRouter            = require('./src/events');
const listsRouter             = require('./src/lists');
const notesRouter             = require('./src/notes');
const habitsRouter            = require('./src/habits');
const referralRouter          = require('./src/referral');
const adminRouter             = require('./src/admin');
const notifPrefsRouter        = require('./src/notifPrefs');
const cronJobs           = require('./src/cronJobs');

const app = express();
app.use(express.json({ limit: '8mb' }));

app.use('/webhook', webhookRouter);
app.use('/calendar', calendarFeedRouter);
app.use('/calendar-profile', calendarProfileRouter);
app.use('/geo-alert', geoAlertRouter);
app.use('/register', registerRouter);
app.use('/calendar-streams', calendarStreamsRouter);
app.use('/receipts', receiptsRouter);
app.use('/receipt-categories', receiptCategoriesRouter);
app.use('/calendar-sync', calendarSyncRouter);
app.use('/auth', authRouter);
app.use('/recipe', recipesRouter);
app.use('/sharing', sharingRouter);
app.use('/events', eventsRouter);
app.use('/lists', listsRouter);
app.use('/notes', notesRouter);
app.use('/habits', habitsRouter);
app.use('/join', referralRouter);
app.use('/admin', adminRouter);
app.use('/user', notifPrefsRouter);
// ── List invite deep-link redirect page ───────────────────────────────────────
app.get('/join/list/:token', async (req, res) => {
  const { token } = req.params;
  const db = require('./src/supabase');
  let listName = 'een lijst';
  let listEmoji = '📝';
  try {
    const invite = await db.getListInvite(token);
    if (invite) { listName = invite.list_name || listName; listEmoji = invite.list_emoji || listEmoji; }
  } catch { /* serve page regardless */ }

  const deepLink = `app://redirect?listInvite=${encodeURIComponent(token)}`;
  const appStoreUrl = 'https://apps.apple.com/app/de-sous-chef/id6742611499';
  const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.lucasheijting.souschef';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sous-Chef uitnodiging</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0A0A0A;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;text-align:center;gap:20px}
    .logo{font-size:48px;margin-bottom:4px}
    h1{font-size:22px;font-weight:700;color:#FCC10C}
    .list-name{font-size:18px;font-weight:600;margin:4px 0}
    p{font-size:15px;color:#aaa;line-height:1.5}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:16px 28px;border-radius:32px;font-size:16px;font-weight:700;text-decoration:none;width:100%;max-width:320px;cursor:pointer;border:none}
    .btn-primary{background:#FCC10C;color:#000}
    .btn-store{background:#1a1a1a;color:#fff;border:1px solid #333;font-size:14px}
    .stores{display:flex;flex-direction:column;gap:8px;width:100%;max-width:320px}
    #opening{font-size:14px;color:#666}
    #fallback{display:none;width:100%;max-width:320px}
    .divider{width:100%;max-width:320px;border-top:1px solid #222;padding-top:20px;margin-top:4px}
  </style>
</head>
<body>
  <div class="logo">🍳</div>
  <div>
    <h1>Sous-Chef</h1>
    <div class="list-name">${listEmoji} ${listName}</div>
  </div>
  <p>Je bent uitgenodigd om mee te werken aan deze lijst!</p>
  <p id="opening">De app wordt geopend…</p>
  <div id="fallback">
    <div class="stores">
      <a class="btn btn-store" href="${appStoreUrl}">📱 Download in de App Store</a>
      <a class="btn btn-store" href="${playStoreUrl}">🤖 Download in Google Play</a>
    </div>
    <p style="margin-top:16px;font-size:13px;color:#555">Na installatie, klik de link opnieuw om automatisch toe te voegen.</p>
  </div>
  <script>
    window.location = '${deepLink}';
    setTimeout(function(){
      document.getElementById('opening').style.display='none';
      document.getElementById('fallback').style.display='block';
    }, 2000);
  </script>
</body>
</html>`);
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sous-Chef backend running on port ${PORT}`);
  cronJobs.start();
});
