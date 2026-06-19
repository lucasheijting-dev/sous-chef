'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0].replace(/[),.\]]+$/, '') : null; // strip trailing punctuation
}

async function fetchTikTokCaption(url) {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { title: data.title ?? null };
  } catch {
    return null;
  }
}

function findRecipeSchema(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const types = [].concat(obj['@type'] ?? []);
  if (types.includes('Recipe')) {
    return {
      title: obj.name ?? null,
      ingredients: Array.isArray(obj.recipeIngredient) ? obj.recipeIngredient : null,
      servings: obj.recipeYield ?? null,
      imageUrl: extractImageUrl(obj.image),
    };
  }
  if (Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) {
      const found = findRecipeSchema(item);
      if (found) return found;
    }
  }
  return null;
}

function extractImageUrl(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return extractImageUrl(image[0]);
  return image.url ?? null;
}

async function fetchHtmlRecipe(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'nl,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error('[RecipeScraper] Fetch error:', err.message);
    return null;
  }

  if (!res.ok) return null;
  const html = await res.text();

  // Try JSON-LD blocks
  const ldMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of ldMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      const schemas = Array.isArray(parsed) ? parsed : [parsed];
      for (const schema of schemas) {
        const recipe = findRecipeSchema(schema);
        if (recipe) return recipe;
      }
    } catch {}
  }

  // Fallback: return title + stripped body text for Claude
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;

  const bodyText = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 3500);

  return { title, rawText: bodyText, ingredients: null };
}

async function extractWithClaude(content, scalingHint) {
  const scaleNote = scalingHint ? `\nSchaal naar: ${scalingHint}.` : '';
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Extraheer ingrediënten uit deze recepttekst. Geef ALLEEN een JSON object terug:
{"title":"naam recept","ingredients":["200g bloem","2 eieren",...],"servings":"4 personen of null"}${scaleNote}

Geen markdown, geen uitleg. Alleen JSON.

Tekst:
${content.slice(0, 4000)}`,
      }],
    });
    const raw = (res.content[0]?.text ?? '{}')
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.ingredients) && parsed.ingredients.length > 0 ? parsed : null;
  } catch (err) {
    console.error('[RecipeScraper] Claude extraction error:', err.message);
    return null;
  }
}

async function scrapeRecipe(url, scalingHint = null) {
  const isTikTok = /tiktok\.com|vm\.tiktok\.com/i.test(url);

  if (isTikTok) {
    const tiktok = await fetchTikTokCaption(url);
    if (tiktok?.title) {
      const extracted = await extractWithClaude(`TikTok video: ${tiktok.title}`, scalingHint);
      if (extracted?.ingredients?.length) {
        return {
          title: extracted.title ?? tiktok.title ?? 'TikTok recept',
          ingredients: extracted.ingredients,
          servings: extracted.servings ?? null,
          imageUrl: null,
          sourceUrl: url,
        };
      }
    }
  }

  const htmlResult = await fetchHtmlRecipe(url);
  if (!htmlResult) return null;

  // Structured ingredients from JSON-LD
  if (htmlResult.ingredients?.length) {
    let ingredients = htmlResult.ingredients;
    if (scalingHint) {
      const rescaled = await extractWithClaude(
        `Recept: ${htmlResult.title ?? ''}\nIngrediënten:\n${ingredients.join('\n')}`,
        scalingHint
      );
      if (rescaled?.ingredients?.length) ingredients = rescaled.ingredients;
    }
    return {
      title: htmlResult.title ?? 'Recept',
      ingredients,
      servings: htmlResult.servings ?? null,
      imageUrl: htmlResult.imageUrl ?? null,
      sourceUrl: url,
    };
  }

  // Fallback: Claude on page text
  const content = `${htmlResult.title ? `Pagina: ${htmlResult.title}\n` : ''}${htmlResult.rawText ?? ''}`;
  const extracted = await extractWithClaude(content, scalingHint);
  if (!extracted?.ingredients?.length) return null;

  return {
    title: extracted.title ?? htmlResult.title ?? 'Recept',
    ingredients: extracted.ingredients,
    servings: extracted.servings ?? null,
    imageUrl: null,
    sourceUrl: url,
  };
}

module.exports = { extractUrl, scrapeRecipe };
