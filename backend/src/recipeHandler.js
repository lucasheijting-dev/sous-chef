'use strict';

const db = require('./supabase');
const { extractUrl, scrapeRecipe } = require('./recipeScraper');
const { sendMessage, sendTyping } = require('./whatsapp');

function extractScalingHint(text) {
  return (
    text.match(/voor\s+\d+\s+person(?:en)?/i)?.[0] ??
    text.match(/\d+\s+person(?:en)?/i)?.[0] ??
    text.match(/\d+\s+porties/i)?.[0] ??
    null
  );
}

function findTargetList(lists, userText) {
  const lc = userText.toLowerCase();
  for (const list of lists) {
    if (lc.includes(list.name.toLowerCase())) return list;
  }
  const grocery = lists.find(l => /boodschap|grocery|groceri|inkoop|supermarkt|winkel/i.test(l.name));
  return grocery ?? lists[0] ?? null;
}

function stripQuantity(text) {
  return text.toLowerCase()
    .replace(/^\d+[\d/,.]*\s*[a-z]{1,4}\s+/i, '')
    .replace(/^\d+[\d/,.]*\s+/i, '')
    .trim();
}

// Core import logic — shared by WhatsApp handler and REST API
async function importRecipe({ userId, url, listId = null, scalingHint = null, userText = '' }) {
  const recipe = await scrapeRecipe(url, scalingHint);
  if (!recipe?.ingredients?.length) return null;

  const lists = await db.getLists(userId);
  let targetList = listId ? lists.find(l => l.id === listId) : null;
  if (!targetList) targetList = findTargetList(lists, userText);
  if (!targetList) return null;

  const savedRecipe = await db.saveRecipe(userId, {
    title: recipe.title,
    sourceUrl: recipe.sourceUrl,
    imageUrl: recipe.imageUrl ?? null,
    ingredientCount: recipe.ingredients.length,
  });

  const existingItems = await db.getListItems(targetList.id);
  const existingByName = new Map(existingItems.map(i => [stripQuantity(i.text), i]));

  const added = [];
  const merged = [];

  for (const ingredient of recipe.ingredients) {
    const strippedIng = stripQuantity(ingredient);
    let existingItem = existingByName.get(strippedIng);

    if (!existingItem) {
      for (const [key, item] of existingByName) {
        if (key.length >= 3 && strippedIng.length >= 3 && (key.includes(strippedIng) || strippedIng.includes(key))) {
          existingItem = item;
          break;
        }
      }
    }

    if (existingItem) {
      await db.addListItemSource(existingItem.id, savedRecipe.id, ingredient).catch(() => {});
      merged.push(ingredient);
    } else {
      const newItem = await db.addListItem(targetList.id, ingredient);
      await db.addListItemSource(newItem.id, savedRecipe.id, ingredient).catch(() => {});
      existingByName.set(strippedIng, newItem);
      added.push(ingredient);
    }
  }

  return { recipe, targetList, added, merged };
}

// WhatsApp entry point
async function handleRecipeMessage({ from, text, userId }) {
  sendTyping(from);

  const url = extractUrl(text);
  if (!url) return false;

  const scalingHint = extractScalingHint(text);

  let result;
  try {
    result = await importRecipe({ userId, url, scalingHint, userText: text });
  } catch (err) {
    console.error('[RecipeHandler] Import error:', err.message);
    return false;
  }

  if (!result) return false;

  const { recipe, targetList, added, merged } = result;
  const servingsStr = recipe.servings ? ` _(${recipe.servings})_` : '';
  const parts = [`🍽️ *${recipe.title}*${servingsStr} → ${targetList.emoji ?? '📝'} ${targetList.name}\n`];

  if (added.length > 0) {
    parts.push(`✅ *${added.length} ingrediënt${added.length !== 1 ? 'en' : ''} toegevoegd:*\n${added.map(i => `• ${i}`).join('\n')}`);
  }
  if (merged.length > 0) {
    parts.push(`_Al aanwezig: ${merged.join(', ')}_`);
  }

  await sendMessage(from, parts.join('\n'));
  return true;
}

module.exports = { handleRecipeMessage, importRecipe };
