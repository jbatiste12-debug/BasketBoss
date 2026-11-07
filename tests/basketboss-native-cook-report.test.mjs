import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {cookRequiredFlags,cookReportFailure} from '../scripts/ios-cook-report.mjs';
const complete=()=>({complete:true,passed:true,legacyVisible:false,...Object.fromEntries(cookRequiredFlags.map(key=>[key,true]))});
test('Cook accepts only the complete passing real-app report',()=>{
 assert.equal(cookReportFailure(complete()),'');
 for(const report of [null,{}, {...complete(),complete:false}])assert.equal(cookReportFailure(report),'report_timeout');
 for(const report of [{...complete(),passed:false},{...complete(),passed:1},{...complete(),legacyVisible:true}])assert.equal(cookReportFailure(report),'ui_failed');
});
test('every navigation, ingredients, voice and data-retention check is independently mandatory',()=>{
 for(const key of cookRequiredFlags){
  const report=complete();delete report[key];assert.equal(cookReportFailure(report),'ui_failed',key+' missing');
  report[key]=false;assert.equal(cookReportFailure(report),'ui_failed',key+' false');
 }
});
test('both the native report writer and hosted XCTest require every mentor check',()=>{
 const source=fs.readFileSync(new URL('../ios/App/App/AppDelegate.swift',import.meta.url),'utf8');
 const hosted=fs.readFileSync(new URL('../ios/App/BasketBossCookSmokeTests/BasketBossCookSmokeTests.swift',import.meta.url),'utf8');
 const caseSeconds=Number(hosted.match(/executionTimeAllowance = (\d+)/)?.[1]);
 const reportSeconds=Number(hosted.match(/let deadline = Date\(\)\.addingTimeInterval\((\d+)\)/)?.[1]);
 assert.equal(caseSeconds,180,'the hosted case must allow the complete Cook navigation cycle');
 assert.equal(reportSeconds,120,'report polling must allow the final return navigation to complete');
 assert.ok(caseSeconds-reportSeconds>=60,'completion assertions retain a full minute after report polling');
 const writer=source.match(/let keys = \[([^\n]+)\]/)?.[1]||'';
 const required=hosted.match(/let required = \[([\s\S]*?)\]\n/)?.[1]||'';
 const mentor=cookRequiredFlags.filter(key=>key.startsWith('mentor'));
 assert.equal(mentor.length,13,'the integration must cover conversation, naming, privacy, controls and cleanup');
 for(const key of mentor){
  assert.ok(writer.includes('"'+key+'"'),'writer must retain '+key);
  assert.ok(required.includes('"'+key+'"'),'XCTest must assert '+key);
 }
});
test('Debug WebView QA remains valid JavaScript and checks the real mentor with injected transport only',()=>{
 const source=fs.readFileSync(new URL('../ios/App/App/AppDelegate.swift',import.meta.url),'utf8');
 const script=source.slice(source.indexOf('private final class BasketBossCookSmokeReporter')).match(/static let script = #"""\n([\s\S]*?)\n    """#/)?.[1];
 assert.ok(script,'the Debug-only Cook script must be extractable');
 assert.doesNotThrow(()=>new Function(script),'Swift raw-string changes must not corrupt the WebView JavaScript');
 assert.match(script,/originalController\.mount\(\{\.\.\.options,assistant,tts\}\)/,'inject model/audio transports without switching off mentor mode');
 assert.match(script,/payload\.history\.length===0/,'a newly opened Cook session must have no retained conversation');
 assert.match(script,/pendingAnswer\.signal\.aborted/,'the actual question request must be aborted on interruption');
 assert.match(script,/JSON\.stringify\(actualNextActions\)!==JSON\.stringify\(expectedNextActions\)/,'verify every rendered action in order after normalized method parsing');
 assert.doesNotMatch(script,/textContent\.includes\(recipe\.method\[1\]\)/,'separate bullet nodes do not preserve source sentence whitespace');
});

function returnProbe({view='week',missingFlag,keepData=true}={}){
 const source=fs.readFileSync(new URL('../ios/App/App/AppDelegate.swift',import.meta.url),'utf8');
 const script=source.slice(source.indexOf('private final class BasketBossCookSmokeReporter')).match(/static let script = #"""\n([\s\S]*?)\n    """#/)?.[1];
 assert.ok(script);
 const report=complete();delete report.complete;delete report.passed;delete report.backToPlan;delete report.dataKept;
 if(missingFlag)report[missingFlag]=false;
 const session=new Map([['bb_native_cook_smoke','back'],['bb_native_cook_smoke_report',JSON.stringify(report)]]),local=new Map(),messages=[],events=new Map();
 const storage=data=>({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)});
 let interval,observer,cleared=false;
 const listen=(type,callback)=>{const callbacks=events.get(type)||[];callbacks.push(callback);events.set(type,callbacks);};
 const document={readyState:'complete',body:{dataset:{bbnextView:view}},documentElement:{},scripts:[{src:'capacitor://localhost/bb-yellow-stickers-ui.js'}],getElementById:id=>id==='app'?{firstElementChild:{}}:null,addEventListener:listen};
 const window={BBNativeStartup:{phase:'ready'},webkit:{messageHandlers:{bbNativeCookSmoke:{postMessage:message=>messages.push(structuredClone(message))}}}};
 vm.runInNewContext(script,{window,document,location:{protocol:'capacitor:',pathname:'/index.html'},localStorage:storage(local),sessionStorage:storage(session),addEventListener:listen,MutationObserver:class{constructor(callback){observer=callback;}observe(){}},setInterval:callback=>{interval=callback;return 1;},clearInterval:()=>{cleared=true;},setTimeout,clearTimeout,console});
 if(!keepData)local.delete('basketboss_native_smoke_probe');
 return {messages,finish:()=>interval(),cleared:()=>cleared,lateEvents:()=>{for(const type of ['load','readystatechange'])for(const callback of events.get(type)||[])callback();observer([{addedNodes:[{nodeName:'SCRIPT'}]}]);}};
}

test('late return-page readiness events cannot overwrite a completed real Cook report',()=>{
 const h=returnProbe();h.finish();
 const finished=h.messages.at(-1);assert.equal(finished.complete,true);assert.equal(finished.passed,true);assert.equal(finished.backToPlan,true);assert.equal(finished.dataKept,true);assert.equal(h.cleared(),true);
 const count=h.messages.length;h.lateEvents();
 assert.equal(h.messages.length,count,'load, readystatechange and late scripts must preserve the final atomic report');
 assert.deepEqual(h.messages.at(-1),finished);
});

test('preserving completion never bypasses route, retention or mentor assertions',()=>{
 for(const options of [{view:'shop'},{keepData:false},{missingFlag:'mentorRecipeContext'}]){
  const h=returnProbe(options);h.finish();const finished=h.messages.at(-1);
  assert.equal(finished.complete,true);assert.equal(finished.passed,false);h.lateEvents();assert.deepEqual(h.messages.at(-1),finished);
 }
});
