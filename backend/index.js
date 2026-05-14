require('dotenv').config();
const express       = require('express');
const webhookRouter      = require('./src/webhook');
const calendarFeedRouter = require('./src/calendarFeed');
const geoAlertRouter     = require('./src/geoAlert');
const cronJobs           = require('./src/cronJobs');

const app = express();
app.use(express.json());

app.use('/webhook', webhookRouter);
app.use('/calendar', calendarFeedRouter);
app.use('/geo-alert', geoAlertRouter);
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sous-Chef backend running on port ${PORT}`);
  cronJobs.start();
});
