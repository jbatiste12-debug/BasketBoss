/* Touch navigation delegates to the existing five bottom-tab controls. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window === "undefined" ? null : window, function () {
  "use strict";
  const NAV =
      '.shell nav.tabs,nav.bb-r6-cook-nav,nav[aria-label="Bottom navigation"]',
    ORDER = ["plan", "discover", "kitchen", "shop", "cook"];
  const VIEWS = {
    plan: "week",
    discover: "discover",
    kitchen: "shop",
    shop: "shop-list",
    cook: "cook",
  };
  const IGNORE =
    'a,button,input,textarea,select,label,nav,[role="tablist"],[contenteditable]:not([contenteditable="false"]),[role="slider"],[draggable="true"],[data-bb-swipe-ignore],#swipeCard,.swipe-card,[data-bb-plan-handle],summary.bbnext-day-toggle,canvas,video,audio';
  const MODALS =
    'dialog[open],[aria-modal="true"],.cook-overlay,#bb172Storefront,#bb172Onboarding,#bbNewOnboarding';
  function install(win) {
    if (win.BBTabSwipe?.version === 1) return win.BBTabSwipe;
    const doc = win.document;
    let gesture = null;
    const visible = (n) =>
      !!n &&
      !n.hidden &&
      n.isConnected !== false &&
      (!n.getClientRects ||
        Array.from(n.getClientRects()).some(
          (r) => r.width > 0 && r.height > 0,
        )) &&
      win.getComputedStyle(n).display !== "none" &&
      win.getComputedStyle(n).visibility !== "hidden";
    function blocked() {
      if (
        doc.body?.classList.contains("bb-plan-is-dragging") ||
        doc.activeElement?.matches?.(
          'input,textarea,select,[contenteditable="true"]',
        ) ||
        win.getSelection?.()?.isCollapsed === false
      )
        return true;
      const busy = doc.querySelector(
        '#bb15AiPremiumHub[data-phase="scanning"],#bb15AiPremiumHub[data-phase="creating"]',
      );
      if (visible(busy)) return true;
      return Array.from(doc.querySelectorAll(MODALS)).some(
        (n) =>
          !(
            n.id === "bbToolStage" &&
            doc.body?.classList.contains("bb-photo-meal-page")
          ) && visible(n),
      );
    }
    function key(n) {
      const k = n.dataset?.bbNavItem;
      if (ORDER.includes(k)) return k;
      const tab = n.dataset?.tab;
      if (tab)
        return {
          week: "plan",
          discover: "discover",
          shop: "kitchen",
          "shop-list": "shop",
          cook: "cook",
        }[tab];
      const label = (
        n.querySelector?.(".nav-label")?.textContent ||
        n.textContent ||
        ""
      )
        .trim()
        .toLowerCase();
      return {
        plan: "plan",
        discover: "discover",
        "at home": "kitchen",
        shop: "shop",
        cook: "cook",
      }[label];
    }
    function navigation() {
      for (const nav of doc.querySelectorAll(NAV)) {
        if (!visible(nav)) continue;
        const controls = Array.from(nav.children).filter((n) =>
            /^(BUTTON|A)$/.test(n.tagName),
          ),
          map = new Map(controls.map((n) => [key(n), n]));
        if (!ORDER.every((k) => map.has(k))) continue;
        const active =
          controls.find((n) => n.dataset?.bbNavCurrent === "true") ||
          controls.find((n) => n.getAttribute("aria-current") === "page") ||
          controls.find((n) => n.classList.contains("active"));
        let current = key(active || {});
        if (!current)
          current = {
            week: "plan",
            discover: "discover",
            shop: "kitchen",
            "shop-list": "shop",
            cook: "cook",
          }[doc.body?.dataset?.bbnextView];
        if (!current) return null;
        return { current, map };
      }
      return null;
    }
    function reserved(node) {
      if (node?.closest?.(IGNORE)) return true;
      for (
        let n = node;
        n && n !== doc.body && n !== doc.documentElement;
        n = n.parentElement
      ) {
        const css = win.getComputedStyle(n);
        if (
          /auto|scroll/.test(css.overflowX) &&
          n.scrollWidth > n.clientWidth + 4
        )
          return true;
      }
      return false;
    }
    const cancel = () => {
      gesture = null;
    };
    function start(event) {
      cancel();
      if (
        event.isTrusted === false ||
        event.defaultPrevented ||
        event.touches?.length !== 1 ||
        blocked() ||
        reserved(event.target)
      )
        return;
      const p = event.touches[0],
        width = win.innerWidth;
      if (p.clientX < 24 || p.clientX > width - 24) return;
      const nav = navigation();
      if (!nav) return;
      gesture = {
        id: p.identifier,
        x: p.clientX,
        y: p.clientY,
        at: Date.now(),
        timestamp: event.timeStamp || 0,
        view: nav.current,
        scroll: win.scrollY || 0,
      };
    }
    function move(event) {
      if (!gesture) return;
      // WebKit/Chromium may deliver a coalesced move after the next touch starts.
      if (event.timeStamp && event.timeStamp < gesture.timestamp) return;
      if (
        event.defaultPrevented ||
        event.touches?.length !== 1 ||
        Date.now() - gesture.at > 900
      ) {
        cancel();
        return;
      }
      const p = event.touches[0],
        dx = p.clientX - gesture.x,
        dy = p.clientY - gesture.y;
      if (
        p.identifier !== gesture.id ||
        (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx))
      )
        cancel();
    }
    function end(event) {
      if (gesture && event.timeStamp && event.timeStamp < gesture.timestamp)
        return;
      const g = gesture;
      cancel();
      if (
        !g ||
        event.isTrusted === false ||
        event.defaultPrevented ||
        event.touches?.length ||
        blocked() ||
        Date.now() - g.at > 900 ||
        Math.abs((win.scrollY || 0) - g.scroll) > 12
      )
        return;
      const p = Array.from(event.changedTouches || []).find(
        (p) => p.identifier === g.id,
      );
      if (!p) return;
      const dx = p.clientX - g.x,
        dy = p.clientY - g.y;
      if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const nav = navigation();
      if (!nav || nav.current !== g.view) return;
      const index = ORDER.indexOf(nav.current) + (dx < 0 ? 1 : -1),
        next = ORDER[index],
        control = nav.map.get(next);
      if (
        !control ||
        control.disabled ||
        control.getAttribute("aria-disabled") === "true"
      )
        return;
      if (win.BBTabViewport?.activate) win.BBTabViewport.activate(control);
      else {
        control.click();
        win.BBTabViewport?.reset?.({ view: VIEWS[next] });
      }
    }
    for (const [type, fn] of [
      ["touchstart", start],
      ["touchmove", move],
      ["touchend", end],
      ["touchcancel", cancel],
    ])
      doc.addEventListener(type, fn, { passive: true });
    const api = {
      version: 1,
      destroy() {
        cancel();
        for (const [type, fn] of [
          ["touchstart", start],
          ["touchmove", move],
          ["touchend", end],
          ["touchcancel", cancel],
        ])
          doc.removeEventListener(type, fn);
      },
    };
    win.BBTabSwipe = api;
    return api;
  }
  return Object.freeze({ install });
});
