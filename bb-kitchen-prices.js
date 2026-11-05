/* Read-only historical receipt prices. Nothing here becomes a current shelf
   quote, an estimate override, a stock balance or a network request. */
(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports)
    module.exports = Object.freeze({ create: factory, ...api });
  if (root) root.BBKitchenPrices = api;
})(typeof window === "undefined" ? null : window, function (root, options) {
  "use strict";
  const now = options?.now || Date.now;
  const CURRENCIES = Object.freeze({
    UK: "GBP",
    Guernsey: "GBP",
    Jersey: "GBP",
    US: "USD",
  });
  const COUNT_UNITS = new Set([
    "each",
    "pack",
    "bag",
    "tin",
    "bunch",
    "loaf",
    "clove",
    "bottle",
    "jar",
    "roll",
    "pair",
  ]);
  const UNITS = new Set(["g", "ml", "kg", "l", ...COUNT_UNITS]);
  const aliases = Object.freeze({
    "toilet roll": "toilet rolls",
    "toilet paper": "toilet rolls",
    toothbrushes: "toothbrush",
    nappy: "nappies",
    "bin bag": "bin bags",
    "refuse bags": "bin bags",
  });
  const text = (value, max = 100) =>
    typeof value === "string"
      ? value
          .normalize("NFKC")
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, max)
      : "";
  const number = (value, { zero = false, max = 1000000 } = {}) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value <= max &&
    (zero ? value >= 0 : value > 0);
  const unit = (value) => {
    const raw = text(value, 20).toLowerCase();
    return (
      {
        count: "each",
        counts: "each",
        unit: "each",
        units: "each",
        item: "each",
        items: "each",
        pieces: "each",
        packs: "pack",
        bags: "bag",
        tins: "tin",
        cans: "tin",
        can: "tin",
        grams: "g",
        litres: "l",
        liters: "l",
        bottles: "bottle",
        rolls: "roll",
      }[raw] || raw
    );
  };
  let generation = 0;
  const invalidate = () => {
    generation++;
  };
  for (const event of [
    "basketboss:session-changed",
    "basketboss:account-deletion-started",
    "basketboss:account-deletion-deleted",
    "basketboss:market-changed",
    "basketboss:receipt-confirmed",
    "basketboss:receipt-saved",
    "storage",
  ])
    root?.addEventListener?.(event, invalidate);
  function canonical(name) {
    if (typeof name !== "string" || !name.trim() || name.length > 200)
      return "";
    let value;
    try {
      value = root?.BBPantryPolicy?.canonicalName
        ? root.BBPantryPolicy.canonicalName(name, root?.BBPriceV19?.canonical)
        : root?.BBPriceV19?.canonical
          ? root.BBPriceV19.canonical(name)
          : name;
    } catch {
      return "";
    }
    const key = text(value, 200)
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\s+/g, " ");
    return aliases[key] || key;
  }
  function actor() {
    try {
      if (typeof root?.BBHome?.actor === "function") return root.BBHome.actor();
      if (typeof root?.BasketBossSession?.read === "function")
        return root.BasketBossSession.read()?.user?.id || "guest";
      return undefined;
    } catch {
      return null;
    }
  }
  function context() {
    try {
      const given =
        root?.BBReceiptHost?.getContext?.() ||
        root?.BBReceiptHost?.context?.() ||
        {};
      const market = root?.bb307ActiveMarket?.() || given.market;
      if (
        !Object.hasOwn(CURRENCIES, market) ||
        (given.currency !== undefined && given.currency !== CURRENCIES[market])
      )
        return null;
      return { market, currency: CURRENCIES[market], actor: actor() };
    } catch {
      return null;
    }
  }
  function blocked() {
    try {
      return root?.BBAccountDeletion?.isDeleting?.() === true;
    } catch {
      return true;
    }
  }
  function date(value) {
    if (
      typeof value !== "string" ||
      value.length > 50 ||
      !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d{1,9})?)?(?:Z|[+-]\d\d:?\d\d))?$/.test(
        value,
      )
    )
      return null;
    const prefix = value.slice(0, 10),
      calendar = new Date(prefix + "T00:00:00Z"),
      time = Date.parse(value);
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(calendar.getTime()) ||
      calendar.toISOString().slice(0, 10) !== prefix ||
      time < Date.UTC(2000, 0, 1) ||
      time > now() + 86400000
    )
      return null;
    return { time, value, day: prefix };
  }
  function recordDate(row, receipt) {
    for (const value of [row.purchasedAt, receipt?.purchasedAt])
      if (value !== undefined && value !== null && value !== "")
        return date(value) ? { ...date(value), kind: "purchased" } : null;
    for (const value of [row.observedAt, row.confirmedAt, receipt?.confirmedAt])
      if (value !== undefined && value !== null && value !== "")
        return date(value) ? { ...date(value), kind: "recorded" } : null;
    return null;
  }
  function pack(row) {
    const supplied = row.packCount !== undefined && row.packCount !== null;
    const count = supplied ? row.packCount : 1;
    if (!Number.isInteger(count) || count < 1 || count > 10000) return null;
    let quantity = row.packQuantity,
      kind = unit(row.packUnit),
      basis = "pack";
    if (!number(quantity) || !UNITS.has(kind)) {
      if (
        (row.packQuantity !== undefined && row.packQuantity !== null) ||
        (row.packUnit !== undefined &&
          row.packUnit !== null &&
          row.packUnit !== "")
      )
        return null;
      if (!number(row.quantity) || !UNITS.has(unit(row.unit))) return null;
      quantity = row.quantity / count;
      kind = unit(row.unit);
      basis = supplied ? "pack" : "receipt-line";
    }
    if (
      !number(quantity) ||
      quantity * (["kg", "l"].includes(kind) ? 1000 : 1) > 1000000 ||
      (COUNT_UNITS.has(kind) && !Number.isInteger(quantity))
    )
      return null;
    return {
      packQuantity: quantity,
      packUnit: kind,
      packCount: count,
      priceBasis: basis,
    };
  }
  function candidate(row, receipt, scope, active, { essential = false } = {}) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      !text(row.receiptId, 120)
    )
      return null;
    if (
      !essential &&
      (row.source !== "reviewed_receipt" ||
        row.scopeId !== scope.id ||
        (row.kind !== undefined && row.kind !== "food"))
    )
      return null;
    if (
      essential &&
      ((row.scopeId !== undefined && row.scopeId !== scope.id) ||
        (row.kind !== undefined && row.kind !== "essential") ||
        (row.source !== undefined &&
          !["receipt", "reviewed_receipt"].includes(row.source)))
    )
      return null;
    const market = row.market ?? receipt?.market,
      currency = row.currency ?? receipt?.currency;
    if (market !== active.market || currency !== active.currency) return null;
    const retailer = text(row.retailer ?? receipt?.retailer, 60);
    if (!retailer || /[<>]/.test(retailer)) return null;
    const purchased = recordDate(row, receipt),
      contents = pack(row);
    if (!purchased || !contents) return null;
    const name = canonical(
      essential ? row.name || row.productName : row.canonicalKey,
    );
    if (!name) return null;
    let amount;
    if (essential) {
      if (!number(row.pricePaid, { zero: true, max: 100000 })) return null;
      amount = row.pricePaid / contents.packCount;
    } else if (number(row.packPrice, { zero: true, max: 100000 }))
      amount = row.packPrice;
    else if (number(row.pricePaid, { zero: true, max: 100000 }))
      amount = row.pricePaid / contents.packCount;
    else return null;
    if (!number(amount, { zero: true, max: 100000 })) return null;
    const priceType = ["regular", "promotion", "unknown"].includes(
      row.priceType,
    )
      ? row.priceType
      : "unknown";
    const observed =
      date(row.observedAt || row.confirmedAt || receipt?.confirmedAt || "")
        ?.time || purchased.time;
    return Object.freeze({
      name,
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
      currency,
      market,
      retailer,
      ...contents,
      date: purchased.value,
      dateKind: purchased.kind,
      time: purchased.time,
      observedAt: observed,
      priceType,
      promotion: priceType === "promotion",
      source: "receipt",
      receiptId: row.receiptId,
    });
  }
  function read() {
    const empty = () => null;
    if (blocked()) return empty;
    const active = context(),
      adapter = root?.BBReceiptInventory;
    if (!active || typeof adapter?.getCachedProjection !== "function")
      return empty;
    let projection;
    try {
      projection = adapter.getCachedProjection();
    } catch {
      return empty;
    }
    if (
      !projection ||
      projection.version !== 1 ||
      !["user", "household"].includes(projection.scope?.kind) ||
      typeof projection.scope.id !== "string" ||
      !projection.scope.id ||
      typeof projection.actorId !== "string" ||
      !projection.actorId ||
      projection.actorId === "guest" ||
      (active.actor !== undefined && active.actor !== projection.actorId) ||
      (projection.scope.kind === "user" &&
        projection.scope.id !== projection.actorId)
    )
      return empty;
    const receipts = new Map();
    for (const receipt of Array.isArray(projection.receipts)
      ? projection.receipts.slice(0, 500)
      : [])
      if (receipt && typeof receipt.receiptId === "string")
        receipts.set(receipt.receiptId, receipt);
    const result = new Map();
    for (const [rows, essential] of [
      [projection.priceObservations, false],
      [projection.essentials, true],
    ])
      for (const row of Array.isArray(rows) ? rows.slice(0, 2000) : []) {
        const quote = candidate(
          row,
          receipts.get(row?.receiptId),
          projection.scope,
          active,
          { essential },
        );
        if (!quote) continue;
        const previous = result.get(quote.name);
        if (
          !previous ||
          quote.time > previous.time ||
          (quote.time === previous.time &&
            quote.observedAt > previous.observedAt)
        )
          result.set(quote.name, quote);
      }
    const pin = generation;
    let valid = true;
    // A reader belongs to one synchronous render, not a retained price cache.
    const microtask = root?.queueMicrotask || globalThis.queueMicrotask;
    if (typeof microtask === "function")
      microtask.call(root || globalThis, () => {
        valid = false;
      });
    return (name) => {
      if (
        !valid ||
        generation !== pin ||
        blocked() ||
        root?.BBReceiptInventory !== adapter
      )
        return null;
      const current = context();
      if (
        !current ||
        current.market !== active.market ||
        current.currency !== active.currency ||
        current.actor !== active.actor
      )
        return null;
      return result.get(canonical(name)) || null;
    };
  }
  function get(name) {
    return read()(name);
  }
  function retailerLabel(value) {
    const raw = text(value, 60);
    return raw === raw.toLowerCase() || raw === raw.toUpperCase()
      ? raw
          .toLowerCase()
          .replace(/(?:^|\s)[a-z]/g, (part) => part.toUpperCase())
      : raw;
  }
  function sizeLabel(quote) {
    const quantity = quote.packQuantity,
      unit = quote.packUnit,
      number = (value) =>
        new Intl.NumberFormat(quote.market === "US" ? "en-US" : "en-GB", {
          maximumFractionDigits: 6,
        }).format(value);
    if (quote.market === "US" && ["g", "kg", "ml", "l"].includes(unit)) {
      try {
        const formatted = root?.BBPantryDisplay?.format?.(
          quote.name,
          quantity,
          unit,
          "US",
        );
        if (formatted && !/^0(?:\.0+)?\s/.test(formatted))
          return formatted.replace(/^1 US cups$/, "1 US cup");
      } catch {}
      const amount = quantity * (["kg", "l"].includes(unit) ? 1000 : 1),
        weight = ["g", "kg"].includes(unit);
      const value =
        amount /
        (weight ? (amount >= 453.6 ? 453.6 : 28.35) : amount >= 60 ? 240 : 30);
      if (value < 0.000001) return number(quantity) + " " + unit;
      return (
        number(value) +
        (weight
          ? amount >= 453.6
            ? " lb"
            : " oz"
          : amount >= 60
            ? " US cup" + (Math.abs(value - 1) < 0.0000001 ? "" : "s")
            : " fl oz")
      );
    }
    return (
      number(quantity) +
      " " +
      (unit === "each" ? "item" + (quantity === 1 ? "" : "s") : unit)
    );
  }
  function label(quote) {
    if (
      !quote ||
      quote.source !== "receipt" ||
      !number(quote.amount, { zero: true, max: 100000 }) ||
      CURRENCIES[quote.market] !== quote.currency ||
      !date(quote.date) ||
      !number(quote.packQuantity) ||
      quote.packQuantity * (["kg", "l"].includes(quote.packUnit) ? 1000 : 1) >
        1000000 ||
      !UNITS.has(quote.packUnit)
    )
      return "";
    const locale = quote.market === "US" ? "en-US" : "en-GB",
      price = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: quote.currency,
      }).format(quote.amount);
    const calendar = new Date(quote.date.slice(0, 10) + "T12:00:00Z"),
      year =
        calendar.getUTCFullYear() !== new Date(now()).getUTCFullYear()
          ? "numeric"
          : undefined;
    const day = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year,
      timeZone: "UTC",
    }).format(calendar);
    const perPack = quote.priceBasis === "pack" && quote.packCount > 1,
      contents =
        perPack && quote.packUnit === "pack" && quote.packQuantity === 1
          ? ""
          : " · " + sizeLabel(quote);
    return (
      "Last paid " +
      price +
      (perPack ? "/pack" : "") +
      (quote.promotion ? " (offer)" : "") +
      contents +
      " · " +
      retailerLabel(quote.retailer) +
      " · " +
      (quote.dateKind === "recorded" ? "recorded " : "") +
      day
    );
  }
  return Object.freeze({ read, get, label });
});
