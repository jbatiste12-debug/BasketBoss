import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {keyboardRuntimePlan} from '../scripts/ios-keyboard-runtime.mjs';
import {cookRequiredFlags,cookReportFailure} from '../scripts/ios-cook-report.mjs';

async function runScript(name,{ci=true,booted=true,includeLatest=false,failTests=false,bootTimeoutState=null,failReadiness=false,keepSimulator=false,cookBadReport=false,cookIncompleteReport=false,cookMissingFlag=null,cookSummary=null,cookSummaryError=false,cookContainerChanges=false,cookBuildBoots=false,cookBundleLocation='products',cookBuildError=null,keyboardBuildBoots=false,argv=[],env={},keyboardState=null,keyboardSummary=null,keyboardSummaryError=false,hardwareKeyboardPreference='1'}={}){
 const commands=[],executions=[],logs=[],delays=[],written=new Map(),readFiles=[],removed=[];let hostedCookRan=false;
 const processStub={platform:'darwin',argv:['node',name,...argv],env:{...(ci?{GITHUB_ACTIONS:'true'}:{}),...env}};
 if(keepSimulator)processStub.env.BB_IAP_KEEP_SIMULATOR_BOOTED='true';
 let state=booted?'Booted':'Shutdown',createdPhone=false,createdState='Shutdown';
 const device=()=>({udid:'proven-phone',name:'iPhone 17 Pro',state,isAvailable:true});
 const disposable=()=>({udid:'disposable-phone',name:'BasketBoss account keyboard checks',state:createdState,isAvailable:true});
 const runtime={identifier:'proven-runtime',name:'iOS 26.2',version:'26.2',isAvailable:true};
 const latestRuntime={identifier:'cold-latest-runtime',name:'iOS 26.5',version:'26.5',isAvailable:true};
 const source=fs.readFileSync(new URL('../scripts/'+name,import.meta.url),'utf8').replace(/^import .+;\r?\n/gm,'');
 const context={process:processStub,path,keyboardRuntimePlan,cookRequiredFlags,cookReportFailure,console:{log:value=>logs.push(value)},setTimeout:(fn,ms)=>{delays.push(ms);fn();return 1;},fs:{
  mkdirSync(){},rmSync:file=>removed.push(String(file)),existsSync(file){
   if(name==='test-ios-cook-smoke.mjs'&&String(file).endsWith('/BasketBossCookSmokeTests.xctest')){
    const embedded=String(file).includes('/App.app/PlugIns/');
    return cookBundleLocation==='both'||(cookBundleLocation==='embedded'&&embedded)||(cookBundleLocation==='products'&&!embedded);
   }
   return true;
  },writeFileSync:(file,value)=>written.set(file,value),appendFileSync:(file,value)=>written.set(file,(written.get(file)||'')+value),
  readFileSync:file=>{readFiles.push(String(file));if(String(file).endsWith('/account-keyboard-diagnostics/state.json')){if(written.has(file))return written.get(file);if(keyboardState)return JSON.stringify(keyboardState);throw Error('keyboard state file missing');}return JSON.stringify(String(file).endsWith('bb-native-iap-smoke.json')?{
   complete:true,passed:true,localStoreKit:true,productionBillingTested:false,backendPremiumGranted:false,
   productsLoaded:true,purchaseVerified:true,accountTokenPreserved:true,unfinishedBeforeServerAck:true,
   earlyFinishRejected:true,restoreVerified:true,duplicatePurchasePrevented:true,wrongAccountRejected:true,
   finishedAfterAcknowledgement:true,pendingDoesNotGrantAccess:true,pendingApprovalDelivered:true,cancellationPreserved:true
  }:String(file).endsWith('bb-native-cook-smoke.json')?{complete:!cookIncompleteReport,passed:!cookBadReport,legacyVisible:false,...Object.fromEntries(cookRequiredFlags.map(key=>[key,key!==cookMissingFlag]))}:{complete:true,passed:true});}
 },execFileSync(command,args,options){
  executions.push({command,args,timeout:options?.timeout});commands.push([command,...args]);
  if(name==='test-ios-account-keyboard.mjs'&&command==='defaults'&&args[0]==='read'){if(hardwareKeyboardPreference===null)throw Error('preference does not exist');return hardwareKeyboardPreference;}
  if(name==='test-ios-cook-smoke.mjs'&&command==='xcodebuild'&&args.includes('build-for-testing')&&cookBuildError)throw Object.assign(Error(cookBuildError.message),{code:cookBuildError.code});
  if(name==='test-ios-cook-smoke.mjs'&&command==='xcodebuild'&&args.includes('build-for-testing')&&cookBuildBoots)state='Booted';
  if(name==='test-ios-account-keyboard.mjs'&&command==='xcodebuild'&&args.includes('build-for-testing')&&keyboardBuildBoots&&createdPhone)createdState='Booted';
  if(name==='test-ios-cook-smoke.mjs'&&command==='xcodebuild'&&args.includes('test-without-building'))hostedCookRan=true;
  if(failTests&&command==='xcodebuild'&&args.includes('test-without-building')){
   const error=Error('xcodebuild failed');error.stdout=name==='test-ios-cook-smoke.mjs'?'XCTAssertTrue failed: full Cook report diagnostic':'XCTAssertTrue failed: real keyboard diagnostic';error.stderr='TEST FAILED';throw error;
  }
  if(command==='xcrun'){
   if(args[0]==='xcresulttool'){if(name==='test-ios-cook-smoke.mjs'){if(cookSummaryError)throw Error('missing Cook XCTest summary');return JSON.stringify(cookSummary||{passedTests:failTests?0:1,failedTests:failTests?1:0,skippedTests:0});}if(keyboardSummaryError)throw Error('missing keyboard XCTest summary');return JSON.stringify(keyboardSummary||{passedTests:failTests?1:4,failedTests:failTests?1:0,skippedTests:0});}
   if(args[0]==='simctl'){
    if(args[1]==='list'&&args[2]==='devices')return JSON.stringify({devices:{[runtime.identifier]:[device(),...(createdPhone?[disposable()]:[])],...(includeLatest?{[latestRuntime.identifier]:[{udid:'cold-latest-phone',name:'iPhone SE (3rd generation)',state:'Shutdown',isAvailable:true}]}:{})}});
    if(args[1]==='list'&&args[2]==='runtimes')return JSON.stringify({runtimes:includeLatest?[latestRuntime,runtime]:[runtime]});
    if(args[1]==='list'&&args[2]==='devicetypes')return JSON.stringify({devicetypes:[{name:'iPhone SE (3rd generation)',identifier:'se'}]});
    if(args[1]==='create'){createdPhone=true;createdState='Shutdown';return 'disposable-phone';}
    if(args[1]==='shutdown'){if(args[2]==='disposable-phone')createdState='Shutdown';else state='Shutdown';}
    if(args[1]==='boot'){
     if(args[2]==='disposable-phone')createdState=bootTimeoutState||'Booted';else state=bootTimeoutState||'Booted';
     if(bootTimeoutState){const error=Error('initial simulator boot command timed out');error.code='ETIMEDOUT';throw error;}
    }
    if(args[1]==='bootstatus'){
     if(failReadiness){const error=Error('simulator never became ready');error.code='ETIMEDOUT';throw error;}
     if(args[2]==='disposable-phone')createdState='Booted';else state='Booted';
    }
    if(args[1]==='get_app_container')return cookContainerChanges&&hostedCookRan?'/synthetic-ci-app-after-xctest':'/synthetic-ci-app';
   }
  }
  return '';
 }};
 await vm.runInNewContext('(async()=>{'+source+'\n})()',context,{filename:name});
 return {commands,executions,logs,delays,written,readFiles,removed,process:processStub};
}

function runKeyboardPreflight(failures={}){
 const workflow=fs.readFileSync(new URL('../.github/workflows/inspect-account-keyboard.yml',import.meta.url),'utf8');
 const match=workflow.match(/- name: Prepare the proven iOS simulator and software keyboard\s+run: \|\s+node --input-type=module <<'JS'\n([\s\S]*?)\n\s+JS\n/);
 assert.ok(match,'the actual keyboard preflight must remain extractable');
 const source=match[1].replace(/^\s*import .+;\r?\n/gm,'');
 const commands=[],executions=[],logs=[],remaining=Object.fromEntries(Object.entries(failures).map(([key,values])=>[key,[...values]]));
 let error=null;
 try{vm.runInNewContext(source,{console:{log:value=>logs.push(value)},execFileSync(command,args,options){
  commands.push([command,...args]);executions.push({command,args,timeout:options?.timeout});
  const operation=command==='xcrun'&&args[0]==='simctl'?(args[1]==='list'?'list-'+args[2]:args[1]):command;
  const code=remaining[operation]?.shift();if(code)throw Object.assign(Error('synthetic '+operation+' failure'),{code});
  if(operation==='list-runtimes')return JSON.stringify({runtimes:[{identifier:'proven-runtime',name:'iOS 26.2',version:'26.2',isAvailable:true}]});
  if(operation==='list-devices')return JSON.stringify({devices:{'proven-runtime':[{udid:'proven-phone',name:'iPhone 17 Pro',state:'Shutdown',isAvailable:true}]}});
  return '';
 }},{filename:'inspect-account-keyboard-preflight.js'});}catch(caught){error=caught;}
 return {commands,executions,logs,error};
}

test('keyboard preflight retries one readonly list timeout before booting the proven phone once',()=>{
 for(const operation of ['list-runtimes','list-devices']){
  const result=runKeyboardPreflight({[operation]:['ETIMEDOUT']});
  assert.equal(result.error,null);
  const calls=result.executions.filter(call=>call.command==='xcrun'&&call.args[1]==='list'&&'list-'+call.args[2]===operation);
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.timeout===120000));
  assert.equal(result.commands.filter(command=>command[1]==='simctl'&&command[2]==='boot').length,1);
  const preference=result.commands.findIndex(command=>command[0]==='defaults');
  const open=result.commands.findIndex(command=>command[0]==='open');
  assert.ok(preference>=0&&preference<open,'software keyboard preference must precede Simulator activation');
  assert.ok(result.commands.some(command=>command[1]==='simctl'&&command[2]==='bootstatus'&&command[3]==='proven-phone'));
 }
});

test('keyboard preflight fails closed after two readonly list timeouts without starting a simulator',()=>{
 const result=runKeyboardPreflight({'list-runtimes':['ETIMEDOUT','ETIMEDOUT']});
 assert.equal(result.error?.code,'ETIMEDOUT');
 assert.equal(result.commands.length,2);
 assert.equal(result.commands.some(command=>command[0]==='defaults'||command[0]==='open'||command[2]==='boot'),false);
});

test('keyboard preflight never retries a non-timeout readonly list error',()=>{
 const result=runKeyboardPreflight({'list-runtimes':['EIO']});
 assert.equal(result.error?.code,'EIO');
 assert.equal(result.commands.length,1);
});

test('keyboard preflight never retries mutating boot, defaults or open commands after timeout',()=>{
 for(const operation of ['boot','defaults','open']){
  const result=runKeyboardPreflight({[operation]:['ETIMEDOUT']});
  assert.equal(result.error?.code,'ETIMEDOUT',operation);
  assert.equal(result.commands.filter(command=>operation==='boot'?command[1]==='simctl'&&command[2]==='boot':command[0]===operation).length,1,operation);
 }
});

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
 const testProcess=result.executions.find(call=>call.command==='xcodebuild'&&call.args.includes('test-without-building'));
 assert.equal(testProcess.timeout,600000,'the execution step has its own ten-minute budget');
 assert.equal(testProcess.args[testProcess.args.indexOf('-default-test-execution-time-allowance')+1],'180');
 assert.equal(testProcess.args[testProcess.args.indexOf('-maximum-test-execution-time-allowance')+1],'300');
 const open=result.commands.findIndex(command=>command[0]==='open');
 const testRun=result.commands.findIndex(command=>command[0]==='xcodebuild'&&command.includes('test-without-building'));
 const keyboardWrites=result.commands.map((command,index)=>({command,index})).filter(({command,index})=>index<testRun&&command[0]==='defaults'&&command[1]==='write'&&command.includes('ConnectHardwareKeyboard'));
 assert.equal(keyboardWrites.length,2);
 assert.ok(keyboardWrites[0].index<open&&keyboardWrites[1].index>open&&keyboardWrites[1].index<testRun,'software keyboard is configured before and after Simulator activation');
 assert.ok(keyboardWrites.every(({command})=>command.at(-1)==='NO'));
 assert.deepEqual(result.delays,[10000],'Simulator and installed accessibility services settle before XCTest launches');
 assert.ok(result.logs.some(line=>line.includes('"passed":true')));
});

test('keyboard prepares and signs a cold disposable CI destination before boot with bounded offline signatures',async()=>{
 const result=await runScript('test-ios-account-keyboard.mjs',{booted:false});
 assert.equal(result.process.exitCode,undefined);
 const build=result.commands.findIndex(command=>command[0]==='xcodebuild'&&command.includes('build-for-testing'));
 assert.equal(result.executions.find(call=>call.command==='xcodebuild'&&call.args.includes('build-for-testing')).timeout,900000);
 assert.ok(result.commands[build].includes('COMPILER_INDEX_STORE_ENABLE=NO'));
 const boot=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='boot');
 const ready=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='bootstatus');
 const install=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='install');
 const signatures=result.executions.filter(call=>call.command==='codesign');
 assert.equal(signatures.length,2);
 for(const call of signatures){
  assert.equal(call.timeout,300000);assert.ok(call.args.includes('--timestamp=none'));
  const index=result.commands.findIndex(command=>command[0]==='codesign'&&command.at(-1)===call.args.at(-1));
  assert.ok(build<index&&index<boot);
 }
 assert.ok(boot<ready&&ready<install);
 assert.equal(result.commands[boot][3],'disposable-phone');
 assert.equal(result.executions.find(call=>call.command==='xcrun'&&call.args[1]==='install').timeout,300000);
 assert.equal(result.commands.some(command=>command[1]==='simctl'&&['shutdown','uninstall','delete'].includes(command[2])&&command[3]==='proven-phone'),false);
 assert.ok(result.logs.some(line=>line.includes('"requiredTests":4')&&line.includes('"passed":true')));
});

test('keyboard refreshes a cold destination after Xcode builds without double booting an already started phone',async()=>{
 const result=await runScript('test-ios-account-keyboard.mjs',{booted:false,keyboardBuildBoots:true});
 assert.equal(result.process.exitCode,undefined);
 assert.equal(result.commands.some(command=>command[1]==='simctl'&&['boot','bootstatus'].includes(command[2])),false);
 const build=result.commands.findIndex(command=>command[0]==='xcodebuild'&&command.includes('build-for-testing'));
 const refresh=result.commands.findIndex((command,index)=>index>build&&command[1]==='simctl'&&command[2]==='list'&&command[3]==='devices');
 const tests=result.commands.findIndex(command=>command[0]==='xcodebuild'&&command.includes('test-without-building'));
 assert.ok(build<refresh&&refresh<tests);
});

test('local keyboard checks retain disposable ownership and their original signing/install budgets',async()=>{
 const result=await runScript('test-ios-account-keyboard.mjs',{ci:false});
 assert.equal(result.process.exitCode,undefined);
 const signatures=result.executions.filter(call=>call.command==='codesign');
 assert.equal(signatures.length,2);
 for(const call of signatures){assert.equal(call.timeout,120000);assert.ok(call.args.includes('--timestamp=none'));}
 assert.equal(result.executions.find(call=>call.command==='xcrun'&&call.args[1]==='install').timeout,120000);
 assert.ok(result.commands.some(command=>command[1]==='simctl'&&command[2]==='create'));
 assert.ok(result.commands.some(command=>command[1]==='simctl'&&command[2]==='delete'&&command[3]==='disposable-phone'));
 assert.equal(result.commands.some(command=>command[1]==='simctl'&&['shutdown','uninstall','delete'].includes(command[2])&&command[3]==='proven-phone'),false);
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

const keyboardReadyState=()=>({version:1,stage:'activated',phone:'proven-phone',ownsSimulator:false,failure:'',failureStage:'',keyboardPreference:'1',preferenceRead:true,runtimeVersion:'26.2',deviceName:'iPhone 17 Pro',resetSyntheticCIApp:true,prepared:true,activated:true});
const keyboardSuccessfulOutcomes={BB_KEYBOARD_COMPILE_OUTCOME:'success',BB_KEYBOARD_ACTIVATE_OUTCOME:'success',BB_KEYBOARD_EXECUTE_OUTCOME:'success'};

test('staged keyboard preparation persists ownership and the original preference without compiling or executing tests',async()=>{
 const result=await runScript('test-ios-account-keyboard.mjs',{argv:['--prepare'],env:{GITHUB_ENV:'/synthetic/github-env'}});
 assert.equal(result.process.exitCode,undefined);
 assert.equal(result.commands.some(command=>['xcodebuild','codesign','open'].includes(command[0])||(command[1]==='simctl'&&['install','uninstall','shutdown','delete'].includes(command[2]))),false);
 const state=JSON.parse([...result.written].find(([file])=>file.endsWith('/state.json'))[1]);
 assert.equal(state.phone,'proven-phone');assert.equal(state.ownsSimulator,false);assert.equal(state.prepared,true);assert.equal(state.activated,false);
 assert.equal(state.keyboardPreference,'1');assert.equal(state.preferenceRead,true);
 assert.equal(result.written.get('/synthetic/github-env'),'BB_KEYBOARD_SIMULATOR=proven-phone\n');
 assert.ok(result.removed.some(file=>file.endsWith('/AccountKeyboard.xcresult')),'a previous result cannot satisfy this session');
 assert.equal(result.logs.some(line=>line.includes('native account keyboard::')),false,'preparation is not a passing test report');
});

test('staged keyboard activation only signs, activates and installs the already compiled UI runner',async()=>{
 const keyboardState={...keyboardReadyState(),stage:'prepared',activated:false};
 const result=await runScript('test-ios-account-keyboard.mjs',{argv:['--activate'],keyboardState});
 assert.equal(result.process.exitCode,undefined);
 assert.equal(result.commands.some(command=>['xcodebuild','ruby'].includes(command[0])),false);
 assert.equal(result.commands.filter(command=>command[0]==='codesign').length,2);
 assert.ok(result.commands.some(command=>command[1]==='simctl'&&command[2]==='install'&&command[3]==='proven-phone'));
 assert.equal(result.commands.some(command=>command[1]==='simctl'&&['shutdown','delete'].includes(command[2])),false);
 assert.deepEqual(result.delays,[10000]);
 assert.equal(JSON.parse([...result.written].find(([file])=>file.endsWith('/state.json'))[1]).activated,true);
});

test('staged keyboard reporting requires all successful steps and exactly four passing, unskipped tests',async()=>{
 const result=await runScript('test-ios-account-keyboard.mjs',{argv:['--report'],keyboardState:keyboardReadyState(),env:keyboardSuccessfulOutcomes});
 assert.equal(result.process.exitCode,undefined);
 assert.equal(result.commands.some(command=>['xcodebuild','ruby','codesign','defaults','open'].includes(command[0])||(command[1]==='simctl'&&command[2]!=='get_app_container')),false,'reporting may read the installed app diagnostics but cannot mutate or launch the simulator');
 assert.deepEqual(result.commands.filter(command=>command[1]==='simctl'),[['xcrun','simctl','get_app_container','proven-phone','uk.co.basketboss.app','data']]);
 assert.ok(result.logs.some(line=>line.includes('native account keyboard::')&&line.includes('"passed":true')));
 for(const keyboardSummary of [{passedTests:3,failedTests:0,skippedTests:0},{passedTests:5,failedTests:0,skippedTests:0},{passedTests:4,failedTests:1,skippedTests:0},{passedTests:4,failedTests:0,skippedTests:1}]){
  const failed=await runScript('test-ios-account-keyboard.mjs',{argv:['--report'],keyboardState:keyboardReadyState(),env:keyboardSuccessfulOutcomes,keyboardSummary});
  assert.equal(failed.process.exitCode,1);
  assert.ok(failed.logs.some(line=>line.includes('"failure":"required_keyboard_tests_missing"')&&line.includes('"passed":false')));
 }
});

test('staged keyboard reporting never lets a passing summary mask a failed, skipped or interrupted workflow step',async()=>{
 for(const key of Object.keys(keyboardSuccessfulOutcomes))for(const outcome of ['failure','skipped','cancelled','timed_out','']){
  const result=await runScript('test-ios-account-keyboard.mjs',{argv:['--report'],keyboardState:keyboardReadyState(),env:{...keyboardSuccessfulOutcomes,[key]:outcome}});
  assert.equal(result.process.exitCode,1,key+' / '+outcome);
  assert.ok(result.logs.some(line=>line.includes('native account keyboard::')&&line.includes('"passed":false')));
 }
 for(const options of [{keyboardState:null},{keyboardState:{...keyboardReadyState(),activated:false}},{keyboardState:keyboardReadyState(),keyboardSummaryError:true}]){
  const result=await runScript('test-ios-account-keyboard.mjs',{argv:['--report'],env:keyboardSuccessfulOutcomes,...options});
  assert.equal(result.process.exitCode,1,'missing state, activation or XCTest summary must fail');
 }
});

test('staged keyboard cleanup restores the original preference and deletes only an owned disposable simulator',async()=>{
 for(const ownsSimulator of [false,true]){
  const keyboardState={...keyboardReadyState(),ownsSimulator,phone:ownsSimulator?'disposable-phone':'proven-phone'};
  const result=await runScript('test-ios-account-keyboard.mjs',{argv:['--cleanup'],keyboardState});
  assert.equal(result.process.exitCode,undefined);
  assert.equal(result.commands.some(command=>command[0]==='xcodebuild'),false);
  const deletes=result.commands.filter(command=>command[1]==='simctl'&&['shutdown','delete'].includes(command[2]));
  assert.equal(deletes.length,ownsSimulator?2:0);
  assert.ok(deletes.every(command=>command[3]==='disposable-phone'));
  assert.ok(result.commands.some(command=>command[0]==='defaults'&&command[1]==='write'&&command.at(-1)==='YES'));
 }
 const unset=await runScript('test-ios-account-keyboard.mjs',{argv:['--cleanup'],keyboardState:{...keyboardReadyState(),keyboardPreference:null}});
 assert.ok(unset.commands.some(command=>command[0]==='defaults'&&command[1]==='delete'&&command.includes('ConnectHardwareKeyboard')));
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
 const readiness=result.executions.find(call=>call.command==='xcrun'&&call.args[1]==='bootstatus');
 assert.equal(readiness.timeout,540000,'cold simulator migrations receive the same bounded nine-minute readiness budget as keyboard preboot');
 const tests=result.executions.find(call=>call.command==='xcodebuild'&&call.args.includes('test-without-building'));
 assert.ok(tests.args.includes('BasketBossCookSmokeTests'));
 assert.ok(tests.args.includes('platform=iOS Simulator,id=proven-phone'));
 assert.equal(tests.timeout,600000,'hosted XCTest receives ten minutes for launch, execution and result-bundle finalization');
 assert.equal(tests.args[tests.args.indexOf('-default-test-execution-time-allowance')+1],'180','the Cook case allows report completion plus final assertions');
 assert.equal(tests.args[tests.args.indexOf('-maximum-test-execution-time-allowance')+1],'300','the Cook case maximum matches the bounded UI execution allowance');
 assert.equal(tests.args.includes('-quiet'),false);
 const appSign=result.executions.find(call=>call.command==='codesign'&&call.args.at(-1).endsWith('/App.app'));
 assert.equal(appSign.timeout,300000);
 assert.ok(appSign.args.includes('--timestamp=none'));
 const signIndex=result.commands.findIndex(command=>command[0]==='codesign'&&command.at(-1).endsWith('/App.app'));
 assert.ok(buildIndex<signIndex&&signIndex<bootIndex,'finish large-app signing before the cold simulator starts');
 const install=result.executions.find(call=>call.command==='xcrun'&&call.args[1]==='install');
 assert.equal(install.timeout,300000);
 assert.equal(result.commands.some(command=>command[1]==='simctl'&&command[2]==='launch'),false);
 assert.ok(result.logs.some(line=>line.includes('"launcher":"hosted_xctest"')&&line.includes('"passed":true')));
 const local=await runScript('test-ios-cook-smoke.mjs',{ci:false});
 assert.equal(local.commands.some(command=>command[0]==='xcodebuild'),false);
 assert.ok(local.commands.some(command=>command[1]==='simctl'&&command[2]==='launch'&&command.includes('--bb-native-cook-smoke')));
 const localSign=local.executions.find(call=>call.command==='codesign'&&call.args.at(-1).endsWith('/App.app'));
 const localInstall=local.executions.find(call=>call.command==='xcrun'&&call.args[1]==='install');
 assert.equal(localSign.timeout,120000);
 assert.equal(localInstall.timeout,120000);
 assert.ok(local.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='bootstatus')<local.commands.findIndex(command=>command[0]==='codesign'));
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

test('Cook requires and signs its exact XCTest bundle in either supported Xcode product layout',async()=>{
 for(const cookBundleLocation of ['products','embedded']){
  const result=await runScript('test-ios-cook-smoke.mjs',{cookBundleLocation});
  assert.equal(result.process.exitCode,undefined,cookBundleLocation);
  const expected='/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator/'+(cookBundleLocation==='embedded'?'App.app/PlugIns/':'')+'BasketBossCookSmokeTests.xctest';
  const signed=result.commands.filter(command=>command[0]==='codesign'&&command.at(-1).endsWith('.xctest'));
  assert.deepEqual(signed,[['codesign','--force','--deep','--sign','-','--timestamp=none',expected]]);
  assert.ok(result.commands.some(command=>command[0]==='codesign'&&command.at(-1).endsWith('/App.app')));
  assert.ok(result.logs.some(line=>line.includes('"testBundleLocation":"'+cookBundleLocation+'"')&&line.includes('"passed":true')));
 }
});

test('Cook fails explicitly when neither product layout contains the required XCTest bundle',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs',{cookBundleLocation:'missing'});
 assert.equal(result.process.exitCode,1);
 assert.equal(result.commands.some(command=>command[0]==='codesign'),false);
 assert.equal(result.commands.some(command=>command[1]==='simctl'&&command[2]==='boot'),false);
 assert.equal(result.commands.some(command=>command[0]==='xcodebuild'&&command.includes('test-without-building')),false);
 const report=JSON.parse([...result.written].find(([file])=>file.endsWith('/cook-smoke-diagnostics/report.json'))[1]);
 assert.equal(report.failureStage,'hosted_build');
 assert.equal(report.commandErrorCode,'COOK_TEST_BUNDLE_MISSING');
 assert.equal(report.commandError,'cook_test_bundle_missing');
 assert.equal(report.passed,false);
});

test('Cook preserves bounded first-line command diagnostics instead of only an opaque failure label',async()=>{
 for(const cookBuildError of [{code:'EACCES',message:'Cannot read the hosted test product'},{code:'bad\ncode'.repeat(30),message:'x'.repeat(500)+'\nLater diagnostic context'}]){
  const result=await runScript('test-ios-cook-smoke.mjs',{cookBuildError});
  assert.equal(result.process.exitCode,1);
  const report=JSON.parse([...result.written].find(([file])=>file.endsWith('/cook-smoke-diagnostics/report.json'))[1]);
  assert.equal(report.failureStage,'hosted_build');
  assert.equal(report.failure,'command_failed');
  assert.ok(report.commandErrorCode.length>0&&report.commandErrorCode.length<=64);
  assert.ok(report.commandError.length>0&&report.commandError.length<=240);
  assert.doesNotMatch(report.commandErrorCode,/\n/);
  assert.doesNotMatch(report.commandError,/\n|Later diagnostic context/);
  if(cookBuildError.code==='EACCES'){
   assert.equal(report.commandErrorCode,'EACCES');
   assert.equal(report.commandError,cookBuildError.message);
  }
 }
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
