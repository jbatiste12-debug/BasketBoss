(function (root) {
  'use strict';

  const SESSION_KEY = 'basketboss_cloud_session_v1';
  const LOCK_KEY = 'basketboss_account_deletion_v1';
  const ownedKey = key => /^(?:basketboss(?:[_:-]|$)|bb[_:-])/i.test(String(key));
  const ownedCache = key => /^(?:basketboss(?:[_:-]|$)|bb[_:-])/i.test(String(key));

  // Only fixed responses from our deletion endpoint can explain its progress.
  // Never show an upstream error body, account identifier or arbitrary code.
  const pendingMessages = Object.freeze({
    deletion_auth_unavailable: 'We could not verify your sign-in right now.',
    deletion_state_unknown: 'We could not confirm your account deletion status.',
    deletion_checkout_pending: 'A previous checkout is still being checked before your account can be deleted.',
    deletion_billing_pending: 'We could not complete the subscription check or cancellation.',
    deletion_cloud_pending: 'We could not confirm that your cloud account and saved data were deleted.',
    deletion_database_pending: 'We could not finish deleting your saved account data.',
    deletion_password_required: 'Your password could not be verified. A previous deletion request still needs to finish.',
    deletion_not_ready: 'Account deletion is temporarily unavailable. A previous deletion request still needs to finish.'
  });

  function failureFeedback(response, data, hadPending) {
    const explicitPending = data?.pending === true || data?.deletion_pending === true;
    const explicitRejection = !response.ok && response.status !== 202 && data?.ok === false && data?.pending === false && !explicitPending;
    const pending = explicitPending || response.status === 202 || (!explicitRejection && (hadPending || response.status >= 500 || response.ok));
    const code = typeof data?.code === 'string' && Object.hasOwn(pendingMessages, data.code) ? data.code : '';
    const kept = 'Your saved device data has been kept';
    if (pending) {
      const progress = code ? pendingMessages[code] : 'Deletion has not been confirmed yet.';
      return { pending, code, text: progress + ' ' + kept + ' and syncing is paused. Re-enter your password and retry to finish.' };
    }
    if (code === 'deletion_auth_unavailable') return { pending, code, text: 'We could not verify your sign-in right now. Your account and saved device data have been kept, and syncing can continue. Please try again later.' };
    if (code === 'deletion_not_ready') return { pending, code, text: 'Account deletion is not available yet. Your account and saved device data have been kept, and syncing can continue. Please try again later.' };
    if (code === 'deletion_password_required' || response.status === 401 || response.status === 403) return { pending, code, text: 'Your password or session could not be verified. ' + kept + ' and syncing can continue. Check your password, or close this window and sign in again.' };
    return { pending, code, text: 'Your account deletion could not be completed. ' + kept + ' and syncing can continue. Please retry.' };
  }

  function clearStorage(storage) {
    if (!storage) return;
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (ownedKey(key)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  }

  function factory(options = {}) {
    const host = options.root || root;
    const doc = options.document === undefined ? host.document : options.document;
    const local = options.localStorage || host.localStorage;
    const sessionStore = options.sessionStorage || host.sessionStorage;
    const now = options.now || Date.now;
    const fetcher = options.fetch || host.fetch?.bind(host);
    const listeners = [];
    let phase = 'idle', pinned = null, inFlight = null, controller = null;
    let dialog = null, form = null, message = null, password = null, confirmation = null, acknowledged = null;
    let submit = null, cancel = null, cleanupRetry = null, restoreFocus = null, observer = null, started = false, locked = false;
    let success = false, knownActor = null, statusFlight = null;

    function readSession() {
      try {
        const value = JSON.parse(local?.getItem(SESSION_KEY) || 'null');
        if (typeof value?.user?.id !== 'string' || !value.user.id || typeof value.access_token !== 'string' || !value.access_token) return null;
        if (!Number.isFinite(Number(value.expires_at))) return null;
        if (Number(value.expires_at) * 1000 <= now()) {
          // The server accepts the original token hash only for resuming an
          // existing deletion. It cannot authorize a new deletion after expiry.
          const pending = readLock();
          if (!pending || pending.actorId !== value.user.id || !['pending', 'deleting'].includes(pending.phase)) return null;
        }
        return { actorId: value.user.id, token: value.access_token, email: String(value.user.email || '') };
      } catch { return null; }
    }

    function readLock() {
      try {
        const value = JSON.parse(local?.getItem(LOCK_KEY) || 'null');
        return typeof value?.actorId === 'string' && ['deleting', 'pending', 'deleted'].includes(value.phase) ? value : null;
      } catch { return null; }
    }

    function sameSession(expected) {
      const current = readSession();
      return Boolean(expected && current && expected.actorId === current.actorId && expected.token === current.token);
    }

    function emit(name, details = {}) {
      if (!host.dispatchEvent) return;
      const detail = { actorId: pinned?.actorId || readSession()?.actorId || null, ...details };
      host.dispatchEvent(new host.CustomEvent('basketboss:account-deletion-' + name, { detail }));
    }

    function lock(next) {
      phase = next;
      try {
        if (next === 'idle') {
          const existing = readLock();
          if (!existing || existing.actorId === pinned?.actorId) local?.removeItem(LOCK_KEY);
        } else if (pinned) {
          local?.setItem(LOCK_KEY, JSON.stringify({ actorId: pinned.actorId, phase: next, startedAt: now() }));
        }
      } catch { /* The in-memory barrier still protects this tab if storage is full. */ }
    }

    function update() {
      if (!dialog) return;
      const busy = phase === 'deleting' || success;
      submit.disabled = busy || locked || !password.value || confirmation.value !== 'DELETE' || !acknowledged.checked;
      submit.textContent = busy ? 'Deleting…' : phase === 'pending' ? 'Retry account deletion' : 'Permanently delete account';
      password.disabled = busy || locked;
      confirmation.disabled = busy || locked;
      acknowledged.disabled = busy || locked;
      cancel.disabled = phase === 'deleting' || success;
      cancel.textContent = phase === 'pending' ? 'Close' : 'Cancel';
      cancel.hidden = success;
      submit.hidden = success;
      form.querySelectorAll('label').forEach(label => { label.hidden = success; });
      dialog.setAttribute('aria-busy', String(phase === 'deleting'));
    }

    function setMessage(text, error = false) {
      if (message) {
        message.textContent = text;
        message.setAttribute('role', error ? 'alert' : 'status');
      }
      update();
    }

    function accountChanged() {
      if (!pinned || sameSession(pinned) || success) return;
      locked = true;
      controller?.abort();
      setMessage('The signed-in account changed. Close this window and reopen account settings. If deletion had started, its result must be checked before trying again.', true);
      mount();
    }

    // Reconcile an old local lock without starting or retrying deletion. Only
    // an authenticated, actor-bound server answer may release the write barrier.
    async function reconcile(expected, savedLock, replacement) {
      if (!expected || !savedLock || expected.actorId !== savedLock.actorId || !fetcher) return { ok: false, state: 'unknown' };
      const before = local?.getItem(LOCK_KEY);
      const baseline = readSession();
      const Abort = options.AbortController || host.AbortController;
      const check = Abort ? new Abort() : null;
      const timeout = host.setTimeout?.(() => check?.abort(), 10000);
      let response, data;
      try {
        response = await fetcher('/api/account/delete?mode=status&actor=' + encodeURIComponent(expected.actorId), {
          method: 'GET', headers: { Authorization: 'Bearer ' + expected.token, Accept: 'application/json' },
          credentials: 'same-origin', cache: 'no-store', ...(check ? { signal: check.signal } : {})
        });
        data = await response.json();
      } catch { return { ok: false, state: 'unknown', message: 'The earlier deletion could not be checked. Your saved data is kept and cloud syncing remains paused.' }; }
      finally { if (timeout !== undefined) host.clearTimeout?.(timeout); }
      if (inFlight || success || phase === 'deleting' || local?.getItem(LOCK_KEY) !== before || readLock()?.actorId !== expected.actorId) return { ok: false, state: 'changed' };
      const current = readSession();
      if (!current || current.actorId !== expected.actorId || current.token !== baseline?.token || (!replacement && !sameSession(expected))) return { ok: false, state: 'changed' };
      if (!response.ok || data?.ok !== true || !['not_started', 'pending', 'deleted'].includes(data.deletionState)) {
        return { ok: false, state: 'unknown', needsSignIn: response.status === 401, message: response.status === 401 ? 'Sign in with the original account to check the earlier deletion. Cloud syncing remains paused.' : 'The earlier deletion could not be checked. Your saved data is kept and cloud syncing remains paused.' };
      }
      if (replacement) {
        // The endpoint independently matched this new bearer to the original
        // actor. A successful recovery never uploads/restores any plan data.
        local.setItem(SESSION_KEY, JSON.stringify(replacement));
      }
      pinned = { ...expected }; knownActor = pinned; locked = false;
      if (data.deletionState === 'deleted') {
        lock('deleted'); return finishOnThisDevice(true);
      }
      if (data.deletionState === 'not_started') {
        lock('idle'); emit('cancelled', { reconciled: true }); mount();
        return { ok: true, state: 'not_started', message: 'No account deletion was started. Your saved data is kept and you can sign in normally.' };
      }
      phase = 'pending'; emit('started', { recovered: true }); mount();
      return { ok: true, state: 'pending', message: 'Your sign-in was recovered. The server confirms an unfinished deletion; cloud syncing stays paused. Use Finish Account Deletion to review it.' };
    }

    async function checkPending() {
      if (statusFlight) return statusFlight;
      if (phase !== 'pending' || inFlight || success) return { ok: false, state: phase };
      const expected = readSession(), saved = readLock();
      statusFlight = reconcile(expected, saved);
      try { const result = await statusFlight; if (result.message) setMessage(result.message, !result.ok); return result; }
      finally { statusFlight = null; }
    }

    async function recoverSession(value) {
      const saved = readLock(), original = readSession();
      if (phase !== 'pending' || inFlight || success || !saved || !original || original.actorId !== saved.actorId) return { ok: false, message: 'The earlier deletion state changed. Reopen account settings.' };
      if (!value || value.user?.id !== saved.actorId || typeof value.access_token !== 'string' || !value.access_token || !Number.isFinite(Number(value.expires_at)) || Number(value.expires_at) * 1000 <= now()) return { ok: false, message: 'Sign in with the original account whose deletion needs checking. Your saved data has been kept.' };
      return reconcile({ actorId: value.user.id, token: value.access_token, email: String(value.user.email || '') }, saved, value);
    }

    async function clearDeviceData() {
      // The account endpoint must confirm deletion before callers use this helper.
      // Only this application's namespaced data is removed on a shared origin.
      const failures = [];
      for (const storage of [local, sessionStore]) {
        try { clearStorage(storage); } catch { failures.push('saved device data'); }
      }
      const caches = options.caches || host.caches;
      try {
        if (caches) {
          const names = await caches.keys();
          await Promise.all(names.filter(ownedCache).map(name => caches.delete(name)));
        }
      } catch { failures.push('offline cache'); }
      try {
        const workers = options.serviceWorker || host.navigator?.serviceWorker;
        const current = new URL(host.location?.href || 'https://basketboss.co.uk/app');
        const appDirectory = new URL('./', current).pathname;
        if (workers?.getRegistrations) {
          const registrations = await workers.getRegistrations();
          for (const registration of registrations) {
            const script = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL;
            if (!script) continue;
            const scriptURL = new URL(script), scope = new URL(registration.scope);
            if (scriptURL.origin === current.origin && scriptURL.pathname === appDirectory + 'service-worker.js' && scope.origin === current.origin && scope.pathname === appDirectory) await registration.unregister();
          }
        }
      } catch { failures.push('offline registration'); }
      try {
        if (typeof host.BBNative?.clearTemporaryData === 'function') {
          const result = await host.BBNative.clearTemporaryData();
          if (result?.ok === false) failures.push('temporary receipt photos');
        }
      } catch { failures.push('temporary receipt photos'); }
      // Re-run after asynchronous cleanup: a closing background task may have saved
      // an app preference while caches were being removed.
      for (const storage of [local, sessionStore]) {
        try { clearStorage(storage); } catch { if (!failures.includes('saved device data')) failures.push('saved device data'); }
      }
      return { ok: failures.length === 0, failures };
    }

    async function finishOnThisDevice(crossTab = false) {
      phase = 'deleted'; success = true;
      emit('deleted', { crossTab });
      const cleanup = await clearDeviceData();
      if (!cleanup.ok) {
        if (doc && !dialog) {
          buildDialog();
          doc.getElementById('bbAccountDeletionEmail').textContent = pinned?.email || 'Your BasketBoss account';
          if (typeof dialog.showModal === 'function') dialog.showModal();
          else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
        }
        setMessage('Your account and cloud data have been deleted. Some saved data on this device could not be cleared. Retry clearing this device, or close BasketBoss and clear its site/app data before using it again.', true);
        if (cleanupRetry) { cleanupRetry.hidden = false; cleanupRetry.focus(); }
        return { ok: true, deleted: true, localCleared: false };
      }
      setMessage('Your account and saved data have been deleted. Opening a fresh BasketBoss…');
      try {
        if (options.onDeleted) await options.onDeleted();
        else host.location?.replace(freshURL());
      } catch { setMessage('Your account and saved data have been deleted. Close and reopen BasketBoss to continue.'); }
      return { ok: true, deleted: true, localCleared: true };
    }

    function freshURL() {
      const url = new URL(host.location?.href || 'https://basketboss.co.uk/app');
      url.hash = '';
      url.search = '';
      if (host.BBNative?.isNative || url.protocol === 'capacitor:') return new URL('index.html', new URL('./', url)).href;
      if (/\/app\/?$/.test(url.pathname)) return url.href;
      if (/\/(?:app|index)\.html$/.test(url.pathname)) return url.href;
      return new URL('./app', url).href;
    }

    async function requestDeletion(input) {
      if (inFlight) return inFlight;
      const expected = input.expectedSession || pinned;
      if (input.confirmation !== 'DELETE' || input.acknowledged !== true || typeof input.password !== 'string' || !input.password) return { ok: false, reason: 'confirmation' };
      if (!sameSession(expected)) return { ok: false, reason: 'account_changed' };
      if (!fetcher) return { ok: false, reason: 'unavailable' };
      const savedLock = readLock();
      const hadPending = phase === 'pending' || Boolean(savedLock && savedLock.actorId === expected.actorId && ['pending', 'deleting'].includes(savedLock.phase));
      pinned = { ...expected };
      locked = false;
      const run = async () => {
        try {
          lock('deleting');
          emit('started');
          setMessage('Deleting your account and saved cloud data…');
          const Abort = options.AbortController || host.AbortController;
          controller = Abort ? new Abort() : null;
          const timeout = host.setTimeout?.(() => controller?.abort(), 45000);
          let response;
          try {
            response = await fetcher('/api/account/delete', {
              method: 'POST', credentials: 'same-origin', cache: 'no-store',
              headers: { 'Authorization': 'Bearer ' + expected.token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ confirmation: 'DELETE', password: input.password }),
              ...(controller ? { signal: controller.signal } : {})
            });
          } finally { if (timeout !== undefined) host.clearTimeout?.(timeout); }
          // Do not keep a reauthentication password in UI state after sending it.
          if (password) password.value = '';
          let data = null;
          try { data = await response.json(); } catch { /* Treat malformed responses as unconfirmed. */ }
          if (!sameSession(expected)) {
            locked = true;
            setMessage('The signed-in account changed. No data for the new account was removed from this device. The original deletion request may have completed.', true);
            return { ok: false, reason: 'account_changed' };
          }
          if (!(response.ok && data?.ok === true && data?.deleted === true)) {
            const feedback = failureFeedback(response, data, hadPending), { pending } = feedback;
            lock(pending ? 'pending' : 'idle');
            if (!pending) emit('cancelled');
            setMessage(feedback.text, true);
            return { ok: false, pending, reason: pending ? 'pending' : 'rejected', code: feedback.code, message: feedback.text };
          }
          // Storage events preserve this exact value even if cleanup has already
          // removed the key by the time another tab receives the event.
          lock('deleted');
          return await finishOnThisDevice();
        } catch {
          if (password) password.value = '';
          // A connection failure can happen after the server has acted. Keep data
          // and the write barrier until the idempotent endpoint confirms success.
          lock('pending');
          setMessage(locked
            ? 'The account changed while deletion was being checked. Close this window and check the original account before retrying.'
            : 'We could not confirm deletion. Your saved device data has been kept and syncing is paused. Re-enter your password and retry when connected.', true);
          return { ok: false, pending: true, reason: locked ? 'account_changed' : 'connection' };
        } finally {
          controller = null;
          if (locked && phase === 'deleting') phase = 'pending';
          update();
          mount();
        }
      };
      inFlight = run();
      try { return await inFlight; } finally { inFlight = null; }
    }

    function element(tag, text, className) {
      const node = doc.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    }

    function buildDialog() {
      if (dialog || !doc?.body) return;
      dialog = element('dialog', '', 'bb-account-deletion-dialog');
      dialog.id = 'bbAccountDeletionDialog';
      dialog.setAttribute('aria-labelledby', 'bbAccountDeletionTitle');
      dialog.setAttribute('aria-describedby', 'bbAccountDeletionExplanation');
      form = element('form');
      const title = element('h2', 'Delete Account & Data');
      title.id = 'bbAccountDeletionTitle';
      const account = element('p', '', 'bb-account-deletion-email');
      account.id = 'bbAccountDeletionEmail';
      const explanation = element('div');
      explanation.id = 'bbAccountDeletionExplanation';
      explanation.append(element('p', 'This permanently deletes your BasketBoss account and your saved cloud meal plans, pantry, shopping and receipt records. It also clears BasketBoss data saved on this device.'));
      const details = element('ul');
      [
        'Your web subscription will be cancelled as part of deletion. Required billing records may still be kept by the payment provider.',
        'You will leave any shared household. If you own it, its cloud sharing and invitations will be removed; other members’ accounts will remain.',
        'Copies on other devices, downloaded backups and original photos in your photo library cannot be removed remotely.',
        'This cannot be undone. You can delete your account whether you have a free or paid membership.'
      ].forEach(text => details.append(element('li', text)));
      explanation.append(details);
      const passwordLabel = element('label', 'Confirm your account password');
      password = element('input');
      password.type = 'password'; password.autocomplete = 'current-password'; password.required = true;
      password.id = 'bbAccountDeletionPassword';
      passwordLabel.append(password);
      const confirmLabel = element('label', 'Type DELETE to confirm');
      confirmation = element('input');
      confirmation.type = 'text'; confirmation.autocomplete = 'off'; confirmation.spellcheck = false;
      confirmation.required = true; confirmation.id = 'bbAccountDeletionConfirmation';
      confirmation.setAttribute('autocapitalize', 'characters');
      confirmLabel.append(confirmation);
      const acknowledgeLabel = element('label', '', 'bb-account-deletion-acknowledge');
      acknowledged = element('input'); acknowledged.type = 'checkbox'; acknowledged.required = true;
      acknowledgeLabel.append(acknowledged, element('span', 'I understand that my account and saved BasketBoss data will be permanently deleted.'));
      message = element('p', '', 'bb-account-deletion-message');
      message.setAttribute('aria-live', 'polite'); message.setAttribute('aria-atomic', 'true');
      const actions = element('div', '', 'bb-account-deletion-actions');
      cancel = element('button', 'Cancel', 'bb-account-deletion-cancel'); cancel.type = 'button';
      cancel.addEventListener('click', close);
      submit = element('button', 'Permanently delete account', 'bb-account-deletion-submit'); submit.type = 'submit'; submit.disabled = true;
      cleanupRetry = element('button', 'Retry clearing this device', 'bb-account-deletion-submit'); cleanupRetry.type = 'button'; cleanupRetry.hidden = true;
      cleanupRetry.addEventListener('click', async () => {
        if (!success || cleanupRetry.disabled) return;
        cleanupRetry.hidden = true; cleanupRetry.disabled = true;
        try { await finishOnThisDevice(); } finally { cleanupRetry.disabled = false; }
      });
      actions.append(cancel, submit, cleanupRetry);
      form.append(title, account, explanation, passwordLabel, confirmLabel, acknowledgeLabel, message, actions);
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (submit.disabled) return;
        void requestDeletion({ expectedSession: pinned, password: password.value, confirmation: confirmation.value, acknowledged: acknowledged.checked });
      });
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      dialog.append(form); doc.body.append(dialog);
    }

    function open() {
      const current = readSession();
      if (!current || inFlight || phase === 'deleting' || success) return false;
      buildDialog();
      if (!dialog) return false;
      pinned = current; locked = false;
      const savedLock = readLock();
      phase = savedLock?.actorId === current.actorId ? 'pending' : 'idle';
      form.reset();
      doc.getElementById('bbAccountDeletionEmail').textContent = 'Signed in as ' + (current.email || 'your BasketBoss account');
      setMessage(phase === 'pending' ? 'A previous deletion request needs confirmation. Syncing is paused. Re-enter your password and retry to finish.' : '');
      restoreFocus = doc.activeElement;
      if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
      else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
      password.focus();
      return true;
    }

    function close() {
      if (!dialog || phase === 'deleting' || success) return;
      password.value = ''; confirmation.value = ''; acknowledged.checked = false;
      if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
      restoreFocus?.focus?.();
      if (phase === 'idle') pinned = null;
    }

    function mount() {
      if (!doc) return;
      const current = readSession();
      for (const [id, parentID] of [['bbProfileAccountDeletion', 'cloud-signed'], ['bbSettingsAccountDeletion', 'bbuiLinksSection']]) {
        const parent = doc.getElementById(parentID);
        let card = doc.getElementById(id);
        if (!parent) continue;
        if (!card) {
          card = element('div', '', 'bb-account-deletion-card'); card.id = id;
          const button = element('button', 'Delete Account & Data', 'bb-account-deletion-open'); button.type = 'button';
          button.addEventListener('click', open);
          card.append(button, element('small', 'Permanently remove your account and saved BasketBoss data.'));
          const check = element('button', 'Check earlier deletion status', 'bb-account-deletion-check'); check.type = 'button';
          check.addEventListener('click', () => { void checkPending().then(result => { if (!result.ok && doc.getElementById('cloud-open')) doc.getElementById('cloud-open').click(); }); });
          card.append(check);
          const links = element('div', '', 'bb-account-deletion-legal');
          const native = host.BBNative?.isNative || host.location?.protocol === 'capacitor:';
          for (const [path, text] of [['privacy', 'Privacy'], ['terms', 'Terms']]) {
            const link = element('a', text); link.href = native ? './' + path + '.html' : '/' + path;
            links.append(link);
          }
          card.append(links);
          parent.append(card);
        }
        card.hidden = !current;
        card.querySelector('button').disabled = phase === 'deleting' || success;
        card.querySelector('button').textContent = phase === 'pending' && pinned?.actorId === current?.actorId ? 'Finish Account Deletion' : 'Delete Account & Data';
        const check = card.querySelector('.bb-account-deletion-check');
        if (check) { check.hidden = phase !== 'pending'; check.disabled = Boolean(statusFlight); }
      }
    }

    function listen(target, event, handler) {
      target?.addEventListener?.(event, handler);
      listeners.push(() => target?.removeEventListener?.(event, handler));
    }

    function start() {
      if (started || !doc) return;
      started = true;
      const current = readSession(), savedLock = readLock();
      knownActor = current;
      if (savedLock?.phase === 'deleted') {
        // A tab closed after server confirmation but before local cleanup should
        // finish cleanup even when its original access token has since expired.
        let previous = null;
        try { previous = JSON.parse(local?.getItem(SESSION_KEY) || 'null'); } catch { /* No matching account to clear. */ }
        if (previous?.user?.id === savedLock.actorId) {
          pinned = { actorId: previous.user.id, token: String(previous.access_token || ''), email: String(previous.user.email || '') };
          knownActor = pinned;
          void finishOnThisDevice(true);
          return;
        }
      }
      if (current && savedLock?.actorId === current.actorId) { pinned = current; phase = 'pending'; emit('started', { resumed: true }); }
      mount();
      listen(host, 'basketboss:session-changed', () => {
        accountChanged();
        const next = readSession();
        if (next || phase === 'idle') knownActor = next;
        mount();
      });
      listen(host, 'focus', () => { accountChanged(); mount(); });
      listen(host, 'online', () => { void checkPending(); });
      listen(host, 'storage', event => {
        if (event.key === SESSION_KEY || event.key === null) {
          accountChanged();
          const next = readSession();
          if (next || phase === 'idle') knownActor = next;
          mount();
        }
        if (event.key === LOCK_KEY) {
          let value = null;
          try { value = JSON.parse(event.newValue || 'null'); } catch { /* Invalid locks cannot initiate cleanup. */ }
          const actor = readSession() || knownActor;
          if (value && value.actorId === actor?.actorId && ['deleting', 'pending', 'deleted'].includes(value.phase)) {
            pinned = pinned || actor;
            if (value.phase === 'deleted') { if (!success) void finishOnThisDevice(true); }
            else if (!success) { phase = value.phase; emit('started', { crossTab: true }); }
          } else if (!inFlight && !success) { phase = 'idle'; emit('cancelled', { crossTab: true }); }
          update(); mount();
        }
      });
      if (host.MutationObserver && doc.body) {
        observer = new host.MutationObserver(() => {
          const missing = [['cloud-signed', 'bbProfileAccountDeletion'], ['bbuiLinksSection', 'bbSettingsAccountDeletion']].some(([parent, child]) => doc.getElementById(parent) && !doc.getElementById(child));
          if (missing) mount();
        });
        observer.observe(doc.body, { childList: true, subtree: true });
      }
      if (phase === 'pending') void checkPending();
    }

    function stop() { observer?.disconnect(); listeners.splice(0).forEach(remove => remove()); started = false; }
    return { start, stop, open, close, isDeleting: () => phase !== 'idle', canRecoverSignIn: () => phase === 'pending' && !inFlight && !success, checkPending, recoverSession, readSession, requestDeletion, clearDeviceData, freshURL };
  }

  root.BBAccountDeletionFactory = factory;
  root.BBAccountDeletionStorage = { ownedKey, ownedCache, clearStorage };
  if (root.document) {
    const instance = factory(); root.BBAccountDeletion = instance;
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', instance.start, { once: true });
    else instance.start();
  }
})(typeof window === 'undefined' ? globalThis : window);
