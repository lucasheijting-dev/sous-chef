'use strict';

// Guided onboarding conversation for new users.
// Step state is kept in-memory (Map). Once finished, onboarding_completed=true
// is written to the users table which is the only persistent flag needed.

const db      = require('./supabase');
const { sendMessage } = require('./whatsapp');

const STEPS = [
  {
    key: 'name',
    ask: `👋 *Welkom bij Sous-Chef!*

Ik ben je persoonlijke assistent op WhatsApp. Je kunt mij alles sturen — afspraken, boodschappen, notities, reminders — en ik regel het voor je.

Laten we beginnen. *Hoe heet je?*`,
  },
  {
    key: 'lists',
    ask: (name) => `Leuk je te ontmoeten, *${name}*! 🍳

*Wil je meteen een paar lijsten aanmaken?* Denk aan boodschappen, werk, films, etc.

Stuur ze kommagescheiden, bijv.: _"boodschappen, werk, films"_
Of typ *overslaan* om dit later te doen.`,
  },
  {
    key: 'done',
    ask: (name) => `Je bent helemaal klaar, *${name}*! 🎉

Hier is wat je mij kunt sturen:

📅 *Agenda* — _"tandarts vrijdag 14u"_ of _"wat staat er morgen?"_
📋 *Lijsten* — _"melk op de boodschappen"_ of _"maak een werklijst"_
📝 *Notities* — _"onthoud: wifi wachtwoord is Appel123"_
🧾 *Bonnetjes* — stuur een foto van een kassabon
🏋️ *Habits* — _"voeg habit toe: sporten"_ of _"ik heb 30 min gesport"_

Stuur gewoon een berichtje in je eigen woorden — ik snap je vanzelf. Tot zo! 🍳`,
  },
];

// userId → { step: number, name: string }
const state = new Map();

function getStep(userId)        { return state.get(userId)?.step ?? 0; }
function setStep(userId, step)  { state.set(userId, { ...(state.get(userId) ?? {}), step }); }
function setName(userId, name)  { state.set(userId, { ...(state.get(userId) ?? {}), name }); }
function getName(userId)        { return state.get(userId)?.name ?? 'je'; }

// Returns true if the user is still in the onboarding flow and the message was handled.
async function handleOnboardingMessage({ from, text, userId }) {
  const step = getStep(userId);
  const lc   = text.toLowerCase().trim();

  // Step 0: hasn't been welcomed yet — send first message
  if (step === 0) {
    setStep(userId, 1);
    await sendMessage(from, STEPS[0].ask);
    return true;
  }

  // Step 1: received name
  if (step === 1) {
    const name = text.trim().split(' ')[0];
    setStep(userId, 2);
    setName(userId, name);
    await sendMessage(from, STEPS[1].ask(name));
    return true;
  }

  // Step 2: received lists (or skip)
  if (step === 2) {
    if (lc !== 'overslaan') {
      const listNames = text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      const EMOJI_MAP = {
        boodschappen: '🛒', werk: '💼', film: '🎬', sport: '🏃',
        boeken: '📚', reizen: '✈️', koken: '🍳', cadeau: '🎁',
      };
      for (const name of listNames.slice(0, 8)) {
        const emoji = Object.entries(EMOJI_MAP).find(([k]) => name.toLowerCase().includes(k))?.[1] ?? '📝';
        try { await db.createList(userId, name, emoji, 'checklist'); } catch {}
      }
    }

    const name = getName(userId);
    state.delete(userId);
    await db.markOnboardingComplete(userId);
    await sendMessage(from, STEPS[2].ask(name));
    return true;
  }

  return false;
}

module.exports = { handleOnboardingMessage };
