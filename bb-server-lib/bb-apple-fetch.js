/* Transport bridge for the official Apple SDK's node-fetch calls in Workers.
 * Apple's certificate, signature, OCSP parsing and revocation checks are left
 * untouched. Only HTTP transport uses the runtime's native Fetch implementation.
 */
import {Buffer} from 'node:buffer';
export const Headers=globalThis.Headers;
export function createAppleFetch({fetch:perform=(...args)=>globalThis.fetch(...args),setTimeout:schedule=setTimeout,clearTimeout:cancel=clearTimeout}={}){
 return async function appleFetch(input,init={}){
  const {timeout,...options}=init;
  const milliseconds=Number(timeout),bounded=Number.isFinite(milliseconds)&&milliseconds>0;
  const controller=bounded?new AbortController():null,upstream=options.signal;
  let timer,aborted;
  if(controller){
   aborted=()=>controller.abort(upstream?.reason);
   if(upstream?.aborted)aborted();else upstream?.addEventListener?.('abort',aborted,{once:true});
   options.signal=controller.signal;
   timer=schedule(()=>controller.abort(new DOMException('Apple HTTP request timed out.','TimeoutError')),milliseconds);
  }
  try{
   const response=await perform(input,options);
   // The SDK consumes complete JSON or DER bodies. Buffer while the timeout is
   // still active, so a response that stalls after its headers is bounded too.
   const bodyless=response.body===null||String(options.method||'GET').toUpperCase()==='HEAD'||[204,205,304].includes(response.status);
   const bytes=await response.arrayBuffer();
   const result=new Response(bodyless?null:bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
   Object.defineProperties(result,{
    url:{value:response.url},redirected:{value:response.redirected},
    buffer:{value:async()=>Buffer.from(await result.arrayBuffer())}
   });
   return result;
  }finally{
   if(timer!==undefined)cancel(timer);
   if(aborted)upstream?.removeEventListener?.('abort',aborted);
  }
 };
}
export default createAppleFetch();
