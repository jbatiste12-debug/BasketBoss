import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {keyboardRuntimePlan} from './ios-keyboard-runtime.mjs';
import {cookRequiredFlags,cookReportFailure} from './ios-cook-report.mjs';

if(process.platform!=='darwin')throw Error('The native Cook smoke test needs a macOS iOS simulator.');
const exec=(command,args,timeout=120000)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,killSignal:'SIGKILL',maxBuffer:16*1024*1024}).trim();
const run=(...args)=>exec('xcrun',args),ci=process.env.GITHUB_ACTIONS==='true';
const output=path.resolve('artifacts/cook-smoke-diagnostics');
if(ci)fs.mkdirSync(output,{recursive:true});
const save=(name,value)=>{if(ci)fs.writeFileSync(path.join(output,name),value);};
const saveFailure=(name,error)=>{const log=String(error.stdout||'')+'\n'+String(error.stderr||'');save(name,log);console.log(log.slice(-16000));};
let stage='devices',raw,failure='',failedStage='',runtimeVersion='',launchAttempts=0,testSummary;
const mark=next=>{stage=next;console.log('Cook runner stage: '+next);};
try{
 // Match the keyboard runner's setup budget and prepare before a cold iOS
 // simulator starts competing for the hosted Mac's CPU and disk.
 if(ci){mark('prepare_hosted_tests');exec('ruby',['scripts/prepare-ios-cook-smoke-tests.rb'],120000);}
 mark('devices');
 const devices=JSON.parse(run('simctl','list','devices','available','--json')).devices;
 const runtimes=keyboardRuntimePlan({runtimes:JSON.parse(run('simctl','list','runtimes','--json')).runtimes,devices}).runtimes;
 const bootedRuntime=runtimes.find(runtime=>(devices[runtime.identifier]||[]).some(device=>device.isAvailable&&device.name.startsWith('iPhone')&&device.state==='Booted'));
 const runtime=bootedRuntime||runtimes.find(runtime=>(devices[runtime.identifier]||[]).some(device=>device.isAvailable&&device.name.startsWith('iPhone')));
 runtimeVersion=runtime?.version||'';
 const available=devices[runtime?.identifier]||[];
 const phone=available.find(device=>device.isAvailable&&device.name.startsWith('iPhone')&&device.state==='Booted')||available.find(device=>device.isAvailable&&device.name.startsWith('iPhone'));
 if(!phone)throw Error('no_simulator');
 console.log('Using '+phone.name+' on iOS '+runtimeVersion+' for Cook navigation verification.');
 if(ci){
  mark('reset_test_simulator');try{run('simctl','shutdown',phone.udid);}catch{}
  let stopped=false;
  for(let attempt=0;attempt<60;attempt++){
   const current=Object.values(JSON.parse(run('simctl','list','devices','available','--json')).devices).flat().find(device=>device.udid===phone.udid);
   if(current?.state==='Shutdown'){stopped=true;break;}
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!stopped)throw Error('simulator_shutdown_timeout');
  exec('defaults',['write','com.apple.iphonesimulator','ConnectHardwareKeyboard','-bool','NO'],10000);
 }
 const products='/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator',app=path.join(products,'App.app');
 let testArguments;
 if(ci){
  // Build while the selected simulator is shut down, before its cold boot
  // competes with Swift compilation for the hosted Mac's CPU and disk.
  testArguments=['-workspace','ios/App/App.xcworkspace','-scheme','BasketBossCookSmokeTests','-configuration','Debug','-sdk','iphonesimulator','-destination','platform=iOS Simulator,id='+phone.udid,'-derivedDataPath','/tmp/basketboss-ios-build','CODE_SIGNING_ALLOWED=NO'];
  mark('hosted_build');try{save('build.log',exec('xcodebuild',[...testArguments,'build-for-testing'],600000));}catch(error){saveFailure('build.log',error);throw error;}
  const bundle=path.join(products,'BasketBossCookSmokeTests.xctest');
  if(!fs.existsSync(bundle))throw Error('cook_test_bundle_missing');
  mark('sign_hosted_tests');exec('codesign',['--force','--deep','--sign','-',bundle]);
 }
 // Xcode may have started this exact destination during build-for-testing.
 // Refresh its state rather than issuing another boot from the earlier snapshot.
 mark('boot');
 const currentPhone=Object.values(JSON.parse(run('simctl','list','devices','available','--json')).devices).flat().find(device=>device.udid===phone.udid);
 if(!currentPhone?.isAvailable)throw Error('selected_simulator_unavailable');
 if(currentPhone.state==='Shutdown')run('simctl','boot',phone.udid);
 else if(!['Booting','Booted'].includes(currentPhone.state))throw Error('unexpected_simulator_state');
 mark('simulator_app');exec('open',['-a','Simulator','--args','-CurrentDeviceUDID',phone.udid]);
 mark('bootstatus');exec('xcrun',['simctl','bootstatus',phone.udid,'-b'],360000);
 // Simulator execution uses local ad-hoc signing, never a developer identity.
 mark('adhoc_sign');exec('codesign',['--force','--deep','--sign','-',app]);
 mark('install');run('simctl','install',phone.udid,app);
 mark('clear_previous_report');const previousContainer=run('simctl','get_app_container',phone.udid,'uk.co.basketboss.app','data');
 fs.rmSync(path.join(previousContainer,'Documents/bb-native-cook-smoke.json'),{force:true});
 if(ci){
  mark('hosted_tests');launchAttempts=1;
  const result=path.join(output,'CookSmoke.xcresult');
  try{save('tests.log',exec('xcodebuild',[...testArguments,'-parallel-testing-enabled','NO','-test-timeouts-enabled','YES','-default-test-execution-time-allowance','90','-maximum-test-execution-time-allowance','120','-resultBundlePath',result,'test-without-building'],180000));}
  catch(error){failure='hosted_xctest_failed';failedStage=stage;saveFailure('tests.log',error);}
  mark('hosted_test_summary');
  try{
   testSummary=JSON.parse(run('xcresulttool','get','test-results','summary','--path',result));
   save('summary.json',JSON.stringify(testSummary,null,2));
   console.log('::notice title=BasketBoss Cook XCTest summary::'+JSON.stringify(testSummary).slice(0,16000));
   if(!failure&&(testSummary.passedTests!==1||testSummary.failedTests!==0||testSummary.skippedTests!==0)){failure='required_cook_test_missing';failedStage=stage;}
  }catch(error){if(!failure){failure='cook_test_summary_failed';failedStage=stage;}saveFailure('summary-error.log',error);}
 }else{
  // Local manual checks preserve the existing simulator launch path.
  mark('launch');launchAttempts=1;run('simctl','launch','--terminate-running-process',phone.udid,'uk.co.basketboss.app','--bb-native-cook-smoke');
 }
 mark('container');const container=run('simctl','get_app_container',phone.udid,'uk.co.basketboss.app','data');
 const file=path.join(container,'Documents/bb-native-cook-smoke.json');
 const readReport=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 mark('report');raw=readReport();
 if(!failure)for(let tick=0;tick<200&&raw?.complete!==true;tick++){await new Promise(resolve=>setTimeout(resolve,250));raw=readReport();}
 failure=failure||cookReportFailure(raw);
}catch(error){failure=failure||(error.code==='ETIMEDOUT'?'command_timeout':'command_failed');failedStage=failedStage||stage;saveFailure('runner-error.log',error);}
const report={reportReceived:!!raw,runtimeVersion,launcher:ci?'hosted_xctest':'simctl',launchAttempts,failureStage:failure?(failedStage||stage):'',failure};
for(const key of [...cookRequiredFlags,'legacyVisible'])report[key]=raw?.[key]===true;
for(const key of ['errorCount','errorLine','scriptCount'])report[key]=Number.isInteger(raw?.[key])?Math.max(0,Math.min(raw[key],1000000)):0;
for(const key of ['phase','readyState','errorKind','errorSource','lastScript','voiceFailure'])report[key]=String(raw?.[key]||'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);
report.passed=!failure&&raw?.passed===true;
save('report.json',JSON.stringify(report,null,2));
console.log('::notice title=BasketBoss native Cook smoke::'+JSON.stringify({nativeCook:report}));
if(!report.passed||failure)process.exitCode=1;
