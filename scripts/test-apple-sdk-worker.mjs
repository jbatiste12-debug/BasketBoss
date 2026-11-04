// Regression for Pages bundlers that leave CommonJS require() in an ESM chunk.
// Only the public Apple root is used; no accounts, proofs, keys or Apple calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {appleRootCertificates} from '../bb-server-lib/bb-apple-roots.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tools=process.env.BB_WORKER_TEST_TOOLS||path.join(root,'node_modules');
const {Miniflare,convertV4MiniflareOptions}=await import(path.join(tools,'miniflare/dist/src/index.js'));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'basketboss-sdk-esm-'));
let worker;
try{
 await build({absWorkingDir:root,stdin:{contents:'export {SignedDataVerifier} from "@apple/app-store-server-library";',resolveDir:root},platform:'node',format:'esm',bundle:true,outfile:path.join(directory,'legacy-sdk.mjs'),logLevel:'silent'});
 fs.copyFileSync(path.join(root,'bb-server-lib/vendor/apple-server-sdk.mjs'),path.join(directory,'fixed-sdk.mjs'));
 const rootCertificate=appleRootCertificates()[0].toString('base64');
 fs.writeFileSync(path.join(directory,'worker.mjs'),`import {Buffer} from 'node:buffer';
export default {async fetch(request){try{
 const sdk=new URL(request.url).pathname==='/legacy'?await import('./legacy-sdk.mjs'):await import('./fixed-sdk.mjs');
 const loaded=typeof sdk.loadAppleServerSDK==='function'?sdk.loadAppleServerSDK():sdk;
 const verifier=new loaded.SignedDataVerifier([Buffer.from(${JSON.stringify(rootCertificate)},'base64')],true,'Sandbox','uk.co.basketboss.app');
 return Response.json({ready:typeof verifier.verifyAndDecodeAppTransaction==='function'});
}catch(error){return Response.json({ready:false,dynamicRequireRejected:/Dynamic require/.test(error.message)},{status:503});}}};`);
 const options={workers:[{modulesRoot:directory,compatibilityDate:'2026-10-01',modules:[
  {type:'ESModule',path:path.join(directory,'worker.mjs')},
  {type:'ESModule',path:path.join(directory,'legacy-sdk.mjs')},
  {type:'ESModule',path:path.join(directory,'fixed-sdk.mjs')}
 ]}]};
 worker=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
 const legacy=await worker.dispatchFetch('https://example.test/legacy');assert.equal(legacy.status,503);assert.deepEqual(await legacy.json(),{ready:false,dynamicRequireRejected:true});
 const fixed=await worker.dispatchFetch('https://example.test/fixed');assert.equal(fixed.status,200);assert.deepEqual(await fixed.json(),{ready:true});
 console.log(JSON.stringify({runtime:'workerd',legacyDynamicRequireRejected:true,deferredEsmSdkReady:true,onlineChecks:true,sandbox:true}));
}finally{await worker?.dispose();fs.rmSync(directory,{recursive:true,force:true});}
