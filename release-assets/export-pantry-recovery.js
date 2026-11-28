/* Download-only pantry recovery export. No network or storage writes. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {module.exports = api;return;}
  const result = api.collect(root.localStorage);
  if (!result.ok) {console.warn(result.error);return result;}
  const blob = new Blob([JSON.stringify(result, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;link.download = 'BasketBoss-pantry-recovery-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  document.body.append(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url), 1000);
  const summary = result.copies.map(({source, savedAt, stockItems, kitchenItems}) => ({source, savedAt, stockItems, kitchenItems}));
  console.table(summary);
  console.info('Pantry recovery copies downloaded. Nothing was restored, uploaded or changed in app storage.');
  return {ok:true,copies:summary,unreadable:result.unreadable};
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const STOCK = 'basketboss_321_v7_measured_pantry', KITCHEN = 'basketboss_makeameal_v1_inventory';
  const AUTH = 'basketboss_cloud_session_v1', CONFIRMED = 'basketboss_ui_next_confirmed_pantry_v1';
  const fields = [STOCK,KITCHEN,CONFIRMED];
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function parse(value) {return typeof value === 'string' ? JSON.parse(value) : value;}
  function collect(storage) {
    let actor, keys;
    try {
      actor = JSON.parse(storage.getItem(AUTH) || 'null')?.user?.id;
      if (typeof actor !== 'string' || !/^[0-9a-f-]{36}$/i.test(actor)) return {ok:false,error:'Open the affected BasketBoss app while signed into the account that owns this pantry. Nothing was changed.'};
      keys = Array.from({length:storage.length}, (_, i) => storage.key(i)).filter(key => typeof key === 'string');
    } catch {return {ok:false,error:'Device storage could not be read. Nothing was changed.'};}
    const copies = [], unreadable = [];
    function add(source, values, savedAt = null) {
      if (!object(values)) return;
      const physical = {};
      for (const key of fields) if (Object.hasOwn(values,key)) physical[key] = parse(values[key]);
      if (!Object.keys(physical).length) return;
      const stock = physical[STOCK], kitchen = physical[KITCHEN];
      if (stock !== null && stock !== undefined && !object(stock) || kitchen !== null && kitchen !== undefined && !object(kitchen)) throw Error('Unreadable pantry copy');
      copies.push({source,savedAt,stockItems:Object.values(stock || {}).filter(value => typeof value === 'number' && value > 0).length,
        kitchenItems:Object.values(kitchen || {}).filter(row => object(row) && row.selected === true).length,values:physical});
    }
    try {add('current-pantry', Object.fromEntries(fields.map(key => [key,storage.getItem(key)])));} catch {unreadable.push('current-pantry');}
    for (const key of keys) {
      if (!key.startsWith('basketboss_pantry_scope_backup_v1:') && !key.startsWith('bb_partner_premerge_') &&
          key !== 'basketboss_receipt_host_snapshot_v1:' + encodeURIComponent(actor) && key !== 'basketboss_receipt_host_snapshot_v1:guest' &&
          !key.startsWith('basketboss_household_auto_premerge_v2:')) continue;
      try {
        const saved = JSON.parse(storage.getItem(key));if (!object(saved)) continue;
        if (key.startsWith('basketboss_pantry_scope_backup_v1:')) {
          if (saved.actorId !== actor || saved.pantry?.actorId !== actor) continue;
          add(key,saved.pantry.values,saved.createdAt || null);
        } else if (key.startsWith('bb_partner_premerge_')) {
          if (!Object.keys(saved).some(name => name.startsWith('bb_partner_baseline_v1_') && name.endsWith('_' + actor))) continue;
          add(key,saved,Number(key.match(/^bb_partner_premerge_(\d+)/)?.[1]) || null);
        } else if (key.startsWith('basketboss_household_auto_premerge_v2:')) {
          if (saved.actorId === actor) add(key,saved.before);
        } else if (key.endsWith(':guest')) {
          if (saved.actorId === 'guest' && saved.claimedBy === actor) add(key,saved.claimedValues);
        } else if (saved.actorId === actor) add(key,saved.values);
      } catch {unreadable.push(key);}
    }
    return {ok:true,version:1,createdAt:new Date().toISOString(),purpose:'Read-only physical pantry recovery copies; no account tokens, receipt ledger or automatic restoration.',copies,unreadable};
  }
  return {collect};
});
