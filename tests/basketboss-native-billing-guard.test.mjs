import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isNativeBillingURL,nativePageURL,nativeMembershipURL,installNativeFetch,installNativeXHR,installNativeWindowOpen} from '../native/routing.mjs';

const billingDestinations=[
 'https://checkout.stripe.com/c/pay/session',
 'https://buy.stripe.com/test_payment_link',
 'https://buy.stripe.com./test_payment_link',
 'https://billing.stripe.com/p/session',
 'https://api.stripe.com/v1/prices/price_test',
 'https://payments.link/example',
 'https://checkout.paddle.com/checkout/custom/example',
 'https://sandbox-checkout.paddle.com/transaction',
 'https://customer-portal.paddle.com/example',
 'https://pay.paddle.net/invoice/example',
 'stripe://checkout/example',
 '/api/subscription/checkout',
 '/api/subscription/checkout-config',
 '/api/checkout/config',
 '/api/billing/create-checkout-session',
 '/api/stripe/config',
 '/api/paymentLinks',
 '/api/payment-links/example',
 '/api/prices/price_test',
 '/api/subscription/portal',
 'https://basketboss.co.uk/pricing-sandbox.html#founder',
 'https://www.basketboss.co.uk/subscriptions',
 'http://basketboss.co.uk/checkout',
 'https://basketboss.co.uk:8443/pricing',
 '/pricing/monthly',
 '/%63heckout',
 'capacitor://localhost/compare.html'
];

test('native billing guard covers providers, payment APIs and hosted sales pages without blocking account or privacy tools',()=>{
 for(const target of billingDestinations)assert.equal(isNativeBillingURL(target),true,target);
 for(const target of [
  '/api/subscription/status','/api/account/delete','/api/household','/api/receipt-inventory',
  '/privacy','/terms','https://basketboss.co.uk/app#account',
  'https://kbhyosxuvlcazyzzinqv.supabase.co/auth/v1/token?grant_type=password',
  'https://stripe.com/privacy','https://www.paddle.com/legal/privacy',
  'https://www.paddle.com/legal/terms','mailto:hello@basketboss.co.uk',
  'https://checkout.stripe.com.example.org/help'
 ])assert.equal(isNativeBillingURL(target),false,target);
 // Processor legal pages must not carry a redirect or checkout query.
 assert.equal(isNativeBillingURL('https://stripe.com/privacy?return_url=https://buy.stripe.com/example'),true);
});

test('web legal and sales destinations resolve to bundled pages from every native entrypoint',()=>{
 const base='capacitor://localhost/legal/entry.html';
 for(const target of ['/privacy','https://basketboss.co.uk/privacy/']){
  assert.equal(nativePageURL(target,base),'capacitor://localhost/privacy.html');
 }
 assert.equal(nativePageURL('/terms?locale=en#data',base),'capacitor://localhost/terms.html?locale=en#data');
 assert.equal(nativePageURL('privacy.html'),'capacitor://localhost/privacy.html');
 assert.equal(nativePageURL('https://basketboss.co.uk/pricing/monthly?coupon=example',base),nativeMembershipURL(base));
 assert.equal(nativePageURL('/subscriptions.html#cancel',base),'capacitor://localhost/pricing-sandbox.html');
 assert.equal(nativePageURL('https://unrelated.example/privacy'),null);
});

test('blocked billing fetches never reach the network while authenticated deletion/status requests retain their body',async()=>{
 const calls=[];
 const win={location:{href:'capacitor://localhost/index.html'},fetch:async(...args)=>{calls.push(args);return new Response('{}');}};
 installNativeFetch({window:win});
 for(const target of billingDestinations){
  const response=await win.fetch(target,{method:'POST',body:'must not be sent'});
  assert.equal(response.status,403,target);
 }
 assert.equal(calls.length,0);
 const controller=new AbortController();
 await win.fetch(new Request('https://basketboss.co.uk/api/account/delete',{
  method:'POST',headers:{Authorization:'Bearer synthetic'},body:'{"confirmation":"DELETE"}'
 }),{signal:controller.signal});
 assert.equal(calls[0][0].url,'https://basketboss.co.uk/api/account/delete');
 assert.equal(calls[0][0].method,'POST');
 assert.equal(calls[0][0].headers.get('Authorization'),'Bearer synthetic');
 assert.equal(await calls[0][0].text(),'{"confirmation":"DELETE"}');
 assert.equal(calls[0][1].credentials,'omit');
 assert.equal(calls[0][1].mode,'cors');
 assert.equal(calls[0][1].redirect,'error');
 assert.equal(calls[0][1].signal,controller.signal);
 await win.fetch('/api/subscription/status');
 assert.equal(calls[1][0],'https://basketboss.co.uk/api/subscription/status');
 await win.fetch('https://stripe.com/privacy');
 assert.equal(calls[2][0],'https://stripe.com/privacy');
});

test('XHR blocks billing before opening transport and preserves nonbilling method and arguments',()=>{
 const calls=[];
 class XHR{open(...args){calls.push(args);}}
 const win={location:{href:'capacitor://localhost/index.html'},XMLHttpRequest:XHR};
 installNativeXHR({window:win});
 const request=new XHR();
 for(const target of billingDestinations)assert.throws(()=>request.open('POST',target,true),/Purchases are not available/,target);
 assert.equal(calls.length,0);
 request.open('DELETE','/api/account/delete',true);
 assert.deepEqual(calls,[['DELETE','https://basketboss.co.uk/api/account/delete',true]]);
});

test('window.open sends billing to local account status and public documents to local pages or native Browser',async()=>{
 const navigations=[],external=[],originalCalls=[],blankWindow={document:{}};
 const win={location:{href:'capacitor://localhost/index.html',assign:value=>navigations.push(value)},open:(...args)=>{originalCalls.push(args);return blankWindow;}};
 installNativeWindowOpen({window:win,openExternal:async value=>external.push(value)});
 for(const target of billingDestinations)assert.equal(win.open(target,'_blank'),null,target);
 assert.deepEqual(navigations,billingDestinations.map(()=>nativeMembershipURL()));
 assert.equal(external.length,0);
 assert.equal(originalCalls.length,0);
 win.open('https://basketboss.co.uk/privacy');
 win.open('/terms');
 assert.deepEqual(navigations.slice(-2),['capacitor://localhost/privacy.html','capacitor://localhost/terms.html']);
 win.open('https://www.paddle.com/legal/privacy');
 await Promise.resolve();
 assert.deepEqual(external,['https://www.paddle.com/legal/privacy']);
 assert.equal(win.open('about:blank','_blank'),blankWindow);
 assert.equal(originalCalls.length,1);
});

test('iOS navigation backstop is installed in both controller entrypoints and uses Capacitor cancellation semantics',()=>{
 const app=fs.readFileSync(new URL('../ios/App/App/AppDelegate.swift',import.meta.url),'utf8');
 const scene=fs.readFileSync(new URL('../ios/App/App/SceneDelegate.swift',import.meta.url),'utf8');
 const storyboard=fs.readFileSync(new URL('../ios/App/App/Base.lproj/Main.storyboard',import.meta.url),'utf8');
 const pluginAPI=fs.readFileSync(new URL('../node_modules/@capacitor/ios/Capacitor/Capacitor/CAPPlugin.h',import.meta.url),'utf8');
 assert.match(app,/override func capacitorDidLoad\(\)[\s\S]*?super\.capacitorDidLoad\(\)[\s\S]*?registerPluginInstance\(BasketBossNavigationPlugin\(\)\)/);
 assert.match(app,/override public func shouldOverrideLoad\(_ navigationAction: WKNavigationAction\) -> NSNumber\?/);
 assert.match(app,/guard let url = navigationAction\.request\.url, Self\.isBillingDestination\(url\) else \{ return nil \}/);
 assert.match(app,/webView\?\.load\(URLRequest\(url: Self\.accountStatusURL\)\)/);
 assert.match(app,/return NSNumber\(value: true\)/);
 assert.match(pluginAPI,/Returning true causes the WebView to abort loading the URL/);
 assert.match(scene,/rootViewController = BasketBossViewController\(\)/);
 assert.match(storyboard,/customClass="BasketBossViewController" customModule="App"/);
 assert.doesNotMatch(app,/navigationDelegate\s*=|class[^\n{]+:[^\n{]*WKNavigationDelegate/);
 // Exercise the literal native regexes against the same checkout destinations
 // as the JS guard, so a mismatch between the two layers is visible in CI.
 const nativePattern=name=>{
  const match=app.match(new RegExp('private static let '+name+' = #"([^\\n]+)"#'));
  assert.ok(match,name);return new RegExp(match[1],'i');
 };
 const provider=nativePattern('providerHost'),pages=nativePattern('purchasePages'),api=nativePattern('paymentAPI'),legal=nativePattern('legalProviderPath');
 for(const target of billingDestinations){
  const url=new URL(target,'capacitor://localhost/index.html');
  assert.ok(['stripe:','paddle:'].includes(url.protocol)||provider.test(url.hostname.replace(/\.$/,''))||pages.test(decodeURIComponent(url.pathname))||api.test(decodeURIComponent(url.pathname)),target);
 }
 for(const path of ['/api/subscription/status','/api/account/delete','/api/receipt-inventory','/privacy','/terms'])assert.equal(api.test(path)||pages.test(path),false,path);
 for(const path of ['/privacy','/legal/privacy','/legal/terms','/terms-of-service'])assert.equal(legal.test(path),true,path);
 for(const path of ['/checkout','/prices','/legal/privacy/checkout'])assert.equal(legal.test(path),false,path);
 // The plugin must allow its bundled status page so its redirect terminates.
 assert.match(app,/if local && path == "\/pricing-sandbox\.html" && url\.query == nil[\s\S]*?return false/);
});

test('native receipt cleanup is scoped to Camera temporary files and photo completion stops during deletion',()=>{
 const app=fs.readFileSync(new URL('../ios/App/App/AppDelegate.swift',import.meta.url),'utf8');
 const runtime=fs.readFileSync(new URL('../native/runtime.mjs',import.meta.url),'utf8');
 const camera=fs.readFileSync(new URL('../node_modules/@capacitor/camera/ios/Sources/CameraPlugin/CameraPlugin.swift',import.meta.url),'utf8');
 assert.match(camera,/NSTemporaryDirectory\(\)[^\n]*appendingPathComponent\("photo-\\\(imageCounter\)\.jpg"\)/);
 const name=app.match(/receiptPhotoName = #"([^\n]+)"#/)[1];
 // Translate ICU absolute anchors for Node without relaxing the end boundary.
 const pattern=new RegExp(name.replace('\\A','^').replace('\\z','$(?![\\s\\S])'));
 for(const file of ['photo-1.jpg','photo-22.jpg','photo-0003.jpg'])assert.equal(pattern.test(file),true,file);
 for(const file of ['photo-1.png','PHOTO-1.jpg','photo-1.JPG','photo-1.jpg\n','photo-.jpg','receipt-1.jpg','photo-1.jpg.bak','other-photo-1.jpg','../photo-1.jpg'])assert.equal(pattern.test(file),false,file);
 const cleanup=app.slice(app.indexOf('@objc func clearReceiptPhotos'));
 assert.match(cleanup,/URL\(fileURLWithPath: NSTemporaryDirectory\(\), isDirectory: true\)/);
 assert.match(cleanup,/contentsOfDirectory\(at: directory, includingPropertiesForKeys:/);
 assert.match(cleanup,/attributes\.isRegularFile == true, attributes\.isSymbolicLink != true/);
 assert.match(cleanup,/manager\.removeItem\(at: file\)/);
 assert.match(cleanup,/call\.reject\([^\n]*"BB_NATIVE_CLEANUP"/);
 assert.doesNotMatch(cleanup,/call\.(?:getString|getArray|getObject)|PHPhotoLibrary|removeItem\(at: directory\)/);
 assert.match(runtime,/const deleting=\(\)=>window\.BBAccountDeletion\?\.isDeleting\?\.\(\)===true/);
 assert.match(runtime,/await Camera\.getPhoto\([\s\S]*?if\(deleting\(\)\|\|!photo\.webPath\|\|!input\.isConnected\)return/);
 assert.match(runtime,/await clearTemporaryData\(\);cleared=true;\s*if\(deleting\(\)\|\|!input\.isConnected\)return;[\s\S]*?input\.dispatchEvent/);
 assert.match(runtime,/finally\{\s*if\(!cleared\)try\{await clearTemporaryData\(\)/);
});
