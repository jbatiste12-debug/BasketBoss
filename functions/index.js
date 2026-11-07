/* Public BasketBoss Beta marketing entry. This is NOT the app or an auth route.
 * The original app continues at /index.html, preserving PWA identity, recipes,
 * session, saved plans, Premium/Paddle and Household API behaviour.
 * Pages Functions: functions/index.js matches / exactly.
 */
import {receiptInventoryConfigured} from './api/receipt-inventory.js';
import {livePaidBillingEnabled} from '../bb-server-lib/bb-paid-access.js';
import {APP_STORE_ID,appStoreLaunchEnabled} from '../bb-server-lib/bb-app-store-launch.js';
export async function onRequest({request,env}){
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const source=new URL(request.url);
  const destination=new URL(source);
  destination.pathname='/welcome'; // Cloudflare Pages asset serving uses pretty paths.
  destination.search='';
  const asset=await env.ASSETS.fetch(new Request(destination.toString(),{method:request.method}));
  const headers=new Headers(asset.headers);
  headers.set('Cache-Control','no-cache, must-revalidate');
  headers.set('X-Content-Type-Options','nosniff');
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(source.hostname))headers.set('X-Robots-Tag','noindex, nofollow');
  const response=new Response(asset.body,{status:asset.status,headers});
  const appStoreLive=appStoreLaunchEnabled(env);
  const receiptReady=livePaidBillingEnabled(env)&&receiptInventoryConfigured(request,env);
  if(request.method==='GET'&&(appStoreLive||receiptReady)){
    response.headers.delete('Content-Length');response.headers.delete('ETag');
    const rewrite=new HTMLRewriter();
    if(receiptReady)rewrite.on('[data-bb-smart-receipt-ready]',{
      element(element){element.removeAttribute('hidden');}
    });
    if(appStoreLive){
      rewrite.on('head',{element(element){element.append('<meta name="apple-itunes-app" content="app-id='+APP_STORE_ID+'">',{html:true});}});
      rewrite.on('[data-bb-app-store-launch]',{element(element){element.removeAttribute('hidden');}});
      rewrite.on('[data-bb-web-hero-label]',{element(element){element.setInnerContent('Use the web app');}});
    }
    return rewrite.transform(response);
  }
  return response;
}
