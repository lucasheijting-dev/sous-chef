'use strict';

// Guided onboarding conversation for new users.
// State is stored in user prefs under onboarding_step (0 = not started, done = finished).

const db      = require('./supabase');
const { sendMessage } = require('./whatsapp');

const STEPS = [
  {
    key: 'name',
    ask: `👋 *Welkom bij Sous-Chef!*

Ik ben je persoonlijke WhatsApp-assistent voor lijsten, agenda, notities en habits.

Laten we snel even instellen. *Hoe heet je?*`,
  },
  {
    key: 'habits',
    ask: (name) => `Fijn, *${name}*! 🍳

*Welke habits wil je bijhouden?* Denk aan sporten, mediteren, lezen, etc.

Stuur ze als kommalijst, bijv.: _"sporten, mediteren, lezen"_
Of typ *overslaan* als je dit later wilt doen.`,
  },
  {
    key: 'lists',
    ask: `Super! Nu de lijsten.

*Welke lijsten wil je aanmaken?* Bijv.: _"boodschappen, werk, film kijken"_
Of typ *overslaan*.`,
  },
  {
    key: 'done',
    ask: (name) => `Klaar! Je bent ingesteld, *${name}*. 🎉

*Dit kan ik voor je doen:*
📅 Afspraken plannen — _"tandarts vrijdag 14u"_
📋 Lijsten bijhouden — _"melk op de boodschappenlijst"_
🏅 Habits loggen — _"30 min gesport"_
📝 Notities opslaan — _"onthoud: Jan bellen voor bezoek"_

Stuur gewoon een berichtje — ik snap je vanzelf! 🍳`,
  },
];

async function getOnboardingStep(userId) {
  const prefs = await db.getUserPrefs(userId) ?? {};
  const raw = prefs.onboarding_step;
  console.log('[Onboarding] step raw value:', JSON.stringify(raw), 'for user:', userId);
  if (raw === 'done') return 'done';
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return isNaN(n) ? 0 : n;
}

async function setOnboardingStep(userId, step) {
  await db.updateUserPrefs(userId, { onboarding_step: step });
}

// Returns true if the user is still in the onboarding flow and the message was handled.
async function handleOnboardingMessage({ from, text, userId, user }) {
  const step = await getOnboardingStep(userId);
  if (step === 'done') return false;

  const lc = text.toLowerCase().trim();

  // Step 0: hasn't been welcomed yet — send first message
  if (step === 0) {
    await setOnboardingStep(userId, 1);
    await sendMessage(from, STEPS[0].ask);
    return true;
  }

  // Step 1: received name
  if (step === 1) {
    const name = text.trim().split(' ')[0]; // first word as name
    await db.updateUserPrefs(userId, { onboarding_name: name, onboarding_step: 2 });
    const prefs = await db.getUserPrefs(userId) ?? {};
    await sendMessage(from, STEPS[1].ask(name));
    return true;
  }

  // Step 2: received habits
  if (step === 2) {
    if (lc !== 'overslaan') {
      const habitNames = text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      for (const name of habitNames.slice(0, 6)) {
        try {
          await db.createHabit(userId, {
            name,
            mini_goal: `Kort ${name}`,
            good_goal: `${name} gedaan`,
            elite_goal: `Lang ${name}`,
          });
        } catch {}
      }
    }
    await setOnboardingStep(userId, 3);
    await sendMessage(from, STEPS[2].ask);
    return true;
  }

  // Step 3: received lists
  if (step === 3) {
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

    const prefs = await db.getUserPrefs(userId) ?? {};
    const name = prefs.onboarding_name ?? 'je';
    await setOnboardingStep(userId, 'done');
    await db.markOnboardingComplete(userId);
    await sendMessage(from, STEPS[3].ask(name));
    return true;
  }

  return false;
}

module.exports = { handleOnboardingMessage };
