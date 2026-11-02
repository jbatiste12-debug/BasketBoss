import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {keyboardRuntimePlan} from '../scripts/ios-keyboard-runtime.mjs';
import {cookRequiredFlags,cookReportFailure} from '../scripts/ios-cook-report.mjs';

async function runScript(name,{ci=true,booted=true,includeLatest=false,failTests=false,bootTimeoutState=null,failReadiness=false,keepSimulator=false,cookBadReport=false,cookIncompleteReport=false,cookMissingFlag=null,cookSummary=null,cookSummaryError=false,cookContainerChanges=false,cookBuildBoots=false}={}){
 const commands=[],executions=[],logs=[],written=new Map(),readFiles=[];let hostedCookRan=false;
 const processStub={platform:'darwin',env:ci?{GITHUB_ACTIONS:'true'}:{}};
 if(keepSimulator)processStub.env.BB_IAP_KEEP_SIMULATOR_BOOTED='true';
 let state=booted?'Booted':'Shutdown';
 const device=()=>({udid:'proven-phone',name:'iPhone 17 Pro',state,isAvailable:true});
 const runtime={identifier:'proven-runtime',name:'iOS 26.2',version:'26.2',isAvailable:true};
 const latestRuntime={identifier:'cold-latest-runtime',name:'iOS 26.5',version:'26.5',isAvailable:true};
 const source=fs.readFileSync(new URL('../scripts/'+name,import.meta.url),'utf8').replace(/^import .+;\r?\n/gm,'');
 const context={process:processStub,path,keyboardRuntimePlan,cookRequiredFlags,cookReportFailure,console:{log:value=>logs.push(value)},setTimeout:fn=>{fn();return 1;},fs:{
  mkdirSync(){},rmSync(){},existsSync(){return true;},writeFileSync:(file,value)=>written.set(file,value),
  readFileSync:file=>{readFiles.push(String(file));return JSON.stringify(String(file).endsWith('bb-native-iap-smoke.json')?{
   complete:true,passed:true,localStoreKit:true,productionBillingTested:false,backendPremiumGranted:false,
   productsLoaded:true,purchaseVerified:true,accountTokenPreserved:true,unfinishedBeforeServerAck:true,
   earlyFinishRejected:true,restoreVerified:true,duplicatePurchasePrevented:true,wrongAccountRejected:true,
   finishedAfterAcknowledgement:true,pendingDoesNotGrantAccess:true,pendingApprovalDelivered:true,cancellationPreserved:true
  }:String(file).endsWith('bb-native-cook-smoke.json')?{complete:!cookIncompleteReport,passed:!cookBadReport,legacyVisible:false,...Object.fromEntries(cookRequiredFlags.map(key=>[key,key!==cookMissingFlag]))}:{complete:true,passed:true});}
 },execFileSync(command,args,options){
  executions.push({command,args,timeout:options?.timeout});commands.push([command,...args]);
  if(name==='test-ios-cook-smoke.mjs'&&command==='xcodebuild'&&args.includes('build-for-testing')&&cookBuildBoots)state='Booted';
  if(name==='test-ios-cook-smoke.mjs'&&command==='xcodebuild'&&args.includes('test-without-building'))hostedCookRan=true;
  if(failTests&&command==='xcodebuild'&&args.includes('test-without-building')){
   const error=Error('xcodebuild failed');error.stdout=name==='test-ios-cook-smoke.mjs'?'XCTAssertTrue failed: full Cook report diagnostic':'XCTAssertTrue failed: real keyboard diagnostic';error.stderr='TEST FAILED';throw error;
  }
  if(command==='xcrun'){
   if(args[0]==='xcresulttool'){if(name==='test-ios-cook-smoke.mjs'){if(cookSummaryError)throw Error('missing Cook XCTest summary');return JSON.stringify(cookSummary||{passedTests:failTests?0:1,failedTests:failTests?1:0,skippedTests:0});}return JSON.stringify({passedTests:failTests?1:4,failedTests:failTests?1:0,skippedTests:0});}
   if(args[0]==='simctl'){
    if(args[1]==='list'&&args[2]==='devices')return JSON.stringify({devices:{[runtime.identifier]:[device()],...(includeLatest?{[latestRuntime.identifier]:[{udid:'cold-latest-phone',name:'iPhone SE (3rd generation)',state:'Shutdown',isAvailable:true}]}:{})}});
    if(args[1]==='list'&&args[2]==='runtimes')return JSON.stringify({runtimes:includeLatest?[latestRuntime,runtime]:[runtime]});
    if(args[1]==='list'&&args[2]==='devicetypes')return JSON.stringify({devicetypes:[{name:'iPhone SE (3rd generation)',identifier:'se'}]});
    if(args[1]==='shutdown')state='Shutdown';
    if(args[1]==='boot'){
     state=bootTimeoutState||'Booted';
     if(bootTimeoutState){const error=Error('initial simulator boot command timed out');error.code='ETIMEDOUT';throw error;}
    }
    if(args[1]==='bootstatus'){
     if(failReadiness){const error=Error('simulator never became ready');error.code='ETIMEDOUT';throw error;}
     state='Booted';
    }
    if(args[1]==='get_app_container')return cookContainerChanges&&hostedCookRan?'/synthetic-ci-app-after-xctest':'/synthetic-ci-app';
   }
  }
  return '';
 }};
 await vm.runInNewContext('(async()=>{'+source+'\n})()',context,{filename:name});
 return {commands,executions,logs,written,readFiles,process:processStub};
}

test('CI Cook runner resets the proven simulator and configures its keyboard before reopening it',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs');
 assert.equal(result.process.exitCode,undefined);
 const shutdown=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='shutdown');
 const boot=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='boot');
 const preference=result.commands.findIndex(command=>command[0]==='defaults'&&command[1]==='write');
 const open=result.commands.findIndex(command=>command[0]==='open');
 assert.ok(shutdown>=0&&boot>shutdown);
 assert.ok(preference>shutdown&&preference<open);
 assert.ok(result.logs.some(line=>line.includes('"passed":true')));
});

test('local Cook runner does not reset a developer simulator or change its keyboard preference',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs',{ci:false});
 assert.equal(result.process.exitCode,undefined);
 assert.equal(result.commands.some(command=>command[0]==='defaults'||command[0]==='killall'||(command[1]==='simctl'&&command[2]==='shutdown')),false);
});

test('standalone CI Cook runner prefers the proven runtime when no previous check booted a phone',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs',{booted:false,includeLatest:true});
 assert.equal(result.process.exitCode,undefined);
 const boot=result.commands.find(command=>command[1]==='simctl'&&command[2]==='boot');
 assert.equal(boot?.[3],'proven-phone');
 assert.ok(result.logs.some(line=>line.includes('"runtimeVersion":"26.2"')&&line.includes('"passed":true')));
});

test('keyboard CI reuses the exercised session without killing its GUI or re-waiting for boot bookkeeping',async()=>{
 const result=await runScript('test-ios-account-keyboard.mjs');
 assert.equal(result.process.exitCode,undefined);
 assert.equal(result.commands.some(command=>command[0]==='killall'||(command[1]==='simctl'&&['boot','bootstatus','shutdown','delete'].includes(command[2]))),false);
 assert.ok(result.commands.some(command=>command[1]==='simctl'&&command[2]==='uninstall'&&command[3]==='proven-phone'));
 assert.ok(result.commands.some(command=>command[0]==='xcodebuild'&&command.includes('test-without-building')));
 assert.ok(result.logs.some(line=>line.includes('"passed":true')));
});

test('keyboard test failures retain the actual XCTest diagnostic in both artifacts and job output',async()=>{
 const result=await runScript('test-ios-account-keyboard.mjs',{failTests:true});
 assert.equal(result.process.exitCode,1);
 assert.ok(result.logs.some(line=>line.includes('XCTAssertTrue failed: real keyboard diagnostic')));
 assert.ok([...result.written].some(([file,text])=>file.endsWith('tests.log')&&text.includes('XCTAssertTrue failed: real keyboard diagnostic')));
 assert.ok(result.logs.some(line=>line.includes('"failureStage":"real_keyboard_tests"')));
 assert.ok(result.logs.some(line=>line.includes('keyboard XCTest summary')&&line.includes('"failedTests":1')));
 assert.ok([...result.written].some(([file,text])=>file.endsWith('summary.json')&&JSON.parse(text).failedTests===1));
});

test('StoreKit boot timeout recovers only after the selected starting simulator proves ready',async()=>{
 for(const bootTimeoutState of ['Booting','Booted']){
  const result=await runScript('test-ios-iap-smoke.mjs',{booted:false,bootTimeoutState,keepSimulator:true});
  assert.equal(result.process.exitCode,undefined);
  const boot=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='boot');
  const recheck=result.commands.findIndex((command,index)=>index>boot&&command[1]==='simctl'&&command[2]==='list'&&command[3]==='devices');
  const ready=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='bootstatus');
  const testRun=result.commands.findIndex(command=>command[0]==='xcodebuild'&&command.includes('test-without-building'));
  assert.ok(boot>=0&&recheck>boot&&ready>recheck&&testRun>ready,'actual readiness must precede hosted purchase tests');
  assert.equal(result.commands.filter(command=>command[1]==='simctl'&&command[2]==='boot').length,1);
  assert.equal(result.commands.some(command=>command[1]==='simctl'&&['shutdown','delete','erase'].includes(command[2])),false);
  assert.ok(result.logs.some(line=>line.includes('"purchaseVerified":true')&&line.includes('"passed":true')));
 }
});

test('StoreKit boot timeout leaves a shutdown simulator failed without entering purchase tests',async()=>{
 const result=await runScript('test-ios-iap-smoke.mjs',{booted:false,bootTimeoutState:'Shutdown',keepSimulator:true});
 assert.equal(result.process.exitCode,1);
 assert.equal(result.commands.some(command=>command[1]==='simctl'&&command[2]==='bootstatus'),false);
 assert.equal(result.commands.some(command=>command[0]==='xcodebuild'),false);
 assert.ok(result.logs.some(line=>line.includes('"failureStage":"boot"')&&line.includes('"failure":"command_timeout"')));
});

test('StoreKit recovery cannot turn a later readiness timeout into a passing check',async()=>{
 const result=await runScript('test-ios-iap-smoke.mjs',{booted:false,bootTimeoutState:'Booting',failReadiness:true,keepSimulator:true});
 assert.equal(result.process.exitCode,1);
 assert.equal(result.commands.some(command=>command[0]==='xcodebuild'),false);
 assert.ok(result.logs.some(line=>line.includes('"failureStage":"bootstatus"')&&line.includes('"passed":false')));
});

test('local StoreKit boot recovery does not reset a developer simulator or keyboard preference',async()=>{
 const result=await runScript('test-ios-iap-smoke.mjs',{ci:false,booted:false,bootTimeoutState:'Booting',keepSimulator:true});
 assert.equal(result.process.exitCode,undefined);
 assert.equal(result.commands.some(command=>command[0]==='defaults'||command[0]==='killall'||(command[1]==='simctl'&&['shutdown','delete','erase'].includes(command[2]))),false);
});


test('CI Cook uses a hosted XCTest launch on the exact selected phone, while local runs retain simctl',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs');
 assert.equal(result.process.exitCode,undefined);
 assert.ok(result.commands.some(command=>command[0]==='ruby'&&command[1]==='scripts/prepare-ios-cook-smoke-tests.rb'));
 const prepare=result.executions.find(call=>call.command==='ruby');
 assert.equal(prepare.timeout,120000,'cold setup receives the same bounded budget as keyboard setup');
 assert.ok(result.commands.findIndex(command=>command[0]==='ruby')<result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='boot'));
 const build=result.executions.find(call=>call.command==='xcodebuild'&&call.args.includes('build-for-testing'));
 assert.equal(build.timeout,600000,'cold test compilation receives a bounded ten-minute budget');
 assert.equal(build.args.includes('-quiet'),false,'real compilation diagnostics must be retained');
 const buildIndex=result.commands.findIndex(command=>command[0]==='xcodebuild'&&command.includes('build-for-testing'));
 const shutdownIndex=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='shutdown');
 const bootIndex=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='boot');
 assert.ok(shutdownIndex<buildIndex&&buildIndex<bootIndex,'build on the same shutdown destination before its cold boot');
 const tests=result.executions.find(call=>call.command==='xcodebuild'&&call.args.includes('test-without-building'));
 assert.ok(tests.args.includes('BasketBossCookSmokeTests'));
 assert.ok(tests.args.includes('platform=iOS Simulator,id=proven-phone'));
 assert.equal(tests.timeout,180000);
 assert.equal(tests.args.includes('-quiet'),false);
 assert.equal(result.commands.some(command=>command[1]==='simctl'&&command[2]==='launch'),false);
 assert.ok(result.logs.some(line=>line.includes('"launcher":"hosted_xctest"')&&line.includes('"passed":true')));
 const local=await runScript('test-ios-cook-smoke.mjs',{ci:false});
 assert.equal(local.commands.some(command=>command[0]==='xcodebuild'),false);
 assert.ok(local.commands.some(command=>command[1]==='simctl'&&command[2]==='launch'&&command.includes('--bb-native-cook-smoke')));
});

test('Cook refreshes the selected phone state after building and never double-boots an Xcode-started destination',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs',{cookBuildBoots:true});
 assert.equal(result.process.exitCode,undefined);
 assert.equal(result.commands.some(command=>command[1]==='simctl'&&command[2]==='boot'),false);
 const build=result.commands.findIndex(command=>command[0]==='xcodebuild'&&command.includes('build-for-testing'));
 const refresh=result.commands.findIndex((command,index)=>index>build&&command[1]==='simctl'&&command[2]==='list'&&command[3]==='devices');
 const ready=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='bootstatus');
 const tests=result.commands.findIndex(command=>command[0]==='xcodebuild'&&command.includes('test-without-building'));
 assert.ok(build<refresh&&refresh<ready&&ready<tests,'real readiness still precedes the hosted test');
});

test('Cook reads the fresh host container after XCTest instead of a previous installation report',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs',{cookContainerChanges:true});
 assert.equal(result.process.exitCode,undefined);
 assert.ok(result.readFiles.some(file=>file==='/synthetic-ci-app-after-xctest/Documents/bb-native-cook-smoke.json'));
 assert.equal(result.readFiles.some(file=>file==='/synthetic-ci-app/Documents/bb-native-cook-smoke.json'),false);
});

test('a passing Cook app report cannot mask a failed XCTest session; its actual build diagnostic is retained',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs',{failTests:true});
 assert.equal(result.process.exitCode,1);
 assert.ok(result.logs.some(line=>line.includes('XCTAssertTrue failed: full Cook report diagnostic')));
 assert.ok(result.logs.some(line=>line.includes('"reportReceived":true')&&line.includes('"failure":"hosted_xctest_failed"')&&line.includes('"failureStage":"hosted_tests"')&&line.includes('"passed":false')));
 assert.ok([...result.written].some(([file,text])=>file.endsWith('tests.log')&&text.includes('TEST FAILED')));
 assert.ok([...result.written].some(([file,text])=>file.endsWith('summary.json')&&JSON.parse(text).failedTests===1));
});

test('Cook requires exactly one passing hosted test, zero failures and zero skipped tests',async()=>{
 for(const cookSummary of [{passedTests:0,failedTests:0,skippedTests:0},{passedTests:2,failedTests:0,skippedTests:0},{passedTests:1,failedTests:1,skippedTests:0},{passedTests:1,failedTests:0,skippedTests:1}]){
  const result=await runScript('test-ios-cook-smoke.mjs',{cookSummary});
  assert.equal(result.process.exitCode,1);
  assert.ok(result.logs.some(line=>line.includes('"failure":"required_cook_test_missing"')&&line.includes('"failureStage":"hosted_test_summary"')));
 }
});

test('Cook missing summaries, incomplete reports, failed UI and absent required checks all fail closed',async()=>{
 for(const options of [{cookSummaryError:true},{cookIncompleteReport:true},{cookBadReport:true},{cookMissingFlag:'voicePrepNarrated'},{cookMissingFlag:'dataKept'}]){
  const result=await runScript('test-ios-cook-smoke.mjs',options);
  assert.equal(result.process.exitCode,1,JSON.stringify(options));
  assert.ok(result.logs.some(line=>line.includes('"failure":')&&!line.includes('"failure":""')));
 }
});
