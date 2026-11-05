import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auditRecipeInstructions, auditRecipeCoverage, summarizePrivateRecipeAudit, auditCookMethodContent, auditIngredientPrepNotes } from '../scripts/audit-recipe-instructions.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
const recipes = read('recipes.json');
const normalized = read('normalized-ingredient-database.json');
const desserts = read('dessert_recipes.json');
const oneRecipe = (id, ingredients, method, mins = 30) => ({ id, ingredients, method, steps: [...method], mins });

test('current public instructions, normalized identities and dessert copies agree', () => {
  const result = auditRecipeInstructions({ recipes, normalized, desserts });
  assert.equal(result.recipes, 100);
  assert.equal(result.methodsScreened, 100);
  assert.equal(result.ingredientLines, 730);
  assert.equal(result.duplicateDesserts, 4);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.review, [], 'accepted public recommendations must resolve their original findings');
});

test('the audit retains pack, oven, elapsed-time and stuffing-shape checks after recommendations', () => {
  const shells = oneRecipe('spinach-ricotta-shells', [['Pasta shells', '250 g']], ['Cook the shells.', 'Fill the shells and bake.']);
  assert(auditRecipeInstructions({ recipes: [shells] }).review.some(finding => finding.code === 'stuffing-shell-size'));
  shells.ingredients[0][1] = '250 g large stuffing shells (conchiglioni)';
  assert(!auditRecipeInstructions({ recipes: [shells] }).review.some(finding => finding.code === 'stuffing-shell-size'));
  shells.ingredients[0][1] = '250 g small shells';
  assert(auditRecipeInstructions({ recipes: [shells] }).review.some(finding => finding.code === 'stuffing-shell-size'));
  const tortellini = oneRecipe('extra-15-minute-pesto-tortellini', [['Tortellini', '500 g']], ['Boil tortellini.', 'Serve with pesto.'], 20);
  tortellini.name = '15-minute pesto tortellini';
  assert(auditRecipeInstructions({ recipes: [tortellini] }).review.some(finding => finding.code === 'title-time'));
  tortellini.name = '20-minute pesto tortellini';
  assert(!auditRecipeInstructions({ recipes: [tortellini] }).review.some(finding => finding.code === 'title-time'));
  const result = auditRecipeInstructions({ recipes: [
    oneRecipe('pack-test', [['Vegetable stock', '1 carton']], ['Prepare stock.', 'Simmer vegetables.']),
    oneRecipe('chicken-katsu-curry', [['Chicken breast', '600 g']], ['Coat chicken.', 'Bake until cooked.']),
    oneRecipe('extra-lentil-shepherdless-pie', [['Dried lentils', '200 g']], ['Simmer lentils.', 'Bake the pie.'], 35)
  ] });
  for (const code of ['pack-quantity', 'cooking-settings', 'sequential-timing']) assert(result.review.some(finding => finding.code === code), code);
});

test('visible ingredient prep notes cannot tell cooks to dry stock, toast flour or melt crumble butter', () => {
  const recipe = oneRecipe('prep-note-test', [['Chicken stock', '200 ml'], ['Strong white bread flour', '200 g'], ['Cold butter', '50 g']], ['Prepare ingredients.', 'Cook as directed.']);
  recipe.culinary_prep_notes = [
    'Pat dry and season before cooking; give the surface time to brown before moving or turning.',
    'Warm or toast only at assembly time so the outside stays crisp.',
    'Cut into small pieces and melt gently.'
  ];
  assert.equal(auditIngredientPrepNotes(recipe).filter(finding => finding.code === 'unrelated-ingredient-prep').length, 3);
  recipe.culinary_prep_notes = ['Prepare the stock according to its packet.', 'Measure the flour before mixing the dough.', 'Keep the butter cold and cube before rubbing into the flour.'];
  assert.deepEqual(auditIngredientPrepNotes(recipe), []);
});

test('Cook content screen detects duplicate actions, late prep and unrelated seafood advice', () => {
  const duplicate = oneRecipe('duplicate', [['Prawns', '200 g']], [
    'Pat the prawns dry before adding them to the hot pan.',
    'Pat the prawns dry before adding them to the hot pan.',
    'Cook until opaque and firm throughout.'
  ]);
  assert(auditCookMethodContent(duplicate).some(finding => finding.code === 'duplicate-method-step'));
  const latePrep = oneRecipe('late-prep', [['Salmon', '200 g']], [
    'Sear salmon in a hot pan. Pat the fish dry before searing.',
    'Prepare your ingredients: Crush the garlic before starting.'
  ]);
  assert.equal(auditCookMethodContent(latePrep).filter(finding => finding.code === 'prep-after-cooking').length, 2);
  const fishcakes = oneRecipe('fishcake-test', [['Cooked salmon', '200 g']], [
    'Flake the cooked salmon into mashed potato.',
    'Pat the fish or seafood dry before searing and cook just until opaque and tender.'
  ]);
  assert(auditCookMethodContent(fishcakes).some(finding => finding.code === 'unrelated-seafood-searing'));
});

test('pasta-water chronology and unrelated additions fail without rejecting legitimate multiple cooking phases', () => {
  const earlyWater = oneRecipe('early-water', [['Linguine', '200 g']], [
    'Mince the garlic and save a mug of pasta water.', 'Cook linguine until tender and drain.'
  ]);
  assert(auditCookMethodContent(earlyWater).some(finding => finding.code === 'cooking-water-before-cooking'));
  const unlisted = oneRecipe('unlisted', [['Beef', '200 g']], ['Brown beef.', 'Thicken with cornflour if desired.']);
  assert(auditCookMethodContent(unlisted).some(finding => finding.code === 'unlisted-cornflour'));
  const phases = oneRecipe('phases', [['Beef', '200 g']], [
    'Pat the beef dry, then brown in batches and set aside.',
    'Soften the vegetables, then return beef to the pan and simmer until tender.',
    'Serve hot.'
  ]);
  assert.deepEqual(auditCookMethodContent(phases), []);
  const water = oneRecipe('valid-water', [['Linguine', '200 g']], [
    'Cook linguine until tender. Reserve a mug of pasta water before draining.',
    'Toss pasta with sauce and a splash of reserved water.'
  ]);
  assert.deepEqual(auditCookMethodContent(water), []);
});

test('public seafood methods prepare before cooking and describe each main cooking phase once', () => {
  const method = id => recipes.find(recipe => recipe.id === id).method.join(' ');
  const prawn = method('prawn-linguine');
  assert(prawn.indexOf('pat them dry') < prawn.indexOf('Add prawns and cook'));
  assert(prawn.indexOf('Cook linguine') < prawn.indexOf('Reserve a mug'));
  assert.equal((prawn.match(/Add prawns and cook/g) || []).length, 1);
  assert(!prawn.includes('Pat the fish or seafood dry before searing'));
  const salmon = method('tuscan-salmon');
  assert(salmon.indexOf('Pat salmon dry') < salmon.indexOf('Sear the salmon'));
  assert.equal((salmon.match(/Sear the salmon/g) || []).length, 1);
  assert(salmon.includes('check the thickest part following food-safety guidance'));
  const rice = method('veggie-fried-rice');
  assert(rice.includes('cooled within one hour'));
  assert(rice.includes('no longer than 24 hours'));
  assert(rice.includes('do not repeatedly reheat'));
  const prep = (id, name) => {
    const recipe = recipes.find(recipe => recipe.id === id);
    return recipe.culinary_prep_notes[recipe.ingredients.findIndex(line => line[0] === name)];
  };
  assert.match(prep('beef-meatballs', 'Breadcrumbs'), /mix.*mince/i);
  assert(!/coating|shallow dish/i.test(prep('beef-meatballs', 'Breadcrumbs')));
  assert.match(prep('honey-garlic-tofu', 'Cornflour'), /tofu/i);
  assert(!/chicken/i.test(prep('honey-garlic-tofu', 'Cornflour')));
});

test('phantom flour, unrelated katsu glaze and cured-gammon colour criteria fail the audit', () => {
  const result = auditRecipeInstructions({ recipes: [
    oneRecipe('oat-test', [['Oats', '100 g']], ['Measure oats.', 'Fold in the flour.']),
    oneRecipe('chicken-katsu-curry', [['Chicken breast', '600 g']], ['Coat the chicken.', 'Give the glaze its final two minutes.']),
    oneRecipe('gammon-test', [['Gammon joint', '1 kg']], ['Follow actual pack cooking instructions.', 'Check there is no pink meat.'])
  ] });
  assert(result.errors.some(finding => finding.code === 'unlisted-method-ingredient'));
  assert(result.errors.some(finding => finding.code === 'nonexistent-glaze'));
  assert(result.errors.some(finding => finding.code === 'cured-meat-colour'));
});

test('method drift and direct-pan cooking-water regression remain detectable', () => {
  const changed = oneRecipe('pan-gnocchi-spinach', [['Gnocchi', '500 g']], [
    'Pan-fry the gnocchi.', 'Reserve a little starchy cooking water, then add the cream.'
  ]);
  changed.steps[0] = 'Boil the gnocchi.';
  const result = auditRecipeInstructions({ recipes: [changed] });
  assert(result.errors.some(finding => finding.code === 'method-steps-drift'));
  assert(result.errors.some(finding => finding.code === 'nonexistent-cooking-water'));
});

test('storage durations do not become cooking phases but an excessive cook duration is flagged', () => {
  const storage = oneRecipe('storage-test', [['Rice', '100 g']], [
    'Cook rice for 12 minutes.', 'Refrigerate within 1 hour and eat within 24 hours.'
  ]);
  assert.equal(auditRecipeInstructions({ recipes: [storage] }).review.length, 0);
  storage.method[0] = 'Simmer for 2 hours.';
  storage.steps = [...storage.method];
  assert(auditRecipeInstructions({ recipes: [storage] }).review.some(finding => finding.code === 'phase-exceeds-total'));
});

test('duplicate dessert amounts are checked while independent price estimates are preserved', () => {
  const canonical = oneRecipe('dessert-test', [['Chocolate', '200 g', 2]], ['Melt chocolate.', 'Allow to set.']);
  const copy = structuredClone(canonical);
  copy.ingredients[0][2] = 3;
  assert.deepEqual(auditRecipeInstructions({ recipes: [canonical], desserts: [copy] }).errors, []);
  copy.ingredients[0][1] = '100 g';
  assert(auditRecipeInstructions({ recipes: [canonical], desserts: [copy] }).errors.some(finding => finding.code === 'dessert-source-drift'));
});

test('historical full methods never increase current full-record coverage', () => {
  const result = auditRecipeCoverage({
    recipes: [{ id: 'a' }], historical: [{ id: 'a' }, { id: 'b' }], expectedTotal: 3,
    images: ['a', 'b', 'c'].map(id => ({ id, validWebP: true }))
  });
  assert.equal(result.currentFullRecipes, 1);
  assert.equal(result.currentProtectedFullRecipesAvailable, 0);
  assert.equal(result.currentProtectedFullRecipesUnavailable, 2);
  assert.equal(result.historicalFullRecipes, 2);
  assert.equal(result.historicalOutsideCurrentPublic, 1);
  assert.equal(result.newerPresentationIdsOutsideHistorical, 1);
  assert.deepEqual(result.errors, []);
});

test('a 500-count claim cannot hide duplicate IDs, bad WebP signatures or missing recipe images', () => {
  const result = auditRecipeCoverage({ recipes: [{ id: 'missing' }], expectedTotal: 2,
    images: [{ id: 'duplicate', validWebP: true }, { id: 'duplicate', validWebP: false }]
  });
  assert(result.errors.some(finding => finding.code === 'presentation-id'));
  assert(result.errors.some(finding => finding.code === 'presentation-image-format'));
  assert(result.errors.some(finding => finding.code === 'presentation-count'));
  assert(result.errors.some(finding => finding.code === 'current-image-missing'));
});

test('explicit current private rows increase current coverage while historical rows remain separate', () => {
  const result = auditRecipeCoverage({
    recipes: [{ id: 'a' }], currentPrivateRecipes: [{ id: 'b' }, { id: 'c' }],
    historical: [{ id: 'a' }, { id: 'b' }], expectedTotal: 3,
    images: ['a', 'b', 'c'].map(id => ({ id, validWebP: true }))
  });
  assert.equal(result.currentFullRecipes, 3);
  assert.equal(result.currentProtectedFullRecipesAvailable, 2);
  assert.equal(result.currentProtectedFullRecipesUnavailable, 0);
  assert.equal(result.historicalFullRecipes, 2);
  assert.deepEqual(result.errors, []);
  assert(auditRecipeCoverage({ recipes: [{ id: 'a' }], currentPrivateRecipes: [{ id: 'a' }], images: [{ id: 'a', validWebP: true }], expectedTotal: 1 }).errors.some(finding => finding.code === 'current-private-id'));
});

test('private audit summaries expose counts, hashes and stable rule identifiers without protected content', () => {
  const record = oneRecipe('private-test', [['Private vegetable name', '1 carton']], ['Private preparation instruction.', 'Serve privately.']);
  const result = summarizePrivateRecipeAudit({ recipes: [record], sha256: 'a'.repeat(64) });
  assert.equal(result.recipes, 1);
  assert.equal(result.rowsSha256, 'a'.repeat(64));
  assert.deepEqual(result.review, [{ code: 'pack-quantity', id: 'private-test' }]);
  assert.doesNotMatch(JSON.stringify(result), /Private vegetable name|1 carton|Private preparation instruction|Serve privately/);
});
