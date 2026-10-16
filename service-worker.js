/* BasketBoss PWA: caches app shell and images for repeat visits. */
const CACHE='basketboss-shell-v2';
const IMAGES='basketboss-images-v1';
const SHELL=['./','./index.html','./manifest.webmanifest','./cloud-config.js','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>![CACHE,IMAGES].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(resp=>{if(resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put('./index.html',clone));}return resp;}).catch(()=>caches.match('./index.html')));
    return;
  }
  if(url.origin===self.location.origin){
    event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(resp=>{if(resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return resp;})));
    return;
  }
  if(req.destination==='image'){
    event.respondWith(caches.open(IMAGES).then(async cache=>{
      const hit=await cache.match(req);
      if(hit)return hit;
      try{const resp=await fetch(req);if(resp.ok||resp.type==='opaque'){await cache.put(req,resp.clone());}return resp;}catch(e){return Response.error();}
    }));
  }
});
