'use strict';

const express = require('express');
const { importRecipe } = require('./recipeHandler');

const router = express.Router();

// POST /recipe/import
// Body: { userId, listId?, url, scalingHint? }
router.post('/import', async (req, res) => {
  const { userId, listId, url, scalingHint } = req.body ?? {};

  if (!userId || !url) {
    return res.status(400).json({ ok: false, error: 'userId en url zijn verplicht.' });
  }

  try {
    const result = await importRecipe({ userId, url, listId: listId ?? null, scalingHint: scalingHint ?? null });

    if (!result) {
      return res.status(422).json({ ok: false, error: 'Kon geen ingrediënten vinden op dit adres. Probeer een ander recept-linkje.' });
    }

    return res.json({
      ok: true,
      title: result.recipe.title,
      servings: result.recipe.servings ?? null,
      listName: result.targetList.name,
      listEmoji: result.targetList.emoji ?? '📝',
      added: result.added,
      merged: result.merged,
    });
  } catch (err) {
    console.error('[Recipe API] Import error:', err.message);
    return res.status(500).json({ ok: false, error: 'Er ging iets mis bij het importeren. Probeer het opnieuw.' });
  }
});

module.exports = router;
