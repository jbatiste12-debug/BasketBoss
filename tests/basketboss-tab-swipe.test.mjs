import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { install } = createRequire(import.meta.url)("../bb-tab-swipe.js");
function fixture() {
  const events = new Map(),
    calls = [],
    resets = [];
  let current = "plan",
    modal = false,
    ignore = false,
    horizontal = false,
    selected = false;
  const style = {
    display: "block",
    visibility: "visible",
    overflowX: "visible",
  };
  const body = {
      dataset: { bbnextView: "week" },
      classList: { contains: () => false },
    },
    target = {
      closest: () => (ignore ? target : null),
      parentElement: body,
      style,
      clientWidth: 100,
      scrollWidth: 100,
    };
  const controls = ["plan", "discover", "kitchen", "shop", "cook"].map(
    (key) => ({
      tagName: "BUTTON",
      dataset: { bbNavItem: key },
      hidden: false,
      isConnected: true,
      style,
      disabled: false,
      getAttribute: () => null,
      classList: { contains: () => false },
      getClientRects: () => [{ width: 100, height: 44 }],
      click() {
        calls.push(key);
        current = key;
      },
    }),
  );
  const nav = {
    children: controls,
    hidden: false,
    isConnected: true,
    style,
    getClientRects: () => [{ width: 390, height: 60 }],
  };
  const doc = {
    body,
    documentElement: {},
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector.includes("nav.tabs")
        ? [nav]
        : modal
          ? [
              {
                id: "modal",
                style,
                hidden: false,
                isConnected: true,
                getClientRects: () => [{ width: 100, height: 100 }],
              },
            ]
          : [],
    addEventListener: (type, fn) => events.set(type, fn),
    removeEventListener: (type) => events.delete(type),
  };
  const win = {
    document: doc,
    innerWidth: 390,
    scrollY: 0,
    getComputedStyle: (n) => n.style || style,
    getSelection: () => ({ isCollapsed: !selected }),
    BBTabViewport: {
      activate: (n) => {
        n.click();
        resets.push(n.dataset.bbNavItem);
      },
    },
  };
  function sync() {
    for (const n of controls)
      n.dataset.bbNavCurrent = String(n.dataset.bbNavItem === current);
  }
  const api = install(win);
  sync();
  const touch = (x, y = 200) => ({ identifier: 1, clientX: x, clientY: y });
  const fire = (type, x, y, extra = {}) => {
    sync();
    const p = touch(x, y);
    events.get(type)?.({
      isTrusted: true,
      target,
      touches: type === "touchend" ? [] : [p],
      changedTouches: [p],
      ...extra,
    });
  };
  return {
    win,
    doc,
    controls,
    events,
    fire,
    api,
    calls,
    resets,
    start: (x = 210, y = 200) => fire("touchstart", x, y),
    move: (x, y) => fire("touchmove", x, y),
    end: (x = 90, y = 200) => fire("touchend", x, y),
    set: (key) => {
      current = key;
      sync();
    },
    modal: () => (modal = true),
    ignore: () => (ignore = true),
    horizontal: () => {
      target.style = { ...style, overflowX: "auto" };
      target.scrollWidth = 300;
    },
    selected: () => (selected = true),
    keyboard: () => (doc.activeElement = { matches: () => true }),
    cancel: () => events.get("touchcancel")?.(),
    multi: () =>
      fire("touchmove", 150, 200, {
        touches: [touch(150), { identifier: 2, clientX: 200, clientY: 200 }],
      }),
  };
}
test("left/right gestures activate existing main-tab controls in order without wrapping", () => {
  const h = fixture();
  h.start();
  h.end();
  assert.deepEqual(h.calls, ["discover"]);
  h.start();
  h.end(330);
  assert.deepEqual(h.calls, ["discover", "plan"]);
  h.start();
  h.end(330);
  assert.equal(h.calls.length, 2);
  h.set("cook");
  h.start();
  h.end();
  assert.equal(h.calls.length, 2);
  h.start();
  h.end(330);
  assert.equal(h.calls.at(-1), "shop");
  assert.deepEqual(h.calls, h.resets);
});
test("vertical scrolling, short gestures, and diagonal drags do not change page", () => {
  for (const [move, end] of [
    [
      [205, 240],
      [80, 280],
    ],
    [
      [190, 200],
      [160, 200],
    ],
    [
      [160, 260],
      [100, 300],
    ],
  ]) {
    const h = fixture();
    h.start();
    h.move(...move);
    h.end(...end);
    assert.equal(h.calls.length, 0);
  }
});
test("delayed coalesced events from the previous touch cannot cancel a new swipe", () => {
  const h = fixture();
  h.set("discover");
  h.fire("touchstart", 130, 200, { timeStamp: 2000 });
  h.fire("touchmove", 95, 120, { timeStamp: 1500 });
  h.fire("touchend", 95, 120, { timeStamp: 1501 });
  h.fire("touchmove", 230, 200, { timeStamp: 2100 });
  h.fire("touchend", 295, 200, { timeStamp: 2200 });
  assert.deepEqual(h.calls, ["plan"]);
});
for (const method of ["modal", "ignore", "horizontal", "selected", "keyboard"])
  test("does not steal gestures from " + method, () => {
    const h = fixture();
    h[method]();
    h.start();
    h.end();
    assert.equal(h.calls.length, 0);
  });
test("screen-edge history gestures, multitouch, cancellation and changed pages are preserved", () => {
  for (const mode of ["edge", "multi", "cancel", "changed"]) {
    const h = fixture();
    h.start(mode === "edge" ? 10 : 210);
    if (mode === "multi") h.multi();
    if (mode === "cancel") h.cancel();
    if (mode === "changed") h.set("kitchen");
    h.end(90);
    assert.equal(h.calls.length, 0, mode);
  }
});
test("opening an overlay after touch start cancels navigation", () => {
  const h = fixture();
  h.start();
  h.modal();
  h.end();
  assert.equal(h.calls.length, 0);
});
test("disabled destination cannot be activated and teardown removes listeners", () => {
  const h = fixture();
  h.controls[1].disabled = true;
  h.start();
  h.end();
  assert.equal(h.calls.length, 0);
  assert.equal(install(h.win), h.api);
  h.api.destroy();
  assert.equal(h.events.size, 0);
});
