/* Premium receipt capture/review. Photos and editable drafts stay in memory. */
(function (root) {
  'use strict';
  const scriptURL = root.document?.currentScript?.src;
  const sibling = name => scriptURL ? new URL(name, scriptURL).href : './' + name;
  const CURRENCIES = { UK: 'GBP', Guernsey: 'GBP', Jersey: 'GBP', US: 'USD' };
  const MAX_BASE64 = 2500000;
  const copy = value => JSON.parse(JSON.stringify(value));
  const number = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
  function createReceiptScanner(initial = {}) {
    let options = { ...initial }, corePromise, current = null;
    const doc = () => options.document || root.document;
    const inventory = () => options.inventory || root.BBReceiptInventory;
    const core = () => options.core ? Promise.resolve(options.core) : (corePromise ||= import(sibling('bb-receipt-inventory-core.mjs')));
    const fetcher = () => options.fetch || root.fetch?.bind(root);
    const context = () => options.getContext ? options.getContext() : { market: root.bb307ActiveMarket?.(), retailer: root.bb307ActiveRetailer?.() || null };
    function session() {
      let value;
      try { value = options.getSession ? options.getSession() : JSON.parse(root.localStorage?.getItem('basketboss_cloud_session_v1') || 'null'); } catch { return null; }
      const actorId = value?.user?.id || value?.actorId, token = value?.access_token || value?.accessToken;
      if (typeof actorId !== 'string' || !actorId || typeof token !== 'string' || !token || token.length > 16000 || /[\r\n]/.test(token)) return null;
      if (value.expires_at !== undefined && (!Number.isFinite(Number(value.expires_at)) || Number(value.expires_at) * 1000 <= Date.now() + 5000)) return null;
      return { actorId, token };
    }
    function unchanged(captured, expected) {
      const user = session(), active = context();
      return !!user && user.actorId === captured?.actorId && user.token === captured?.token && active?.market === expected.market && (active.retailer || null) === (expected.retailer || null);
    }
    function assertCurrent(captured, expected, signal) {
      if (signal?.aborted) throw Error('receipt_scan_cancelled');
      if (!unchanged(captured, expected)) throw Error('receipt_context_changed');
    }
    function message(error) {
      const key = String(error?.message || error || '');
      if (/context_changed|account_changed|session_expired|draft_not_owned/.test(key)) return 'Your account, region or supermarket changed. Close and reopen the receipt scanner.';
      if (/currency_mismatch/.test(key)) return 'The receipt currency does not match your Shop region. Choose the correct region and reopen the scanner.';
      if (/initial_pantry_merge|local_remote_pantry_merge|revision_conflict|household_scope_changed|projection_belongs/.test(key)) return 'Your Pantry needs a review before this receipt can be added. Review Pantry in Shop, then retry this receipt.';
      if (/quota|daily|limit reached|429/i.test(key)) return 'Your receipt scan allowance has been reached. Try another day, or enter items manually.';
      if (/cancelled|AbortError|aborted/i.test(key)) return 'Receipt scan cancelled. Nothing new was confirmed.';
      if (/pending.*changed|identity_conflict/.test(key)) return 'This receipt already has a saved or pending confirmation. Recover it before making changes.';
      if (/storage|quota|recovery_required/.test(key)) return 'Your receipt may be saved online, but this device needs a Pantry refresh. Use Check saved receipt.';
      if (/unsupported|not.*image|image.*type/i.test(key)) return 'Choose a JPEG, PNG, WebP or supported phone photo.';
      if (/large|12 MB|too_big/i.test(key)) return 'Choose an image under 12 MB, or crop the receipt and try again.';
      if (/security|turnstile/i.test(key)) return 'Complete the security check before scanning.';
      return key && !/^[a-z_]+$/.test(key) ? key.slice(0, 220) : 'The receipt could not be processed. Check the details and try again.';
    }
    async function jsonRequest(path, captured, { signal, method = 'GET', body } = {}) {
      const perform = fetcher(); if (!perform) throw Error('Receipt scanning is unavailable.');
      const response = await perform(path, { method, headers: { Accept: 'application/json', Authorization: 'Bearer ' + captured.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', redirect: 'manual', cache: 'no-store', signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { const error = Error(response.status === 429 ? 'Daily receipt scan limit reached (429).' : String(data.error || 'Receipt service unavailable.').slice(0, 220)); error.status = response.status; throw error; }
      return data;
    }
    async function availability({ market, retailer, signal } = {}) {
      const captured = session(), active = context(), expected = { market: market || active?.market, retailer: retailer ?? active?.retailer ?? null };
      if (!captured) return { available: false, reason: 'Sign in to a verified Premium account to scan receipts.' };
      if (!CURRENCIES[expected.market] || typeof expected.retailer !== 'string' || !expected.retailer.trim() || !unchanged(captured, expected)) return { available: false, reason: 'Choose your current Shop region and supermarket first.' };
      try {
        const results = await Promise.all([
          jsonRequest('/api/receipt-inventory?mode=status', captured, { signal }),
          jsonRequest('/api/bb173/status', captured, { signal })
        ]);
        assertCurrent(captured, expected, signal);
        const receipt = results[0], ai = results[1];
        if (receipt.ok !== true || receipt.available !== true || receipt.premium !== true || receipt.migrationReady !== true) return { available: false, reason: 'Receipt inventory is not available for this account yet.' };
        if (ai.status !== 'available' || ai.premium_ai !== true) return { available: false, reason: 'Premium receipt scanning is currently unavailable.' };
        return { available: true, turnstileRequired: ai.turnstileRequired !== false, siteKey: typeof ai.siteKey === 'string' ? ai.siteKey : null, market: expected.market, retailer: expected.retailer };
      } catch (error) { return { available: false, reason: message(error) }; }
    }
    async function preparePhoto(file, { signal } = {}) {
      if (!file || !/^image\/(?:jpeg|png|webp|heic|heif|avif)$/i.test(file.type || '')) throw Error('unsupported_receipt_image_type');
      if (!(file.size > 0) || file.size > 12 * 1024 * 1024) throw Error('Choose an image under 12 MB.');
      if (signal?.aborted) throw Error('receipt_scan_cancelled');
      const create = options.createImageBitmap || root.createImageBitmap?.bind(root);
      if (!create) throw Error('This browser cannot read that photo. Try a JPEG or PNG photo.');
      const bitmap = await create(file, { imageOrientation: 'from-image' });
      try {
        if (!bitmap.width || !bitmap.height) throw Error('The receipt image could not be read.');
        if (signal?.aborted) throw Error('receipt_scan_cancelled');
        const canvas = doc().createElement('canvas'), scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const drawing = canvas.getContext('2d'); if (!drawing) throw Error('The receipt image could not be prepared.');
        drawing.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        for (const quality of [.82, .68, .54]) {
          const data = canvas.toDataURL('image/jpeg', quality), base64 = data.split(',')[1];
          if (signal?.aborted) throw Error('receipt_scan_cancelled');
          if (base64 && base64.length <= MAX_BASE64) return { mimeType: 'image/jpeg', imageBase64: base64 };
        }
        throw Error('The receipt image is still too large. Crop it and try again.');
      } finally { bitmap.close?.(); }
    }
    async function readReceipt({ file, market, retailer = null, consent, signal, turnstileToken = '' } = {}) {
      if (consent !== true) throw Error('Agree to send this photo for receipt reading before scanning.');
      const captured = session(), expected = { market, retailer };
      assertCurrent(captured, expected, signal);
      const ready = await availability({ market, retailer, signal });
      if (!ready.available) throw Error(ready.reason);
      if (ready.turnstileRequired && (typeof turnstileToken !== 'string' || !turnstileToken)) throw Error('receipt_security_check_required');
      const photo = await (options.preparePhoto || preparePhoto)(file, { signal });
      assertCurrent(captured, expected, signal);
      if (!photo || photo.mimeType !== 'image/jpeg' || typeof photo.imageBase64 !== 'string' || !photo.imageBase64.length || photo.imageBase64.length > MAX_BASE64) throw Error('The receipt image could not be prepared.');
      const result = await jsonRequest('/api/bb173/scan', captured, { signal, method: 'POST', body: { ...photo, scanKind: 'receipt_inventory', expectedCurrency: CURRENCIES[market], turnstileToken } });
      assertCurrent(captured, expected, signal);
      if (result.ok !== true || result.reviewRequired !== true || !result.receiptInventory || !Array.isArray(result.receiptInventory.items) || result.receiptInventory.items.length > 200) throw Error('The receipt reader did not return a reviewable receipt.');
      return result.receiptInventory;
    }
    function element(tag, properties = {}, contents) {
      const node = doc().createElement(tag);
      for (const [key, value] of Object.entries(properties)) {
        if (key.startsWith('aria-') || key === 'role') node.setAttribute(key, value);
        else node[key] = value;
      }
      if (contents !== undefined) node.append(...(Array.isArray(contents) ? contents : [typeof contents === 'string' ? doc().createTextNode(contents) : contents]));
      return node;
    }
    function field(label, control, help) {
      const wrapper = element('label', { className: 'bb-receipt-field' }, [element('span', {}, label), control]);
      if (help) wrapper.append(element('small', {}, help));
      return wrapper;
    }
    function select(entries, value) {
      const node = element('select');
      for (const [id, label] of entries) node.append(element('option', { value: id }, label));
      node.value = value ?? ''; return node;
    }
    function checkbox(label, top, checked = false) {
      const input = element('input', { type: 'checkbox', checked });
      if (top) input.dataset.receiptTop = top;
      return { input, label: element('label', { className: 'bb-receipt-check' }, [input, doc().createTextNode(label)]) };
    }
    function ensureStyles() {
      if (doc().getElementById('bb-receipt-scanner-style')) return;
      const link = element('link', { id: 'bb-receipt-scanner-style', rel: 'stylesheet', href: sibling('bb-receipt-scanner.css') });
      (doc().head || doc().body).append(link);
    }
    async function open({ market, retailer = null, shopSessionId = null, onSaved, onNeedsPantryReview } = {}) {
      const document = doc(); if (!document || !inventory()) throw Error('Receipt inventory is not ready.');
      current?.close(); ensureStyles();
      const expected = { market, retailer }, captured = session(), opener = document.activeElement;
      const dialog = element('dialog', { className: 'bb-receipt-scanner', id: 'bb-receipt-scanner', 'aria-labelledby': 'bb-receipt-title', 'aria-modal': 'true' });
      const state = { dialog, closed: false, busy: false, done: false, frozen: false, revision: 0, file: null, draft: null, ready: null, core: null, choices: [], controller: null, previewURL: null, widget: null, challengeToken: '', rowViews: [], requestId: null };
      const closeButton = element('button', { type: 'button', className: 'bb-receipt-close', 'aria-label': 'Close receipt scanner' }, 'Close'); closeButton.dataset.receiptAction = 'close';
      const title = element('h2', { id: 'bb-receipt-title' }, 'Scan a receipt');
      const status = element('p', { className: 'bb-receipt-status', role: 'status', 'aria-live': 'polite' }, 'Checking receipt availability…');
      const privacy = element('p', { className: 'bb-receipt-muted' }, 'Premium · Uses your existing scan allowance, up to 5 scans a day. Review every item before saving.');
      const file = element('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif', disabled: true }); file.setAttribute('capture', 'environment'); file.dataset.receiptAction = 'file';
      const preview = element('img', { alt: 'Selected receipt photo, shown only on this device', hidden: true, className: 'bb-receipt-photo' });
      const consent = checkbox('I agree to send this photo to Google Gemini to read the receipt.', 'consent');
      const privacyLink = element('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy policy');
      const captureHelp = element('p', { className: 'bb-receipt-muted' }, ['Crop out personal and payment details first. BasketBoss does not save receipt photos. ', privacyLink]);
      const scan = element('button', { type: 'button', disabled: true, className: 'bb-receipt-primary' }, 'Scan receipt'); scan.dataset.receiptAction = 'scan';
      const challenge = element('div', { className: 'bb-receipt-challenge' });
      const capture = element('section', { className: 'bb-receipt-capture', 'aria-label': 'Receipt photo' }, [field('Take or choose a receipt photo', file, 'JPEG, PNG or supported phone photo, under 12 MB.'), preview, captureHelp, consent.label, challenge, scan]);
      const review = element('form', { className: 'bb-receipt-review', hidden: true, 'aria-label': 'Review receipt items' });
      const storeInfo = element('p', { className: 'bb-receipt-store' });
      const storeReviewed = checkbox('I checked this receipt is from ' + (retailer || 'the supermarket selected in Shop') + '.', 'storeReviewed');
      const currencyReviewed = checkbox('I checked the receipt currency is ' + (CURRENCIES[market] || '') + '.', 'currencyReviewed');
      const totalInput = element('input', { type: 'number', inputMode: 'decimal', min: '-100000', max: '100000', step: '.01' }); totalInput.dataset.receiptTop = 'receiptTotal';
      const totalUnknown = checkbox('The total is unreadable. Keep it unknown; save only the reviewed item subtotals.', 'totalUnknown');
      const totalReviewed = checkbox('I checked the receipt total and all included discounts, refunds and tax rows.', 'totalReviewed');
      const trip = checkbox('This is the receipt for the same shopping trip already recorded in Shop.', 'shopLink');
      const tripHelp = element('p', { className: 'bb-receipt-muted' }, 'Link only the same purchases, so amounts already recorded are not counted twice.');
      if (!shopSessionId) { trip.label.hidden = true; tripHelp.hidden = true; }
      const totals = element('div', { className: 'bb-receipt-totals', 'aria-label': 'Reviewed receipt subtotals' });
      const rows = element('div', { className: 'bb-receipt-groups' }), list = element('datalist', { id: 'bb-receipt-ingredients' });
      const save = element('button', { type: 'submit', disabled: true, className: 'bb-receipt-primary' }, 'Confirm receipt & add food'); save.dataset.receiptAction = 'save';
      const saveHelp = element('p', { className: 'bb-receipt-muted' }, 'Measured food is added to Pantry. Non-food stays in Weekly essentials. Next, confirm Pantry in Shop before meals are reconciled.');
      review.append(storeInfo, storeReviewed.label, currencyReviewed.label, field('Actual receipt total (' + (CURRENCIES[market] || '') + ')', totalInput), totalUnknown.label, totalReviewed.label, trip.label, tripHelp, totals, list, rows, saveHelp, save);
      const recover = element('button', { type: 'button', hidden: true }, 'Check saved receipt'); recover.dataset.receiptAction = 'recover';
      const retry = element('button', { type: 'button', hidden: true }, 'Retry the same confirmation'); retry.dataset.receiptAction = 'retry';
      const recovery = element('div', { className: 'bb-receipt-recovery' }, [recover, retry]);
      dialog.append(element('header', { className: 'bb-receipt-header' }, [title, closeButton]), privacy, status, capture, review, recovery);
      document.body.append(dialog);
      function alive(revision = state.revision) { return !state.closed && dialog.isConnected !== false && revision === state.revision; }
      function guard() {
        if (unchanged(captured, expected)) return true;
        status.textContent = message(Error('receipt_context_changed')); state.frozen = true; update(); return false;
      }
      function releasePhoto(clearInput = true) {
        if (state.previewURL) (options.URL || root.URL)?.revokeObjectURL?.(state.previewURL);
        state.previewURL = null; preview.removeAttribute?.('src'); preview.hidden = true; state.file = null; if (clearInput) file.value = '';
      }
      function cleanup() {
        if (state.closed) return;
        state.closed = true; state.revision++; state.controller?.abort();
        if (state.draft) inventory().cancelDraft?.(state.draft);
        releasePhoto(); state.draft = null; state.rowViews = [];
        if (state.widget !== null) root.turnstile?.remove?.(state.widget);
        root.removeEventListener?.('storage', externalChange); root.removeEventListener?.('focus', externalChange); document.removeEventListener?.('visibilitychange', externalChange);
        dialog.remove(); if (current === state) current = null;
        if (opener?.isConnected !== false) opener?.focus?.();
      }
      state.close = () => { if (dialog.open && typeof dialog.close === 'function') dialog.close(); cleanup(); };
      current = state;
      closeButton.addEventListener('click', state.close); dialog.addEventListener('close', cleanup);
      dialog.addEventListener('cancel', event => { event.preventDefault(); state.close(); });
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); state.close(); return; }
        if (event.key !== 'Tab' || typeof dialog.querySelectorAll !== 'function') return;
        const focusable = [...dialog.querySelectorAll('button,input,select,a[href]')].filter(x => !x.disabled && !x.hidden && !x.closest?.('[hidden]'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus?.(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus?.(); }
      });
      function externalChange() {
        if (state.closed) return;
        const user = session();
        if (!user || user.actorId !== captured?.actorId || user.token !== captured?.token) { state.close(); return; }
        if (!state.busy) guard();
      }
      root.addEventListener?.('storage', externalChange); root.addEventListener?.('focus', externalChange); document.addEventListener?.('visibilitychange', externalChange);
      function validateLine(line) {
        if (line.sourceKind === 'total' || line.classification === 'ignore' && line.sourceKind === 'purchase' || line.selected === false && line.sourceKind === 'purchase') return [];
        if (line.sourceKind !== 'purchase') {
          if (line._includeAdjustment === false) return [];
          const amount = number(line.lineTotal);
          return amount === null || Math.abs(amount) > 100000 || (line.sourceKind === 'tax' ? amount < 0 : amount > 0) ? ['Check the signed adjustment amount.'] : line.reviewed ? [] : ['Review this adjustment.'];
        }
        if (line.classification === 'pending') return ['Choose food, non-food, or exclude this item.'];
        const normalized = state.core.normalizeReceiptLine(line, { catalog: state.choices });
        const issues = [...normalized.issues];
        if (line.classification === 'food' && !state.choices.some(x => x.key === line.canonicalKey)) issues.push('Choose an exact recognised ingredient.');
        if (number(line.lineTotal) === null || number(line.lineTotal) < 0 || number(line.lineTotal) > 100000) issues.push('Enter the actual line price.');
        if (!line.reviewed) issues.push('Review this item.');
        return issues;
      }
      function update() {
        const editable = !state.busy && !state.frozen && !state.done;
        file.disabled = !state.ready?.available || !editable;
        consent.input.disabled = !editable;
        scan.disabled = !state.ready?.available || !state.file || !consent.input.checked || !editable || state.ready.turnstileRequired && !state.challengeToken;
        for (const control of [storeReviewed.input, currencyReviewed.input, totalUnknown.input, totalReviewed.input, trip.input]) control.disabled = !editable;
        totalInput.disabled = !editable || totalUnknown.input.checked;
        let valid = !!state.draft && state.draft.lines.some(line => line.sourceKind === 'purchase' && line.selected !== false && ['food', 'essential'].includes(line.classification)) && storeReviewed.input.checked && currencyReviewed.input.checked && totalReviewed.input.checked && (totalUnknown.input.checked || number(totalInput.value) !== null && Math.abs(number(totalInput.value)) <= 100000);
        if (state.draft && state.core) {
          for (const view of state.rowViews) {
            const issues = validateLine(view.line); view.note.textContent = issues.length ? issues.map(x => String(x).replace(/_/g, ' ')).join(' · ') : 'Ready to confirm';
            for (const control of view.controls) control.disabled = !editable;
            if (view.reviewed) view.reviewed.checked = view.line.reviewed === true;
            if (issues.length) valid = false;
          }
          const actualTotal = totalUnknown.input.checked ? null : number(totalInput.value), summary = state.core.receiptTotals(state.draft.lines.filter(line => line.sourceKind === 'purchase' || line._includeAdjustment !== false), actualTotal);
          const format = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: CURRENCIES[market] }).format(value);
          totals.textContent = 'Food ' + format(summary.food) + ' · Weekly essentials ' + format(summary.essentials) + (summary.adjustments ? ' · Discounts/refunds ' + format(summary.adjustments) : '') + (summary.taxLines ? ' · Tax shown ' + format(summary.taxLines) : '') + ' · Receipt total ' + (actualTotal === null ? 'unknown' : format(actualTotal)) + (summary.difference && Math.abs(summary.difference) > .01 ? '. Check the difference of ' + format(summary.difference) + ', including any tax or omitted rows.' : '');
        }
        save.disabled = !editable || !valid;
        recover.disabled = state.busy; retry.disabled = state.busy;
      }
      function edit(line, fieldName, value, rerender = false) {
        if (!guard() || state.busy || state.frozen || state.done) return;
        line[fieldName] = value;
        if (fieldName !== 'reviewed') line.reviewed = false;
        delete line.unitPrice;
        if (fieldName === 'lineTotal') line.pricePaid = value;
        if (fieldName === 'classification') {
          if (value === 'ignore') line.selected = false;
          if (value !== 'food') line.canonicalKey = null;
        }
        if (rerender) renderRows(); else update();
      }
      function rowView(line) {
        const box = element('fieldset', { className: 'bb-receipt-row' }); box.dataset.receiptLine = line.id;
        const controls = [], note = element('p', { className: 'bb-receipt-row-note' });
        const track = (control, key) => { control.dataset.receiptField = key; controls.push(control); return control; };
        box.append(element('legend', {}, line.description || 'Receipt item'));
        if (line.notes) box.append(element('p', { className: 'bb-receipt-muted' }, line.notes));
        if (line.sourceKind === 'total') { box.append(element('p', {}, 'Detected receipt total. Check the total above; this row is not added again.')); return { box, line, controls, note }; }
        const adjustment = line.sourceKind !== 'purchase';
        const selected = track(element('input', { type: 'checkbox', checked: adjustment ? line._includeAdjustment !== false : line.selected !== false }), 'selected');
        selected.addEventListener('change', () => { if (adjustment) edit(line, '_includeAdjustment', selected.checked); else edit(line, 'selected', selected.checked); });
        box.append(element('label', { className: 'bb-receipt-check' }, [selected, document.createTextNode(adjustment ? 'Include this ' + line.sourceKind + ' in the reviewed record' : 'Include this item')]));
        if (!adjustment) {
          const kind = track(select([['pending', 'Needs classification'], ['food', 'Food → Pantry'], ['essential', 'Non-food → Weekly essentials'], ['ignore', 'Exclude item']], line.classification), 'classification');
          if (line.hardExcluded) for (const option of kind.children) if (option.value === 'food') option.disabled = true;
          kind.addEventListener('change', () => { if (line.hardExcluded && kind.value === 'food') { kind.value = 'essential'; return; } edit(line, 'classification', kind.value, true); });
          box.append(field('Item type', kind));
        }
        const price = track(element('input', { type: 'number', inputMode: 'decimal', step: '.01', min: adjustment && line.sourceKind !== 'tax' ? '-100000' : '0', max: adjustment && line.sourceKind !== 'tax' ? '0' : '100000', value: line.lineTotal ?? '' }), 'lineTotal');
        price.addEventListener('input', () => edit(line, 'lineTotal', number(price.value)));
        box.append(field((adjustment ? 'Signed amount' : 'Actual price for the whole receipt line') + ' (' + CURRENCIES[market] + ')', price));
        if (!adjustment && ['food', 'essential'].includes(line.classification)) {
          if (line.classification === 'food') {
            const match = track(element('input', { type: 'text', value: line.canonicalKey || '', autocomplete: 'off' }), 'canonicalKey'); match.setAttribute('list', list.id);
            match.addEventListener('change', () => { const value = match.value.trim().toLowerCase(), found = state.choices.find(x => x.key.toLowerCase() === value || x.name.toLowerCase() === value); edit(line, 'canonicalKey', found?.key || null); });
            box.append(field('Exact ingredient match', match, 'Choose a recognised ingredient. Unknown matches are not added to Pantry.'));
          } else box.append(element('p', { className: 'bb-receipt-muted' }, 'This stays in Weekly essentials and is never added to food stock. Its amount may stay unknown.'));
          const mode = track(select([['total', 'Measured total amount'], ['packs', 'Pack size × number of packs']], line._measurementMode), 'measurementMode');
          mode.addEventListener('change', () => { line._measurementMode = mode.value; line.reviewed = false; if (mode.value === 'packs') { line.quantity = null; line.unit = null; } else { line.packCount = null; line.packQuantity = null; line.packUnit = null; } renderRows(); });
          box.append(field('How is the quantity shown?', mode));
          const units = [['', 'Choose unit'], ['g', 'g'], ['kg', 'kg'], ['ml', 'ml'], ['l', 'litres'], ['each', 'each'], ['clove', 'cloves'], ['tin', 'tins'], ['pack', 'packs']];
          const quantityKey = line._measurementMode === 'packs' ? 'packQuantity' : 'quantity', unitKey = line._measurementMode === 'packs' ? 'packUnit' : 'unit';
          const quantity = track(element('input', { type: 'number', inputMode: 'decimal', min: '.001', max: '1000000', step: 'any', value: line[quantityKey] ?? '' }), quantityKey);
          const unit = track(select(units, line[unitKey] || ''), unitKey);
          quantity.addEventListener('input', () => edit(line, quantityKey, number(quantity.value))); unit.addEventListener('change', () => edit(line, unitKey, unit.value || null));
          box.append(element('div', { className: 'bb-receipt-amount' }, [field(line._measurementMode === 'packs' ? 'Contents of one pack' : 'Actual total amount bought', quantity), field('Unit', unit)]));
          if (line._measurementMode === 'packs') {
            const count = track(element('input', { type: 'number', inputMode: 'numeric', min: '1', max: '10000', step: '1', value: line.packCount ?? '' }), 'packCount');
            count.addEventListener('input', () => edit(line, 'packCount', number(count.value))); box.append(field('Number of packs', count, 'Enter the printed or checked count. No pack size is guessed.'));
          }
          const type = track(select([['unknown', 'Price type unknown'], ['regular', 'Checked regular pack price'], ['promotion', 'Promotion / offer price']], line.priceType || 'unknown'), 'priceType');
          type.addEventListener('change', () => edit(line, 'priceType', type.value)); box.append(field('Price type', type, 'Regular prices are remembered only for this account, region, supermarket and exact pack.'));
        }
        const reviewed = track(element('input', { type: 'checkbox', checked: line.reviewed === true }), 'reviewed');
        reviewed.addEventListener('change', () => edit(line, 'reviewed', reviewed.checked));
        box.append(element('label', { className: 'bb-receipt-check' }, [reviewed, document.createTextNode(adjustment ? 'I checked this adjustment.' : 'I checked this item, quantity and actual price.')]), note);
        return { box, line, controls, note, reviewed };
      }
      function renderRows() {
        rows.replaceChildren(); state.rowViews = [];
        const groups = [['food', 'Food for Pantry'], ['essential', 'Weekly essentials · non-food'], ['pending', 'Needs review / excluded items'], ['adjustment', 'Discounts, refunds and tax']];
        for (const [kind, label] of groups) {
          const own = state.draft.lines.filter(line => kind === 'adjustment' ? line.sourceKind !== 'purchase' : line.sourceKind === 'purchase' && (kind === 'pending' ? !['food', 'essential'].includes(line.classification) : line.classification === kind));
          if (!own.length) continue;
          const section = element('section', { className: 'bb-receipt-group', 'aria-label': label }, element('h3', {}, label));
          for (const line of own) { const view = rowView(line); state.rowViews.push(view); section.append(view.box); }
          rows.append(section);
        }
        update();
      }
      for (const check of [storeReviewed.input, currencyReviewed.input, totalReviewed.input]) check.addEventListener('change', update);
      totalUnknown.input.addEventListener('change', () => { totalReviewed.input.checked = false; update(); });
      totalInput.addEventListener('input', () => { totalReviewed.input.checked = false; update(); });
      trip.input.addEventListener('change', () => { if (state.draft) state.draft.shopSessionId = trip.input.checked ? shopSessionId : null; update(); });
      consent.input.addEventListener('change', update);
      file.addEventListener('change', () => {
        if (!guard()) return; state.revision++; state.controller?.abort();
        const chosen = file.files?.[0] || null;
        if (state.draft) inventory().cancelDraft?.(state.draft); state.draft = null; state.requestId = null; state.done = false; state.frozen = false; state.busy = false;
        releasePhoto(false); rows.replaceChildren(); state.rowViews = []; review.hidden = true; recover.hidden = true; retry.hidden = true; consent.input.checked = false;
        state.file = chosen;
        if (state.file) {
          try { state.previewURL = (options.URL || root.URL)?.createObjectURL?.(state.file) || null; if (state.previewURL) { preview.src = state.previewURL; preview.hidden = false; } } catch {}
          status.textContent = 'Photo ready. Agree to photo reading, then tap Scan receipt.';
        } else status.textContent = 'Choose a receipt photo to begin.';
        update();
      });
      scan.addEventListener('click', async () => {
        if (scan.disabled || !state.file || !consent.input.checked || !guard()) return;
        const revision = ++state.revision; state.busy = true; update(); status.textContent = 'Reading the receipt. You will review it before anything is saved…';
        state.controller = new AbortController(); const timer = (options.setTimeout || root.setTimeout)(() => state.controller?.abort(), 65000);
        try {
          const raw = await readReceipt({ file: state.file, market, retailer, consent: true, signal: state.controller.signal, turnstileToken: state.challengeToken });
          if (!alive(revision) || !guard()) return;
          const draft = await inventory().normalizeDraft({ ...raw, shopSessionId: null }, { market, retailer });
          if (!alive(revision) || !guard()) { inventory().cancelDraft?.(draft); return; }
          state.draft = draft; state.requestId = draft.receiptId + ':confirm';
          for (const line of draft.lines) { line.reviewed = false; line.priceType = line.priceType === 'promotion' ? 'promotion' : 'unknown'; line._includeAdjustment = true; line._measurementMode = line.packQuantity !== null && line.packQuantity !== undefined ? 'packs' : 'total'; if (line._measurementMode === 'packs') { line.quantity = null; line.unit = null; } }
          storeInfo.textContent = 'Shop: ' + (retailer || 'No supermarket selected') + ' · Region: ' + market + ' · Receipt says: ' + (raw.retailer || 'supermarket unreadable') + ' · Currency: ' + (raw.currency || 'unreadable—check it against ' + CURRENCIES[market]);
          totalInput.value = draft.receiptTotal ?? ''; totalUnknown.input.checked = false; totalReviewed.input.checked = false; storeReviewed.input.checked = false; currencyReviewed.input.checked = false; trip.input.checked = false;
          review.hidden = false; renderRows(); status.textContent = 'Check food and non-food separately. Unknown amounts need a measurement, or exclude the item.';
          review.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); totalInput.focus?.();
        } catch (error) { if (alive(revision)) status.textContent = message(error); }
        finally { (options.clearTimeout || root.clearTimeout)(timer); if (alive(revision)) { state.busy = false; state.challengeToken = ''; if (state.widget !== null) root.turnstile?.reset?.(state.widget); update(); } }
      });
      function finished(result) {
        if (result.localApplied === true) {
          state.done = true; state.frozen = true; recover.hidden = true; retry.hidden = true;
          status.textContent = 'Receipt saved. Measured food is in Pantry; non-food stays in Weekly essentials. Confirm Pantry in Shop before reconciling meals.';
        } else {
          state.frozen = true; recover.hidden = false; retry.hidden = true;
          status.textContent = 'Receipt saved online, but this device has not updated Pantry. Check the saved receipt before confirming again.';
        }
        try { onSaved?.(result); } catch {}
        update();
      }
      review.addEventListener('submit', async event => {
        event.preventDefault(); update(); if (save.disabled || !guard() || !state.draft) return;
        const revision = state.revision; state.busy = true; update(); status.textContent = 'Saving the reviewed receipt…'; state.controller = new AbortController();
        try {
          const cleanDraft = copy(state.draft); cleanDraft.receiptTotal = totalUnknown.input.checked ? null : number(totalInput.value); cleanDraft.shopSessionId = trip.input.checked ? shopSessionId : null;
          for (const line of cleanDraft.lines) { if (line.sourceKind !== 'purchase') line.reviewed = line._includeAdjustment !== false && line.reviewed; delete line._includeAdjustment; delete line._measurementMode; }
          const normalized = await inventory().normalizeDraft(cleanDraft, { market, retailer });
          if (!alive(revision) || !guard()) { inventory().cancelDraft?.(normalized); return; }
          const result = await inventory().commitReviewedReceipt(normalized, { idempotencyKey: state.requestId, signal: state.controller.signal });
          if (!alive(revision)) return;
          const currentSession = session();
          if (!currentSession || currentSession.actorId !== captured?.actorId || currentSession.token !== captured?.token) { state.close(); return; }
          if (result.committed === true) finished(result); else throw Error('The receipt was not confirmed.');
        } catch (error) {
          if (!alive(revision)) return;
          if (error.commitUnknown || error.recoveryRequired) { state.frozen = true; recover.hidden = false; retry.hidden = true; status.textContent = 'Confirmation may have reached the server. Check the saved receipt before retrying; this prevents duplicate stock.'; }
          else { status.textContent = message(error); if (/pantry_merge|revision_conflict|household_scope/.test(error.message || '')) onNeedsPantryReview?.({ reason: error.message, receiptId: state.draft.receiptId }); }
        } finally { if (alive(revision)) { state.busy = false; update(); } }
      });
      async function recoveryAction(retryRequest) {
        if (state.busy || !guard()) return; state.busy = true; update(); state.controller = new AbortController();
        status.textContent = retryRequest ? 'Retrying the same saved confirmation…' : 'Checking the saved receipt…';
        try {
          inventory().recoverLocalTransaction?.();
          const result = retryRequest ? await inventory().retryPendingConfirmation({ signal: state.controller.signal }) : await inventory().synchronize({ signal: state.controller.signal });
          if (!alive()) return;
          if (result.localApplied) finished({ ...result, ok: true, committed: true, recovered: true });
          else { recover.hidden = false; retry.hidden = result.pendingReceipt !== true; status.textContent = result.pendingReceipt ? 'The confirmation has not been found yet. Retry the same reviewed receipt; do not start a new scan.' : 'Receipt saved online. Pantry still needs a refresh or review before this device can use it.'; }
        } catch (error) { if (alive()) status.textContent = message(error); }
        finally { if (alive()) { state.busy = false; update(); } }
      }
      recover.addEventListener('click', () => recoveryAction(false)); retry.addEventListener('click', () => recoveryAction(true));
      if (typeof dialog.showModal === 'function') dialog.showModal(); else { dialog.open = true; dialog.setAttribute('open', ''); }
      closeButton.focus?.();
      try {
        const result = await Promise.all([availability({ market, retailer }), core(), inventory().canonicalOptions()]);
        if (!alive()) return dialog;
        state.ready = result[0]; state.core = result[1]; state.choices = result[2].slice(0, 5000);
        for (const choice of state.choices) list.append(element('option', { value: choice.key }, choice.name));
        if (!state.ready.available) status.textContent = state.ready.reason;
        else {
          status.textContent = 'Choose a receipt photo. Nothing is added until you review and confirm.';
          if (state.ready.turnstileRequired) {
            if (root.turnstile?.render && state.ready.siteKey) state.widget = root.turnstile.render(challenge, { sitekey: state.ready.siteKey, action: 'bb_ai', callback: token => { if (alive()) { state.challengeToken = token; update(); } }, 'expired-callback': () => { state.challengeToken = ''; update(); } });
            else status.textContent = 'The security check is unavailable. Reopen the scanner when it is ready.';
          }
        }
      } catch (error) { if (alive()) { state.ready = { available: false }; status.textContent = message(error); } }
      if (alive()) { update(); if (!file.disabled) file.focus?.(); }
      return dialog;
    }
    return Object.freeze({ configure(value) { options = { ...options, ...value }; return this; }, availability, preparePhoto, readReceipt, open, close() { current?.close(); } });
  }
  root.BBReceiptScannerFactory = createReceiptScanner;
  root.BBReceiptScanner = createReceiptScanner();
})(typeof window !== 'undefined' ? window : globalThis);
