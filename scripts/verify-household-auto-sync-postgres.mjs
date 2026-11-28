// Real, isolated PostgreSQL verification. No remote database or credentials.
// Usage: BB_POSTGRES_BIN=/path/to/postgres/bin node scripts/verify-household-auto-sync-postgres.mjs
// Requires initdb, pg_ctl, psql and the matching pgcrypto extension files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID, createHash} from 'node:crypto';

const run = promisify(execFile);
const root = new URL('../', import.meta.url);
const binary = name => process.env.BB_POSTGRES_BIN ? path.join(process.env.BB_POSTGRES_BIN, name) : name;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'basketboss-sync-postgres-'));
const data = path.join(directory, 'data');
const log = path.join(directory, 'postgres.log');
// The server listens only on this private Unix socket. No TCP port is opened.
const port = 57000 + Math.floor(Math.random() * 5000);
const actor = '11111111-1111-4111-8111-111111111111';
const partner = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const unconfirmed = '44444444-4444-4444-8444-444444444444';
const household = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const syncFile = 'sql/basketboss_household_auto_sync_v2_20261128.sql';
const migrations = [
  'sql/basketboss_household_production_20261029.sql',
  'sql/basketboss_receipt_inventory_20261031.sql',
  'sql/basketboss_account_deletion_20261031.sql',
  'supabase/migrations/20261104174441_receipt_auto_stock_policy.sql',
  'supabase/migrations/20261104174450_pantry_fractional_stock_balances.sql',
  'supabase/migrations/20261105084102_receipt_household_price_projection.sql'
];
let started = false, checks = 0;
const literal = value => value === null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const json = value => literal(JSON.stringify(value)) + '::jsonb';
const psqlArguments = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', directory, '-p', String(port), '-U', 'postgres', '-d', 'postgres'];
async function sql(source) {
  const child = execFile(binary('psql'), psqlArguments, {maxBuffer: 8 * 1024 * 1024});
  child.stdin.end(source);
  return await new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(stdout.trim()) : reject(Object.assign(Error(stderr.trim()), {code})));
  });
}
const result = async source => JSON.parse((await sql(source)).split('\n').filter(Boolean).at(-1));
const check = async (label, work) => {await work(); checks++; console.log('PASS ' + label);};
const rpcSql = (action, payload = {}, {user = actor, id = household, inventory = true} = {}) =>
  `SELECT public.bb_hh_service_sync_v2(${literal(user)}::uuid,${literal(id)}::uuid,${literal(action)},${json(payload)},${inventory});`;
const rpc = (action, payload, options) => result(rpcSql(action, payload, options));
const read = options => rpc('get', {}, options);
async function reserve(target, value, options = {}) {
  const {user, inventory, id, operationId = randomUUID(), baseClock = (await read({user, inventory, id})).clock} = options;
  const body = {expectedHouseholdId: id || household, operationId, baseClock, target, value};
  return {body, answer: await rpc('reserve', body, {user, inventory, id})};
}
const apply = (reserved, options) => rpc('apply', {
  expectedHouseholdId: reserved.body.expectedHouseholdId,
  operationId: reserved.body.operationId,
  order: reserved.answer.operation.order
}, options);
const dinner = day => ({kind: 'dinner', key: day});
const pantry = key => ({kind: 'pantry', key});
const entry = (state, section, key) => state.entries.find(row => row.section === section && row.entry_key === key);
const identity = reserved => ({id: reserved.body.operationId, order: reserved.answer.operation.order});
const entrySnapshot = () => sql(`SELECT jsonb_agg(to_jsonb(e) ORDER BY section,entry_key)
  FROM public.bb_household_entries e WHERE household_id='${household}';`);
const inventorySnapshot = () => result(`SELECT public.bb_receipt_inventory_snapshot('household','${household}',NULL);`);
function receiptSql(body) {
  const {inventoryBaseline, expectedScope, requestId, priceObservations, ...semantic} = body;
  const hash = createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
  return `SELECT public.bb_receipt_inventory_service('${actor}','household','${household}','confirm_receipt',
    ${literal(requestId)},${literal(body.receiptId)},${literal(hash)},${json(body)});`;
}
async function receiptBody(receiptId) {
  const inventory = await inventorySnapshot();
  return {
    action: 'confirm_receipt', requestId: receiptId + ':confirm', receiptId, addToPantry: true,
    expectedScope: {kind: 'household', id: household},
    shopSessionId: 'sync-test', market: 'UK', currency: 'GBP', retailer: 'Test shop',
    purchasedAt: '2026-11-28T07:00:00Z', receiptTotal: 1.25, adjustments: [],
    inventoryBaseline: {stock: inventory.stock, expectedRevision: inventory.inventoryRevision, initialize: false},
    lines: [{lineId: 'line-1', kind: 'food', canonicalKey: 'pasta', name: 'Pasta', brand: '',
      quantity: 500, unit: 'g', packCount: 1, packQuantity: 500, packUnit: 'g',
      pricePaid: 1.25, priceType: 'regular', location: 'cupboard'}], priceObservations: []
  };
}
async function waitForSleep(applicationName) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${literal(applicationName)} AND wait_event='PgSleep';`) === '1') return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error('Concurrent PostgreSQL transaction did not reach the synchronization barrier.');
}

async function setup() {
  for (const name of ['initdb', 'pg_ctl', 'psql']) {
    try {execFileSync(binary(name), ['--version'], {stdio: 'ignore'});}
    catch {throw Error('PostgreSQL binaries unavailable; set BB_POSTGRES_BIN to a matching PostgreSQL bin directory.');}
  }
  await run(binary('initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'], {maxBuffer: 1024 * 1024});
  await run(binary('pg_ctl'), ['-D', data, '-l', log, '-o', `-c listen_addresses= -c unix_socket_directories=${directory} -c port=${port} -c max_connections=20 -c shared_buffers=16MB -c fsync=off`, '-w', 'start']);
  started = true;
  await sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),not_after timestamptz);
    CREATE TABLE auth.refresh_tokens(id integer PRIMARY KEY,user_id text);
    CREATE TABLE auth.flow_state(id integer PRIMARY KEY,user_id uuid,linking_target_id uuid);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    INSERT INTO auth.users VALUES
      ('${actor}','owner@example.invalid','2026-10-01'),
      ('${partner}','partner@example.invalid','2026-10-01'),
      ('${outsider}','other@example.invalid','2026-10-01'),
      ('${unconfirmed}','unconfirmed@example.invalid',NULL);
    INSERT INTO auth.sessions(id,user_id) VALUES
      ('66666666-6666-4666-8666-666666666666','${actor}'),
      ('77777777-7777-4777-8777-777777777777','${partner}');
    INSERT INTO auth.refresh_tokens VALUES(1,'${actor}'),(2,'${partner}');
    INSERT INTO auth.flow_state VALUES(1,'${actor}',NULL),(2,'${partner}','${actor}'),(3,'${partner}',NULL);`);
  for (const file of migrations) await sql(fs.readFileSync(new URL(file, root), 'utf8'));
  await sql(`INSERT INTO public.bb_households(id,owner_user_id,partner_user_id,partner_email,invite_status)
    VALUES('${household}','${actor}','${partner}','partner@example.invalid','accepted');`);
}

try {
  await setup();
  const schemaBefore = await result(`SELECT jsonb_agg(x ORDER BY x.table_name,x.ordinal_position) FROM (
    SELECT table_name,column_name,data_type,ordinal_position FROM information_schema.columns
    WHERE table_schema='public' AND table_name LIKE 'bb_%') x;`);
  const migration = fs.readFileSync(new URL(syncFile, root), 'utf8');
  await sql(migration);
  await sql(migration);
  const schemaAfter = await result(`SELECT jsonb_agg(x ORDER BY x.table_name,x.ordinal_position) FROM (
    SELECT table_name,column_name,data_type,ordinal_position FROM information_schema.columns
    WHERE table_schema='public' AND table_name LIKE 'bb_%') x;`);
  await check('function file is repeatable and adds no tables or columns', () => assert.deepEqual(schemaAfter, schemaBefore));
  const deletionReady = await result('SELECT public.bb_account_deletion_ready();');
  await check('real account-deletion migration and guarded household patch remain ready', () => assert.equal(deletionReady.ready, true));

  const initial = await read();
  await check('read does not initialize household inventory', async () => {
    assert.equal(initial.ok, true);
    assert.equal(initial.household_id, household);
    assert.equal(initial.state.initialized, false);
    assert.equal(await sql('SELECT count(*) FROM public.bb_receipt_inventory_scopes;'), '0');
  });
  const mealsOnlyRead = await read({inventory: false});
  await check('an unarmed inventory gate returns shared dinners without exposing stock', () => {
    assert.equal(mealsOnlyRead.ok, true);
    for (const key of ['stock', 'locations', 'inventoryRevision', 'initialized', 'inventory']) assert.equal(Object.hasOwn(mealsOnlyRead.state, key), false);
  });

  const first = await reserve(dinner('Monday'), {recipeId: 'chilli', servings: 4});
  await check('reserve records intent without changing visible dinner', async () => {
    assert.equal(first.answer.operation.status, 'reserved');
    assert.equal(entry((await read()).state, 'planned_day', 'Monday'), undefined);
  });
  const beforeReservedRetry = await entrySnapshot();
  const reservedRetry = await rpc('reserve', first.body);
  const afterReservedRetry = await entrySnapshot();
  await check('retrying a pending reservation performs no hidden metadata writes', () => {
    assert.equal(reservedRetry.operation.status, 'reserved');
    assert.equal(reservedRetry.operation.order, first.answer.operation.order);
    assert.equal(afterReservedRetry, beforeReservedRetry);
  });
  const firstApplied = await apply(first);
  await check('dinner and servings apply together with the reserved order', () => {
    assert.equal(firstApplied.ok, true);
    assert.deepEqual(identity(first), {id: firstApplied.operation.id, order: firstApplied.operation.order});
    assert.equal(firstApplied.operation.status, 'applied');
    assert.deepEqual(entry(firstApplied.state, 'planned_day', 'Monday').value, {recipeId: 'chilli'});
    assert.deepEqual(entry(firstApplied.state, 'servings', 'Monday').value, {count: 4});
  });

  const beforeTerminalRetries = await entrySnapshot();
  const duplicateReserve = await rpc('reserve', first.body);
  const duplicateApply = await apply(first);
  const afterTerminalRetries = await entrySnapshot();
  await check('lost responses retry the same operation without new writes or order', async () => {
    assert.equal(duplicateReserve.operation.order, first.answer.operation.order);
    assert.equal(duplicateReserve.operation.status, 'applied');
    assert.equal(duplicateApply.operation.status, 'applied');
    assert.equal(duplicateApply.clock, firstApplied.clock);
    assert.equal(entry(duplicateApply.state, 'planned_day', 'Monday').revision, entry(firstApplied.state, 'planned_day', 'Monday').revision);
    assert.equal(afterTerminalRetries, beforeTerminalRetries);
  });
  const changedValue = await rpc('reserve', {...first.body, value: {recipeId: 'different', servings: 4}});
  const changedActor = await rpc('reserve', first.body, {user: partner});
  const changedClock = await rpc('reserve', {...first.body, baseClock: first.body.baseClock + 1});
  await check('operation identity binds actor, target, value and original base clock', () => {
    for (const answer of [changedValue, changedActor, changedClock]) assert.equal(answer.ok, false);
  });

  const older = await reserve(dinner('Tuesday'), {recipeId: 'old', servings: 2});
  const newer = await reserve(dinner('Tuesday'), {recipeId: 'new', servings: 6}, {user: partner});
  const newerApplied = await apply(newer, {user: partner});
  const olderApplied = await apply(older);
  await check('later accepted dinner survives an older delayed apply', () => {
    assert.ok(newer.answer.operation.order > older.answer.operation.order);
    assert.equal(newerApplied.operation.status, 'applied');
    assert.equal(olderApplied.operation.status, 'superseded');
    assert.deepEqual(entry(olderApplied.state, 'planned_day', 'Tuesday').value, {recipeId: 'new'});
    assert.deepEqual(entry(olderApplied.state, 'servings', 'Tuesday').value, {count: 6});
    assert.deepEqual(entry(olderApplied.state, 'planned_day', 'Monday').value, {recipeId: 'chilli'});
  });

  const reserveBeforeNewer = await reserve(dinner('Wednesday'), {recipeId: 'outdated', servings: 2});
  const reserveNewer = await reserve(dinner('Wednesday'), {recipeId: 'latest', servings: 3}, {user: partner});
  const staleBeforeLatestApply = await apply(reserveBeforeNewer);
  await apply(reserveNewer, {user: partner});
  await check('newly reserved intent supersedes an older pending intent before apply', () => assert.equal(staleBeforeLatestApply.operation.status, 'superseded'));

  const legacyPending = await reserve(dinner('Thursday'), {recipeId: 'pending', servings: 2});
  await sql(`SELECT public.bb_hh_service_patch('${actor}','${household}','planned_day','Thursday','{"recipeId":"legacy"}',0);
    SELECT public.bb_hh_service_patch('${actor}','${household}','servings','Thursday','{"count":5}',0);`);
  const afterLegacy = await apply(legacyPending);
  await check('legacy row changes after reserve supersede pending dinner atomically', () => {
    assert.equal(afterLegacy.operation.status, 'superseded');
    assert.deepEqual(entry(afterLegacy.state, 'planned_day', 'Thursday').value, {recipeId: 'legacy'});
    assert.deepEqual(entry(afterLegacy.state, 'servings', 'Thursday').value, {count: 5});
  });

  for (const day of ['Friday', 'Saturday', 'Sunday']) {
    await apply(await reserve(dinner(day), {recipeId: 'dinner-' + day, servings: 3}));
  }
  const wholeWeek = await read();
  await check('projection includes all seven dinner days and their servings', () => {
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      assert.equal(typeof entry(wholeWeek.state, 'planned_day', day).value.recipeId, 'string');
      assert.equal(typeof entry(wholeWeek.state, 'servings', day).value.count, 'number');
    }
    assert.equal(wholeWeek.state.entries.some(row => row.entry_key.startsWith('__bb_sync_v2:')), false);
  });
  const clearDinner = await reserve(dinner('Saturday'), {recipeId: null, servings: null});
  const clearedDinner = await apply(clearDinner);
  await check('clearing a dinner writes both meal and servings tombstones', () => {
    assert.deepEqual(entry(clearedDinner.state, 'planned_day', 'Saturday').value, {deleted: true});
    assert.deepEqual(entry(clearedDinner.state, 'servings', 'Saturday').value, {deleted: true});
    assert.deepEqual(entry(clearedDinner.state, 'planned_day', 'Friday').value, {recipeId: 'dinner-Friday'});
  });

  const settings = [
    ['household_servings:default', {count: 4}, 'household_servings', 'default'],
    ['budget_target:weekly', {amount: 35.5}, 'budget_target', 'weekly'],
    ['shopping_checked:pasta', true, 'shopping_checked', 'pasta']
  ];
  for (const [key, value] of settings) await apply(await reserve({kind: 'setting', key}, value));
  const settingSnapshot = await read();
  await check('existing shared settings use the same ordered transport and typed values', () => {
    for (const [, value, section, key] of settings) assert.deepEqual(entry(settingSnapshot.state, section, key).value, value);
  });
  const settingClear = await reserve({kind: 'setting', key: 'budget_target:weekly'}, {deleted: true});
  const clearedSetting = await apply(settingClear);
  await check('clearing a shared setting retains its deletion tombstone', () => {
    assert.deepEqual(entry(clearedSetting.state, 'budget_target', 'weekly').value, {deleted: true});
    assert.deepEqual(entry(clearedSetting.state, 'household_servings', 'default').value, {count: 4});
  });
  const settingPending = await reserve({kind: 'setting', key: 'household_servings:default'}, {count: 2});
  const currentSetting = entry((await read()).state, 'household_servings', 'default');
  await sql(`SELECT public.bb_hh_service_patch('${actor}','${household}','household_servings','default','{"count":6}',${currentSetting.revision});`);
  const settingAfterLegacy = await apply(settingPending);
  await check('a legacy setting update supersedes older pending intent', () => {
    assert.equal(settingAfterLegacy.operation.status, 'superseded');
    assert.deepEqual(entry(settingAfterLegacy.state, 'household_servings', 'default').value, {count: 6});
  });
  await assert.rejects(sql(`SELECT public.bb_hh_service_patch('${actor}','${household}','kitchen_item','__bb_sync_v2:clock','{}',0);`), /invalid_patch/);
  await check('legacy patch cannot write the reserved synchronization namespace', () => assert.ok(true));

  // Pantry writes intentionally require an already initialized owner scope.
  const beforeInitialization = await reserve(pantry('pasta|g'), {quantity: 250, location: 'cupboard'});
  const withoutInventoryGate = await reserve(pantry('pasta|g'), {quantity: 250, location: 'cupboard'}, {inventory: false});
  await check('pantry cannot bypass initialization or the upstream inventory gate', () => {
    assert.equal(beforeInitialization.answer.ok, false);
    assert.equal(withoutInventoryGate.answer.ok, false);
  });
  await sql(`INSERT INTO public.bb_receipt_inventory_scopes(scope_kind,scope_id,household_id,initialized,inventory_revision,stock,locations)
    VALUES('household','${household}','${household}',true,1,'{"pasta|g":500,"egg|each":4.5}', '{"pasta|g":"cupboard","egg|each":"fridge"}');`);
  const pasta = await reserve(pantry('pasta|g'), {quantity: 125.5, location: 'cupboard'});
  const egg = await reserve(pantry('egg|each'), {quantity: 2.25, location: 'fridge'}, {user: partner});
  await apply(egg, {user: partner});
  const stockAfterIndependent = await apply(pasta);
  await check('independent pantry edits preserve fractional amounts and other items', () => {
    assert.deepEqual(stockAfterIndependent.state.stock, {'pasta|g': 125.5, 'egg|each': 2.25});
    assert.deepEqual(stockAfterIndependent.state.locations, {'pasta|g': 'cupboard', 'egg|each': 'fridge'});
  });
  await check('inventory projection is the complete existing household receipt snapshot', async () => {
    assert.deepEqual(stockAfterIndependent.state.inventory, await inventorySnapshot());
    assert.deepEqual(stockAfterIndependent.state.inventory.scope, {kind: 'household', id: household});
  });
  const oldAppliedRetry = await apply(first);
  await check('an old applied-operation retry acknowledges its original order and returns latest household state', () => {
    assert.equal(oldAppliedRetry.operation.status, 'applied');
    assert.equal(oldAppliedRetry.operation.order, first.answer.operation.order);
    assert.equal(oldAppliedRetry.clock, stockAfterIndependent.clock);
    assert.deepEqual(oldAppliedRetry.state, stockAfterIndependent.state);
  });

  const pantryOld = await reserve(pantry('pasta|g'), {quantity: 999, location: 'cupboard'});
  const pantryDelete = await reserve(pantry('pasta|g'), {quantity: 0, location: 'cupboard'}, {user: partner});
  await apply(pantryDelete, {user: partner});
  const pantryOldApplied = await apply(pantryOld);
  await check('new pantry removal is a durable tombstone against delayed old quantities', () => {
    assert.equal(pantryOldApplied.operation.status, 'superseded');
    assert.equal(Object.hasOwn(pantryOldApplied.state.stock, 'pasta|g'), false);
    assert.equal(Object.hasOwn(pantryOldApplied.state.locations, 'pasta|g'), false);
    assert.equal(pantryOldApplied.state.stock['egg|each'], 2.25);
  });

  const sameItemPending = await reserve(pantry('pasta|g'), {quantity: 20, location: 'cupboard'});
  const firstReceipt = await receiptBody('receipt-interleave');
  const concurrentReceipt = sql(`SET application_name='bb-test-receipt-interleave'; BEGIN;
    SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='5s';
    ${receiptSql(firstReceipt)} SELECT pg_sleep(0.4); COMMIT;`);
  await waitForSleep('bb-test-receipt-interleave');
  const pendingAgainstReceipt = await apply(sameItemPending);
  const concurrentOutput = await concurrentReceipt;
  const receiptAnswer = JSON.parse(concurrentOutput.split('\n').find(line => line.startsWith('{')));
  await check('receipt commit and pending same-item apply serialize without a deadlock or lost purchase', () => {
    assert.equal(receiptAnswer.ok, true);
    assert.equal(pendingAgainstReceipt.operation.status, 'superseded');
    assert.equal(pendingAgainstReceipt.state.stock['pasta|g'], 500);
    assert.equal(pendingAgainstReceipt.state.stock['egg|each'], 2.25);
  });

  const unrelatedPending = await reserve(pantry('egg|each'), {quantity: 1.125, location: 'fridge'});
  const secondReceipt = await receiptBody('receipt-unrelated');
  const secondReceiptAnswer = await result(receiptSql(secondReceipt));
  const accountingBeforeEdit = await sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY receipt_id) FROM public.bb_receipt_inventory_receipts r;`);
  const unrelatedAfterReceipt = await apply(unrelatedPending);
  const accountingAfterEdit = await sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY receipt_id) FROM public.bb_receipt_inventory_receipts r;`);
  const receiptReplay = await result(receiptSql(secondReceipt));
  await check('receipt changes to another item preserve pending edits and immutable receipt accounting', () => {
    assert.equal(secondReceiptAnswer.ok, true);
    assert.equal(unrelatedAfterReceipt.operation.status, 'applied');
    assert.equal(unrelatedAfterReceipt.state.stock['pasta|g'], 1000);
    assert.equal(unrelatedAfterReceipt.state.stock['egg|each'], 1.125);
    assert.equal(accountingAfterEdit, accountingBeforeEdit);
    assert.equal(receiptReplay.ok, true);
    assert.equal(receiptReplay.duplicate, true);
    assert.equal(receiptReplay.stock['pasta|g'], 1000);
  });

  const invalidBefore = await read();
  const invalidBodies = [
    {...first.body, operationId: randomUUID(), target: dinner('Someday')},
    {...first.body, operationId: randomUUID(), target: dinner('Friday'), value: {recipeId: 'a', servings: 13}},
    {...first.body, operationId: randomUUID(), target: dinner('Friday'), value: {recipeId: 'a', servings: 2, unexpected: true}},
    {...first.body, operationId: randomUUID(), target: pantry('pasta|g'), value: {quantity: -1, location: 'cupboard'}},
    {...first.body, operationId: randomUUID(), target: pantry('soap|each'), value: {quantity: 1, location: 'cupboard'}},
    {...first.body, operationId: randomUUID(), target: pantry('pasta|g'), value: {quantity: 1, location: 'shelf'}},
    {...first.body, operationId: randomUUID(), unexpected: true},
    {...first.body, operationId: randomUUID(), expectedHouseholdId: outsider}
  ];
  const invalidAnswers = [];
  for (const body of invalidBodies) invalidAnswers.push(await rpc('reserve', body));
  const wrongOrder = await rpc('apply', {expectedHouseholdId: household, operationId: first.body.operationId, order: first.answer.operation.order + 1});
  await check('malformed payloads and changed apply order fail without mutating state or clock', async () => {
    for (const answer of [...invalidAnswers, wrongOrder]) assert.equal(answer.ok, false);
    assert.deepEqual(await read(), invalidBefore);
  });

  const pruneBase = (await read()).clock;
  await sql(`DO $prune$
    DECLARE i integer; current_clock bigint := ${pruneBase}; response jsonb;
    BEGIN FOR i IN 1..1032 LOOP
      response := public.bb_hh_service_sync_v2('${actor}','${household}','reserve',jsonb_build_object(
        'expectedHouseholdId','${household}',
        'operationId','55555555-5555-4555-8555-'||lpad(i::text,12,'0'),
        'baseClock',current_clock,'target',jsonb_build_object('kind','dinner','key','Sunday'),
        'value',jsonb_build_object('recipeId','pruning-'||i::text,'servings',2)),true);
      IF response->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'prune reserve failed: %',response; END IF;
      current_clock := (response->>'clock')::bigint;
    END LOOP; END $prune$;`);
  const prunedRead = await read();
  const expiredReserve = await rpc('reserve', first.body);
  const expiredApply = await apply(first);
  await check('bounded operation history prevents pruned old retries from becoming fresh edits', async () => {
    assert.ok(prunedRead.pruneFloor > first.body.baseClock);
    assert.equal(expiredReserve.ok, true);
    assert.equal(expiredReserve.operation.status, 'expired');
    assert.equal(expiredApply.ok, true);
    assert.equal(expiredApply.operation.status, 'expired');
    assert.equal((await read()).clock, prunedRead.clock);
    const rowStats = await result(`SELECT jsonb_build_object('ops',count(*) FILTER(WHERE entry_key LIKE '__bb_sync_v2:op:%'),
      'largest',max(octet_length(value::text))) FROM public.bb_household_entries WHERE entry_key LIKE '__bb_sync_v2:%';`);
    assert.ok(rowStats.ops >= 1024 && rowStats.ops <= 1032, JSON.stringify(rowStats));
    assert.ok(rowStats.largest <= 8192);
  });

  const outsiderAnswer = await read({user: outsider});
  const unconfirmedAnswer = await read({user: unconfirmed});
  await check('database rechecks accepted membership and confirmed identity', () => {
    assert.equal(outsiderAnswer.ok, false);
    assert.equal(unconfirmedAnswer.ok, false);
  });
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(sql(`SET ROLE ${role}; SELECT * FROM public.bb_household_entries;`), /permission denied/i);
    await assert.rejects(sql(`SET ROLE ${role}; ${rpcSql('get')}`), /permission denied/i);
  }
  const serviceRead = await result('SET ROLE service_role; ' + rpcSql('get'));
  await check('browser roles cannot read metadata or execute sync RPC; service role can', () => assert.equal(serviceRead.ok, true));

  await sql(`SELECT public.bb_hh_service_unlink('${actor}');`);
  const removedPartner = await read({user: partner});
  const ownerAfterUnlink = await read();
  await check('unlink immediately revokes partner access and preserves owner inventory', () => {
    assert.equal(removedPartner.ok, false);
    assert.equal(ownerAfterUnlink.ok, true);
    assert.equal(ownerAfterUnlink.state.stock['pasta|g'], 1000);
  });

  const current = await read();
  await sql(migration);
  const afterReapply = await read();
  await check('reapplying functions preserves household state and operation history', () => {
    assert.deepEqual(afterReapply, current);
  });
  const drainingSync = sql(`SET application_name='bb-test-delete-barrier'; BEGIN;
    SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='5s';
    ${rpcSql('get')} SELECT pg_sleep(0.4); COMMIT;`);
  await waitForSleep('bb-test-delete-barrier');
  const deletedOwner = await result(`SET lock_timeout='3s'; SET statement_timeout='5s';
    SELECT public.bb_account_delete_data('${actor}','owner@example.invalid');`);
  await drainingSync;
  await check('real account deletion drains in-flight sync and removes household metadata and inventory', async () => {
    assert.equal(deletedOwner.deleted, true);
    assert.equal(await sql(`SELECT count(*) FROM public.bb_households WHERE id='${household}';`), '0');
    assert.equal(await sql(`SELECT count(*) FROM public.bb_household_entries WHERE household_id='${household}';`), '0');
    assert.equal(await sql(`SELECT count(*) FROM public.bb_receipt_inventory_scopes WHERE scope_kind='household' AND scope_id='${household}';`), '0');
    assert.equal(await sql(`SELECT count(*) FROM public.bb_receipt_inventory_receipts WHERE scope_kind='household' AND scope_id='${household}';`), '0');
    assert.equal(await sql(`SELECT count(*) FROM auth.sessions WHERE user_id='${actor}';`), '0');
    assert.equal(await sql(`SELECT count(*) FROM auth.refresh_tokens WHERE user_id='${actor}';`), '0');
    assert.equal(await sql(`SELECT count(*) FROM auth.flow_state WHERE user_id='${actor}' OR linking_target_id='${actor}';`), '0');
    assert.equal(await sql(`SELECT count(*) FROM auth.refresh_tokens WHERE user_id='${partner}';`), '1');
    assert.equal(await sql(`SELECT count(*) FROM auth.flow_state WHERE user_id='${partner}';`), '1');
  });
  const deletedRetry = await result(`SELECT public.bb_account_delete_data('${actor}','owner@example.invalid');`);
  const delayedAfterDeletion = await apply(pasta);
  await check('deletion retries stay idempotent and delayed operations cannot restore deleted data', () => {
    assert.equal(deletedRetry.deleted, true);
    assert.equal(delayedAfterDeletion.ok, false);
    assert.equal(delayedAfterDeletion.forbidden, true);
  });
  console.log(JSON.stringify({status: 'passed', checks, engine: 'isolated PostgreSQL', version: execFileSync(binary('postgres'), ['--version'], {encoding: 'utf8'}).trim(), productionWrites: false}));
} catch (error) {
  console.error('PostgreSQL household sync verification failed:', String(error?.message || error).slice(0, 2500));
  if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8').split('\n').slice(-18).join('\n'));
  process.exitCode = 1;
} finally {
  if (started) await run(binary('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']).catch(() => {});
  fs.rmSync(directory, {recursive: true, force: true});
}
