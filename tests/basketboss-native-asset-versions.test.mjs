import test from 'node:test';import assert from 'node:assert/strict';
import {versionNativeHtml} from '../scripts/build-native-web.mjs';
test('native script versions follow actual bytes while API and external URLs remain untouched',()=>{
 const source='<script src="make-a-meal.js?v=old"></script><link href="bb-native.css" rel="stylesheet"><a href="make-a-meal.html">Cook</a><script src="https://external.invalid/tool.js"></script><a href="/api/status">API</a>';
 const read=name=>Buffer.from(name==='make-a-meal.js'?'new code':'new css');const docs=new Map([['make-a-meal.html','document-content-hash']]);
 const output=versionNativeHtml(source,read,docs);assert.match(output,/make-a-meal\.js\?v=old&amp;bb_native_asset=[a-f0-9]{16}/);assert.match(output,/make-a-meal\.html\?bb_native_doc=document-content-hash/);assert.match(output,/src="https:\/\/external.invalid\/tool.js"/);assert.match(output,/href="\/api\/status"/);
 assert.equal(versionNativeHtml(output,read,docs),output);assert.notEqual(versionNativeHtml(source,()=>Buffer.from('updated'),docs),output);
});
test('native versioning never reads an encoded traversal or malformed asset reference',()=>{
 let reads=0;const source='<script src="..%2f..%2fprivate.js"></script><link href="broken%zz.css">';
 assert.equal(versionNativeHtml(source,()=>{reads++;return Buffer.from('private');}),source);assert.equal(reads,0);
});
