'use strict';

const Anthropic  = require('@anthropic-ai/sdk');
const db         = require('./supabase');
const { sendMessage } = require('./whatsapp');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function sendSuggestionToUser(user) {
  const [lists, habits, events] = await Promise.all([
    db.getLists(user.id),
    db.getActiveHabits(user.id),
    db.getUpcomingEvents(user.id, 14),
  ]);

  const listSummaries = await Promise.all(
    lists.map(async l => {
      const items = await db.getListItems(l.id);
      const open  = items.filter(i => !i.checked).length;
      return open > 0 ? `${l.name} (${open} open)` : null;
    })
  );

  const activeLists  = listSummaries.filter(Boolean).join(', ') || 'geen';
  const activeHabits = habits.map(h => h.name).join(', ') || 'geen';
  const upcomingEvts = events.map(e => e.title).join(', ')   || 'geen';

  const prompt = `Je bent Sous-Chef, een persoonlijke WhatsApp-assistent.

Gebruikersdata:
- Lijsten met open items: ${activeLists}
- Actieve habits: ${activeHabits}
- Aankomende afspraken: ${upcomingEvts}

Geef één korte, persoonlijke tip of suggestie (max 2 zinnen).
Varieer: productiviteitstip, habit-motivatie, of een herinnering om iets af te ronden.
Wees direct en vriendelijk. Geen aanspreking met "je" meer dan nodig.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  });

  const tip = response.content[0]?.text?.trim();
  if (!tip) return;

  await sendMessage(user.whatsapp_number, `💡 *Tip van Sous-Chef*\n\n${tip}`);
  await db.markSuggestionSent(user.id);
  console.log(`[Suggestions] Sent to ${user.whatsapp_number}`);
}

async function sendWeeklySuggestions() {
  console.log('[Suggestions] Sending weekly suggestions...');
  try {
    const users = await db.getUsersForSuggestions();
    for (const user of users) {
      await sendSuggestionToUser(user).catch(err =>
        console.error(`[Suggestions] Failed for ${user.whatsapp_number}:`, err)
      );
    }
    console.log(`[Suggestions] Done — sent to ${users.length} users.`);
  } catch (err) {
    console.error('[Suggestions] Fatal error:', err);
  }
}

module.exports = { sendWeeklySuggestions };
