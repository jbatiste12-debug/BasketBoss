import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
let chromium,browser;
for(const module of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)){
  try{({chromium}=require(module));break;}catch{}
}
const source=await fs.readFile(new URL('../bb-account-polish.js',import.meta.url),'utf8');
const css=await fs.readFile(new URL('../bb-account-polish.css',import.meta.url),'utf8');
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const options={skip:!chromium&&'Playwright unavailable',timeout:30000};
const frame=page=>page.evaluate(()=>new Promise(resolve=>window.__nativeRAF(()=>window.__nativeRAF(resolve))));
async function fixture(platform='web'){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{margin:0}#cloud-panel{display:none;position:fixed;inset:0}#cloud-panel.open{display:grid}#cloud-card{background:#fff}button{min-height:44px} ${css}
    </style></head><body><main class="shell"><header class="top"><button id="bbuiOpenSettings">Settings</button></header><button id="cloud-open">Account</button></main>
    <div id="cloud-panel"><section id="cloud-card"><button id="cloud-close">Close</button><h2>Old account</h2><p id="cloud-status"></p><div id="cloud-signed" hidden></div><form id="cloud-auth" data-bb-auth-view="sign-in"><label>Email<input id="cloud-email"></label><label>Password<input id="cloud-password"></label><button id="cloud-login" type="button">Sign in</button></form></section></div></body></html>`);
  await page.evaluate(platform=>{
    if(platform!=='web')window.BBNative={isNative:true,platform};
    window.__nativeRAF=window.requestAnimationFrame.bind(window);window.__presentationFrames=0;
    window.requestAnimationFrame=fn=>{window.__presentationFrames++;return window.__nativeRAF(fn);};
    window.__pantrySyncCalls=0;window.__loginCalls=0;
    document.getElementById('cloud-login').addEventListener('click',()=>window.__loginCalls++);
    document.getElementById('cloud-open').onclick=()=>document.getElementById('cloud-panel').classList.add('open');
    document.getElementById('cloud-close').onclick=()=>document.getElementById('cloud-panel').classList.remove('open');
    window.__originalNodes=['cloud-auth','cloud-email','cloud-password','cloud-login'].map(id=>document.getElementById(id));
  },platform);
  await page.addScriptTag({content:source});
  await frame(page);
  return{context,page};
}
for(const platform of ['web','ios','android']){
  test(`${platform}: late Settings mount is decorated before its first visible frame`,options,async()=>{
    const h=await fixture(platform);
    try{
      const firstFrame=await h.page.evaluate(()=>new Promise(resolve=>window.__nativeRAF(()=>{
        const overlay=document.createElement('div');overlay.className='bbui-settings-overlay';
        overlay.innerHTML='<section class="bbui-settings-panel"><header class="bbui-settings-heading"><h2 id="bbuiSettingsTitle">BasketBoss Settings</h2></header><section id="bbuiAccountSection"><h3>Account & welcome</h3></section><section id="bbuiStorageSection"><h3>Backup & restore</h3></section><section id="bbuiLinksSection"><h3>Region, feedback & legal</h3></section><button id="bbuiSettingsTab">Old Settings</button><button id="bbuiTutorialsTab">Tutorials</button></section>';
        document.body.append(overlay);
        window.__nativeRAF(()=>resolve({ready:overlay.firstElementChild.dataset.bbAccountPolish,title:document.getElementById('bbuiSettingsTitle').textContent,tab:document.getElementById('bbuiSettingsTab').textContent}));
      })));
      assert.deepEqual(firstFrame,{ready:'settings',title:'Settings',tab:'Settings'});
      assert.equal(await h.page.locator('.bbap-heading-copy').count(),1);
      assert.equal(await h.page.locator('.bbap-section-icon').count(),3);
      await frame(h.page);
      assert.equal(await h.page.locator('.bbap-heading-copy').count(),1,'presentation reconciliation settles without duplicating nodes');
    }finally{await h.context.close();}
  });
  test(`${platform}: settled account refreshes leave header and viewport unchanged and retain real controls`,options,async()=>{
    const h=await fixture(platform);
    try{
      await h.page.locator('#cloud-open').click();await frame(h.page);
      const writes=await h.page.evaluate(async()=>{
        const counts={header:0,viewport:0};
        const observer=new MutationObserver(records=>{for(const record of records){if(record.target.matches('header.top'))counts.header++;else counts.viewport++;}});
        observer.observe(document.querySelector('header.top'),{attributes:true,attributeFilter:['data-bb-account-polish']});
        observer.observe(document.getElementById('cloud-panel'),{attributes:true,attributeFilter:['style']});
        const before=window.__presentationFrames;
        for(let i=0;i<6;i++){window.BBAccountPolish.refresh();await new Promise(resolve=>window.__nativeRAF(resolve));}
        await Promise.resolve();observer.disconnect();
        return{...counts,frames:window.__presentationFrames-before,controls:window.__originalNodes.every(node=>node===document.getElementById(node.id))};
      });
      assert.deepEqual(writes,{header:0,viewport:0,frames:0,controls:true});
      await h.page.locator('#cloud-password').fill('untouched-example');
      await h.page.locator('#cloud-login').click();
      assert.equal(await h.page.evaluate(()=>window.__loginCalls),1);
      assert.equal(await h.page.locator('#cloud-password').inputValue(),'untouched-example');
      await h.page.locator('#cloud-close').click();
      assert.equal(await h.page.locator('#cloud-panel').isVisible(),false);
      assert.equal(await h.page.locator('.shell').getAttribute('inert'),null);
    }finally{await h.context.close();}
  });
}
