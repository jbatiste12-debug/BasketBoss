import test from 'node:test';
import assert from 'node:assert/strict';
import {ANDROID_ORIGIN,androidApiURL,androidPageURL,androidMembershipURL,isAndroidBillingURL,installAndroidFetch,installAndroidXHR,installAndroidWindowOpen} from '../native/android-routing.mjs';

test('Android routes only its local and official HTTPS API URLs',()=>{
 for(const input of ['/api/household?mode=status','https://localhost/api/subscription/status','https://www.basketboss.co.uk/api/receipt-inventory'])assert.match(androidApiURL(input),/^https:\/\/basketboss\.co\.uk\/api\//);
 for(const input of ['/recipes.json','https://localhost.evil/api/household','http://localhost/api/household','https://localhost:8443/api/household','https://user@localhost/api/household','capacitor://localhost/api/household','https://evil.example/api/household','https://basketboss.co.uk.evil/api/household','https://project.supabase.co/auth/v1/token'])assert.equal(androidApiURL(input),null,input);
 assert.equal(androidPageURL('https://basketboss.co.uk/app?test=1#partner-sharing'),ANDROID_ORIGIN+'/index.html?test=1#partner-sharing');
 assert.equal(androidPageURL('/terms'),ANDROID_ORIGIN+'/terms.html');assert.equal(androidPageURL('https://evil.example/app'),null);
 assert.equal(androidMembershipURL(),ANDROID_ORIGIN+'/pricing-sandbox.html');
});
test('Android membership redirects classify local, production and provider billing without blocking public legal pages',()=>{
 for(const input of ['/pricing-sandbox.html?appleIntent=invalid','/api/subscription/checkout','https://localhost/api/subscription/portal','https://basketboss.co.uk/compare','https://checkout.paddle.com/example','https://billing.stripe.com/example'])assert.equal(isAndroidBillingURL(input),true,input);
 for(const input of ['/api/subscription/status','/privacy','https://www.paddle.com/legal/privacy','https://stripe.com/privacy'])assert.equal(isAndroidBillingURL(input),false,input);
});
test('Android fetch retains Bearer, body, method and cancellation without cookie transport',async()=>{
 const calls=[],controller=new AbortController(),win={location:{href:ANDROID_ORIGIN+'/index.html'},fetch:async(...args)=>{calls.push(args);return new Response('{}');}};
 const original=installAndroidFetch({window:win});assert.equal(typeof original,'function');
 const request=new Request('https://localhost/api/receipt-inventory',{method:'POST',headers:{Authorization:'Bearer synthetic-session'},body:'{"action":"confirm"}'});
 await win.fetch(request,{signal:controller.signal});
 const [forwarded,options]=calls[0];assert.equal(forwarded.url,'https://basketboss.co.uk/api/receipt-inventory');assert.equal(forwarded.method,'POST');assert.equal(forwarded.headers.get('Authorization'),'Bearer synthetic-session');assert.equal(await forwarded.text(),'{"action":"confirm"}');assert.equal(options.signal,controller.signal);assert.equal(options.credentials,'omit');assert.equal(options.mode,'cors');assert.equal(options.redirect,'error');
 const signup={method:'POST',body:'synthetic',headers:{apikey:'public-fixture'}};await win.fetch('https://project.supabase.co/auth/v1/signup',signup);assert.equal(calls[1][0],'https://project.supabase.co/auth/v1/signup');assert.equal(calls[1][1],signup,'existing Supabase auth transport is not rewritten');
 await win.fetch('/recipes.json');assert.equal(calls[2][0],'/recipes.json');
});
test('Android purchase fetches stop before any network request',async()=>{
 const calls=[],win={location:{href:ANDROID_ORIGIN+'/index.html'},fetch:async(...args)=>{calls.push(args);return new Response('{}');}};installAndroidFetch({window:win});
 for(const input of ['/api/subscription/checkout','/api/subscription/checkout-config','/api/subscription/portal','https://checkout.paddle.com/example']){
  const r=await win.fetch(input,{method:'POST',body:'{}'});assert.equal(r.status,403);assert.match((await r.json()).error,/Android test build/);
 }assert.equal(calls.length,0);
});
test('Android XHR rewrites only API URLs and preserves the original method and remaining open arguments',()=>{
 const calls=[];class XHR{open(...args){calls.push(args);}setRequestHeader(){}send(){}}
 const win={location:{href:ANDROID_ORIGIN+'/index.html'},XMLHttpRequest:XHR};installAndroidXHR({window:win});const xhr=new XHR();
 xhr.open('POST','/api/account/delete',true);assert.deepEqual(calls[0],['POST','https://basketboss.co.uk/api/account/delete',true]);
 xhr.open('GET','/recipes.json',false);assert.deepEqual(calls[1],['GET','/recipes.json',false]);
 assert.throws(()=>xhr.open('POST','/api/subscription/checkout'),/Android test build/);assert.equal(calls.length,2);
});
test('Android window opening preserves local print windows and prevents provider checkout windows',async()=>{
 const assigned=[],external=[],opened=[],blank={};const win={location:{href:ANDROID_ORIGIN+'/index.html',assign:url=>assigned.push(url)},open:(...args)=>{opened.push(args);return blank;}};
 installAndroidWindowOpen({window:win,openExternal:url=>external.push(url)});
 assert.equal(win.open('about:blank','_blank'),blank);assert.equal(opened.length,1);
 assert.equal(win.open('https://buy.stripe.com/test'),null);assert.deepEqual(assigned,[ANDROID_ORIGIN+'/pricing-sandbox.html']);assert.deepEqual(external,[]);
 win.open('https://basketboss.co.uk/privacy');assert.equal(assigned[1],ANDROID_ORIGIN+'/privacy.html');
 win.open('https://example.test/help');await Promise.resolve();assert.deepEqual(external,['https://example.test/help']);
 win.open('javascript:alert(1)');assert.equal(opened.length,1);
});
