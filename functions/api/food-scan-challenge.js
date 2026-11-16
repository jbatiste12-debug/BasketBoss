// A public human check, hosted on the website's HTTPS origin for WKWebView.
// It never receives account credentials, photos or inventory data. The scan
// endpoint still verifies the returned Turnstile token and account separately.
const NATIVE_ORIGIN='capacitor://localhost';
const HOST='basketboss.co.uk';
const headers={
 'Cache-Control':'no-store, max-age=0',
 'Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff',
 'X-Robots-Tag':'noindex, nofollow',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
};
const literal=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export function onRequest({request,env}){
 const url=new URL(request.url);
 if(url.protocol!=='https:'||url.hostname!==HOST)return new Response('Not found',{status:404,headers});
 if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:{...headers,Allow:'GET'}});
 const nonce=url.searchParams.get('nonce');
 if(url.searchParams.size!==1||!nonce||!/^[a-f0-9]{64}$/.test(nonce))return new Response('Invalid verification request',{status:400,headers});
 const siteKey=env?.TURNSTILE_SITE_KEY;
 if(env?.BB_PREMIUM_AI_ENABLED!=='true'||typeof siteKey!=='string'||!/^[A-Za-z0-9_-]{10,100}$/.test(siteKey))return new Response('Verification unavailable',{status:503,headers});
 const scriptNonce=crypto.randomUUID().replace(/-/g,'');
 const csp="default-src 'none'; script-src 'nonce-"+scriptNonce+"' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; img-src https://challenges.cloudflare.com data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors "+NATIVE_ORIGIN;
 const html=`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BasketBoss human check</title><style>html,body{margin:0;background:#fffdf6;color:#1e4d3b;font:14px/1.4 system-ui}main{display:grid;justify-items:center;gap:6px;padding:7px}p{margin:0;text-align:center}</style></head><body><main><p id="status" role="status">Complete the check to scan your food.</p><div id="challenge"></div></main><script nonce="${scriptNonce}">
(()=>{'use strict';const nonce=${literal(nonce)},sitekey=${literal(siteKey)};
const status=document.getElementById('status');
// WebKit can treat its custom-scheme parent as opaque, requiring '*'. The
// message contains only this nonce-bound human-check result; CSP restricts
// embedding, and the parent independently checks HTTPS origin and WindowProxy.
function send(kind,token){if(window.parent===window)return;window.parent.postMessage({type:'basketboss-food-scan-check',nonce,kind,...(token?{token}:{})},'*');}
function failed(){status.textContent='The check could not load. Use Retry check in BasketBoss.';send('error');}
window.bbFoodScanChallengeReady=function(){try{window.turnstile.render('#challenge',{sitekey,action:'bb_ai',size:'compact',callback:function(token){status.textContent='Check complete. Return to your scan.';send('token',token);},'expired-callback':function(){status.textContent='The check expired. Use Retry check in BasketBoss.';send('expired');},'timeout-callback':failed,'error-callback':function(){failed();return true;}});}catch(_){failed();}};
const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=bbFoodScanChallengeReady&render=explicit';script.async=true;script.onerror=failed;document.head.appendChild(script);
})();</script></body></html>`;
 return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
}
