// Run the real StoreKit/Capacitor bridge against a local Debug-only catalogue.
// This never creates an App Store transaction or grants backend Premium access.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('StoreKit simulator verification requires macOS.');
const out=path.resolve('artifacts/apple-iap-diagnostics');
fs.mkdirSync(out,{recursive:true});
const execute=(command,args,timeout=120000)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout}).trim();
const run=(...args)=>execute('xcrun',args);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let stage='devices',phone,raw,failure='',runtimeVersion='';
try{
 const devices=JSON.parse(run('simctl','list','devices','available','--json')).devices;
 const runtimes=JSON.parse(run('simctl','list','runtimes','--json')).runtimes.filter(runtime=>runtime.isAvailable&&runtime.name.startsWith('iOS')).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
 const runtime=runtimes.find(runtime=>(devices[runtime.identifier]||[]).some(device=>device.isAvailable&&device.name.startsWith('iPhone')));
 runtimeVersion=runtime?.version||'';
 const available=devices[runtime?.identifier]||[];
 phone=available.find(device=>device.isAvailable&&device.name.startsWith('iPhone')&&device.state==='Booted')||available.find(device=>device.isAvailable&&device.name.startsWith('iPhone'));
 if(!phone)throw Error('no_iphone_simulator');
 console.log('Using '+phone.name+' on iOS '+runtimeVersion+' for local StoreKit verification.');
 stage='boot';if(phone.state!=='Booted')run('simctl','boot',phone.udid);
 stage='simulator_app';execute('open',['-a','Simulator','--args','-CurrentDeviceUDID',phone.udid]);
 stage='bootstatus';console.log('Waiting for simulator boot.');execute('xcrun',['simctl','bootstatus',phone.udid,'-b'],540000);
 const app='/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator/App.app';
 stage='fixture';if(!fs.existsSync(path.join(app,'BasketBossPremium.storekit')))throw Error('debug_storekit_fixture_missing');
 stage='adhoc_sign';execute('codesign',['--force','--deep','--sign','-',app]);
 stage='install';run('simctl','install',phone.udid,app);
 const container=run('simctl','get_app_container',phone.udid,'uk.co.basketboss.app','data');
 const file=path.join(container,'Documents/bb-native-iap-smoke.json');
 fs.rmSync(file,{force:true});
 stage='launch';console.log('Launching local StoreKit smoke, with no real purchases or backend entitlement grant.');
 run('simctl','launch','--terminate-running-process',phone.udid,'uk.co.basketboss.app','--bb-native-iap-smoke');
 stage='report';const deadline=Date.now()+180000;
 while(Date.now()<deadline){
  if(fs.existsSync(file)){try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}if(raw?.complete===true)break;}
  await pause(300);
 }
 if(!raw?.complete)failure='report_timeout';
 else if(raw.passed!==true)failure='storekit_smoke_failed';
 else if(raw.localStoreKit!==true||raw.productionBillingTested!==false||raw.backendPremiumGranted!==false)failure='test_environment_mismatch';
 const required=['productsLoaded','purchaseVerified','accountTokenPreserved','unfinishedBeforeServerAck','earlyFinishRejected','restoreVerified','duplicatePurchasePrevented','wrongAccountRejected','finishedAfterAcknowledgement','pendingDoesNotGrantAccess','pendingApprovalDelivered'];
 if(Number(runtimeVersion.split('.')[0])>=17)required.push('cancellationPreserved');
 if(!failure&&required.some(key=>raw[key]!==true))failure='required_purchase_check_failed';
}catch(error){failure=error.code==='ETIMEDOUT'?'command_timeout':'command_failed';}
const report={reportReceived:!!raw,runtimeVersion,failureStage:failure?stage:'',failure};
for(const key of ['complete','passed','localStoreKit','productionBillingTested','backendPremiumGranted','productsLoaded','purchaseVerified','accountTokenPreserved','unfinishedBeforeServerAck','earlyFinishRejected','restoreVerified','duplicatePurchasePrevented','wrongAccountRejected','finishedAfterAcknowledgement','cancellationPreserved','pendingDoesNotGrantAccess','pendingApprovalDelivered'])report[key]=raw?.[key]===true;
for(const key of ['stage','error'])report[key]=String(raw?.[key]||'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);
fs.writeFileSync(path.join(out,'local-storekit-report.json'),JSON.stringify(report,null,2));
if(failure&&phone){try{execute('xcrun',['simctl','io',phone.udid,'screenshot','--type=png',path.join(out,'failure.png')],30000);}catch{}}
console.log('::notice title=BasketBoss local StoreKit verification::'+JSON.stringify({localStoreKit:report}));
if(phone){try{execute('xcrun',['simctl','shutdown',phone.udid],30000);}catch{}}
if(failure||!report.passed)process.exitCode=1;
