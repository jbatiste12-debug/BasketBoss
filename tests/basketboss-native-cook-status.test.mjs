import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transformNativeHtml} from '../scripts/build-native-web.mjs';

const source=fs.readFileSync(new URL('../make-a-meal.html',import.meta.url),'utf8');
const start=source.indexOf('function showPremiumForAI(entry)');
const opener=source.slice(start,source.indexOf("document.addEventListener('click'",start));

test('native Free AI entry opens bundled account status without a sales dialog or file picker',()=>{
 const calls=[];
 const context=vm.createContext({window:{BBNative:{isNative:true},location:{assign:address=>calls.push(address)}},document:{getElementById(){throw Error('Native must not open the web sales dialog');}}});
 vm.runInContext(opener,context);vm.runInContext('showPremiumForAI({})',context);
 assert.deepEqual(calls,['pricing-sandbox.html']);
});

test('web AI entry preserves its existing eligibility dialog and feature label',()=>{
 let shown=0;const feature={textContent:''},dialog={open:false,showModal(){shown++;}};
 const context=vm.createContext({window:{},document:{getElementById:id=>id==='bbPremiumDialog'?dialog:feature},visibleError(){throw Error('Unexpected error');}});
 vm.runInContext(opener,context);vm.runInContext('showPremiumForAI({matches:()=>true})',context);
 assert.equal(shown,1);assert.equal(feature.textContent,'AI ingredient scanning');
});

test('native packaging removes the private comparison controller while keeping actual Cook and setup controls',()=>{
 const native=transformNativeHtml(source);
 assert.doesNotMatch(native,/id="bb17513-private-qa-toggle-(script|css)"/);
 assert.doesNotMatch(native,/QA ONLY — NO PAYMENT/);
 assert.match(native,/id="generate"/);assert.match(native,/id="ai-photo-input"/);assert.match(native,/bb-cook-studio\.js/);
 assert.match(source,/id="bb17513-private-qa-toggle-script"/,'the separate private web preview remains available');
});
