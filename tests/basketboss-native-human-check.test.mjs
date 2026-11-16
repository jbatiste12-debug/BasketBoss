import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {onRequest} from '../functions/api/food-scan-challenge.js';

const require=createRequire(import.meta.url),nativeCheck=require('../bb-native-human-check.js');
const TYPE='basketboss-food-scan-check',ORIGIN='https://basketboss.co.uk',nonce='ab'.repeat(32);
const env={BB_PREMIUM_AI_ENABLED:'true',TURNSTILE_SITE_KEY:'0x4AAAA_public_fixture',TURNSTILE_SECRET_KEY:'never-return-secret',GEMINI_API_KEY:'never-return-provider-key'};
function request({url=ORIGIN+'/api/food-scan-challenge?nonce='+nonce,method='GET',config=env}={}){return onRequest({request:new Request(url,{method}),env:config});}

test('the hosted challenge is no-store, noindex and framed only by the native origin',async()=>{
 const response=request();assert.equal(response.status,200);
 assert.match(response.headers.get('Cache-Control'),/no-store/);
 assert.match(response.headers.get('X-Robots-Tag'),/noindex/);
 assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
 const policy=response.headers.get('Content-Security-Policy');assert.match(policy,/frame-ancestors capacitor:\/\/localhost(?:;|$)/);
 assert.match(policy,/default-src 'none'/);assert.match(policy,/base-uri 'none'/);assert.match(policy,/form-action 'none'/);
 assert.match(policy,/script-src 'nonce-[a-f0-9]+' https:\/\/challenges\.cloudflare\.com/);
 const html=await response.text();assert.match(html,/action:'bb_ai'/);assert.match(html,/size:'compact'/);
 assert.ok(!html.includes(env.TURNSTILE_SECRET_KEY));assert.ok(!html.includes(env.GEMINI_API_KEY));
 assert.ok(!html.includes('Authorization'));assert.ok(!html.includes('localStorage'));assert.ok(!html.includes('imageBase64'));
 const scriptNonce=html.match(/<script nonce="([a-f0-9]+)">/)[1];assert.ok(policy.includes("'nonce-"+scriptNonce+"'"));
});

test('the hosted page rejects other hosts, insecure transport, writes and malformed query state',()=>{
 for(const url of ['https://evil.example/api/food-scan-challenge?nonce='+nonce,'https://www.basketboss.co.uk/api/food-scan-challenge?nonce='+nonce,'http://basketboss.co.uk/api/food-scan-challenge?nonce='+nonce])assert.equal(request({url}).status,404);
 for(const method of ['POST','HEAD','OPTIONS']){const response=request({method});assert.equal(response.status,405);assert.equal(response.headers.get('Allow'),'GET');}
 for(const query of ['', '?nonce=short', '?nonce='+nonce+'&nonce='+nonce,'?nonce='+nonce+'&token=unwanted','?nonce=%3Cscript%3E'])assert.equal(request({url:ORIGIN+'/api/food-scan-challenge'+query}).status,400);
 for(const config of [{},{...env,BB_PREMIUM_AI_ENABLED:'false'},{...env,TURNSTILE_SITE_KEY:'invalid<script>'}])assert.equal(request({config}).status,503);
});

test('the hosted renderer posts only nonce-bound human-check results to its parent',async()=>{
 const html=await request().text(),script=html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1];
 const sent=[],loaded=[],status={textContent:''};let rendered;
 const win={parent:{postMessage:(data,target)=>sent.push({data,target})},turnstile:{render:(_,options)=>{rendered=options;}}};
 const doc={getElementById:()=>status,createElement:()=>({}),head:{appendChild:node=>loaded.push(node)}};
 vm.runInNewContext(script,{window:win,document:doc});
 assert.equal(loaded.length,1);assert.equal(loaded[0].src,'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=bbFoodScanChallengeReady&render=explicit');
 win.bbFoodScanChallengeReady();assert.equal(rendered.sitekey,env.TURNSTILE_SITE_KEY);assert.equal(rendered.action,'bb_ai');
 rendered.callback('opaque-human-token.123');rendered['expired-callback']();rendered['error-callback']();
 assert.deepEqual(JSON.parse(JSON.stringify(sent)),[
  {data:{type:TYPE,nonce,kind:'token',token:'opaque-human-token.123'},target:'*'},
  {data:{type:TYPE,nonce,kind:'expired'},target:'*'},
  {data:{type:TYPE,nonce,kind:'error'},target:'*'}
 ]);
 assert.match(status.textContent,/could not load/);
});

class Node{
 constructor(tag){this.tagName=tag;this.style={};this.children=[];this.listeners={};this.attributes={};this.hidden=false;if(tag==='iframe')this.contentWindow={};}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(name,listener){this.listeners[name]=listener;}
 appendChild(child){child.remove();child.parent=this;this.children.push(child);return child;}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(value=>value!==this);this.parent=null;}}
 click(){this.listeners.click?.();}
}
function fixture({protocol='capacitor:',hostname='localhost',crypto=true}={}){
 const host=new Node('div'),listeners=new Map(),timers=new Map(),tokens=[],errors=[],expired=[];let random=0,nextTimer=0;
 const win={location:{protocol,hostname},document:{createElement:tag=>new Node(tag)},crypto:crypto?{getRandomValues(bytes){bytes.fill(++random);return bytes;}}:null,
  addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener:(name,listener)=>{if(listeners.get(name)===listener)listeners.delete(name);},
  setTimeout:(callback,ms)=>{const id=++nextTimer;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id)};
 const handle=nativeCheck.create(win).mount(host,{onToken:value=>tokens.push(value),onError:value=>errors.push(value),onExpire:()=>expired.push(true)});
 const frame=()=>host.children.find(node=>node.tagName==='iframe'),retry=()=>host.children.find(node=>node.tagName==='button');
 function emit(data={},event={}){const current=frame();listeners.get('message')?.({origin:ORIGIN,source:current?.contentWindow,data:{type:TYPE,nonce:current?new URL(current.src).searchParams.get('nonce'):null,kind:'token',token:'opaque-human-token.123',...data},...event});}
 return {host,win,handle,frame,retry,tokens,errors,expired,timers,listeners,emit};
}

test('native mounting uses the official HTTPS frame and sends no user or account data',()=>{
 const h=fixture(),frame=h.frame(),url=new URL(frame.src);
 assert.equal(url.origin,ORIGIN);assert.equal(url.pathname,'/api/food-scan-challenge');assert.equal(url.searchParams.size,1);assert.match(url.searchParams.get('nonce'),/^[a-f0-9]{64}$/);
 assert.equal(frame.attributes.referrerpolicy,'no-referrer');assert.equal(frame.attributes.sandbox,'allow-scripts allow-same-origin');
 assert.equal(frame.attributes.allow,"camera 'none'; microphone 'none'; geolocation 'none'");
 assert.equal(h.timers.size,1);assert.equal(h.retry().hidden,true);h.handle.remove();
});

test('web pages, unexpected custom origins and missing secure randomness cannot mount the native check',()=>{
 for(const options of [{protocol:'https:',hostname:'basketboss.co.uk'},{protocol:'capacitor:',hostname:'evil.example'},{crypto:false}]){
  const h=fixture(options);assert.equal(h.handle,null);assert.equal(h.host.children.length,0);assert.deepEqual(h.errors,['verification_unavailable']);assert.equal(h.listeners.size,0);
 }
});

test('forged origins, frame sources, message types and nonces never deliver a token',()=>{
 const h=fixture();
 for(const origin of ['https://evil.example','http://basketboss.co.uk','https://www.basketboss.co.uk','null','capacitor://localhost'])h.emit({}, {origin});
 h.emit({}, {source:{}});h.emit({nonce:'wrong'});h.emit({type:'other'});h.emit({}, {data:null});h.emit({}, {data:[]});
 for(const token of ['', 'short', 'x'.repeat(2049),'has\nnewline'])h.emit({token});
 assert.deepEqual(h.tokens,[]);assert.deepEqual(h.errors,[]);
 h.emit({token:'opaque+provider/token=with.punctuation'});h.emit();assert.deepEqual(h.tokens,['opaque+provider/token=with.punctuation']);assert.equal(h.timers.size,0);h.handle.remove();
});

test('reset rotates nonce and frame identity, rejects old errors and messages, and clears an issued token',()=>{
 const h=fixture(),old=h.frame(),oldNonce=new URL(old.src).searchParams.get('nonce'),oldTimer=[...h.timers.values()][0].callback;
 h.emit();h.handle.reset();assert.equal(h.expired.length,1);assert.notEqual(h.frame(),old);assert.notEqual(new URL(h.frame().src).searchParams.get('nonce'),oldNonce);
 old.listeners.error();oldTimer();h.emit({nonce:oldNonce},{source:old.contentWindow});h.emit({nonce:oldNonce});
 assert.deepEqual(h.errors,[]);assert.equal(h.tokens.length,1);assert.equal(h.retry().hidden,true);
 h.emit();assert.equal(h.tokens.length,2);h.handle.remove();assert.equal(h.expired.length,2);
});

test('expiry and failures invalidate the result, expose Retry, and ignore late success until reset',()=>{
 for(const kind of ['expired','error']){
  const h=fixture();h.emit();h.emit({kind});assert.equal(h.retry().hidden,false);
  if(kind==='expired')assert.equal(h.expired.length,1);else assert.deepEqual(h.errors,['verification_unavailable']);
  h.emit();assert.equal(h.tokens.length,1);h.retry().click();assert.equal(h.retry().hidden,true);h.emit();assert.equal(h.tokens.length,2);h.handle.remove();
 }
});

test('a timeout is recoverable and remove detaches all listeners and late results',()=>{
 const h=fixture();const timeout=[...h.timers.values()][0];assert.equal(timeout.ms,120000);timeout.callback();assert.deepEqual(h.errors,['verification_unavailable']);assert.equal(h.retry().hidden,false);
 h.retry().click();const frame=h.frame(),nonce=new URL(frame.src).searchParams.get('nonce');h.handle.remove();h.handle.remove();
 assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);assert.equal(h.host.children.length,0);
 h.emit({nonce},{source:frame.contentWindow});frame.listeners.error();timeout.callback();assert.deepEqual(h.tokens,[]);assert.equal(h.errors.length,1);assert.equal(h.handle.reset(),false);
});
