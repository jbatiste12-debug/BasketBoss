import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {keyboardRuntimePlan} from '../scripts/ios-keyboard-runtime.mjs';
import {launchCookSmoke} from '../scripts/ios-cook-launch.mjs';

async function runScript(name,{ci=true,booted=true,includeLatest=false,failTests=false,bootTimeoutState=null,failReadiness=false,keepSimulator=false,cookLaunchTimeouts=0,cookReportAfter=0,cookBadReport=false}={}){
 const commands=[],executions=[],logs=[],written=new Map();let cookLaunches=0;
 const processStub={platform:'darwin',env:ci?{GITHUB_ACTIONS:'true'}:{}};
 if(keepSimulator)processStub.env.BB_IAP_KEEP_SIMULATOR_BOOTED='true';
 let state=booted?'Booted':'Shutdown';
 const device=()=>({udid:'proven-phone',name:'iPhone 17 Pro',state,isAvailable:true});
 const runtime={identifier:'proven-runtime',name:'iOS 26.2',version:'26.2',isAvailable:true};
 const latestRuntime={identifier:'cold-latest-runtime',name:'iOS 26.5',version:'26.5',isAvailable:true};
 const source=fs.readFileSync(new URL('../scripts/'+name,import.meta.url),'utf8').replace(/^import .+;\r?\n/gm,'');
 const context={process:processStub,path,keyboardRuntimePlan,launchCookSmoke,console:{log:value=>logs.push(value)},setTimeout:fn=>{fn();return 1;},fs:{
  mkdirSync(){},rmSync(){},existsSync(){return true;},writeFileSync:(file,value)=>written.set(file,value),
  readFileSync:file=>JSON.stringify(String(file).endsWith('bb-native-iap-smoke.json')?{
   complete:true,passed:true,localStoreKit:true,productionBillingTested:false,backendPremiumGranted:false,
   productsLoaded:true,purchaseVerified:true,accountTokenPreserved:true,unfinishedBeforeServerAck:true,
   earlyFinishRejected:true,restoreVerified:true,duplicatePurchasePrevented:true,wrongAccountRejected:true,
   finishedAfterAcknowledgement:true,pendingDoesNotGrantAccess:true,pendingApprovalDelivered:true,cancellationPreserved:true
  }:String(file).endsWith('bb-native-cook-smoke.json')?{complete:cookLaunches>=cookReportAfter,passed:!cookBadReport}:{complete:true,passed:true})
 },execFileSync(command,args,options){
  executions.push({command,args,timeout:options?.timeout});commands.push([command,...args]);
  if(failTests&&command==='xcodebuild'&&args.includes('test-without-building')){
   const error=Error('xcodebuild failed');error.stdout='XCTAssertTrue failed: real keyboard diagnostic';error.stderr='TEST FAILED';throw error;
  }
  if(command==='xcrun'){
   if(args[0]==='xcresulttool')return JSON.stringify({passedTests:failTests?1:4,failedTests:failTests?1:0,skippedTests:0});
   if(args[0]==='simctl'){
    if(name==='test-ios-cook-smoke.mjs'&&args[1]==='launch'){cookLaunches++;if(cookLaunches<=cookLaunchTimeouts){const error=Error('simctl launch handshake timeout');error.code='ETIMEDOUT';throw error;}}
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
    if(args[1]==='get_app_container')return '/synthetic-ci-app';
   }
  }
  return '';
 }};
 await vm.runInNewContext('(async()=>{'+source+'\n})()',context,{filename:name});
 return {commands,executions,logs,written,process:processStub};
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


test('Cook launch recovery stays on the exact CI phone/app and bounds termination/readiness before its only retry',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs',{cookLaunchTimeouts:1,cookReportAfter:2});
 assert.equal(result.process.exitCode,undefined);
 const launches=result.executions.filter(call=>call.command==='xcrun'&&call.args[1]==='launch');
 assert.equal(launches.length,2);
 for(const call of launches){assert.deepEqual([...call.args],['simctl','launch','--terminate-running-process','proven-phone','uk.co.basketboss.app','--bb-native-cook-smoke']);assert.equal(call.timeout,120000);}
 const terminate=result.executions.find(call=>call.command==='xcrun'&&call.args[1]==='terminate');
 assert.deepEqual([...terminate.args],['simctl','terminate','proven-phone','uk.co.basketboss.app']);assert.equal(terminate.timeout,15000);
 assert.ok(result.executions.some(call=>call.command==='xcrun'&&call.args[1]==='bootstatus'&&call.args[2]==='proven-phone'&&call.timeout===60000));
 assert.ok(result.logs.some(line=>line.includes('"launchAttempts":2')&&line.includes('"passed":true')));
});

test('Cook launch handshake recovery never turns an actual failed app report into a passing test',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs',{cookLaunchTimeouts:1,cookBadReport:true});
 assert.equal(result.process.exitCode,1);
 assert.equal(result.commands.filter(command=>command[1]==='simctl'&&command[2]==='launch').length,1);
 assert.equal(result.commands.some(command=>command[1]==='simctl'&&command[2]==='terminate'),false);
 assert.ok(result.logs.some(line=>line.includes('"failure":"ui_failed"')&&line.includes('"passed":false')));
});
