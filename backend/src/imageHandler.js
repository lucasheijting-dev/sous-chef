'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const db        = require('./supabase');
const { sendMessage } = require('./whatsapp');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Download image from Meta Cloud API
async function downloadMetaImage(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  // Step 1: get media URL
  const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Meta media lookup failed: ${metaRes.status}`);
  const { url, mime_type } = await metaRes.json();

  // Step 2: download actual image bytes
  const imgRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!imgRes.ok) throw new Error(`Meta image download failed: ${imgRes.status}`);

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return { buffer, mimeType: mime_type ?? 'image/jpeg' };
}

// Ask Claude what's in the image and extract structured data
async function analyzeImage(buffer, mimeType) {
  const base64 = buffer.toString('base64');

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 },
          },
          {
            type: 'text',
            text: `Analyseer deze afbeelding en geef een JSON-antwoord terug (geen markdown).

Als het een bonnetje/kassabon is, vul dan in:
{
  "type": "receipt",
  "store": "naam van de winkel",
  "date": "YYYY-MM-DD of null als niet zichtbaar",
  "total": 12.50,
  "currency": "EUR",
  "items": [{"name": "product", "price": 1.99, "quantity": 1}],
  "category": "supermarkt|restaurant|kleding|benzine|apotheek|overig",
  "description": "korte samenvatting in het Nederlands"
}

Als het GEEN bonnetje is:
{
  "type": "other",
  "description": "wat zie je in het Nederlands, max 2 zinnen"
}

Geef ALLEEN geldige JSON terug.`,
          },
        ],
      },
    ],
  });

  const raw = (response.content.find(b => b.type === 'text')?.text ?? '{}')
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(raw);
  } catch {
    return { type: 'other', description: 'Kon de afbeelding niet verwerken.' };
  }
}

// Main handler: called from webhook when image message arrives
async function handleImageMessage({ from, mediaId, userId }) {
  try {
    const { buffer, mimeType } = await downloadMetaImage(mediaId);
    console.log(`[ImageHandler] Downloaded image: ${buffer.length} bytes, ${mimeType}`);

    // Upload to Supabase Storage (non-fatal — receipt is still saved without image)
    let imageUrl = null;
    try {
      imageUrl = await db.uploadReceiptImage(userId, buffer, mimeType);
      console.log(`[ImageHandler] Uploaded to storage: ${imageUrl}`);
    } catch (uploadErr) {
      console.error('[ImageHandler] Storage upload failed (continuing without image):', uploadErr.message);
    }

    // Analyze with Claude Vision
    console.log('[ImageHandler] Sending to Claude Vision...');
    const analysis = await analyzeImage(buffer, mimeType);
    console.log('[ImageHandler] Claude analysis:', JSON.stringify(analysis));

    if (analysis.type === 'receipt') {
      await db.createReceipt(userId, {
        store:       analysis.store ?? 'Onbekend',
        date:        analysis.date ?? null,
        total:       analysis.total ?? null,
        currency:    analysis.currency ?? 'EUR',
        items:       analysis.items ?? [],
        category:    analysis.category ?? 'overig',
        description: analysis.description ?? '',
        imageUrl,
      });

      const totalStr = analysis.total != null
        ? `€${Number(analysis.total).toFixed(2)}`
        : 'bedrag onbekend';
      const dateStr  = analysis.date ? ` van ${formatDate(analysis.date)}` : '';
      const items    = Array.isArray(analysis.items) && analysis.items.length > 0
        ? `\n${analysis.items.slice(0, 5).map(i => `• ${i.name}${i.price != null ? ` — €${Number(i.price).toFixed(2)}` : ''}`).join('\n')}${analysis.items.length > 5 ? `\n_...en ${analysis.items.length - 5} meer_` : ''}`
        : '';

      await sendMessage(from,
        `🧾 *Bonnetje gescand!*\n\n🏪 ${analysis.store ?? 'Onbekend'}${dateStr}\n💶 *${totalStr}*${items}\n\n_Opgeslagen in de Bonnetjes tab._`
      );
    } else {
      await sendMessage(from, `📸 ${analysis.description}`);
    }
  } catch (err) {
    console.error('[ImageHandler] Error:', err);
    await sendMessage(from, 'Sorry, kon de afbeelding niet verwerken. Probeer het opnieuw.');
  }
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return iso; }
}

module.exports = { handleImageMessage };
