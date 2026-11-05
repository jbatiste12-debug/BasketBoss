import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { create } = require("../bb-kitchen-prices.js"),
  policy = require("../bb-pantry-policy.js");
const NOW = Date.parse("2026-11-05T12:00:00Z");
function food(extra = {}) {
  return {
    id: "price-a",
    scopeId: "alice",
    receiptId: "receipt-a",
    canonicalKey: "carrot",
    packQuantity: 500,
    packUnit: "g",
    packCount: 1,
    packPrice: 2.4,
    market: "UK",
    currency: "GBP",
    retailer: "aldi",
    purchasedAt: "2026-11-04",
    observedAt: "2026-11-04T20:00:00Z",
    priceType: "regular",
    source: "reviewed_receipt",
    ...extra,
  };
}
function essential(extra = {}) {
  return {
    id: "essential-a",
    receiptId: "receipt-a",
    name: "Toilet rolls",
    quantity: 12,
    unit: "each",
    packQuantity: 6,
    packUnit: "each",
    packCount: 2,
    pricePaid: 6,
    market: "UK",
    currency: "GBP",
    retailer: "tesco",
    purchasedAt: "2026-11-04",
    confirmedAt: "2026-11-04T20:00:00Z",
    ...extra,
  };
}
function fixture({
  observations = [food()],
  essentials = [],
  receipts = [],
} = {}) {
  let currentActor = "alice",
    market = "UK",
    deleting = false,
    broken = false,
    calls = 0;
  const events = new Map(),
    projection = {
      version: 1,
      actorId: "alice",
      scope: { kind: "user", id: "alice" },
      priceObservations: observations,
      essentials,
      receipts,
    };
  const root = {
    BBPantryPolicy: policy,
    BBPriceV19: {
      canonical: (value) =>
        String(value)
          .toLowerCase()
          .replace(/^garlic cloves?$/, "garlic"),
    },
    BBHome: { actor: () => currentActor },
    bb307ActiveMarket: () => market,
    BBAccountDeletion: { isDeleting: () => deleting },
    BBReceiptInventory: {
      getCachedProjection() {
        calls++;
        if (broken) throw Error("Wrong account");
        return projection;
      },
    },
    addEventListener: (name, fn) => events.set(name, fn),
    queueMicrotask,
  };
  const api = create(root, { now: () => NOW });
  return {
    api,
    root,
    projection,
    events,
    get calls() {
      return calls;
    },
    actor: (value) => {
      currentActor = value;
    },
    market: (value) => {
      market = value;
    },
    deletion: () => {
      deleting = true;
    },
    failure: () => {
      broken = true;
    },
  };
}
test("confirmed receipt prices produce a compact historical label using canonical singular aliases", () => {
  const h = fixture(),
    before = JSON.stringify(h.projection),
    quote = h.api.get("Carrots");
  assert.equal(quote.amount, 2.4);
  assert.equal(quote.source, "receipt");
  assert.equal(quote.packQuantity, 500);
  assert.equal(h.api.label(quote), "Last paid £2.40 · 500 g · Aldi · 4 Nov");
  assert.equal(
    JSON.stringify(h.projection),
    before,
    "history lookup never mutates stock or price records",
  );
  assert.equal(h.api.get("Chicken"), null);
});
test("last actual purchase date wins over a later scan, insertion order or retailer change", () => {
  const h = fixture({
    observations: [
      food({
        id: "older-scan",
        packPrice: 9,
        purchasedAt: "2026-10-01",
        observedAt: "2026-11-05T10:00:00Z",
      }),
      food({
        id: "newer-purchase",
        packPrice: 1.8,
        retailer: "lidl",
        purchasedAt: "2026-11-03",
        observedAt: "2026-11-03T10:00:00Z",
      }),
    ],
  });
  const quote = h.api.get("Carrot");
  assert.equal(quote.amount, 1.8);
  assert.equal(quote.retailer, "lidl");
});
test("receipt metadata fills missing purchased dates and fallback timestamps are labelled recorded", () => {
  const h = fixture({
    observations: [
      food({ purchasedAt: null, observedAt: "2026-11-05T10:00:00Z" }),
    ],
    receipts: [{ receiptId: "receipt-a", purchasedAt: "2026-11-02" }],
  });
  assert.match(h.api.label(h.api.get("Carrots")), /2 Nov$/);
  h.projection.receipts = [];
  assert.match(h.api.label(h.api.get("Carrots")), /recorded 5 Nov$/);
});
test("food promotions remain clearly historical offers and cannot become regular estimates", () => {
  const h = fixture({
    observations: [
      food({
        packPrice: 1.25,
        priceType: "promotion",
        eligibleForRegularPrice: false,
      }),
    ],
  });
  const quote = h.api.get("Carrot");
  assert.equal(quote.promotion, true);
  assert.equal(quote.priceType, "promotion");
  assert.equal(
    h.api.label(quote),
    "Last paid £1.25 (offer) · 500 g · Aldi · 4 Nov",
  );
  assert.equal(quote.verifiedRetailQuote, undefined);
  assert.equal(quote.priceOverride, undefined);
});
test("multi-pack food uses its already computed pack price and household line totals divide once", () => {
  const h = fixture({
    observations: [food({ packCount: 3, packPrice: 2, pricePaid: 6 })],
    essentials: [essential()],
  });
  assert.equal(h.api.get("Carrots").amount, 2);
  assert.match(h.api.label(h.api.get("Carrots")), /£2\.00\/pack · 500 g/);
  const soap = h.api.get("Toilet roll");
  assert.equal(soap.amount, 3);
  assert.equal(soap.packQuantity, 6);
  assert.equal(soap.packCount, 2);
  assert.equal(
    h.api.label(soap),
    "Last paid £3.00/pack · 6 items · Tesco · 4 Nov",
  );
});
test("household metadata stays historical when price type is absent, with no guessed regular classification", () => {
  const h = fixture({
    observations: [],
    essentials: [essential({ priceType: undefined })],
  });
  assert.equal(h.api.get("Toilet paper").priceType, "unknown");
  assert.doesNotMatch(
    h.api.label(h.api.get("Toilet rolls")),
    /offer|regular|estimate/i,
  );
  h.projection.essentials[0].priceType = "promotion";
  assert.match(h.api.label(h.api.get("Toilet rolls")), /\(offer\)/);
});
test("household records can inherit the verified receipt context without reading local overrides", () => {
  const h = fixture({
    observations: [],
    essentials: [
      essential({
        market: undefined,
        currency: undefined,
        retailer: undefined,
        purchasedAt: undefined,
      }),
    ],
    receipts: [
      {
        receiptId: "receipt-a",
        market: "UK",
        currency: "GBP",
        retailer: "Aldi",
        purchasedAt: "2026-11-01",
      },
    ],
  });
  h.root.localStorage = {
    getItem() {
      throw Error("Legacy local price store must never be read");
    },
  };
  const quote = h.api.get("Toilet rolls");
  assert.equal(quote.amount, 3);
  assert.equal(quote.retailer, "Aldi");
  assert.match(h.api.label(quote), /1 Nov$/);
});
test("wrong market or currency cannot leak into the active regional label", () => {
  const h = fixture({
    observations: [
      food({
        market: "US",
        currency: "USD",
        retailer: "walmart",
        packPrice: 3,
      }),
    ],
  });
  assert.equal(h.api.get("Carrot"), null);
  h.market("US");
  assert.match(h.api.label(h.api.get("Carrot")), /^Last paid \$3\.00/);
  h.projection.priceObservations[0].currency = "GBP";
  assert.equal(h.api.get("Carrot"), null);
  h.root.BBReceiptHost = {
    getContext: () => ({ market: "US", currency: "GBP" }),
  };
  assert.equal(h.api.get("Carrot"), null);
});
test("US historical pack labels use shared customary display while stored quantities remain canonical", () => {
  const h = fixture({
    observations: [
      food({ market: "US", currency: "USD", packQuantity: 453.6 }),
    ],
  });
  h.market("US");
  let calls = 0;
  h.root.BBPantryDisplay = {
    format(name, quantity, unit, market) {
      calls++;
      assert.equal(quantity, 453.6);
      assert.equal(unit, "g");
      assert.equal(market, "US");
      return "1 lb";
    },
  };
  const quote = h.api.get("Carrots");
  assert.match(h.api.label(quote), /\$2\.40 · 1 lb/);
  assert.equal(calls, 1);
  assert.equal(quote.packQuantity, 453.6);
  assert.equal(quote.packUnit, "g");
  delete h.root.BBPantryDisplay;
  h.projection.priceObservations[0].packQuantity = 240;
  h.projection.priceObservations[0].packUnit = "ml";
  assert.match(h.api.label(h.api.get("Carrots")), /1 US cup/);
});
test("a per-pack price does not repeat a meaningless one-pack size and old dates include their year", () => {
  const h = fixture({
    essentials: [
      essential({
        packUnit: "pack",
        packQuantity: 1,
        quantity: 2,
        unit: "pack",
        purchasedAt: "2025-11-04",
      }),
    ],
  });
  assert.equal(
    h.api.label(h.api.get("Toilet rolls")),
    "Last paid £3.00/pack · Tesco · 4 Nov 2025",
  );
});
test("only receipt-sourced scoped observations are eligible, even if manual data has a newer price", () => {
  for (const patch of [
    { source: "user_price" },
    { source: "legacy_override" },
    { source: undefined },
    { scopeId: "bob" },
    { receiptId: "" },
    { kind: "essential" },
  ]) {
    const h = fixture({ observations: [food(patch)] });
    assert.equal(h.api.get("Carrots"), null, JSON.stringify(patch));
  }
  for (const patch of [
    { source: "user_price" },
    { kind: "food" },
    { scopeId: "bob" },
  ]) {
    const h = fixture({ observations: [], essentials: [essential(patch)] });
    assert.equal(h.api.get("Toilet rolls"), null);
  }
});
test("malformed quantity, price and date metadata is skipped instead of inventing a price", () => {
  const patches = [
    { packQuantity: 0 },
    { packQuantity: -1 },
    { packQuantity: "500" },
    { packQuantity: Infinity },
    { packUnit: "scoop" },
    { packCount: 0 },
    { packCount: 1.5 },
    { packCount: 10001 },
    { packPrice: "2.40" },
    { packPrice: -1 },
    { packPrice: Infinity },
    { packPrice: 100001 },
    { purchasedAt: "2026-02-31" },
    { purchasedAt: "yesterday" },
    { purchasedAt: "2030-11-05" },
    { purchasedAt: "2026-11-04T99:10:00Z" },
    { retailer: "<script>" },
  ];
  for (const patch of patches) {
    const h = fixture({ observations: [food(patch)] });
    assert.equal(h.api.get("Carrots"), null, JSON.stringify(patch));
  }
});
test("unknown pack metadata can describe a measured receipt line without guessing a shelf pack", () => {
  const h = fixture({
    observations: [],
    essentials: [
      essential({
        packQuantity: null,
        packUnit: null,
        packCount: null,
        quantity: 750,
        unit: "ml",
        pricePaid: 2.4,
        name: "Washing-up liquid",
      }),
    ],
  });
  const quote = h.api.get("Washing-up liquid");
  assert.equal(quote.priceBasis, "receipt-line");
  assert.equal(quote.amount, 2.4);
  assert.equal(quote.packQuantity, 750);
  assert.doesNotMatch(h.api.label(quote), /\/pack/);
});
test("valid tiny measured packs never display as a false zero quantity", () => {
  const h = fixture({ observations: [food({ packQuantity: 0.000001 })] });
  assert.match(h.api.label(h.api.get("Carrots")), /0\.000001 g/);
});
test("reader indexes a projection once per render and stops on actor, market, deletion or storage changes", async () => {
  const h = fixture(),
    reader = h.api.read();
  assert.equal(h.calls, 1);
  assert.ok(reader("Carrot"));
  assert.ok(reader("Carrots"));
  assert.equal(h.calls, 1);
  h.actor("bob");
  assert.equal(reader("Carrot"), null);
  h.actor("alice");
  h.market("US");
  assert.equal(reader("Carrot"), null);
  h.market("UK");
  h.events.get("storage")();
  assert.equal(reader("Carrot"), null);
  const fresh = h.api.read();
  assert.ok(fresh("Carrots"));
  await Promise.resolve();
  assert.equal(
    fresh("Carrots"),
    null,
    "a per-render reader is not a persistent price cache",
  );
  const latest = h.api.read();
  h.deletion();
  assert.equal(latest("Carrots"), null);
  assert.equal(h.api.get("Carrots"), null);
});
test("adapter failures, missing owner information and logged-out actors fail closed", () => {
  const h = fixture();
  h.failure();
  assert.equal(h.api.get("Carrot"), null);
  for (const patch of [
    { actorId: "bob" },
    { actorId: "guest" },
    { scope: { kind: "user", id: "bob" } },
    { scope: { kind: "global", id: "alice" } },
    { version: 2 },
  ]) {
    const x = fixture();
    Object.assign(x.projection, patch);
    assert.equal(x.api.get("Carrot"), null);
  }
  const guest = fixture();
  guest.actor("guest");
  assert.equal(guest.api.get("Carrot"), null);
});
test("the current actor can see guarded household-scope observations without mixing scopes", () => {
  const h = fixture({ observations: [food({ scopeId: "household-a" })] });
  h.projection.scope = { kind: "household", id: "household-a" };
  assert.equal(h.api.get("Carrots").amount, 2.4);
  h.projection.priceObservations[0].scopeId = "household-b";
  assert.equal(h.api.get("Carrots"), null);
});
test("the formatter rejects arbitrary objects and does not call the network or mutate stores", () => {
  const h = fixture();
  h.root.fetch = () => {
    throw Error("No network");
  };
  h.root.localStorage = {
    setItem() {
      throw Error("No mutations");
    },
  };
  assert.equal(h.api.label(null), "");
  assert.equal(h.api.label({ amount: 2, currency: "GBP" }), "");
  const quote = h.api.get("Carrots");
  assert.ok(Object.isFrozen(quote));
  assert.match(h.api.label(quote), /^Last paid/);
});
