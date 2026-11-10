import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Run with node --test tests/basketboss-shopping-header-browser.test.mjs.
// BB_PLAYWRIGHT_MODULE and BB_CHROMIUM_PATH support an existing browser runtime.
const require = createRequire(import.meta.url);
let chromium;
for (const name of [process.env.BB_PLAYWRIGHT_MODULE, 'playwright', '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(name)); break; } catch {}
}
const root = fileURLToPath(new URL('..', import.meta.url));
const actor = '00000000-0000-4000-8000-000000000019';
const household = '00000000-0000-4000-8000-000000000020';
const sharedItems = [
  {id:'00000000-0000-4000-8000-000000000031',household_id:household,name:'Eggs',quantity:1,unit:'pack',completed:false,completed_by:null,revision:1,created_by:'00000000-0000-4000-8000-000000000021',added_by_name:'Sam'},
  {id:'00000000-0000-4000-8000-000000000032',household_id:household,name:'Toothpaste',quantity:1,unit:'each',completed:false,completed_by:null,revision:1,created_by:actor,added_by_name:'Alex'},
  {id:'00000000-0000-4000-8000-000000000033',household_id:household,name:'Former member extra',quantity:1,unit:'each',completed:false,completed_by:null,revision:1,created_by:null,added_by_name:null},
];
const output = process.env.BB_SHOPPING_HEADER_SCREENSHOTS || '';
const bridge = `window.__shoppingHeaderQA = {
  ready: () => typeof RECIPES !== 'undefined' && RECIPES.length > 0,
  open() {
    state.planned = [{recipeId:'fajitas',day:'Monday'},{recipeId:'tuna-sweetcorn-pasta',day:'Tuesday'}];
    state.plannedBreakfasts = []; state.plannedDesserts = []; state.servings = 4;
    state.pantry = {}; state.mealPreferences = null; persist(); tab = 'shop'; render();
    return window.BBWeeklyShop.start();
  },
  session: () => bbShopV7Session(),
  rows: () => bb172StorefrontAll().map(row => ({id:row.id,name:row.name,checked:row.checked}))
};`;

async function fixture(browser, width) {
  let sharedRows = sharedItems;
  const original = await fs.readFile(path.join(root, 'app.html'), 'utf8');
  const marker = 'window.BBHomeHost=Object.freeze({';
  assert.ok(original.includes(marker), 'the full application contains the test bridge anchor');
  const app = original.replace(marker, bridge + marker);
  const context = await browser.newContext({
    viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
    reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  // Every request is fulfilled locally. No fixture can mutate a real account.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname.endsWith('.supabase.co')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.pathname.includes('/auth/v1/user') ? {id:actor,email:'shopping-header@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'} : []) });
    }
    if (!['basketboss.co.uk', 'www.basketboss.co.uk'].includes(url.hostname)) return route.fulfill({status:200,body:''});
    if (url.pathname.startsWith('/api/')) {
      let data = {ok:true};
      if (url.pathname === '/api/subscription/status') data = {authenticated:true,tier:'owner',premium:true,premiumAccess:true,mode:'live',subscription:null};
      else if (url.pathname === '/api/household') data = url.searchParams.get('mode') === 'shopping' ? {ok:true,household_id:household,items:sharedRows} : {configured:true,premium:true,role:'owner',household_id:household,invite_status:'none',partner_email:null};
      else if (url.pathname === '/api/receipt-inventory') data = {ok:true,configured:false,available:false};
      else if (url.pathname === '/api/shopping/weekly-trip') data = {ok:true,allowed:true,premium:true};
      else if (url.pathname === '/api/bb173/status') data = {status:'available',premium_ai:true,turnstileRequired:false};
      else if (url.pathname === '/api/recipes/v700/premium') return route.fulfill({status:403,contentType:'application/json',body:'{"error":"No premium catalogue in this local fixture"}'});
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    }
    const aliases = {'/app':'app.html','/app.html':'app.html','/index.html':'app.html','/index':'app.html','/':'welcome.html'};
    let relative = aliases[url.pathname] || decodeURIComponent(url.pathname).replace(/^\//, '');
    if (relative.includes('..')) return route.fulfill({status:404,body:''});
    if (relative.startsWith('release-assets/')) {
      try { await fs.access(path.join(root, relative)); }
      catch { relative = 'catalogues/700/release/assets/' + relative; }
    }
    try {
      const body = relative === 'app.html' ? app : await fs.readFile(path.join(root, relative));
      const types = {'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
      return route.fulfill({status:200,contentType:types[path.extname(relative)] || 'application/octet-stream',body});
    } catch { return route.fulfill({status:404,body:''}); }
  });
  await context.addInitScript(({actor}) => {
    const expires = Math.floor(Date.now()/1000) + 7200;
    const encode = value => btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    const user = {id:actor,email:'shopping-header@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'};
    localStorage.setItem('basketboss_cloud_session_v1', JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user}));
    localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'fajitas',day:'Monday'},{recipeId:'tuna-sweetcorn-pasta',day:'Tuesday'}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:['Vegetarian'],goals:['Waste less food']}}));
    localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));
    localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));
    localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
    sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
    localStorage.setItem('basketboss_321_v7_market','Guernsey');
    localStorage.setItem('basketboss_v172_weekly_budget_target_v1','150');
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text => {window.__shoppingCopied=text;}}});
  }, {actor});
  await page.goto('https://basketboss.co.uk/app', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.__shoppingHeaderQA?.ready() && window.BBWeeklyShop);
  await page.evaluate(() => window.__shoppingHeaderQA.open());
  await page.locator('#bb172Storefront .bb172-storefront-checkbox').first().waitFor();
  return {page,context,errors,preview:async()=>{
    sharedRows=sharedItems.slice(0,2);
    await page.evaluate(()=>window.BBSharedShopping.refresh({force:true}));
    await page.waitForFunction(()=>document.querySelectorAll('#bbSharedShopping .bbss-item').length===2);
  }};
}

async function screenshot(page, name) {
  if (!output) return;
  await fs.mkdir(output, {recursive:true});
  await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});
}

for (const width of [320, 390]) {
  test(`shopping summary collapses, survives tick repaint and restores the app header at ${width}px`, {skip:!chromium && 'Install Playwright or set BB_PLAYWRIGHT_MODULE',timeout:60000}, async () => {
    const browser = await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
    let context, page;
    try {
      const fixtureResult = await fixture(browser, width);
      ({page,context} = fixtureResult); const {errors} = fixtureResult;
      const shell = page.locator('#bb172Storefront');
      await screenshot(page, `${width}-expanded`);
      assert.equal(await page.locator('.shell > header.top').isVisible(),false,'ordinary green app header is hidden in shopping mode');
      assert.equal(await shell.getAttribute('data-bb-shop-compact'),'false');
      assert.ok(await shell.locator('.bb172-storefront-header').evaluate(node=>node.getBoundingClientRect().height)>100,'blue summary starts expanded');
      const shared = shell.locator('#bbSharedShopping');
      await shared.locator('.bbss-item').first().waitFor();
      assert.equal(await shared.locator('.bbss-partner-badge').count(),1,'only another current household member gets the partner badge');
      assert.match(await shared.locator('.is-partner-added').textContent(),/Eggs.*Partner added.*Added by Sam/);
      assert.equal(await shared.getByRole('button',{name:'Partner Sharing',exact:true}).isVisible(),true);
      assert.equal(await shared.getByRole('button',{name:'＋ Add item',exact:true}).isVisible(),true);
      await shared.scrollIntoViewIfNeeded();
      await screenshot(page, `${width}-partner-badges`);
      await fixtureResult.preview();
      await shell.evaluate(node=>{node.scrollTop=0;});
      await page.waitForFunction(() => document.getElementById('bb172Storefront')?.dataset.bbShopCompact === 'false');
      await screenshot(page, `${width}-expanded-preview`);
      await shell.evaluate(node=>{node.scrollTop=Number(node.dataset.bbShopCollapseAt)+4;});
      await page.waitForFunction(() => document.getElementById('bb172Storefront')?.dataset.bbShopCompact === 'true');
      await screenshot(page, `${width}-compact-partner-badges`);
      await screenshot(page, `${width}-compact-preview`);
      const total = (await page.evaluate(() => window.__shoppingHeaderQA.rows())).length;
      assert.ok(total > 5, 'real planned recipes produce a scrollable shopping list');
      const session = await page.evaluate(() => window.__shoppingHeaderQA.session().id);
      await shell.evaluate(node => {node.scrollTop=Math.max(550,node.querySelector('.bb172-storefront-aisles').offsetTop-120);});
      await page.waitForFunction(() => document.getElementById('bb172Storefront')?.dataset.bbShopCompact === 'true');
      const compact = shell.locator('.bb172-storefront-compact');
      await screenshot(page, `${width}-compact`);
      const bounds = await compact.evaluate(node => {const rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,right:rect.right,width:rect.width,height:rect.height,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,text:node.textContent};});
      assert.ok(Math.abs(bounds.x)<1 && Math.abs(bounds.right-width)<1,'compact summary spans the viewport width');
      assert.ok(Math.abs(bounds.y)<=1,`compact summary sticks to the screen top (${bounds.y}px)`);
      assert.ok(bounds.height<=76,'compact summary is slim');
      assert.ok(bounds.scrollWidth<=bounds.clientWidth+1,'budget and counter fit without horizontal scrolling');
      assert.match(bounds.text,/£/,'compact summary keeps the remaining estimate');
      assert.match(bounds.text,new RegExp(String(total)),'compact summary shows the item count');
      const checkbox = await shell.locator('.bb172-storefront-checkbox').evaluateAll(nodes => nodes.find(node=>{const rect=node.getBoundingClientRect();return rect.top>100&&rect.bottom<650;})?.getAttribute('aria-label'));
      const before = await shell.evaluate(node => node.scrollTop);
      assert.ok(checkbox, 'a shopping tick is visible beneath the compact summary');
      const point=await shell.getByRole('checkbox',{name:checkbox,exact:true}).evaluate(node=>{const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};});
      await page.touchscreen.tap(point.x,point.y);
      await page.waitForFunction(label => window.__shoppingHeaderQA.rows().find(row=>label==='Mark bought: '+row.name)?.checked,checkbox);
      await page.waitForFunction(() => document.getElementById('bb172Storefront')?.dataset.bbShopCompact === 'true');
      const after = await shell.evaluate(node => node.scrollTop);
      assert.ok(Math.abs(after-before)<=2,`ticking preserves list position (${before} → ${after})`);
      assert.equal(await page.evaluate(() => window.__shoppingHeaderQA.session().id),session,'ticking keeps the shopping session');
      assert.match(await compact.textContent(),new RegExp(String(total-1)),'compact item count updates after a tick');
      await screenshot(page, `${width}-compact-after-tick`);
      await compact.locator('.bb172-storefront-add').click();
      assert.equal(await shared.locator('#bbSharedShoppingForm').isVisible(),true,'compact Add item opens the shared form');
      assert.equal(await shared.locator('input[name="name"]').evaluate(node=>node===document.activeElement),true,'Add item focuses the name field');
      await shared.getByRole('button',{name:'Cancel',exact:true}).click();
      const overflow=await shell.evaluate(node=>({scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,offenders:[...node.querySelectorAll('*')].filter(child=>{const rect=child.getBoundingClientRect();return rect.width&&rect.right>innerWidth+1;}).slice(0,8).map(child=>({tag:child.tagName,classes:child.className,right:child.getBoundingClientRect().right}))}));
      assert.ok(overflow.scrollWidth<=overflow.clientWidth+1,`shopping mode has no horizontal overflow: ${JSON.stringify(overflow)}`);
      await shell.locator('.bb172-storefront-copy').click();
      await page.waitForFunction(() => typeof window.__shoppingCopied === 'string' && window.__shoppingCopied.length>0);
      await shell.evaluate(node => {node.scrollTop=0;});
      await page.waitForFunction(() => document.getElementById('bb172Storefront')?.dataset.bbShopCompact === 'false');
      await shell.getByRole('button',{name:'Bought',exact:true}).click();
      assert.equal(await shell.locator('.bb172-storefront-checkbox').count(),1,'Bought filter still shows the ticked item');
      await shell.getByRole('button',{name:'All items',exact:true}).click();
      assert.equal(await shell.locator('.bb172-storefront-checkbox').count(),total,'All items restores the list');
      await shell.locator('.bb172-storefront-finish').click();
      await page.locator('#bb172ShopConfirm').waitFor();
      await page.locator('#bb172ShopConfirm').getByRole('button',{name:/keep shopping/i}).click();
      await shell.locator('.bb172-storefront-exit').click();
      const dialog=page.locator('#bb172ShopConfirm');
      if(await dialog.isVisible()) await dialog.getByRole('button',{name:/exit|leave/i}).click();
      await shell.waitFor({state:'detached'});
      assert.equal(await page.locator('.shell > header.top').isVisible(),true,'exiting restores the normal app header');
      assert.equal(await page.evaluate(() => document.body.classList.contains('bb172-storefront-visible')),false);
      assert.equal(await page.evaluate(() => window.__shoppingHeaderQA.session().id),session,'Exit keeps the current shopping session');
      assert.equal(await page.evaluate(label => window.__shoppingHeaderQA.rows().find(row=>label==='Mark bought: '+row.name)?.checked,checkbox),true,'Exit keeps the ticked purchase');
      assert.deepEqual(errors,[],'real application loads without uncaught browser errors');
      await screenshot(page, `${width}-exited`);
    } catch (error) {
      if (page) await screenshot(page, `${width}-failure`);
      throw error;
    } finally {
      await context?.close();
      await browser.close();
    }
  });
}
