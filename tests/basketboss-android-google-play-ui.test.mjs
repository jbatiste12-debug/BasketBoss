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
const css=fs.readFileSync(new URL('../native/android.css',import.meta.url),'utf8');
function html({premium=false,provider=null,available=true,signedOut=false}={}){
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*{box-sizing:border-box}body{margin:0;padding:12px!important}button{font:inherit}${css}</style></head><body><main id="bbNativeMembershipMount"></main><button id="cloud-open">Account sign in</button><script>
 window.__premium=${premium};window.__provider=${JSON.stringify(provider)};window.__available=${available};window.__native=[];window.__proofRefreshes=0;window.__purchaseStatus='cancelled';window.__signedIn=!${signedOut};
 if(__signedIn)localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({user:{id:'test-member'},access_token:'synthetic-bearer',expires_at:Date.now()/1000+3600}));
 document.getElementById('cloud-open').addEventListener('click',()=>window.__signInClicked=true);
 window.BasketBossVerifiedPremium={refresh:async()=>__proofRefreshes++};
 const phase=(period,price,micros,recurrenceMode=1,billingCycleCount=0)=>({formattedPrice:price,priceCurrencyCode:'AUD',priceAmountMicros:micros,billingPeriod:period,recurrenceMode,billingCycleCount});
 const product='uk.co.basketboss.premium';
 window.fetch=async(address,options)=>{const path=new URL(address,location.href).pathname;const body=options?.body?JSON.parse(options.body):{};
 if(path==='/api/subscription/status')return Response.json({authenticated:true,premiumAccess:__premium,...(__premium?{tier:'premium',mode:'sandbox',provider:__provider||'google_play',subscription:{productId:product}}:{})});
 if(path==='/api/google-play/config')return Response.json({available:__available,provider:'google_play',productId:product,productIds:[product],packageName:'uk.co.basketboss.app',plans:[{plan:'monthly',basePlanId:'monthly',offerIds:['eligible-trial']},{plan:'annual',basePlanId:'annual',offerIds:[]}],mode:'test'});
 if(path==='/api/google-play/purchase-context')return Response.json({canPurchase:true,...body,obfuscatedAccountId:'server-actor-hash',mode:'test'});
 if(path==='/api/google-play/verify'){__premium=true;__provider='google_play';return Response.json({ok:true,acknowledged:true,provider:'google_play',premiumAccess:true});}
 throw Error('Unexpected API');};
 const play={addListener:async()=>({remove(){}}),getProducts:async()=>({products:[{id:product,subscriptionOfferDetails:[{basePlanId:'monthly',offerId:'eligible-trial',offerToken:'eligible-sdk-offer',pricingPhases:[phase('P3D','A$0.00','0',2,1),phase('P1M','A$6.79','6790000')]},{basePlanId:'annual',offerId:null,offerToken:'annual-sdk-offer',pricingPhases:[phase('P1Y','A$64.99','64990000')]}]}]}),getPurchases:async()=>({purchases:[]}),purchase:async args=>{__native.push(['purchase',args]);return {status:__purchaseStatus,purchases:__purchaseStatus==='purchased'?[{purchaseToken:'memory-only-proof',productId:product,state:'purchased'}]:[]};},manageSubscriptions:async args=>{__native.push(['manage',args]);return {opened:true};}};
 window.__play=play;
 </script><script>${bundle}</script><script>window.__runtime=BBAndroidQA.installAndroidRuntime({registerNative:name=>name==='BasketBossGooglePlay'?__play:{clearReceiptPhotos:async()=>({ok:true})},app:{addListener:async()=>({remove(){}}),getLaunchUrl:async()=>null},browser:{open:async()=>{}},bars:{setStyle:async()=>{}},splash:{hide:async()=>{}},installStartup:()=>({ready(){}}),watchEntry:()=>({stop(){}})});</script></body></html>`;
}
async function open(options){
 const context=await browser.newContext({viewport:{width:320,height:760}}),page=await context.newPage();
 await page.route('https://localhost/**',route=>route.fulfill({contentType:'text/html',body:html(options)}));await page.goto('https://localhost/pricing-sandbox.html');
 await page.waitForFunction(()=>window.__runtime.purchases&&!window.__runtime.purchases.state.busy&&['free','premium','signed_out'].includes(window.BasketBossNativeMembershipState));return {context,page};
}

test('Android Google Play UI displays actual eligible trial phases, cancellation, pending and verified Premium at 320px',{skip:!chromium},async()=>{
 const {context,page}=await open();try{
  const card=page.locator('.bb-native-membership');assert.match(await card.innerText(),/Free for 3 days, then A\$6\.79 \/ month/);assert.match(await card.innerText(),/A\$64\.99 \/ year/);assert.doesNotMatch(await card.innerText(),/£|7.day|Apple|Paddle/);
  assert.equal(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),true);assert.equal(await card.locator('.bb-native-google-plan').count(),2);
  const trial=card.locator('[data-google-play-plan="monthly"]');await trial.click();await page.waitForFunction(()=>__runtime.purchases.state.message.includes('Purchase cancelled'));assert.equal(await page.evaluate(()=>__proofRefreshes),0);
  await page.evaluate(()=>__purchaseStatus='pending');await trial.click();await page.waitForFunction(()=>__runtime.purchases.state.message.includes('payment is pending'));assert.equal(await page.evaluate(()=>__runtime.purchases.state.premiumAccess),false);
  await page.evaluate(()=>__purchaseStatus='purchased');await trial.click();await page.waitForFunction(()=>__runtime.purchases.state.premiumAccess&&!__runtime.purchases.state.busy);
  assert.equal(await page.evaluate(()=>__proofRefreshes),1);assert.equal(await card.locator('.bb-native-google-plans').isVisible(),false);await card.getByRole('button',{name:'Manage Google Play subscription',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>__native.filter(call=>call[0]==='manage')[0][1]),{productId:'uk.co.basketboss.premium'});
 }finally{await context.close();}
});

test('existing Premium and disabled Play setup show clear account access without another purchase',{skip:!chromium},async()=>{
 for(const options of [{premium:true,provider:'paddle'},{available:false}]){
  const {context,page}=await open(options);try{
   const card=page.locator('.bb-native-membership');assert.equal(await card.locator('.bb-native-google-plan:visible').count(),0);assert.equal(await page.evaluate(()=>__native.length),0);
   assert.match(await card.innerText(),options.premium?/do not need another subscription/:/not available yet/);
   await card.getByRole('button',{name:'Google Play subscription settings',exact:true}).click();assert.deepEqual(await page.evaluate(()=>__native[0]),['manage',{}]);
  }finally{await context.close();}
 }
});

test('signed-out Android membership asks for the existing sign-in flow before prices or purchases',{skip:!chromium},async()=>{
 const {context,page}=await open({signedOut:true});try{
  const card=page.locator('.bb-native-membership');assert.equal(await card.locator('.bb-native-google-plan').count(),0);await card.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal(await page.evaluate(()=>__signInClicked),true);assert.equal(await page.evaluate(()=>__native.length),0);
 }finally{await context.close();}
});
