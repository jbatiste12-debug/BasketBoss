/* Personal planning choices share the existing plan's backup and save contract. */
(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BBMealPreferences = api;
})(typeof window === "undefined" ? null : window, function (root) {
  "use strict";
  const DIETS = Object.freeze([
    "Vegetarian",
    "Vegan",
    "Gluten-free",
    "Dairy-free",
  ]);
  const GOALS = Object.freeze([
    "Spend less on groceries",
    "Plan dinners faster",
    "Waste less food",
    "Make shopping simpler",
    "Try new recipes",
  ]);
  const MIGRATION_KEY = "basketboss_onboarding_meal_preferences_v1";
  const validScope = (value) =>
    typeof value === "string" &&
    /^[a-z0-9._-]{1,128}$/i.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value);
  const choices = (values, allowed) =>
    Array.isArray(values)
      ? allowed.filter((value) => values.includes(value))
      : [];
  function normalize(value) {
    return value?.version === 1 &&
      validScope(value.scope) &&
      Array.isArray(value.diets) &&
      Array.isArray(value.goals)
      ? {
          version: 1,
          scope: value.scope,
          diets: choices(value.diets, DIETS),
          goals: choices(value.goals, GOALS),
        }
      : null;
  }
  function scope() {
    try {
      const id = JSON.parse(
        root?.localStorage?.getItem("basketboss_cloud_session_v1") || "null",
      )?.user?.id;
      return validScope(id) ? id : "guest";
    } catch {
      return "guest";
    }
  }
  let adapter = null;
  const listeners = new Set();
  function stored() {
    try {
      return normalize(
        adapter
          ? adapter.read()
          : JSON.parse(
              root?.localStorage?.getItem("basketboss_321_unified_state_v1") ||
                "null",
            )?.mealPreferences,
      );
    } catch {
      return null;
    }
  }
  function get() {
    const value = stored(),
      actor = scope();
    return value?.scope === actor
      ? value
      : { version: 1, scope: actor, diets: [], goals: [] };
  }
  function emit() {
    const value = get();
    for (const fn of listeners)
      try {
        fn(value);
      } catch {}
  }
  function claim() {
    try {
      root?.localStorage?.setItem(
        MIGRATION_KEY,
        JSON.stringify({ version: 1, scope: scope() }),
      );
    } catch {}
  }
  function set(patch) {
    const before = get();
    const proto =
      patch && typeof patch === "object"
        ? Object.getPrototypeOf(patch)
        : undefined;
    const plain =
      !!patch &&
      typeof patch === "object" &&
      (proto === null || Object.getPrototypeOf(proto) === null);
    if (
      !plain ||
      Object.keys(patch).some((key) => !["diets", "goals"].includes(key)) ||
      ["diets", "goals"].some(
        (key) =>
          Object.hasOwn(patch, key) &&
          (!Array.isArray(patch[key]) ||
            patch[key].some(
              (value) => !(key === "diets" ? DIETS : GOALS).includes(value),
            )),
      )
    )
      return {
        ok: false,
        error: "Choose from the available meal preferences.",
        value: before,
      };
    const next = { ...before, ...patch };
    next.diets = choices(next.diets, DIETS);
    next.goals = choices(next.goals, GOALS);
    try {
      if (
        root?.BBAccountDeletion?.isDeleting?.() === true ||
        !adapter ||
        adapter.write(next) !== true
      )
        throw Error("Could not save meal preferences. Please try again.");
      claim();
      emit();
      return { ok: true, value: next };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "Could not save meal preferences.",
        value: before,
      };
    }
  }
  function configure(value) {
    if (typeof value?.read !== "function" || typeof value?.write !== "function")
      throw Error("Meal preferences require a plan-state adapter.");
    adapter = value;
    emit();
  }
  function migrateOnboarding() {
    try {
      if (
        !adapter ||
        root?.BBAccountDeletion?.isDeleting?.() === true ||
        root?.localStorage?.getItem(MIGRATION_KEY)
      )
        return false;
      // A saved explicit choice, including no dietary restrictions, always wins.
      if (stored()) {
        claim();
        return false;
      }
      const survey = JSON.parse(
        root?.localStorage?.getItem("bb_onboarding_fresh_once_20261028_v1") ||
          "null",
      );
      if (survey?.complete !== true) return false;
      const diets = choices(survey.diets, DIETS),
        goals = choices(survey.goals, GOALS);
      if (!diets.length && !goals.length) {
        claim();
        return false;
      }
      return set({ diets, goals }).ok;
    } catch {
      return false;
    }
  }
  function recipeAllowed(recipe) {
    const diets = get().diets;
    return (
      !!recipe &&
      (!diets.length ||
        root?.BBDietaryPreferences?.recipeAllowed(recipe, diets) === true)
    );
  }
  function goalScore({
    amount,
    servings = 1,
    pantryBonus = 0,
    previouslyPlanned = true,
    goals = get().goals,
  } = {}) {
    let score = 0;
    if (
      goals.includes("Spend less on groceries") &&
      Number.isFinite(amount) &&
      amount >= 0
    )
      score += 0.6 / (1 + amount / Math.max(1, servings));
    if (goals.includes("Waste less food") && Number.isFinite(pantryBonus))
      score += Math.max(0, pantryBonus) * 0.5;
    if (goals.includes("Try new recipes") && previouslyPlanned === false)
      score += 1;
    return score;
  }
  function controls({ onSave, onError } = {}) {
    const doc = root?.document;
    if (!doc) return null;
    const section = doc.createElement("section");
    section.className = "bb-meal-preferences";
    const label = doc.createElement("strong");
    label.textContent = "Dietary preferences";
    section.append(label);
    const note = doc.createElement("p");
    note.textContent =
      "Applied to Auto-fill and recipe suggestions. Your existing plan stays as you chose it.";
    section.append(note);
    function group(field, options, parent) {
      const row = doc.createElement("div");
      row.className = "bb-meal-preference-pills";
      row.setAttribute("role", "group");
      row.setAttribute(
        "aria-label",
        field === "diets" ? "Dietary preferences" : "Planning goals",
      );
      for (const value of options) {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = value;
        button.dataset.bbMealChoice = field;
        button.setAttribute(
          "aria-pressed",
          String(get()[field].includes(value)),
        );
        button.onclick = () => {
          const selected = new Set(get()[field]);
          selected.has(value) ? selected.delete(value) : selected.add(value);
          const result = set({ [field]: [...selected] });
          if (!result.ok) {
            onError?.(result.error);
            return;
          }
          onSave?.(result.value);
        };
        row.append(button);
      }
      parent.append(row);
    }
    group("diets", DIETS, section);
    const goals = doc.createElement("details"),
      summary = doc.createElement("summary");
    summary.textContent =
      "Planning goals" +
      (get().goals.length ? " · " + get().goals.length + " selected" : "");
    goals.append(summary);
    group("goals", GOALS, goals);
    section.append(goals);
    return section;
  }
  root?.addEventListener?.("basketboss:session-changed", emit);
  root?.addEventListener?.("storage", (event) => {
    if (
      event.key === null ||
      [
        "basketboss_cloud_session_v1",
        "basketboss_321_unified_state_v1",
      ].includes(event.key)
    )
      emit();
  });
  return Object.freeze({
    DIETS,
    GOALS,
    MIGRATION_KEY,
    normalize,
    scope,
    get,
    set,
    configure,
    migrateOnboarding,
    recipeAllowed,
    goalScore,
    controls,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
});
