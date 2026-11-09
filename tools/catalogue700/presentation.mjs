/* Human-facing presentation for generated catalogue-700 clients only.
 * This does not change source catalogues, API contracts, IDs or entitlements.
 * Keep each replacement anchored to known copy, rather than replacing numbers.
 */
const COPY = Object.freeze([
  ['Includes 500 recipes, Smart Auto-Fill, 1-Tap Batch Cooking', 'Includes all 700 recipes, including 50 breakfast options, optional meal planning, Smart Auto-Fill and 1-Tap Batch Cooking'],
  ['include 500 recipes, Smart Auto-Fill and 1-Tap Batch Cooking.', 'include all 700 recipes, including 50 breakfast options, optional meal planning, Smart Auto-Fill and 1-Tap Batch Cooking.'],
  ['All 500 recipes, advanced planning and eligible Premium AI features.', 'All 700 recipes, including 50 breakfast options, optional meal planning, advanced planning and eligible Premium AI features.'],
  ['<li>All <strong>500 recipes</strong> (100 recipes stay free)</li>', '<li>All <strong>700 recipes</strong> (200 recipes stay free)</li><li><strong>50 breakfast options</strong>, plus optional breakfast and dessert planning</li>'],
  ['Search 500 BasketBoss recipes', 'Search BasketBoss recipes'],
  ['100 free recipes', '200 free recipes'],
  ['100 Free recipes', '200 Free recipes'],
  ['100 Free Recipes', '200 Free Recipes'],
  ['100 recipes free', '200 recipes free'],
  ['100 starter recipes', '200 starter recipes'],
  ['100 built-in recipes', '200 built-in recipes'],
  ['100 recipes stay free', '200 recipes stay free'],
  ['100 recipes to get you started', '200 recipes to get you started'],
  ['100 recipes and basic', '200 recipes and basic'],
  ['Free includes 100 recipes', 'Free includes 200 recipes'],
  ['Free: 100 recipes', 'Free: 200 recipes'],
  ['Free (100 recipes)', 'Free (200 recipes)'],
  ["'100 recipes'", "'200 recipes'"],
  ['>100 recipes<', '>200 recipes<'],
  ['100 FREE', '200 FREE'],
  ['All 500 recipes', 'All 700 recipes'],
  ['all 500 recipes', 'all 700 recipes'],
  ['all 500 with Premium', 'all 700 with Premium'],
  ['All 500 with Premium', 'All 700 with Premium'],
  ['500 with Premium', '700 with Premium'],
  ['500 recipes + Leftover Magic', '700 recipes + Leftover Magic'],
  ['Discover 500 recipes', 'Discover 700 recipes'],
  ['500-recipe access', '700-recipe access'],
  ['500-recipe library', '700-recipe library'],
  ['Premium (500 recipes)', 'Premium (700 recipes)'],
  ['>500 recipes<', '>700 recipes<'],
  ['400 more recipes in Premium', '500 more recipes in Premium'],
]);

export function transform700Presentation(source) {
  if (typeof source !== 'string') throw new TypeError('Catalogue presentation source must be a string.');
  let result = source;
  for (const [before, after] of COPY) result = result.replaceAll(before, after);
  return result;
}
