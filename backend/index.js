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
const cronJobs           = require('./src/cronJobs');

const app = express();
app.use(express.json());

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
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sous-Chef backend running on port ${PORT}`);
  cronJobs.start();
});
