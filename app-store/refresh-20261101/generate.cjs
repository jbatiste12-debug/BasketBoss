const fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict');
const{chromium}=require('/workspace/work/capture-tools/node_modules/playwright');
const checkout=path.resolve(__dirname,'../..'),native=process.argv.includes('--native'),root=native?path.join(checkout,'dist/native'):checkout,output='/workspace/work/signin-preview';
const slow='baked-potato-beans',quick='pan-gnocchi-spinach',dessert='dessert-chocolate-brownies';
const normalized=JSON.parse(fs.readFileSync(path.join(checkout,'normalized-ingredient-database.json'))).recipes.find(r=>r.id===quick);
const stock=Object.fromEntries(normalized.ingredients.map(i=>[i.key+'|'+i.unit,i.quantity*2/normalized.servings]));
const seed={slow,quick,dessert,stock,items:normalized.ingredients.map(i=>({name:i.name,key:i.key,qty:i.quantity*2/normalized.servings,unit:i.unit,loc:'fridge'}))};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const file=path.resolve(root,'.'+p);if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
async function setup(browser,width,premium){
 const context=await browser.newContext({viewport:{width,height:width>800?(ipad?1376:1000):852},deviceScaleFactor:ipad?2:3,isMobile:width<800,hasTouch:width<800,serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[],receiptRequests=[];let receiptReady=false;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(u.pathname.startsWith('/api/receipt-inventory')||u.pathname.startsWith('/api/bb173/')){receiptRequests.push({path:u.pathname+u.search,method:route.request().method()});if(u.pathname==='/api/receipt-inventory'&&u.searchParams.get('mode')==='status')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,available:receiptReady&&premium,premium:premium,configured:true,migrationReady:true})});if(u.pathname==='/api/bb173/status')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:receiptReady&&premium?'available':'unavailable',premium_ai:premium,turnstileRequired:false})});return route.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"available":false}'});}if(u.pathname==='/api/subscription/status'){requests.push('verified-status');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:true,premiumAccess:premium,tier:premium?'premium':'free',mode:'live',subscription:null})});}if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,available:false,configured:false,premium:false})});return route.continue();});
 await page.addInitScript(({seed})=>{
  const OriginalDate=Date,start=OriginalDate.now(),base=new OriginalDate(2026,10,2,18,30).getTime();class TestDate extends OriginalDate{constructor(...args){super(...(args.length?args:[base+OriginalDate.now()-start]));}static now(){return base+OriginalDate.now()-start;}}window.Date=TestDate;
  const put=(key,value)=>localStorage.setItem(key,typeof value==='string'?value:JSON.stringify(value));
  put('bb_onboarding_fresh_once_20261028_v1',{complete:true,step:10,house:'3–4 people',region:'UK',partnerStepV2:true});put('basketboss_onboarding_seen_v1','true');sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');sessionStorage.setItem('bb_funnel_nudge_dismissed_v1','1');
  if(!localStorage.getItem('evening_browser_seeded')){
   put('basketboss_cloud_session_v1',{access_token:'browser-isolated-synthetic-session-no-server-auth',expires_at:4000000000,user:{id:'11111111-1111-4111-8111-111111111111',email:'isolated-browser@example.invalid'}});
   put('basketboss_321_v7_market','UK');put('basketboss_321_v10_price_retailer_UK','Tesco');put('basketboss_321_unified_state_v1',{version:2,planned:[{day:'Monday',recipeId:seed.slow},{day:'Friday',recipeId:seed.quick}],dayServings:{Monday:{recipeId:seed.slow,count:6},Friday:{recipeId:seed.quick,count:2}},servings:4,feedingSet:true,plannedDesserts:[{day:'Monday',recipeId:seed.dessert}],pantry:{},customPantry:[],dismissed:[]});
   put('basketboss_321_v7_measured_pantry',seed.stock);put('basketboss_ui_next_confirmed_pantry_v1',{version:1,items:seed.items,confirmedAt:new Date().toISOString()});put('basketboss_receipt_host_actor_v1',{version:1,actorId:'11111111-1111-4111-8111-111111111111'});put('evening_browser_seeded','1');
  }
  window.__receiptIO={fileClicks:0,camera:0};const originalClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(...args){if(this.type==='file')window.__receiptIO.fileClicks++;return originalClick.apply(this,args);};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{window.__receiptIO.camera++;throw Error('Browser test does not open cameras.');};put('basketboss_321_features_v1',{version:1,essentials:[{id:'legacy-milk',name:'Milk',qty:2,unit:'pack',selected:true,owned:false,estimatedPackPrice:1.5,priceMarket:'UK',priceRetailer:'Tesco',priceCurrency:'GBP',priceScope:'store'}]});window.__speech={instances:[],spoken:[],abortCount:0,startCount:0};class Recognition{constructor(){this.results=[];window.__speech.instances.push(this);}start(){this.running=true;window.__speech.startCount++;queueMicrotask(()=>this.onstart?.());}abort(){this.running=false;window.__speech.abortCount++;queueMicrotask(()=>this.onend?.());}}window.SpeechRecognition=Recognition;
  window.__speech.emit=text=>{const r=window.__speech.instances.at(-1);if(!r?.running)throw Error('No active mock recognition session');const result=[{transcript:text}];result.isFinal=true;r.results.push(result);r.onresult?.({resultIndex:r.results.length-1,results:r.results});};
  window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel(){},speak(u){window.__speech.spoken.push(u.text);setTimeout(()=>u.onend?.(),5);}}});
 },{seed});
 await page.goto('http://127.0.0.1:8802/index.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(premium=>window.BasketBossVerifiedPremium?.isActive?.()===premium,premium);await page.waitForSelector('.bbnext-day');await page.waitForTimeout(1400);if(native)await page.evaluate(premium=>{document.documentElement.classList.add('bb-native-ios');window.BBNative={isNative:false};},premium);
 const monday=page.locator('.bbnext-day').filter({has:page.locator('[data-bbfeed-day="Monday"]')}).first();
 return{context,page,errors,requests,receiptRequests,monday,setReceiptReady(value){receiptReady=value;}};
}


const ipad=process.argv.includes('--ipad');
const out=process.env.BB_SCREENSHOT_OUT||(ipad?'/workspace/artifacts/BasketBoss-App-Store-iPad-20261101':'/workspace/artifacts/BasketBoss-App-Store-20261101');fs.mkdirSync(out,{recursive:true});
const captures=[];
async function shot(page,id,title,caption,premium=false){
 await page.evaluate(()=>document.activeElement?.blur?.());await page.waitForTimeout(350);
 const raw=path.join(out,id+'-ui.png');await page.screenshot({path:raw,animations:'disabled'});
 captures.push({id,title,caption,premium,raw});
}
async function capture(browser){
 const free=await setup(browser,ipad?1032:430,false),{page}=free;
 await shot(page,'01-plan','A calmer week.','Plan dinners, then keep the details tucked away.');
 await page.locator('.tab[data-tab="shop"]').click();await page.locator('[data-bb76-store="cupboard"]>summary').click();await page.waitForTimeout(300);
 await shot(page,'02-at-home','Know what’s at home.','Four familiar choices. Add more when you need them.');
 await page.locator('[data-bb5-food="Rice"]').click();const row=page.locator('[data-bb5-row="cupboard|rice"]');await row.locator('[data-bb5-qty]').fill('200');await row.locator('[data-bb5-needed]').fill('600');
 while(await page.locator('[data-bb5-row]:not([data-bb5-row="cupboard|rice"]) [data-bb5-remove]').count())await page.locator('[data-bb5-row]:not([data-bb5-row="cupboard|rice"]) [data-bb5-remove]').first().click();
 await page.evaluate(()=>{window.BBReceiptHost={requiresPantryReview:()=>false,hasPendingConfirmation:()=>false,confirmCurrentPantry:async()=>({ok:true}),afterRender(){}};});
 await page.locator('#bb5Reconcile').click();await page.locator('.tab[data-tab="shop"]').click();
 await page.evaluate(()=>{document.querySelector('#bbSimplePantry').open=true;scrollTo({top:document.querySelector('#bbSimplePantry').getBoundingClientRect().top+scrollY-16,behavior:'instant'});});
 await shot(page,'03-reconcile','Buy the difference.','Total needed − already got = to buy.');
 await page.locator('.tab[data-tab="shop-list"]').click();if(await page.locator('.bb-weekly-basic-list').isVisible())await page.locator('.bb-weekly-basic-list').click();await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 await shot(page,'04-shopping','One list. All week.','Keep adding. Tick things off as you shop.');
 await page.locator('.tab[data-tab="discover"]').click();await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 await shot(page,'05-discover','Find tonight’s favourite.','Clear recipe cards. A plan that fits your week.');
 await free.context.close();
 const paid=await setup(browser,ipad?1032:430,true);await paid.page.evaluate(()=>window.BBHomeHost.openCook('pan-gnocchi-spinach'));await paid.page.waitForSelector('.cook-overlay');
 const voice=paid.page.getByRole('button',{name:/Turn on voice|Start voice|Voice Cook|Start listening/i}).first();if(await voice.count())try{await voice.click({timeout:2000});}catch{}
 await shot(paid.page,'06-voice-cook','A helping voice.','Ingredients and cooking steps, read aloud.',true);
 await paid.page.locator('#bbExit').click();await paid.page.locator('.tab[data-tab="shop-list"]').click();paid.setReceiptReady(true);
 const scan=paid.page.locator('[data-bb-receipt-entry]').first();if(await scan.count())try{await scan.click({timeout:3000});}catch{}
 await shot(paid.page,'07-receipts','Scan. Review. Restock.','Check receipt matches before updating At home.',true);
 if(free.errors.length||paid.errors.length)throw Error('Screenshot application errors: '+JSON.stringify([...free.errors,...paid.errors]));await paid.context.close();
}
async function design(browser){
 const context=await browser.newContext({viewport:{width:ipad?1032:440,height:ipad?1376:956},deviceScaleFactor:ipad?2:3}),page=await context.newPage();
 const logo=fs.readFileSync(path.join(checkout,'icons/basketboss-crowned-v1766-192.png')).toString('base64');
 for(const item of captures){
  const png=fs.readFileSync(item.raw).toString('base64');
  await page.setContent(`<html><head><style>*{box-sizing:border-box}html,body{margin:0;width:440px;height:956px;overflow:hidden}body{font-family:Arial,Helvetica,sans-serif;background:radial-gradient(ellipse at 95% 5%,#ecedd6,transparent 48%),#fffdf5;color:#194932}.brand{position:absolute;top:24px;left:32px;display:flex;align-items:center;gap:10px;font-size:17px;font-weight:800;letter-spacing:-.5px}.brand img{width:32px;height:32px}.count{position:absolute;right:32px;top:34px;color:#839079;font-size:11px;letter-spacing:2px}header{position:absolute;top:75px;left:32px;right:28px}h1{font-size:43px;letter-spacing:-2px;line-height:1.02;margin:0 0 13px;max-width:370px;font-weight:850}p{font-size:15px;line-height:1.4;margin:0;max-width:338px;color:#57705e}.phone{position:absolute;top:226px;left:39px;width:362px;height:716px;border:6px solid #254c3c;border-radius:37px;background:#f1f4e9;box-shadow:0 20px 45px #244d3420;overflow:hidden}.phone img{width:350px;height:704px;object-fit:contain;display:block}.premium{position:absolute;right:42px;top:202px;border:1px solid #d9c17d;border-radius:99px;background:#f8edc8;color:#79602b;padding:5px 10px;font-size:10px;font-weight:800;letter-spacing:.8px}${ipad?'html,body{width:1032px;height:1376px}.brand{top:36px;left:84px;font-size:26px;gap:14px}.brand img{width:42px;height:42px}.count{right:84px;top:52px;font-size:17px}header{top:106px;left:84px;right:84px}h1{font-size:64px;max-width:900px;letter-spacing:-2.5px;margin-bottom:18px}p{font-size:23px;max-width:850px}.phone{top:274px;left:116px;width:800px;height:1084px;border-width:8px;border-radius:38px}.phone img{width:784px;height:1068px}.premium{top:236px;right:120px;font-size:15px}':''}</style></head><body><div class="brand"><img src="data:image/png;base64,${logo}">BasketBoss</div><div class="count">${item.id.slice(0,2)} / 07</div><header><h1>${item.title}</h1><p>${item.caption}</p></header>${item.premium?'<div class="premium">PREMIUM FEATURE</div>':''}<div class="phone"><img src="data:image/png;base64,${png}"></div></body></html>`);
  await page.screenshot({path:path.join(out,item.id+'.png'),animations:'disabled'});
 }
 await context.close();
 const sheet=await browser.newPage({viewport:{width:1320,height:ipad?259:406},deviceScaleFactor:1});
 await sheet.setContent('<html><body style="margin:0;background:#e8eddf;display:flex;gap:8px;padding:12px">'+captures.map(item=>'<img style="width:176px;height:auto;align-self:flex-start" src="data:image/png;base64,'+fs.readFileSync(path.join(out,item.id+'.png')).toString('base64')+'">').join('')+'</body></html>');await sheet.screenshot({path:path.join(out,'contact-sheet.png')});await sheet.close();
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({dimensions:ipad?{width:2064,height:2752}:{width:1320,height:2868},source:'Current generated application web assets rendered locally with fictional demonstration data',nativeSimulatorCapture:false,app:'BasketBoss',screens:captures.map(({raw,...item})=>({...item,file:item.id+'.png'}))},null,2));
}
(async()=>{await new Promise(r=>server.listen(8802,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.BB_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{await capture(browser);await design(browser);console.log(JSON.stringify({output:out,screens:captures.map(item=>item.id+'.png'),dimensions:ipad?'2064×2752':'1320×2868'}));}finally{await browser.close();server.close();}})().catch(error=>{console.error(error);server.close();process.exitCode=1});
