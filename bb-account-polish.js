/* Presentation for existing Settings and account controls. Authentication, saved
 * data, memberships and destructive actions stay with their original handlers. */
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc || root.BBAccountPolish) return;
  const icons = {
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9.5 3-.6 2.1-2 .9-2-.5-2.4 4.1 1.5 1.6v2.4L2.5 15l2.4 4.1 2-.5 2 .9.6 2.1h5l.6-2.1 2-.9 2 .5 2.4-4.1-1.5-1.5V11l1.5-1.5-2.4-4.1-2 .5-2-.9-.6-2.1h-5Z"/><circle cx="12" cy="12.2" r="3.2"/></svg>',
    account: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>',
    backup: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8a7 7 0 0 1 12-3l2 2M19 3v4h-4M19 16a7 7 0 0 1-12 3l-2-2M5 21v-4h4M12 8v8m-3-3 3 3 3-3"/></svg>',
    preferences: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3" fill="var(--bbap-card,#fffdf7)"/><circle cx="16" cy="17" r="3" fill="var(--bbap-card,#fffdf7)"/></svg>'
  };
  const state = { panel: null, opened: false, focusBack: null, queued: false, viewportFrame: null, background: [], scrollX: 0, scrollY: 0 };
  function fitAccountViewport() {
    state.viewportFrame = null;
    if (!state.opened || !state.panel?.classList.contains('open')) return;
    const view = root.visualViewport;
    const height = Math.max(1, Math.min(Number(view?.height) || root.innerHeight, root.innerHeight));
    const width = Math.max(1, Math.min(Number(view?.width) || root.innerWidth, root.innerWidth));
    for (const [name, value] of Object.entries({ height, width, top: Math.max(0, Number(view?.offsetTop) || 0), left: Math.max(0, Number(view?.offsetLeft) || 0) })) {
      state.panel.style.setProperty('--bbap-viewport-' + name, value + 'px');
    }
    const card = doc.getElementById('cloud-card'), input = doc.activeElement;
    if (!card?.contains(input) || !input.matches?.('input,textarea,select')) return;
    const box = card.getBoundingClientRect(), field = input.getBoundingClientRect();
    const top = box.top + 52, bottom = box.bottom - 12;
    let delta = field.top < top ? field.top - top : field.bottom > bottom ? field.bottom - bottom : 0;
    const login = doc.getElementById('cloud-login');
    if (input.id === 'cloud-password' && login?.getClientRects().length) {
      delta += Math.min(Math.max(0, login.getBoundingClientRect().bottom - delta - bottom), Math.max(0, field.top - delta - top));
    }
    if (delta) card.scrollTop += delta;
  }
  function scheduleViewport() {
    if (state.opened && state.viewportFrame === null) state.viewportFrame = root.requestAnimationFrame(fitAccountViewport);
  }
  function holdAccountBackground() {
    state.scrollX = root.scrollX || 0; state.scrollY = root.scrollY || 0;
    doc.documentElement.style.setProperty('--bbap-page-top', -state.scrollY + 'px');
    doc.documentElement.classList.add('bb-account-open');
    state.background = [...doc.querySelectorAll('.shell,.bbui-settings-overlay,#bbNewOnboarding')].filter(node => !node.contains(state.panel)).map(node => ({ node, inert: node.hasAttribute('inert') }));
    for (const { node } of state.background) node.setAttribute('inert', '');
    fitAccountViewport();
  }
  function releaseAccountBackground() {
    if (state.viewportFrame !== null) root.cancelAnimationFrame(state.viewportFrame);
    state.viewportFrame = null;
    if (state.panel?.contains(doc.activeElement)) doc.activeElement.blur?.();
    for (const { node, inert } of state.background) if (!inert) node.removeAttribute('inert');
    state.background = [];
    doc.documentElement.classList.remove('bb-account-open');
    doc.documentElement.style.removeProperty('--bbap-page-top');
    root.scrollTo(state.scrollX, state.scrollY);
  }
  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function setText(node, value) { if (node && node.textContent !== value) node.textContent = value; }
  function decorateSettings() {
    const panel = doc.querySelector('.bbui-settings-panel');
    if (!panel || panel.dataset.bbAccountPolish) return;
    panel.dataset.bbAccountPolish = 'settings';
    const heading = panel.querySelector('.bbui-settings-heading');
    const title = panel.querySelector('#bbuiSettingsTitle');
    if (heading && title) {
      const copy = element('div', 'bbap-heading-copy');
      heading.insertBefore(copy, title);
      copy.append(element('p', 'bbap-eyebrow', 'YOUR BASKETBOSS'));
      setText(title, 'Settings');
      copy.append(title, element('p', 'bbap-heading-note', 'Your account, preferences and a little help.'));
    }
    for (const [id, titleText, icon] of [
      ['bbuiAccountSection', 'Account & setup', 'account'],
      ['bbuiStorageSection', 'Your backups', 'backup'],
      ['bbuiLinksSection', 'Preferences & support', 'preferences']
    ]) {
      const section = doc.getElementById(id), titleNode = section?.querySelector('h3');
      if (!titleNode) continue;
      setText(titleNode, titleText);
      const mark = element('span', 'bbap-section-icon'); mark.setAttribute('aria-hidden', 'true'); mark.innerHTML = icons[icon];
      titleNode.prepend(mark);
      section.prepend(titleNode);
    }
    const tabs = [['bbuiSettingsTab', 'Settings'], ['bbuiTutorialsTab', 'Guides']];
    for (const [id, label] of tabs) setText(doc.getElementById(id), label);
  }
  function visibleControls(panel) {
    return [...panel.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]')]
      .filter(node => !node.hidden && node.getClientRects().length > 0);
  }
  function focusAccount() {
    const panel = state.panel;
    if (!panel?.classList.contains('open')) return;
    const email = doc.getElementById('cloud-email');
    const first = email?.getClientRects().length && !email.disabled ? email : visibleControls(panel).find(node => node.id !== 'cloud-close');
    (first || doc.getElementById('cloud-close'))?.focus?.({ preventScroll: true });
  }
  function syncAccount() {
    const panel = doc.getElementById('cloud-panel'), card = doc.getElementById('cloud-card');
    if (!panel || !card) return;
    if (!card.dataset.bbAccountPolish) {
      card.dataset.bbAccountPolish = 'account';
      panel.setAttribute('aria-label', 'BasketBoss account');
      const title = card.querySelector('h2');
      if (title) {
        title.id = title.id || 'bbapAccountTitle';
        panel.setAttribute('aria-labelledby', title.id);
        const mark = element('div', 'bbap-account-mark'); mark.setAttribute('aria-hidden', 'true'); mark.innerHTML = icons.account;
        card.insertBefore(mark, title);
        card.insertBefore(element('p', 'bbap-eyebrow', 'YOUR BASKETBOSS ACCOUNT'), title);
        const note = element('p', 'bbap-account-note'); note.id = 'bbapAccountIntro'; title.after(note);
      }
      const close = doc.getElementById('cloud-close');
      close?.setAttribute('aria-label', 'Close account');
      const email = doc.getElementById('cloud-email');
      email?.setAttribute('inputmode', 'email'); email?.setAttribute('autocapitalize', 'none'); email?.setAttribute('spellcheck', 'false');
      const status = doc.getElementById('cloud-status'); status?.setAttribute('role', 'status'); status?.setAttribute('aria-live', 'polite');
      const message = doc.getElementById('cloud-message'); message?.setAttribute('role', 'status'); message?.setAttribute('aria-live', 'polite');
      panel.addEventListener('keydown', event => {
        if (!panel.classList.contains('open')) return;
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); doc.getElementById('cloud-close')?.click();
        } else if (event.key === 'Tab') {
          const controls = visibleControls(panel); if (!controls.length) return;
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      });
      panel.addEventListener('focusin', scheduleViewport);
      state.panel = panel;
      const observer = new root.MutationObserver(schedule);
      observer.observe(panel, { attributes: true, attributeFilter: ['class', 'hidden'], subtree: true });
    }
    const signedIn = doc.getElementById('cloud-signed')?.hidden === false;
    const title = card.querySelector('h2');
    setText(title, signedIn ? 'Your account.' : 'Welcome back.');
    setText(doc.getElementById('bbapAccountIntro'), signedIn ? 'Your plans, your account, your choices.' : 'Sign in to access your saved cloud plan.');
    const opened = panel.classList.contains('open');
    const wasOpened = state.opened;
    state.opened = opened;
    if (opened && !wasOpened) {
      state.focusBack = doc.activeElement;
      holdAccountBackground();
      root.requestAnimationFrame(focusAccount);
    } else if (!opened && wasOpened) {
      releaseAccountBackground();
      if (state.focusBack?.isConnected && !panel.contains(state.focusBack)) state.focusBack.focus?.({ preventScroll: true });
      state.focusBack = null;
    }
    if (opened) scheduleViewport();
  }
  function decorateHeader() {
    const header = doc.querySelector('.shell > header.top');
    if (!header) return;
    header.dataset.bbAccountPolish = 'banner';
    const settings = doc.getElementById('bbuiOpenSettings');
    if (settings && !settings.dataset.bbAccountPolish) {
      settings.dataset.bbAccountPolish = 'trigger';
      settings.innerHTML = icons.settings;
    }
  }
  function refresh() { state.queued = false; decorateHeader(); decorateSettings(); syncAccount(); }
  function schedule() { if (!state.queued) { state.queued = true; root.requestAnimationFrame(refresh); } }
  function start() {
    root.visualViewport?.addEventListener('resize', scheduleViewport);
    root.visualViewport?.addEventListener('scroll', scheduleViewport);
    root.addEventListener('resize', scheduleViewport);
    refresh();
    // The legacy application mounts Settings after DOMContentLoaded. Watching
    // additions only avoids re-running on every plan, price or style mutation.
    const observer = new root.MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches?.('.bbui-settings-overlay,#cloud-panel,.shell') || node.querySelector?.('.bbui-settings-panel,#cloud-panel'))))) schedule();
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }
  root.BBAccountPolish = Object.freeze({ refresh });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})(typeof window === 'undefined' ? globalThis : window);
