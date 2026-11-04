/* Dietary eligibility uses the listed ingredients. A recipe title, category or
 * pantry score cannot override a conflicting ingredient or invent a substitute.
 * Ingredient labels are still subject to the app's existing allergy guidance.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BBDietaryPreferences = api;
})(typeof window === "undefined" ? null : window, function () {
  "use strict";
  const DIETS = Object.freeze([
    "vegetarian",
    "vegan",
    "gluten-free",
    "dairy-free",
  ]);
  const LABELS = Object.freeze({
    vegetarian: "Vegetarian",
    vegan: "Vegan",
    "gluten-free": "Gluten-free",
    "dairy-free": "Dairy-free",
  });
  const text = (value) =>
    typeof value === "string"
      ? value
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[‐‑–—]/g, "-")
          .replace(/_/g, " ")
          .replace(/[’']/g, "")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  function normalizeDiets(value) {
    if (!Array.isArray(value)) return [];
    const selected = new Set(value.map((v) => text(v).replace(/\s+/g, "-")));
    return DIETS.filter((diet) => selected.has(diet));
  }
  function ingredientName(value) {
    return text(
      Array.isArray(value)
        ? value[0]
        : typeof value === "string"
          ? value
          : value?.name || value?.key,
    );
  }
  const MEAT =
    /\b(?:meat|chicken|turkey|beef|brisket|steaks?|mince|minced meat|pork|bacon|ham|gammon|chorizo|pancetta|prosciutto|salami|pepperoni|sausage(?:s)?|lamb|mutton|veal|venison|duck|goose|goat|rabbit|liver|kidney|offal|lard|suet|gelatine?|gelatin|tallow|bone broth)\b/;
  const SEAFOOD =
    /\b(?:fish|salmon|tuna|cod|haddock|pollock|hake|trout|mackerel|sardines?|anchov(?:y|ies)|sea\s*bass|prawns?|shrimp|mussels?|clams?|scallops?|squid|calamari|crab|lobster|oysters?|seafood|bonito|dashi|caviar|roe)\b/;
  const RENNET =
    /\b(?:parmesan|parmigiano|pecorino|grana padano|animal rennet|hard cheese|worcestershire|pesto)\b/;
  const DAIRY =
    /\b(?:milk|butter|cream|creme fraiche|yogh?urt|cheese|cheddar|mozzarella|parmesan|parmigiano|pecorino|ricotta|feta|halloumi|paneer|burrata|mascarpone|gruyere|brie|stilton|ghee|buttermilk|whey|casein|quark|custard|chocolate|pesto|brioche|croissants?|margarine)\b/;
  const VEGAN_EXTRA =
    /\b(?:eggs?|honey|mayonnaise|mayo|meringue|quorn|royal jelly|beeswax|carmine|cochineal)\b/;
  const GLUTEN =
    /\b(?:wheat|rye|barley|spelt|semolina|bulgur|bulgar|couscous|orzo|malt|bread|flatbreads?|breadcrumbs?|panko|pasta|spaghetti|penne|linguine|macaroni|fusilli|rigatoni|tortellini|ravioli|lasagn[ae]|noodles?|wraps?|tortillas?|pitta|pita|bagels?|buns?|brioche|gnocchi|flour|oats?|oatmeal|cornflakes|biscuits?|crackers?|dumplings?|pastry|pizza bases?|pizza dough|batter|seitan|sausages?|soy sauce|soya sauce|tamari)\b/;
  const COMPOUND = /\b(?:with|and|or|plus)\b|[&/]/;
  const explicitAlternative = (name, pattern) =>
    pattern.test(name) && !COMPOUND.test(name);
  const vegetarianAlternative = (name) =>
    explicitAlternative(
      name,
      /\b(?:vegan|vegetarian|plant[ -]based|meat[ -]free|fish[ -]free|quorn)\b/,
    );
  const veganAlternative = (name) => explicitAlternative(name, /\bvegan\b/);
  function animalText(name) {
    return name.replace(
      /\b(?:kidney beans?|beef tomatoes?|oyster mushrooms?|goats? cheese|duck eggs?|goose eggs?|(?:cauliflower|aubergine|eggplant|mushroom|tofu|cabbage) steaks?|(?:soya?|lentil|mushroom|tofu|tempeh) mince)\b/g,
      "",
    );
  }
  function animalIngredient(name) {
    const value = animalText(name);
    return (
      MEAT.test(value) ||
      SEAFOOD.test(value) ||
      RENNET.test(value) ||
      (/\b(?:stock|broth|bouillon)\b/.test(value) &&
        !/\b(?:vegetable|veg|mushroom|seaweed|kombu)\b/.test(value))
    );
  }
  function dairyText(name) {
    if (explicitAlternative(name, /\b(?:vegan|dairy[ -]free|non[ -]dairy)\b/))
      return "";
    return name
      .replace(
        /\b(?:coconut|almond|oat|soya?|rice|cashew|hazelnut|hemp|pea|plant) (?:milk|cream|yogh?urt)\b/g,
        "",
      )
      .replace(
        /\b(?:peanut|almond|cashew|nut|cocoa|cacao|apple|sunflower seed) butter\b|\bbutter beans?\b|\bcream of coconut\b/g,
        "",
      );
  }
  function glutenText(name) {
    if (explicitAlternative(name, /\bgluten[ -]free\b/)) return "";
    return name
      .replace(
        /\b(?:rice|corn|maize|chickpea|gram|besan|almond|coconut|buckwheat|potato|tapioca|cassava) flour\b/g,
        "",
      )
      .replace(
        /\b(?:rice|glass|bean thread|mung bean) noodles?\b|\bcorn tortillas?\b/g,
        "",
      );
  }
  function conflicts(name, diet) {
    if (diet === "vegetarian")
      return !vegetarianAlternative(name) && animalIngredient(name);
    if (diet === "vegan") {
      if (veganAlternative(name)) return false;
      return (
        (!vegetarianAlternative(name) && animalIngredient(name)) ||
        DAIRY.test(dairyText(name)) ||
        VEGAN_EXTRA.test(name) ||
        (/\b(?:sausages?|bacon|mince|chicken|fish)\b/.test(name) &&
          vegetarianAlternative(name))
      );
    }
    if (diet === "dairy-free") return DAIRY.test(dairyText(name));
    if (diet === "gluten-free") return GLUTEN.test(glutenText(name));
    return false;
  }
  function evaluate(recipe, choices = []) {
    const diets = normalizeDiets(choices);
    if (!recipe || typeof recipe !== "object")
      return { allowed: false, conflicts: [], missingIngredients: true };
    if (!diets.length)
      return { allowed: true, conflicts: [], missingIngredients: false };
    const names = Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map(ingredientName)
      : [];
    if (!names.length || names.some((name) => !name))
      return {
        allowed: false,
        conflicts: diets.slice(),
        missingIngredients: true,
      };
    const blocked = diets.filter((diet) => {
      const flag = {
        vegetarian: "vegetarian",
        vegan: "vegan",
        "gluten-free": "glutenFree",
        "dairy-free": "dairyFree",
      }[diet];
      return (
        recipe[flag] === false ||
        (diet === "vegan" && recipe.vegetarian === false) ||
        names.some((name) => conflicts(name, diet))
      );
    });
    return {
      allowed: blocked.length === 0,
      conflicts: blocked,
      missingIngredients: false,
    };
  }
  function recipeAllowed(recipe, choices = []) {
    return evaluate(recipe, choices).allowed;
  }
  return Object.freeze({
    DIETS,
    LABELS,
    normalizeDiets,
    ingredientName,
    evaluate,
    recipeAllowed,
  });
});
