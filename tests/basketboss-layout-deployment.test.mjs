import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyLayoutDeployment} from '../scripts/verify-layout-deployment.mjs';
const perform=change=>async(url,options)=>{
 const name=new URL(url).pathname.slice(1);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal);
 const row=change?.(name)||{};
 return new Response(row.body??fs.readFileSync(new URL('../'+name,import.meta.url)),{status:row.status||200,headers:{'content-type':row.type||(name.endsWith('.css')?'text/css':'application/javascript')}});
};
test('public layout proof verifies current planner, pantry and shopping bytes',async()=>{
 assert.deepEqual(await verifyLayoutDeployment({perform:perform()}),{ok:true,layoutAssets:5,plannerTabsBytesVerified:true,pantryTabsBytesVerified:true,shoppingPresentationBytesVerified:true});
});
test('public layout proof rejects stale script bytes and HTML fallbacks',async()=>{
 await assert.rejects(verifyLayoutDeployment({perform:perform(name=>name==='bb-simple-layout.js'?{body:'old'}:null)}),/LAYOUT_ASSET_STALE/);
 await assert.rejects(verifyLayoutDeployment({perform:perform(name=>name==='bb-pantry-inline.css'?{type:'text/html'}:null)}),/LAYOUT_ASSET_UNAVAILABLE/);
});
