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

  // Step 0: first ever message — redirect to app for OTP registration
  if (step === 0) {
    state.delete(userId);
    await db.markOnboardingComplete(userId);
    await sendMessage(from,
      `👋 *Welkom Chefje!*\n\nGa terug naar de *De Sous-Chef app* om je toegangscode aan te vragen. Daarna kun je mij hier alles sturen! 🍳`
    );
    return true;
  }

  return false;
}

module.exports = { handleOnboardingMessage };
