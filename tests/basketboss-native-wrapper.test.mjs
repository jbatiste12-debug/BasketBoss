import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {productionApiURL,nativePageURL,isCheckoutURL,installNativeFetch} from '../native/routing.mjs';
import {transformNativeHtml,validatePublicCatalogue,verifyNativeWeb} from '../scripts/build-native-web.mjs';

test('only local and official production API requests are routed to the backend',()=>{
 for(const address of ['/api/recipes/premium?catalogue=500','capacitor://localhost/api/receipt-inventory','https://www.basketboss.co.uk/api/household'])assert.match(productionApiURL(address),/^https:\/\/basketboss\.co\.uk\/api\//);
 for(const address of ['/recipes.json','bb-receipt-inventory-core.mjs','https://evil.example/api/household','https://basketboss.co.uk.evil/api/household','http://basketboss.co.uk/api/household','https://kbhyosxuvlcazyzzinqv.supabase.co/auth/v1/token'])assert.equal(productionApiURL(address),null,address);
 assert.equal(nativePageURL('https://basketboss.co.uk/app?x=1#account'),'capacitor://localhost/index.html?x=1#account');
 assert.equal(nativePageURL('https://evil.example/app'),null);
});
test('native fetch preserves Bearer, POST body and abort signal while using cookie-free CORS',async()=>{
 const calls=[],controller=new AbortController();
 const win={location:{href:'capacitor://localhost/index.html'},fetch:async(...args)=>{calls.push(args);return new Response('{}');}};
 installNativeFetch({window:win});
 const request=new Request('https://basketboss.co.uk/api/receipt-inventory',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:'{"action":"confirm_pantry"}'});
 await win.fetch(request,{signal:controller.signal});
 assert.equal(calls[0][0].url,'https://basketboss.co.uk/api/receipt-inventory');
 assert.equal(calls[0][0].headers.get('Authorization'),'Bearer synthetic');assert.equal(await calls[0][0].text(),'{"action":"confirm_pantry"}');
 assert.equal(calls[0][1].credentials,'omit');assert.equal(calls[0][1].mode,'cors');assert.equal(calls[0][1].redirect,'error');assert.equal(calls[0][1].signal,controller.signal);
 await win.fetch('/recipes.json');assert.equal(calls[1][0],'/recipes.json');
});
test('native checkout and account-creation requests stop locally without making a network call',async()=>{
 let called=0;const win={location:{href:'capacitor://localhost/index.html'},fetch:async()=>{called++;return new Response('{}');}};installNativeFetch({window:win});
 for(const target of ['/api/subscription/checkout','/api/subscription/checkout-config','https://kbhyosxuvlcazyzzinqv.supabase.co/auth/v1/signup'])assert.equal((await win.fetch(target,{method:'POST'})).status,403);
 assert.equal(called,0);assert.equal(isCheckoutURL('https://checkout.paddle.com/123'),true);assert.equal(isCheckoutURL('https://customer-portal.paddle.com/123'),false);
});
test('native HTML receives local base and runtime before inline scripts; source is immutable',()=>{
 const original='<html><head><base href="../../"><script>window.test=1</script><script src="bb-intro-trial.js"></script><script src="paddle-sandbox.js"></script></head><body><a href="/app">App</a></body></html>';
 const result=transformNativeHtml(original);
 assert.ok(result.indexOf('bb-native-runtime.js')<result.indexOf('window.test=1'));assert.match(result,/<base href="\.\/">/);assert.match(result,/viewport-fit=cover/);assert.match(result,/href="index.html"/);
 assert.doesNotMatch(result,/paddle-sandbox\.js|src="bb-intro-trial\.js"/);assert.match(original,/<base href="\.\.\/\.\.\/">/);
});
test('private catalogue payloads cannot enter the native public bundle',()=>{
 const recipes=Array.from({length:100},(_,n)=>({id:'free-'+n})),normalized={recipes:recipes.map(r=>({id:r.id}))};
 assert.equal(validatePublicCatalogue(recipes,normalized,[]).size,100);
 assert.throws(()=>validatePublicCatalogue([...recipes,{id:'premium'}],normalized,[]),/exactly the public 100/);
 assert.throws(()=>validatePublicCatalogue(recipes,{recipes:[...normalized.recipes.slice(1),{id:'premium'}]},[]),/do not match/);
});
test('native output contains public assets and the PWA entrypoints retain identical content',()=>{
 assert.equal(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),fs.readFileSync(new URL('../app.html',import.meta.url),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(new URL('../dist/native/native-web-manifest.json',import.meta.url)));
 assert.equal(manifest.privateRecipeBundle,false);assert.ok(!manifest.files.some(f=>/(?:^|\/)(?:functions|sql|bb-server-lib|node_modules|ios)\/|sealed\.json|private\.json/.test(f.path)));
 assert.ok(manifest.files.some(f=>f.path==='bb-native-runtime.js'));
 assert.equal(verifyNativeWeb({directory:new URL('../dist/native',import.meta.url).pathname}).freeRecipes,100);
});
