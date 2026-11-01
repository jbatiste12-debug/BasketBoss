import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

if(process.platform!=='darwin')throw Error('The native Cook smoke test needs a macOS iOS simulator.');
const exec=(command,args,timeout=120000)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,killSignal:'SIGKILL'}).trim();
const run=(...args)=>exec('xcrun',args);
let stage='devices',raw,failure='',runtimeVersion='';
try{
 const devices=JSON.parse(run('simctl','list','devices','available','--json')).devices;
 const runtimes=JSON.parse(run('simctl','list','runtimes','--json')).runtimes.filter(runtime=>runtime.isAvailable&&runtime.name.startsWith('iOS')).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
 const bootedRuntime=runtimes.find(runtime=>(devices[runtime.identifier]||[]).some(device=>device.isAvailable&&device.name.startsWith('iPhone')&&device.state==='Booted'));
 const runtime=bootedRuntime||runtimes.find(runtime=>(devices[runtime.identifier]||[]).some(device=>device.isAvailable&&device.name.startsWith('iPhone')));
 runtimeVersion=runtime?.version||'';
 const available=devices[runtime?.identifier]||[];
 const phone=available.find(device=>device.isAvailable&&device.name.startsWith('iPhone')&&device.state==='Booted')||available.find(device=>device.isAvailable&&device.name.startsWith('iPhone'));
 if(!phone)throw Error('no_simulator');
 console.log('Using '+phone.name+' on iOS '+runtimeVersion+' for Cook navigation verification.');
 stage='boot';if(phone.state!=='Booted')run('simctl','boot',phone.udid);
 stage='simulator_app';exec('open',['-a','Simulator','--args','-CurrentDeviceUDID',phone.udid]);
 stage='bootstatus';exec('xcrun',['simctl','bootstatus',phone.udid,'-b'],360000);
 const app='/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator/App.app';
 // Apple Silicon simulators need a local ad-hoc signature for execution. No
 // developer certificate or distribution identity is used by this smoke test.
 stage='adhoc_sign';exec('codesign',['--force','--deep','--sign','-',app]);
 stage='install';run('simctl','install',phone.udid,app);
 stage='launch';run('simctl','launch','--terminate-running-process',phone.udid,'uk.co.basketboss.app','--bb-native-cook-smoke');
 stage='container';const container=run('simctl','get_app_container',phone.udid,'uk.co.basketboss.app','data');
 const file=path.join(container,'Documents/bb-native-cook-smoke.json');
 stage='report';for(let tick=0;tick<200;tick++){if(fs.existsSync(file)){raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw.complete===true)break;}await new Promise(resolve=>setTimeout(resolve,250));}
 if(!raw?.complete)failure='report_timeout';else if(!raw.passed)failure='ui_failed';
}catch(error){failure=error.code==='ETIMEDOUT'?'command_timeout':'command_failed';}
const report={reportReceived:!!raw,runtimeVersion,failureStage:failure?stage:'',failure};
for(const key of ['passed','nativeOrigin','cookMounted','cookReady','navPresent','navVisible','navHit','legacyVisible','backToPlan','dataKept','mainReady','startupReady'])report[key]=raw?.[key]===true;
for(const key of ['errorCount','errorLine','scriptCount'])report[key]=Number.isInteger(raw?.[key])?Math.max(0,Math.min(raw[key],1000000)):0;
for(const key of ['phase','readyState','errorKind','errorSource','lastScript'])report[key]=String(raw?.[key]||'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);
console.log('::notice title=BasketBoss native Cook smoke::'+JSON.stringify({nativeCook:report}));
if(!report.passed||failure)process.exitCode=1;
