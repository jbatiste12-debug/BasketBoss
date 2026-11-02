import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {keyboardRuntimePlan} from './ios-keyboard-runtime.mjs';
import {launchCookSmoke} from './ios-cook-launch.mjs';

if(process.platform!=='darwin')throw Error('The native Cook smoke test needs a macOS iOS simulator.');
const exec=(command,args,timeout=120000)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,killSignal:'SIGKILL'}).trim();
const run=(...args)=>exec('xcrun',args);
let stage='devices',raw,failure='',runtimeVersion='',launchAttempts=0;
try{
 const devices=JSON.parse(run('simctl','list','devices','available','--json')).devices;
 // Share the proven-runtime ordering with the keyboard runner when no previous
 // native check has booted a device (the standalone native build workflow).
 const runtimes=keyboardRuntimePlan({runtimes:JSON.parse(run('simctl','list','runtimes','--json')).runtimes,devices}).runtimes;
 const bootedRuntime=runtimes.find(runtime=>(devices[runtime.identifier]||[]).some(device=>device.isAvailable&&device.name.startsWith('iPhone')&&device.state==='Booted'));
 const runtime=bootedRuntime||runtimes.find(runtime=>(devices[runtime.identifier]||[]).some(device=>device.isAvailable&&device.name.startsWith('iPhone')));
 runtimeVersion=runtime?.version||'';
 const available=devices[runtime?.identifier]||[];
 const phone=available.find(device=>device.isAvailable&&device.name.startsWith('iPhone')&&device.state==='Booted')||available.find(device=>device.isAvailable&&device.name.startsWith('iPhone'));
 if(!phone)throw Error('no_simulator');
 console.log('Using '+phone.name+' on iOS '+runtimeVersion+' for Cook navigation verification.');
 if(process.env.GITHUB_ACTIONS==='true'){
  // Hosted XCTest leaves simulator services and its host process running.
  // Start the standalone WKWebView check from a fresh boot of that same proven
  // runtime, rather than reusing an indeterminate post-test process state.
  stage='reset_test_simulator';try{run('simctl','shutdown',phone.udid);}catch{}
  let stopped=false;
  for(let attempt=0;attempt<60;attempt++){
   const current=Object.values(JSON.parse(run('simctl','list','devices','available','--json')).devices).flat().find(device=>device.udid===phone.udid);
   if(current?.state==='Shutdown'){stopped=true;break;}
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!stopped)throw Error('simulator_shutdown_timeout');
  exec('defaults',['write','com.apple.iphonesimulator','ConnectHardwareKeyboard','-bool','NO'],10000);
 }
 stage='boot';if(process.env.GITHUB_ACTIONS==='true'||phone.state!=='Booted')run('simctl','boot',phone.udid);
 stage='simulator_app';exec('open',['-a','Simulator','--args','-CurrentDeviceUDID',phone.udid]);
 stage='bootstatus';exec('xcrun',['simctl','bootstatus',phone.udid,'-b'],360000);
 const app='/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator/App.app';
 // Apple Silicon simulators need a local ad-hoc signature for execution. No
 // developer certificate or distribution identity is used by this smoke test.
 stage='adhoc_sign';exec('codesign',['--force','--deep','--sign','-',app]);
 stage='install';run('simctl','install',phone.udid,app);
 stage='clear_previous_report';const previousContainer=run('simctl','get_app_container',phone.udid,'uk.co.basketboss.app','data');
 fs.rmSync(path.join(previousContainer,'Documents/bb-native-cook-smoke.json'),{force:true});
 const file=path.join(previousContainer,'Documents/bb-native-cook-smoke.json');
 const readReport=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 const launched=launchCookSmoke({ci:process.env.GITHUB_ACTIONS==='true',readReport,
  launch:()=>{launchAttempts++;stage=launchAttempts===1?'launch':'launch_retry';run('simctl','launch','--terminate-running-process',phone.udid,'uk.co.basketboss.app','--bb-native-cook-smoke');},
  terminate:()=>{stage='launch_retry_terminate';try{exec('xcrun',['simctl','terminate',phone.udid,'uk.co.basketboss.app'],15000);}catch(error){if(error.code==='ETIMEDOUT'||!/found nothing to terminate|not running|no such process/i.test(String(error.stderr||'')))throw error;}},
  confirmBoot:()=>{stage='launch_retry_bootstatus';exec('xcrun',['simctl','bootstatus',phone.udid,'-b'],60000);}
 });
 raw=launched.report;
 stage='report';if(!raw?.complete)for(let tick=0;tick<200;tick++){raw=readReport();if(raw?.complete===true)break;await new Promise(resolve=>setTimeout(resolve,250));}
 if(!raw?.complete)failure='report_timeout';else if(!raw.passed)failure='ui_failed';
}catch(error){failure=error.code==='ETIMEDOUT'?'command_timeout':'command_failed';}
const report={reportReceived:!!raw,runtimeVersion,launchAttempts,failureStage:failure?stage:'',failure};
for(const key of ['passed','nativeOrigin','cookMounted','cookReady','navPresent','navVisible','navHit','legacyVisible','backToPlan','dataKept','mainReady','startupReady','ingredientClosed','ingredientPhoto','ingredientSaved','ingredientAutofill','ingredientExistingKept','ingredientRestored','voiceFreeLocked','voiceManualStart','voiceNextStep','voiceTimer','voiceScaledAmount','voiceExitStopped','voiceRestored','voicePrepAvailable','voicePrepNarrated','voicePrepAdvanced','voiceCookNarrated','voiceStepNarrated'])report[key]=raw?.[key]===true;
for(const key of ['errorCount','errorLine','scriptCount'])report[key]=Number.isInteger(raw?.[key])?Math.max(0,Math.min(raw[key],1000000)):0;
for(const key of ['phase','readyState','errorKind','errorSource','lastScript','voiceFailure'])report[key]=String(raw?.[key]||'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);
console.log('::notice title=BasketBoss native Cook smoke::'+JSON.stringify({nativeCook:report}));
if(!report.passed||failure)process.exitCode=1;
