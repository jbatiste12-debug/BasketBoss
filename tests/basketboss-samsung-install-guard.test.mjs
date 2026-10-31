import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const installer=await fs.readFile(new URL('../bb-install.js',import.meta.url),'utf8');
const worker=await fs.readFile(new URL('../service-worker.js',import.meta.url),'utf8');

function harness(userAgent){
  const listeners={};
  const button={textContent:''};
  const note={hidden:true,style:{setProperty(){},removeProperty(){}}};
  const nodes=new Map([['bb173NativeInstall',button],['bb173SamsungInstallNote',note]]);
  const document={
    readyState:'loading', addEventListener(){}, querySelectorAll(){return [];},
    getElementById(id){return nodes.get(id)||null;}
  };
  const window={
    addEventListener(name,fn){listeners[name]=fn;},
    localStorage:{getItem(){return null;}},
    matchMedia(){return {matches:false};}
  };
  const navigator={userAgent,standalone:false};
  vm.runInNewContext(installer,{window,document,navigator},{filename:'bb-install.js'});
  assert.equal(typeof listeners.beforeinstallprompt,'function');
  let suppressed=false;
  listeners.beforeinstallprompt({preventDefault(){suppressed=true;},prompt(){throw Error('Unexpected native install');}});
  assert.equal(suppressed,true);
  return {button,note};
}

test('Samsung Internet Android shows guidance instead of native install',()=>{
  const {button,note}=harness('Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36');
  assert.equal(button.textContent,'View safe Android advice');
  assert.equal(note.hidden,false);
  assert.match(installer,/if\(isSamsungInternet\)\{deferredPrompt=null;refresh\(\);return;\}/);
  assert.match(installer,/if\(isSamsungInternet\)\{setStatus\(/);
  assert.match(installer,/do not bypass it/i);
});

test('Android Chrome retains its standard install prompt',()=>{
  const {button,note}=harness('Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 Chrome/154.0 Mobile Safari/537.36');
  assert.equal(button.textContent,'Install now');
  assert.equal(note.hidden,true);
});

test('iPhone and desktop browsers retain their normal paths',()=>{
  for(const ua of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154.0 Safari/537.36'
  ]){
    const {button,note}=harness(ua);
    assert.equal(button.textContent,'Install now');
    assert.equal(note.hidden,true);
  }
});

test('service worker installs the current install asset, retires old caches and leaves APIs untouched',async()=>{
  const handlers={},installed=[],deleted=[];
  let skipped=false,claimed=false;
  const self={registration:{scope:'https://basketboss.co.uk/'},location:{origin:'https://basketboss.co.uk'},
    addEventListener:(name,fn)=>{handlers[name]=fn;},
    skipWaiting:async()=>{skipped=true;},clients:{claim:async()=>{claimed=true;}}};
  const caches={
    open:async key=>({addAll:async urls=>{installed.push({key,urls:Array.from(urls)});}}),
    keys:async()=>[installed[0].key,'basketboss-premium-secure-obsolete','another-app-cache'],
    delete:async key=>{deleted.push(key);return true;}
  };
  vm.runInNewContext(worker,{self,caches,URL},{filename:'service-worker.js'});
  let pending;
  handlers.install({waitUntil:promise=>{pending=promise;}});await pending;
  assert.equal(installed.length,1);
  assert.ok(installed[0].key,'An explicit app cache must be opened');
  assert.ok(installed[0].urls.some(url=>new URL(url).pathname==='/bb-install.js'));
  assert.equal(skipped,true);
  handlers.activate({waitUntil:promise=>{pending=promise;}});await pending;
  assert.deepEqual(deleted,['basketboss-premium-secure-obsolete']);
  assert.equal(claimed,true);
  for(const path of ['api/household?mode=status','api/subscription/status','api/bb173/scan']){
    let intercepted=false;
    handlers.fetch({request:{method:'GET',url:'https://basketboss.co.uk/'+path},
      respondWith(){intercepted=true;},waitUntil(){}});
    assert.equal(intercepted,false,`${path} must not be handled by the offline cache`);
  }
});
