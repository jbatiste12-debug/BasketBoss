/* Capture Auth credentials before analytics, then remove them from the URL.
   Only Supabase verification may establish an app session. No URL grants access. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window === "undefined" ? null : window, function () {
  "use strict";
  const KEY = "basketboss_auth_callback_v1",
    TTL = 600000;
  const FIELDS = [
    "sb_flow_id",
    "code",
    "token_hash",
    "type",
    "bb_auth",
    "access_token",
    "refresh_token",
    "expires_in",
    "expires_at",
    "token_type",
    "provider_token",
    "provider_refresh_token",
    "error",
    "error_code",
    "error_description",
  ];
  function parse(value, base) {
    let url;
    try {
      url = new URL(value, base);
    } catch {
      return null;
    }
    if (
      !(
        (url.protocol === "https:" &&
          ["basketboss.co.uk", "www.basketboss.co.uk"].includes(
            url.hostname,
          )) ||
        (url.protocol === "capacitor:" && url.hostname === "localhost") ||
        (url.protocol === "basketboss:" &&
          url.hostname === "auth" &&
          url.pathname === "/callback")
      )
    )
      return null;
    const hash = new URLSearchParams(url.hash.slice(1)),
      query = url.searchParams,
      get = (key) => hash.get(key) || query.get(key) || "";
    if (
      !["code", "token_hash", "access_token", "error", "error_code"].some(
        (key) => get(key),
      )
    )
      return null;
    const fields = Object.fromEntries(
      FIELDS.filter((key) => !key.startsWith("provider_"))
        .map((key) => [key, get(key)])
        .filter(([, value]) => value),
    );
    const kinds = ["code", "token_hash", "access_token"].filter(
      (key) => fields[key],
    );
    if (kinds.length > 1) return { error: "ambiguous_callback" };
    return fields;
  }
  function install(win) {
    if (win.BBAuthCallbackBridge) return win.BBAuthCallbackBridge;
    let memory = null;
    function capture(value) {
      const fields = parse(value, win.location.href);
      if (!fields) return false;
      memory = { fields, createdAt: Date.now() };
      try {
        win.sessionStorage.setItem(KEY, JSON.stringify(memory));
      } catch {}
      return true;
    }
    function consume() {
      let entry = memory;
      memory = null;
      try {
        if (!entry)
          entry = JSON.parse(win.sessionStorage.getItem(KEY) || "null");
        win.sessionStorage.removeItem(KEY);
      } catch {}
      if (
        !entry ||
        !Number.isFinite(entry.createdAt) ||
        Date.now() - entry.createdAt > TTL ||
        entry.createdAt > Date.now() + 1000
      )
        return null;
      return entry.fields;
    }
    function pending() {
      try {
        return !!memory || !!win.sessionStorage.getItem(KEY);
      } catch {
        return !!memory;
      }
    }
    function scrub() {
      let url;
      try {
        url = new URL(win.location.href);
      } catch {
        return;
      }
      for (const key of FIELDS) url.searchParams.delete(key);
      const hash = new URLSearchParams(url.hash.slice(1));
      for (const key of FIELDS) hash.delete(key);
      url.hash = hash.toString();
      try {
        win.history.replaceState(
          win.history.state,
          "",
          url.pathname + url.search + url.hash,
        );
      } catch {}
    }
    const controller = {
      capture,
      consume,
      pending,
      captureCurrent() {
        if (!capture(win.location.href)) return false;
        scrub();
        return true;
      },
    };
    win.BBAuthCallbackBridge = controller;
    if (capture(win.location.href)) {
      scrub();
      const pathname = win.location.pathname,
        app =
          /\/(?:app|app\.html|index\.html)$/.test(pathname) &&
          !!win.document.querySelector?.("#cloud-auth");
      // During head parsing the account form is not available yet: entry paths
      // identify app documents; the public / and welcome/index routes redirect.
      const native = win.location.protocol === "capacitor:";
      const appPath =
        /^\/(?:app|app\.html)$/.test(pathname) ||
        (native && pathname === "/index.html");
      if (!appPath && !app) {
        let saved = false;
        try {
          saved = !!win.sessionStorage.getItem(KEY);
        } catch {}
        if (saved)
          win.location.replace(
            native
              ? "index.html?bb_auth_callback=1"
              : "/app?bb_auth_callback=1",
          );
        else
          win.document.addEventListener(
            "DOMContentLoaded",
            () => {
              const p = win.document.createElement("p");
              p.textContent =
                "Your browser could not keep this confirmation securely. Enable site storage, reopen BasketBoss and request a new email.";
              win.document.body.prepend(p);
            },
            { once: true },
          );
      }
    }
    return controller;
  }
  return Object.freeze({ parse, install });
});
