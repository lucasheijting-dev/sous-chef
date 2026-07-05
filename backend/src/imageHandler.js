'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const db        = require('./supabase');
const { sendMessage } = require('./whatsapp');
const session   = require('./sessionMemory');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Download image from Meta Cloud API
async function downloadMetaImage(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Meta media lookup failed: ${metaRes.status}`);
  const { url, mime_type } = await metaRes.json();

  const imgRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!imgRes.ok) throw new Error(`Meta image download failed: ${imgRes.status}`);

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return { buffer, mimeType: mime_type ?? 'image/jpeg' };
}

// Fuzzy match: find the list or note whose name best matches the target string
function fuzzyFind(items, nameKey, query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();
  // Exact match first
  let match = items.find(i => i[nameKey]?.toLowerCase() === q);
  if (match) return match;
  // Substring match
  match = items.find(i => i[nameKey]?.toLowerCase().includes(q));
  if (match) return match;
  // Reverse: does query contain the item name?
  match = items.find(i => q.includes(i[nameKey]?.toLowerCase() ?? ''));
  return match ?? null;
}

async function analyzeImage(buffer, mimeType, { caption, lists, notes, userCategories } = {}) {
  const base64 = buffer.toString('base64');

  const catBlock = userCategories?.length > 0
    ? `\n\nDe gebruiker heeft deze eigen categorieën:\n${userCategories.map(c => `- id: "${c.id}", naam: "${c.name}", emoji: "${c.emoji}"`).join('\n')}\n\nKies de best passende categorie-id uit die lijst en zet die in "user_category_id". Als geen categorie past, zet null.`
    : '';

  const listsBlock = lists?.length > 0
    ? `\n\nBeschikbare lijsten: ${lists.map(l => `"${l.name}"`).join(', ')}`
    : '';

  const notesBlock = notes?.length > 0
    ? `\n\nBeschikbare notities: ${notes.map(n => `"${n.title ?? n.body?.slice(0, 30)}"`).join(', ')}`
    : '';

  const captionBlock = caption
    ? `\n\nBijschrift van de gebruiker: "${caption}"`
    : '';

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
            text: `Analyseer deze afbeelding en geef een JSON-antwoord terug (geen markdown).${captionBlock}${listsBlock}${notesBlock}

Kies het beste type:

1. Als het een bonnetje/kassabon is → type "receipt"
2. Als het een handgeschreven of getypte LIJST van items is (boodschappenlijstje, takenlijstje, opsomming) → type "handwritten_list" en extraheer alle leesbare items
3. Als het bijschrift aangeeft dat de foto bij een NOTITIE hoort (bijv. "voeg toe aan notitie X") → type "note_image"
4. Als het bijschrift aangeeft dat de foto bij een LIJST hoort met één item → type "list_item"
5. Anders → type "other"

Antwoordformaten:

Voor bonnetje:
{
  "type": "receipt",
  "store": "naam winkel",
  "date": "YYYY-MM-DD of null",
  "total": 12.50,
  "currency": "EUR",
  "items": [{"name": "product", "price": 1.99, "quantity": 1}],
  "category": "supermarkt|restaurant|kleding|benzine|apotheek|overig",
  "user_category_id": null,
  "description": "korte samenvatting"
}

Voor handgeschreven lijst:
{
  "type": "handwritten_list",
  "items": ["item 1", "item 2", "item 3"],
  "detected_list_type": "groceries|todo|other",
  "suggested_list_name": "Boodschappen of To-do of null",
  "readable": true
}
Als de lijst onleesbaar is: { "type": "handwritten_list", "readable": false, "items": [] }

Voor notitie-foto:
{
  "type": "note_image",
  "note_name": "naam van de notitie uit het bijschrift",
  "description": "korte beschrijving van de foto in het Nederlands"
}

Voor lijst-item met foto:
{
  "type": "list_item",
  "list_name": "naam van de lijst uit het bijschrift",
  "item_text": "korte tekst voor het lijst-item",
  "description": "korte beschrijving in het Nederlands"
}

Voor overig:
{
  "type": "other",
  "description": "wat zie je in het Nederlands, max 2 zinnen"
}

Regels voor bonnetjes: bedragen → altijd als getal (12.50). Herken: 'AH'/'Albert Heijn' → 'Albert Heijn'; 'JMB'/'Jumbo' → 'Jumbo'; 'Lidl','Aldi','Plus','Dirk','Spar','Coop','Picnic' → exact die naam.${catBlock}

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

// Main handler
async function handleImageMessage({ from, mediaId, userId, caption }) {
  try {
    const { buffer, mimeType } = await downloadMetaImage(mediaId);
    console.log(`[ImageHandler] Downloaded image: ${buffer.length} bytes, ${mimeType}, caption: ${caption}`);

    // Upload to Supabase Storage
    let imageUrl = null;
    try {
      imageUrl = await db.uploadUserImage(userId, buffer, mimeType);
      console.log(`[ImageHandler] Uploaded to storage: ${imageUrl}`);
    } catch (uploadErr) {
      console.error('[ImageHandler] Storage upload failed (continuing without image):', uploadErr.message);
    }

    // Load context for smart routing
    let lists = [], notes = [], userCategories = [];
    try { [lists, notes, userCategories] = await Promise.all([db.getLists(userId), db.getNotes(userId), db.getReceiptCategories(userId)]); } catch {}

    const analysis = await analyzeImage(buffer, mimeType, { caption, lists, notes, userCategories });
    console.log('[ImageHandler] Claude analysis:', JSON.stringify(analysis));

    if (analysis.type === 'receipt') {
      // Duplicate detection
      if (analysis.date && analysis.total != null) {
        const existing = await db.getReceipts(userId);
        const dupe = existing.find(r =>
          r.date === analysis.date &&
          r.store?.toLowerCase() === (analysis.store ?? '').toLowerCase() &&
          Math.abs((r.total ?? 0) - (analysis.total ?? 0)) < 0.01
        );
        if (dupe) {
          await sendMessage(from, `⚠️ Dit bonnetje lijkt al eerder ingescand (${analysis.store}, ${analysis.date}). Al toegevoegd op ${new Date(dupe.created_at).toLocaleDateString('nl-NL')}.`);
          return;
        }
      }

      const validCatId = userCategories.find(c => c.id === analysis.user_category_id)?.id ?? null;

      await db.createReceipt(userId, {
        store:             analysis.store ?? 'Onbekend',
        date:              analysis.date ?? null,
        total:             analysis.total ?? null,
        currency:          analysis.currency ?? 'EUR',
        items:             analysis.items ?? [],
        category:          analysis.category ?? 'overig',
        description:       analysis.description ?? '',
        imageUrl,
        receiptCategoryId: validCatId,
      });

      const totalStr = analysis.total != null ? formatAmount(analysis.total, analysis.currency) : 'bedrag onbekend';
      const dateStr  = analysis.date ? ` van ${formatDate(analysis.date)}` : '';
      const items    = Array.isArray(analysis.items) && analysis.items.length > 0
        ? `\n${analysis.items.slice(0, 5).map(i => `• ${i.name}${i.price != null ? ` — €${Number(i.price).toFixed(2)}` : ''}`).join('\n')}${analysis.items.length > 5 ? `\n_...en ${analysis.items.length - 5} meer_` : ''}`
        : '';

      await sendMessage(from, `🧾 *Bonnetje gescand!*\n\n🏪 ${analysis.store ?? 'Onbekend'}${dateStr}\n💶 *${totalStr}*${items}\n\n_Opgeslagen in de Bonnetjes tab._`);
      return;
    }

    if (analysis.type === 'handwritten_list') {
      if (!analysis.readable || !analysis.items?.length) {
        await sendMessage(from, 'Ik kan dit niet goed lezen. Kun je een scherpere foto sturen, of typ de items gewoon?');
        return;
      }

      // Find the best matching list
      const suggestedName = analysis.suggested_list_name;
      let targetList = null;
      if (suggestedName) {
        targetList = fuzzyFind(lists, 'name', suggestedName);
      }
      // Fallback: match by detected_list_type
      if (!targetList && analysis.detected_list_type === 'groceries') {
        targetList = lists.find(l => l.default_type === 'groceries') ?? fuzzyFind(lists, 'name', 'boodschappen');
      }
      if (!targetList && analysis.detected_list_type === 'todo') {
        targetList = lists.find(l => l.default_type === 'todo') ?? fuzzyFind(lists, 'name', 'to-do');
      }
      if (!targetList) targetList = lists[0] ?? null;

      const itemLines = analysis.items.map(i => `• ${i}`).join('\n');
      const listLabel = targetList ? `${targetList.emoji ?? '📝'} *${targetList.name}*` : 'een nieuwe lijst';

      // Store pending state for confirmation
      session.setPendingPhotoItems(userId, {
        items: analysis.items,
        listId: targetList?.id ?? null,
        listName: targetList?.name ?? null,
        listEmoji: targetList?.emoji ?? '📝',
      });

      await sendMessage(from, `📋 Ik zie ${analysis.items.length} items:\n\n${itemLines}\n\nZet ik ze op ${listLabel}? (ja / nee, op [andere lijst])`);
      return;
    }

    if (analysis.type === 'note_image' && imageUrl) {
      const note = fuzzyFind(notes, 'title', analysis.note_name)
        ?? fuzzyFind(notes, 'body', analysis.note_name);

      if (note) {
        await db.updateNoteImageUrl(userId, note.id, imageUrl);
        const noteName = note.title ?? note.body?.slice(0, 30);
        await sendMessage(from, `📸 Foto toegevoegd aan notitie *"${noteName}"*.\n\n_${analysis.description ?? ''}_`);
      } else {
        // Note not found → create new note with image
        const title = analysis.note_name ?? caption ?? 'Foto';
        const newNote = await db.createNote(userId, title, analysis.description ?? caption ?? '');
        await db.updateNoteImageUrl(userId, newNote.id, imageUrl);
        await sendMessage(from, `📝 Nieuwe notitie *"${title}"* aangemaakt met foto.\n\n_${analysis.description ?? ''}_`);
      }
      return;
    }

    if (analysis.type === 'list_item' && imageUrl) {
      const list = fuzzyFind(lists, 'name', analysis.list_name);

      if (list) {
        const itemText = analysis.item_text ?? analysis.description ?? 'Foto-item';
        await db.addListItemWithImage(list.id, itemText, imageUrl);
        await sendMessage(from, `📸 *"${itemText}"* met foto toegevoegd aan ${list.emoji ?? '📝'} *${list.name}*.\n\n_${analysis.description ?? ''}_`);
      } else {
        // List not found → fall back to creating a note
        const title = analysis.list_name ?? caption ?? 'Foto';
        const newNote = await db.createNote(userId, title, analysis.description ?? caption ?? '');
        await db.updateNoteImageUrl(userId, newNote.id, imageUrl);
        await sendMessage(from, `📝 Lijst *"${analysis.list_name}"* niet gevonden. Foto opgeslagen als notitie *"${title}"*.`);
      }
      return;
    }

    // Fallback: describe the image
    await sendMessage(from, `📸 ${analysis.description}`);
  } catch (err) {
    console.error('[ImageHandler] Error:', err);
    await sendMessage(from, 'Sorry, kon de afbeelding niet verwerken. Probeer het opnieuw.');
  }
}

const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£', SEK: 'kr', NOK: 'kr', DKK: 'kr', CHF: 'CHF', JPY: '¥', CNY: '¥', AUD: 'A$', CAD: 'C$' };

function formatAmount(total, currency = 'EUR') {
  const amount = Number(total).toFixed(2);
  const sym = CURRENCY_SYMBOLS[currency?.toUpperCase()] ?? currency ?? '€';
  const after = ['SEK', 'NOK', 'DKK'].includes(currency?.toUpperCase());
  return after ? `${amount} ${sym}` : `${sym}${amount}`;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return iso; }
}

module.exports = { handleImageMessage };
