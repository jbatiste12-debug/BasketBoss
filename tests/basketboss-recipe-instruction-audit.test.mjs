import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auditRecipeInstructions, auditRecipeCoverage, summarizePrivateRecipeAudit } from '../scripts/audit-recipe-instructions.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
const recipes = read('recipes.json');
const normalized = read('normalized-ingredient-database.json');
const desserts = read('dessert_recipes.json');
const oneRecipe = (id, ingredients, method, mins = 30) => ({ id, ingredients, method, steps: [...method], mins });

test('current public instructions, normalized identities and dessert copies agree', () => {
  const result = auditRecipeInstructions({ recipes, normalized, desserts });
  assert.equal(result.recipes, 100);
  assert.equal(result.ingredientLines, 730);
  assert.equal(result.duplicateDesserts, 4);
  assert.deepEqual(result.errors, []);
  assert(result.review.some(finding => finding.code === 'sequential-timing'), 'unresolved timing must remain visible');
  assert(result.review.some(finding => finding.code === 'pack-quantity'), 'unspecified pack amounts must remain visible');
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
