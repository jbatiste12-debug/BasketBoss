import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);let chromium,browser,bundle;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
before(async()=>{
 if(!chromium)return;
 const result=await build({entryPoints:[new URL('../native/android-runtime.mjs',import.meta.url).pathname],bundle:true,write:false,format:'iife',globalName:'BBAndroidQA',target:'chrome120'});bundle=result.outputFiles[0].text;
 browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});
const androidCSS=fs.readFileSync(new URL('../native/android.css',import.meta.url),'utf8'),dockCSS=fs.readFileSync(new URL('../bb-navigation-polish.css',import.meta.url),'utf8');
function html(insets){return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*{box-sizing:border-box}body{margin:0}.top{background:#fffdf7;padding:12px}.shell{padding:12px}button{min-height:44px}dialog{width:90%;height:400px} ${androidCSS} ${dockCSS}</style></head><body><div class="shell"><header class="top">BasketBoss</header><main id="app"><input id="food" aria-label="Food"><input type="file" id="photo" data-receipt-action="file"><section id="bbNativeMembershipMount"></section><a id="checkout" href="https://checkout.paddle.com/test">Subscribe</a><button id="bbpolUpgradePill">Upgrade</button><dialog id="amount"><button>Done</button></dialog></main><nav id="bbPrimaryNavigation" data-bb-navigation="polished">${['Plan','Discover','At home','Shop','Cook'].map((name,index)=>`<button data-bb-nav-item="${index}">${name}</button>`).join('')}</nav></div><script>localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({user:{id:'android-test-member'},access_token:'synthetic-token',expires_at:Date.now()/1000+3600}));for(const [name,value]of Object.entries(${JSON.stringify(insets)}))document.documentElement.style.setProperty('--safe-area-inset-'+name,value+'px');</script><script>${bundle}</script><script>window.__AndroidEvents={};window.__AndroidExternal=[];window.__AndroidRuntime=BBAndroidQA.installAndroidRuntime({app:{addListener:async(name,handler)=>{__AndroidEvents[name]=handler;return{remove(){}}},getLaunchUrl:async()=>null},browser:{open:async value=>__AndroidExternal.push(value.url)},bars:{setStyle:async()=>{}},splash:{hide:async()=>{}},haptics:{selectionStart:async()=>{},selectionChanged:async()=>{},selectionEnd:async()=>{},impact:async()=>{},notification:async()=>{}},installStartup:()=>({ready(){}}),watchEntry:()=>({stop(){}})});</script></body></html>`;}

for(const scenario of [
 {width:320,height:720,insets:{top:28,right:0,bottom:24,left:0}},
 {width:390,height:844,insets:{top:0,right:0,bottom:0,left:0}},
 {width:844,height:390,insets:{top:24,right:16,bottom:16,left:44}}
])test('Android entry and safe-area geometry respect stock native insets at '+scenario.width+'px',{skip:!chromium},async()=>{
 const context=await browser.newContext({viewport:{width:scenario.width,height:scenario.height}}),page=await context.newPage(),requests=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='basketboss.co.uk'&&url.pathname==='/api/subscription/status'){
   const headers={'Access-Control-Allow-Origin':'https://localhost','Access-Control-Allow-Headers':'Authorization,Accept,Cache-Control,Content-Type','Access-Control-Allow-Methods':'GET,POST'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   requests.push(route.request());return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({authenticated:true,premiumAccess:true,tier:'owner',mode:'live'})});
  }
  if(url.origin==='https://localhost')return route.fulfill({contentType:'text/html',body:html(scenario.insets)});
  return route.abort();
 });
 try{
  await page.goto('https://localhost/index.html');await page.waitForFunction(()=>window.BasketBossNativeMembershipState==='premium');
  assert.match(await page.locator('.bb-native-membership').innerText(),/existing Premium membership is available/);assert.equal(await page.locator('#checkout').getAttribute('href'),'https://localhost/pricing-sandbox.html');
  assert.equal(requests[0].headers().authorization,'Bearer synthetic-token');assert.equal(await page.evaluate(()=>window.BBNativeAppleAuth===undefined&&typeof window.BBNative.clearTemporaryData==='function'),true);
  const box=await page.evaluate(()=>{
   const header=document.querySelector('header'),dock=document.getElementById('bbPrimaryNavigation'),r=dock.getBoundingClientRect();
   return {topPadding:parseFloat(getComputedStyle(header).paddingTop),dock:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},bodyScrollWidth:document.body.scrollWidth,targets:[...dock.querySelectorAll('button')].map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))};
  });
  assert.ok(box.topPadding>=Math.max(12,scenario.insets.top));assert.ok(box.dock.bottom<=scenario.height-Math.max(8,scenario.insets.bottom)+1);assert.ok(box.dock.x>=scenario.insets.left);assert.ok(box.dock.right<=scenario.width-scenario.insets.right);assert.ok(box.bodyScrollWidth<=scenario.width+1);assert.ok(box.targets.every(t=>t.width>=44&&t.height>=44));
  await page.locator('#food').fill('Pasta');await page.evaluate(()=>BBNative.dismissKeyboard());assert.equal(await page.locator('#food').inputValue(),'Pasta','native wrapper does not replace the food draft');
  const original=await page.evaluate(()=>localStorage.getItem('basketboss_cloud_session_v1'));
  assert.equal(await page.evaluate(async()=>{const r=await fetch('/api/subscription/checkout',{method:'POST',body:'{}'});return r.status;}),403);assert.equal(requests.length,1,'purchase attempt does not make another network call');
  assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_cloud_session_v1')),original);
  const filePrevented=await page.locator('#photo').evaluate(node=>{const e=new MouseEvent('click',{bubbles:true,cancelable:true});node.dispatchEvent(e);return e.defaultPrevented;});assert.equal(filePrevented,false,'ordinary Android HTML file chooser remains the input owner');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
