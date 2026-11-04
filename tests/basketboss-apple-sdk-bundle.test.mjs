import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL}from'node:url';import{execFileSync}from'node:child_process';import{build}from'esbuild';
import{buildAppleSDK,appleBuiltinFacades}from'../scripts/build-apple-sdk.mjs';
import{appleRootCertificates}from'../bb-server-lib/bb-apple-roots.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),artifact=path.join(root,'bb-server-lib/vendor/apple-server-sdk.mjs');
test('checked-in official SDK bundle is reproducible from pinned source and preserves licenses',async()=>{
 const result=await buildAppleSDK({check:true});assert.equal(result.version,'3.1.0');assert.equal(result.esbuildVersion,'0.28.2');assert.ok(result.nativeImports.includes('node:crypto'));assert.ok(result.nativeImports.includes('node:stream'));assert.ok(result.nativeImports.every(name=>name.startsWith('node:')));
 const license=fs.readFileSync(path.join(root,'bb-server-lib/vendor/apple-server-sdk.LICENSE.txt'),'utf8');for(const pkg of['@apple/app-store-server-library 3.1.0','jsonwebtoken','node-fetch','jsrsasign'])assert.ok(license.includes(pkg));assert.match(license,/Permission is hereby granted/);
});
test('native built-in facades remove unsupported CommonJS built-in require and preserve module shape',async()=>{
 const result=await build({stdin:{contents:'export function probe(){const crypto=require("crypto"),stream=require("stream"),buffer=require("buffer");return [crypto.createHash("sha256").update("test").digest("hex"),typeof stream.Readable,typeof buffer.Buffer];}',resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',plugins:[appleBuiltinFacades()],logLevel:'silent'});
 const source=result.outputFiles[0].text;assert.match(source,/from "node:crypto"/);assert.match(source,/from "node:stream"/);assert.doesNotMatch(source,/Dynamic require|__require\("(?:crypto|stream|buffer)"/);
 const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));assert.deepEqual(module.probe(),['9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08','function','function']);
});
test('importing the ESM artifact does not evaluate SDK random-state initialization',()=>{
 const script='const original=Math.random;Math.random=()=>{throw Error("SDK initialized before request");};const module=await import('+JSON.stringify(pathToFileURL(artifact).href)+');Math.random=original;if(typeof module.loadAppleServerSDK!=="function")throw Error("missing deferred entry");process.stdout.write("deferred");';
 assert.equal(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'}),'deferred');
});
test('deferred official SDK retains real pinned-root Sandbox and online verification behavior',async()=>{
 const bundle=await import(pathToFileURL(artifact).href);assert.equal(bundle.APPLE_SERVER_SDK_VERSION,'3.1.0');const sdk=bundle.loadAppleServerSDK();assert.equal(typeof sdk.AppStoreServerAPIClient,'function');assert.equal(typeof sdk.VerificationStatus.RETRYABLE_VERIFICATION_FAILURE,'number');
 const verifier=new sdk.SignedDataVerifier(appleRootCertificates(),true,'Sandbox','uk.co.basketboss.app');assert.equal(verifier.enableOnlineChecks,true);assert.equal(verifier.environment,'Sandbox');assert.equal(verifier.bundleId,'uk.co.basketboss.app');await assert.rejects(verifier.verifyAndDecodeAppTransaction('invalid proof'));
 const loader=fs.readFileSync(path.join(root,'bb-server-lib/bb-apple-subscriptions.js'),'utf8');assert.ok(loader.includes("import('./vendor/apple-server-sdk.mjs').then(module=>module.loadAppleServerSDK())"));assert.equal(loader.includes("import('@apple/app-store-server-library')"),false);
});
