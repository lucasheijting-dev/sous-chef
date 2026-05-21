'use strict';

const { handleMessage } = require('./messageHandler');
const { sendMessage }   = require('./whatsapp');

async function downloadMetaAudio(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Meta media lookup failed: ${metaRes.status}`);
  const { url, mime_type } = await metaRes.json();

  const audioRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!audioRes.ok) throw new Error(`Meta audio download failed: ${audioRes.status}`);

  const buffer = Buffer.from(await audioRes.arrayBuffer());
  return { buffer, mimeType: mime_type ?? 'audio/ogg' };
}

async function transcribeWithWhisper(buffer, mimeType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  // WhatsApp stuurt OGG (opus). Whisper accepteert OGG maar verwacht een bestandsnaam met extensie.
  const ext = mimeType.includes('ogg') ? 'ogg'
    : mimeType.includes('mp4') ? 'mp4'
    : mimeType.includes('mpeg') ? 'mp3'
    : 'ogg';

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`);
  form.append('model', 'whisper-1');
  form.append('language', 'nl');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper API error: ${res.status} ${err}`);
  }

  const { text } = await res.json();
  return text?.trim() ?? '';
}

async function handleVoiceMessage({ from, mediaId }) {
  try {
    const { buffer, mimeType } = await downloadMetaAudio(mediaId);
    const text = await transcribeWithWhisper(buffer, mimeType);

    if (!text) {
      await sendMessage(from, 'Ik kon je voicenote niet verstaan. Probeer het nog eens of stuur een tekstbericht.');
      return;
    }

    console.log(`[Voice] Transcribed from ${from}: ${text}`);

    // Process exactly like a text message — replies are the action confirmations
    await handleMessage({ from, text });
  } catch (err) {
    console.error('[Voice] Error:', err.message);
    await sendMessage(from, 'Er ging iets mis bij het verwerken van je voicenote. Probeer het nog eens! 🎤');
  }
}

module.exports = { handleVoiceMessage };
