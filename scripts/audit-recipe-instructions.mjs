#!/usr/bin/env node
// Source consistency checks. Protected rows are accepted only through an explicit
// private export outside the checkout; their content never enters stdout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPrivateRecipeExport } from './load-private-recipe-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const words = value => String(value || '').toLowerCase();
const instructionKey = value => words(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// These rules identify concrete instruction defects, not culinary similarity.
// Legitimate separate phases (brown, remove, return and simmer) stay separate.
export function auditCookMethodContent(recipe) {
  const findings = [];
  if (!Array.isArray(recipe?.method)) return findings;
  const seenSteps = new Set(), seenSentences = new Set();
  const method = recipe.method.join(' ');
  let cookingStarted = false;
  for (const [index, step] of recipe.method.entries()) {
    const key = instructionKey(step);
    if (seenSteps.has(key)) findings.push({ code: 'duplicate-method-step', id: recipe.id, detail: `Step ${index + 1} repeats an earlier instruction.` });
    seenSteps.add(key);
    for (const sentence of String(step).split(/(?<=[.!?])\s+/)) {
      const sentenceKey = instructionKey(sentence);
      // Short stock phrases such as "Serve hot" are not duplicate actions.
      if (sentenceKey.split(' ').length < 7) continue;
      if (seenSentences.has(sentenceKey)) findings.push({ code: 'duplicate-method-sentence', id: recipe.id, detail: `Step ${index + 1} repeats an earlier sentence.` });
      seenSentences.add(sentenceKey);
    }
    if (cookingStarted && /^prepare your ingredients:/i.test(step)) findings.push({ code: 'prep-after-cooking', id: recipe.id, detail: `Step ${index + 1} introduces initial ingredient preparation after cooking has started.` });
    if (/\b(?:sear|brown|pan-fry|stir-fry)\b[^.]*\.\s*Pat\b[^.]*\bdry before (?:searing|browning|cooking)\b/i.test(step)) findings.push({ code: 'prep-after-cooking', id: recipe.id, detail: `Step ${index + 1} puts drying advice after the cooking action it prepares for.` });
    if (/^(?:brown|sear|pan-fry|stir-fry|boil|simmer|roast|bake)\b/i.test(step)) cookingStarted = true;
  }
  const pastaCook = method.search(/\b(?:cook|boil)\b[^.]*\b(?:pasta|gnocchi|tortellini|linguine|spaghetti|penne|shells)\b/i);
  const reserveWater = method.search(/\b(?:reserve|save)\b[^.]*\b(?:pasta|cooking) water\b/i);
  if (reserveWater !== -1 && pastaCook !== -1 && reserveWater < pastaCook) findings.push({ code: 'cooking-water-before-cooking', id: recipe.id, detail: 'Cooking water is reserved before the pasta or gnocchi has been cooked.' });
  if (/\b(?:grate the fresh parsley|grate (?:the )?parsley)\b/i.test(method)) findings.push({ code: 'unsuitable-herb-preparation', id: recipe.id, detail: 'Fresh parsley is treated as a root aromatic to grate.' });
  const ingredients = recipe.ingredients?.map(line => String(line[0])).join(' ') || '';
  if (/\bcornflour\b/i.test(method) && !/\bcornflour\b/i.test(ingredients)) findings.push({ code: 'unlisted-cornflour', id: recipe.id, detail: 'Method suggests cornflour absent from the ingredients.' });
  if (/\bcooked salmon\b/i.test(ingredients) && /pat the fish or seafood dry before searing/i.test(method)) findings.push({ code: 'unrelated-seafood-searing', id: recipe.id, detail: 'Cooked-salmon fishcakes include advice for searing raw seafood.' });
  if (/\bpenne and hot chicken stock\b/i.test(method) && /reserve a little starchy cooking water/i.test(method)) findings.push({ code: 'one-pot-cooking-water', id: recipe.id, detail: 'One-pot pasta cooked in its sauce is told to reserve separate cooking water.' });
  return findings;
}

export function auditIngredientPrepNotes(recipe) {
  const findings = [], notes = recipe?.culinary_prep_notes;
  if (!Array.isArray(notes)) return findings;
  if (notes.length !== recipe.ingredients?.length) findings.push({ code: 'prep-note-alignment', id: recipe.id, detail: 'Ingredient prep notes do not align with the ingredient list.' });
  for (const [index, note] of notes.entries()) {
    const name = words(recipe.ingredients?.[index]?.[0]);
    const mismatch = /stock/.test(name) && /pat dry|brown before|surface time to brown/i.test(note)
      || /flour|breadcrumbs/.test(name) && /warm or toast only at assembly/i.test(note)
      || /cold butter/.test(name) && /melt gently/i.test(note)
      || /(?:cooked|smoked) salmon/.test(name) && /before searing|hot surface for colour/i.test(note)
      || /garlic baguette/.test(name) && /crush or grate/i.test(note)
      || /orange juice/.test(name) && /zest the skin/i.test(note)
      || /oats/.test(name) && /overnight/.test(recipe.id) && /batter or dough/i.test(note)
      || name === 'pesto' && ['date-pesto-gnocchi', 'pan-gnocchi-spinach', 'pesto-salmon-potatoes', 'chicken-pesto-wraps'].includes(recipe.id) && /pasta water/i.test(note);
    if (mismatch) findings.push({ code: 'unrelated-ingredient-prep', id: recipe.id, detail: `Ingredient ${index + 1} has prep advice for a different ingredient or cooking method.` });
  }
  return findings;
}

export function auditRecipeInstructions({ recipes, normalized, desserts = [] }) {
  const errors = [], review = [];
  const add = (list, code, id, detail) => list.push({ code, id, detail });
  if (!Array.isArray(recipes)) throw new TypeError('Recipe input must be an array');
  const byId = new Map();
  let ingredientLines = 0;
  for (const recipe of recipes) {
    const id = recipe.id;
    if (!id || byId.has(id)) add(errors, 'recipe-id', id, 'Recipe ID is missing or duplicated.');
    byId.set(id, recipe);
    if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) {
      add(errors, 'ingredients-missing', id, 'Ingredient list is empty.');
      continue;
    }
    ingredientLines += recipe.ingredients.length;
    for (const [index, ingredient] of recipe.ingredients.entries()) {
      if (!Array.isArray(ingredient) || !String(ingredient[0] || '').trim() || !String(ingredient[1] || '').trim()) {
        add(errors, 'ingredient-shape', id, `Ingredient ${index + 1} needs a name and quantity.`);
      }
      if (/\b(?:carton|block|standard pack)\b/i.test(String(ingredient[1]))) {
        add(review, 'pack-quantity', id, `${ingredient[0]}: ${ingredient[1]}; confirm the actual recipe amount, not just the purchased container.`);
      }
    }
    if (!Array.isArray(recipe.method) || recipe.method.length < 2 || recipe.method.some(step => typeof step !== 'string' || !step.trim())) {
      add(errors, 'method-missing', id, 'Method needs nonempty ordered instructions.');
      continue;
    }
    if (recipe.steps && !same(recipe.method, recipe.steps)) add(errors, 'method-steps-drift', id, 'method and steps differ.');
    errors.push(...auditCookMethodContent(recipe));
    errors.push(...auditIngredientPrepNotes(recipe));
    if (!Number.isFinite(recipe.mins) || recipe.mins <= 0) add(errors, 'time-invalid', id, 'Total minutes must be positive.');
    const method = words(recipe.method.join(' '));
    const ingredients = words(recipe.ingredients.map(line => line[0]).join(' '));
    const references = [
      ['flour', /\bflour\b/, /flour/],
      ['Parmesan', /\bparmesan\b/, /parmesan|hard cheese/],
      ['oregano', /\boregano\b/, /oregano|italian herbs|mixed (?:dried )?herbs/],
      ['sweetener', /\bsweetener\b/, /sugar|honey|syrup|sweetener/]
    ];
    for (const [name, mention, listed] of references) {
      if (mention.test(method) && !listed.test(ingredients)) add(errors, 'unlisted-method-ingredient', id, `${name} is required by the method but absent from the ingredients.`);
    }
    if (/drain (?:the )?beans/.test(method) && !/beans/.test(ingredients)) add(errors, 'unlisted-beans', id, 'Method drains beans absent from the ingredient list.');
    if (/rice absorb the seasoned stock/.test(method) && !/stock/.test(ingredients)) add(errors, 'unlisted-stock', id, 'Method requires rice to absorb stock absent from the ingredients.');
    if (/gammon/.test(ingredients) && /no pink meat/.test(method)) add(errors, 'cured-meat-colour', id, 'Cured gammon can stay pink; colour is not a suitable sole doneness check.');
    if (['sausage-gnocchi', 'date-pesto-gnocchi', 'pan-gnocchi-spinach'].includes(id) && /reserve a little starchy cooking water/.test(method)) {
      add(errors, 'nonexistent-cooking-water', id, 'Direct pan method refers to separate starchy cooking water.');
    }
    if (id === 'chicken-katsu-curry' && /give the glaze/.test(method)) add(errors, 'nonexistent-glaze', id, 'Katsu method refers to an unrelated glaze.');
    for (const [index, step] of recipe.method.entries()) {
      // Storage durations are not cooking phases and must not inflate recipe time.
      const sentences = step.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (/refrigerat|leftovers|reheat|eat within|store |keep chilled/i.test(sentence)) continue;
        for (const match of sentence.matchAll(/\b(\d+)(?:\s*[–-]\s*(\d+))?\s*(hours?|hrs?|minutes?|mins?)\b/gi)) {
          const duration = Math.max(Number(match[1]), Number(match[2] || match[1])) * (/^h/i.test(match[3]) ? 60 : 1);
          if (duration > recipe.mins) add(review, 'phase-exceeds-total', id, `Step ${index + 1}: ${match[0]} exceeds the listed ${recipe.mins} minutes; confirm elapsed time.`);
        }
      }
    }
    if (id === 'extra-lentil-shepherdless-pie' && recipe.mins === 35) add(review, 'sequential-timing', id, '35 minutes does not allow preparation, dried-lentil cooking and the stated 15–20-minute potato boil followed by a 20–25-minute bake. Re-time with the author; no replacement total has been invented.');
    if (id === 'extra-15-minute-pesto-tortellini' && recipe.mins !== 15) add(review, 'title-time', id, `Title says 15-minute; recorded total is ${recipe.mins} minutes.`);
    if (id === 'spinach-ricotta-shells' && recipe.ingredients.some(line => /^pasta shells$/i.test(line[0]))) add(review, 'stuffing-shell-size', id, 'Method fills shells, but the ingredient does not specify large stuffing shells. Confirm intended shape without changing quantities.');
    if (['family-chicken-wraps', 'chicken-katsu-curry', 'miso-salmon-rice'].includes(id) && /\bbake\b/i.test(method) && !/\d+\s*°\s*[cf]/i.test(method)) add(review, 'cooking-settings', id, 'The baking option supplies no oven temperature. An author-tested setting is needed; no temperature or cooking duration has been invented.');
  }
  if (normalized) {
    const rows = normalized.recipes;
    if (!Array.isArray(rows)) throw new TypeError('Normalized input must contain recipes');
    if (normalized.count_recipes !== recipes.length || rows.length !== recipes.length) add(errors, 'normalized-count', null, 'Normalized and public recipe counts differ.');
    if (normalized.count_ingredient_lines !== ingredientLines) add(errors, 'normalized-line-count', null, 'Normalized ingredient-line metadata differs.');
    const normalizedIds = new Set();
    for (const row of rows) {
      if (normalizedIds.has(row.id)) add(errors, 'normalized-duplicate', row.id, 'Normalized recipe ID is duplicated.');
      normalizedIds.add(row.id);
      const recipe = byId.get(row.id);
      if (!recipe || row.ingredients.length !== recipe.ingredients.length) {
        add(errors, 'normalized-ingredients', row.id, 'Normalized ingredient count does not match source.');
        continue;
      }
      for (const [index, line] of row.ingredients.entries()) {
        if (line.name !== recipe.ingredients[index][0] || line.recipe_id !== row.id || line.ingredient_index !== index) add(errors, 'normalized-identity', row.id, `Normalized ingredient ${index + 1} does not match source identity.`);
        if (!Number.isFinite(line.quantity) || line.quantity <= 0 || !line.unit) add(errors, 'normalized-quantity', row.id, `Normalized ingredient ${index + 1} has no positive quantity/unit.`);
      }
    }
  }
  const dessertIds = new Set();
  for (const dessert of desserts) {
    const canonical = byId.get(dessert.id);
    if (dessertIds.has(dessert.id)) add(errors, 'dessert-duplicate', dessert.id, 'Dessert ID is duplicated.');
    dessertIds.add(dessert.id);
    const amounts = record => record.ingredients.map(line => line.slice(0, 2));
    if (!canonical || !same(dessert.method, canonical.method) || dessert.steps && !same(dessert.steps, canonical.method) || dessert.mins !== canonical.mins || !same(amounts(dessert), amounts(canonical)) || dessert.culinary_prep_notes && !same(dessert.culinary_prep_notes, canonical.culinary_prep_notes)) add(errors, 'dessert-source-drift', dessert.id, 'Duplicate dessert method, prep notes, time or ingredient amounts differ from canonical public record.');
  }
  return {
    scope: 'Supplied public JSON files only; no protected methods or kitchen testing.',
    recipes: recipes.length,
    methodsScreened: recipes.filter(recipe => Array.isArray(recipe.method) && recipe.method.length).length,
    ingredientLines,
    duplicateDesserts: desserts.length,
    normalizedReviewFlags: normalized?.recipes.reduce((count, row) => count + row.ingredients.filter(line => line.needs_review).length, 0) || 0,
    errors,
    review
  };
}

// Presentation assets are useful for a complete ID/asset sweep, but do not
// establish the titles, amounts, timings or methods in a protected live row.
// Historical rows deliberately never increase currentFullRecipes.
export function auditRecipeCoverage({ recipes, currentPrivateRecipes = [], historical = [], images = [], expectedTotal = 500 }) {
  const errors = [];
  const currentIds = new Set(recipes.map(recipe => recipe.id));
  const privateIds = new Set();
  for (const recipe of currentPrivateRecipes) {
    if (!recipe?.id || privateIds.has(recipe.id) || currentIds.has(recipe.id)) errors.push({ code: 'current-private-id', id: recipe?.id || null });
    privateIds.add(recipe?.id);
  }
  const allCurrentIds = new Set([...currentIds, ...privateIds]);
  const historicalIds = new Set(historical.map(recipe => recipe.id));
  const imageIds = new Set();
  for (const image of images) {
    if (!image || typeof image.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(image.id) || imageIds.has(image.id)) {
      errors.push({ code: 'presentation-id', id: image?.id || null });
    }
    imageIds.add(image?.id);
    if (image.validWebP !== true) errors.push({ code: 'presentation-image-format', id: image?.id || null });
  }
  if (imageIds.size !== expectedTotal) errors.push({ code: 'presentation-count', id: null });
  for (const id of allCurrentIds) if (!imageIds.has(id)) errors.push({ code: 'current-image-missing', id });
  for (const id of historicalIds) if (!imageIds.has(id)) errors.push({ code: 'historical-image-missing', id });
  return {
    expectedCatalogueRecipes: expectedTotal,
    presentationIds: imageIds.size,
    presentationAssets: images.length,
    presentationScope: 'Primary image IDs and WebP signatures only; protected recipe metadata and visual recipe accuracy are not verified.',
    currentFullRecipes: allCurrentIds.size,
    currentProtectedFullRecipesAvailable: privateIds.size,
    currentProtectedFullRecipesUnavailable: Math.max(0, expectedTotal - allCurrentIds.size),
    historicalFullRecipes: historicalIds.size,
    historicalOutsideCurrentPublic: [...historicalIds].filter(id => !currentIds.has(id)).length,
    newerPresentationIdsOutsideHistorical: historical.length ? [...imageIds].filter(id => !historicalIds.has(id)).length : null,
    historicalScope: 'Historical source is screened separately and is never asserted to match current protected records.',
    errors
  };
}

export function summarizePrivateRecipeAudit(snapshot) {
  const audit = auditRecipeInstructions({ recipes: snapshot.recipes, normalized: snapshot.normalized });
  // No recipe method, ingredient, quantity, title or provider identifiers leave
  // this summary. Stable IDs and rule codes locate findings in the private file.
  const identifiers = finding => ({ code: finding.code, id: finding.id });
  return {
    source: 'Explicit current protected D1 export; automatic consistency screen, not manual culinary review or kitchen testing.',
    recipes: audit.recipes,
    ingredientLines: audit.ingredientLines,
    rowsSha256: snapshot.sha256,
    consistencyErrors: audit.errors.length,
    reviewFindings: audit.review.length,
    normalizedReviewFlags: audit.normalizedReviewFlags,
    errors: audit.errors.map(identifiers),
    review: audit.review.map(identifiers)
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const result = auditRecipeInstructions({ recipes: read('recipes.json'), normalized: read('normalized-ingredient-database.json'), desserts: read('dessert_recipes.json') });
  const historicalArg = process.argv.indexOf('--historical');
  if (historicalArg !== -1 && !process.argv[historicalArg + 1]) throw new Error('--historical requires a local JSON file path');
  const historical = historicalArg === -1 ? [] : JSON.parse(fs.readFileSync(process.argv[historicalArg + 1], 'utf8'));
  const privateArg = process.argv.indexOf('--current-private');
  if (privateArg !== -1 && !process.argv[privateArg + 1]) throw new Error('private_recipe_audit_input_required');
  const currentPrivate = privateArg === -1 ? null : readPrivateRecipeExport(process.argv[privateArg + 1]);
  const imageRoot = path.join(root, 'release-assets/basketboss-v17/images');
  const images = ['existing', 'new'].flatMap(folder => fs.readdirSync(path.join(imageRoot, folder))
    .filter(name => name.endsWith('.webp')).map(name => {
      const file = fs.readFileSync(path.join(imageRoot, folder, name));
      return { id: name.slice(0, -5), validWebP: file.length > 12 && file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP' };
    }));
  result.coverage = auditRecipeCoverage({ recipes: read('recipes.json'), currentPrivateRecipes: currentPrivate?.recipes || [], historical, images });
  if (currentPrivate) {
    result.currentPrivateScreen = summarizePrivateRecipeAudit(currentPrivate);
    result.scope = 'Current public JSON and explicitly supplied protected D1 snapshot; automatic consistency screens, no kitchen testing.';
  }
  if (historical.length) {
    const screened = auditRecipeInstructions({ recipes: historical });
    const currentIds = new Set(read('recipes.json').map(recipe => recipe.id));
    const historicalOnlyErrors = screened.errors.filter(finding => !currentIds.has(finding.id));
    result.historicalScreen = {
      source: 'Explicitly supplied historical JSON; not current protected-catalogue verification.',
      recipes: screened.recipes,
      ingredientLines: screened.ingredientLines,
      consistencyErrors: screened.errors.length,
      outsideCurrentPublicConsistencyErrors: historicalOnlyErrors.map(({ code, id }) => ({ code, id })),
      reviewFindings: screened.review.length
    };
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Public recipe audit: ${result.recipes} recipes, ${result.ingredientLines} ingredient lines, ${result.duplicateDesserts} duplicate desserts.`);
    console.log(`${result.errors.length} consistency errors; ${result.review.length} author-review findings; ${result.normalizedReviewFlags} pre-existing normalized quantity-review flags.`);
    for (const finding of [...result.errors, ...result.review]) console.log(`${finding.code} | ${finding.id || 'catalogue'} | ${finding.detail}`);
    console.log(`Coverage: ${result.coverage.presentationIds} presentation IDs; ${result.coverage.currentFullRecipes} current full recipes; ${result.coverage.currentProtectedFullRecipesUnavailable} current protected full records unavailable.`);
    if (result.currentPrivateScreen) console.log(`Current protected screen: ${result.currentPrivateScreen.recipes} recipes, ${result.currentPrivateScreen.ingredientLines} ingredient lines, ${result.currentPrivateScreen.consistencyErrors} consistency findings, ${result.currentPrivateScreen.reviewFindings} review findings; rows SHA-256 ${result.currentPrivateScreen.rowsSha256}.`);
    if (result.historicalScreen) console.log(`Separate historical screen: ${result.historicalScreen.recipes} recipes, ${result.historicalScreen.ingredientLines} ingredient lines, ${result.historicalScreen.consistencyErrors} consistency findings (${result.historicalScreen.outsideCurrentPublicConsistencyErrors.length} outside current public IDs).`);
    console.log(result.scope);
  }
  if (result.errors.length || result.coverage.errors.length || result.currentPrivateScreen?.consistencyErrors) process.exitCode = 1;
 } catch (error) {
   // Invalid private files/provider text must not be reflected into a public log.
   console.error(/^private_recipe_audit_[a-z_]+$/.test(error?.message || '') ? error.message : 'recipe_audit_input_unavailable');
   process.exitCode = 1;
 }
}
