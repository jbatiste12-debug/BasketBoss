// Real workerd fetch regression. All upstream traffic terminates in a synthetic
// service callback; no customer credentials, provider calls or account deletion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST='https://synthetic.supabase.co',FOREIGN='https://redirect-target.fixture.invalid';
const TOKEN='Bearer synthetic-deletion-session',KEY='synthetic-publishable-key';
const USER={id:'11111111-1111-4111-8111-111111111111',email:'synthetic@fixture.invalid',email_confirmed_at:'2026-11-01T00:00:00Z'};

export async function testDeletionWorkerFetch(){
 const tools=process.env.BB_WORKER_TEST_TOOLS||path.join(root,'node_modules');
 const {Miniflare,convertV4MiniflareOptions}=await import(path.join(tools,'miniflare/dist/src/index.js'));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'basketboss-deletion-fetch-'));
 let worker,mode='confirmed',upstreamRequests=0,foreignRequests=0;
 try{
  const entry=path.join(directory,'worker.mjs');
  await build({absWorkingDir:root,stdin:{contents:`
import {authenticatedDeletionUser} from ${JSON.stringify(path.join(root,'bb-server-lib/bb-apple-sign-in.js'))};
export default {async fetch(request){
 const verification=[];
 // Do not inject fetcher: Request construction and redirect handling must run
 // in workerd's own global fetch, before the synthetic outbound boundary.
 const user=await authenticatedDeletionUser(request,{
  SUPABASE_URL:${JSON.stringify(HOST)},SUPABASE_PUBLISHABLE_KEY:${JSON.stringify(KEY)}
 },{onFailure:reason=>verification.push(reason)});
 return Response.json({user,verification});
}};`,resolveDir:root},bundle:true,format:'esm',platform:'node',target:'es2022',outfile:entry,logLevel:'silent'});
  const outboundService=async request=>{
   const url=new URL(request.url);
   if(url.origin===FOREIGN){foreignRequests++;return new Response('redirect target must not be reached',{status:500});}
   assert.equal(url.origin,HOST,'outbound calls are restricted to the synthetic Supabase host');
   assert.equal(url.pathname,'/auth/v1/user');assert.equal(url.search,'');assert.equal(request.method,'GET');
   assert.equal(request.headers.get('authorization'),TOKEN);assert.equal(request.headers.get('apikey'),KEY);
   assert.equal(request.headers.has('cookie'),false,'incoming browser cookies must not be forwarded');
   upstreamRequests++;
   if(mode==='confirmed')return Response.json(USER);
   if(mode==='provider401')return Response.json({error:'synthetic-rejection'},{status:401});
   if(mode==='malformed')return new Response('synthetic-invalid-json',{headers:{'Content-Type':'application/json'}});
   return new Response(null,{status:Number(mode.slice('redirect'.length)),headers:{Location:FOREIGN+'/must-not-receive-credentials'}});
  };
  const options={workers:[{modulesRoot:directory,compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],
   modules:[{type:'ESModule',path:entry}],outboundService}]};
  worker=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
  for(const scenario of ['confirmed','provider401','redirect302','redirect307','redirect308','malformed']){
   mode=scenario;upstreamRequests=0;foreignRequests=0;
   const response=await worker.dispatchFetch('https://worker.fixture.invalid/identity',{
    headers:{Authorization:TOKEN,Cookie:'synthetic-incoming-cookie=must-not-forward'}
   });
   assert.equal(response.status,200);
   const result=await response.json();
   console.log(JSON.stringify({runtime:'workerd',deletionFetchCase:scenario,authenticated:result.user!==null,
    verification:result.verification,upstreamRequests,foreignRequests}));
   assert.equal(upstreamRequests,1,'real workerd fetch must reach the synthetic upstream: '+scenario);
   assert.equal(foreignRequests,0,'redirects must never forward account headers to another host');
   if(scenario==='confirmed'){
    assert.deepEqual(result,{user:{id:USER.id,email:USER.email,appleIdentity:false,appleSubjects:[]},verification:[]});
   }else{
    assert.equal(result.user,null,'failed or redirected verification cannot authenticate an account');
    assert.deepEqual(result.verification,[scenario==='provider401'?'auth_session_rejected':scenario==='malformed'?'auth_response_invalid':'auth_http_unavailable']);
   }
  }
  console.log(JSON.stringify({runtime:'workerd',deletionFetchVerified:true,confirmedUserAccepted:true,providerRejectionPreserved:true,
   redirectsRejected:true,credentialsNeverForwarded:true,malformedUserRejected:true,syntheticOnly:true}));
 }finally{await worker?.dispose();fs.rmSync(directory,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await testDeletionWorkerFetch();
