'use strict';

const express = require('express');
const { handleMessage } = require('./messageHandler');
const { handleRecipeMessage } = require('./recipeHandler');
const { extractUrl } = require('./recipeScraper');

const router = express.Router();

// Meta webhook verification
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// Incoming messages
router.post('/', async (req, res) => {
  // Respond 200 immediately so Meta doesn't retry
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    console.log('[Webhook] Raw value:', JSON.stringify(value, null, 2));
    if (!value?.messages?.length) return;

    const message = value.messages[0];
    const from    = message.from;

    if (message.type === 'audio') {
      const { handleVoiceMessage } = require('./voiceHandler');
      await handleVoiceMessage({ from, mediaId: message.audio.id });
      return;
    }

    if (message.type === 'image') {
      const { handleImageMessage } = require('./imageHandler');
      const { getOrCreateUserFull } = require('./supabase');
      const user = await getOrCreateUserFull(from);
      await handleImageMessage({ from, mediaId: message.image.id, userId: user.id, caption: message.image.caption ?? null });
      return;
    }

    if (message.type !== 'text') return;

    const text = message.text?.body?.trim();
    if (!text) return;

    console.log(`[Webhook] Message from ${from}: ${text}`);

    // If message contains a URL, try to handle as recipe import first
    if (extractUrl(text)) {
      const { getOrCreateUserFull } = require('./supabase');
      const user = await getOrCreateUserFull(from);
      const handled = await handleRecipeMessage({ from, text, userId: user.id });
      if (handled) return;
    }

    await handleMessage({ from, text });
  } catch (err) {
    console.error('Webhook error:', err);
    if (from) {
      const { sendMessage } = require('./whatsapp');
      sendMessage(from, '⚠️ Er is een onverwachte fout opgetreden. Probeer het opnieuw of neem contact op met Lucas.').catch(() => {});
    }
  }
});

module.exports = router;
