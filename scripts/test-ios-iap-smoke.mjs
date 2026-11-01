// Run the real StoreKit/Capacitor bridge in a hosted XCTest session against a
// local Debug-only catalogue. Xcode supplies StoreKit's test-session context.
// This never creates an App Store transaction or grants backend Premium access.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('StoreKit simulator verification requires macOS.');
const out=path.resolve('artifacts/apple-iap-diagnostics');
fs.mkdirSync(out,{recursive:true});
let stage='devices',phone,raw,failure='',runtimeVersion='',runtimeSelection='',availableRuntimeVersions=[],commandError='',lastCommand;
function progress(extra={}){fs.writeFileSync(path.join(out,'runner-progress.json'),JSON.stringify({stage,at:new Date().toISOString(),runtimeVersion,runtimeSelection,availableRuntimeVersions,command:lastCommand,...extra},null,2));}
function mark(next){stage=next;console.log('StoreKit runner stage: '+stage);progress();}
const execute=(command,args,timeout=120000)=>{
 lastCommand={command,args,timeoutMs:timeout};progress();
 return execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,killSignal:'SIGKILL',maxBuffer:16*1024*1024}).trim();
};
const run=(...args)=>execute('xcrun',args);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 mark('prepare_hosted_tests');execute('ruby',['scripts/prepare-ios-storekit-tests.rb'],30000);
 mark('devices');
 const devices=JSON.parse(run('simctl','list','devices','available','--json')).devices;
 mark('runtimes');
 const runtimes=JSON.parse(run('simctl','list','runtimes','--json')).runtimes.filter(runtime=>runtime.isAvailable&&runtime.name.startsWith('iOS')).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
 availableRuntimeVersions=runtimes.map(runtime=>runtime.version);
 console.log('Available iOS simulator runtimes: '+availableRuntimeVersions.join(', '));
 const candidates=runtimes.filter(runtime=>(devices[runtime.identifier]||[]).some(device=>device.isAvailable&&device.name.startsWith('iPhone')));
 // Apple tracks configuration failures outside the IDE on iOS 26.5 under
 // FB22237318. Prefer another installed runtime, keeping all real assertions.
 // https://developer.apple.com/forums/thread/826971
 const preferred=candidates.find(runtime=>{const [major,minor]=runtime.version.split('.').map(Number);return major>26||(major===26&&minor>=6)||(major===26&&(minor===1||minor===2))||(major===18&&minor===6);});
 const runtime=preferred||candidates[0];
 runtimeSelection=preferred?'preferred_storekit_runtime':'latest_runtime_fallback';
 runtimeVersion=runtime?.version||'';
 if(!preferred)console.log('No preferred StoreKit runtime is installed; using the latest available runtime and retaining full failure diagnostics.');
 const available=devices[runtime?.identifier]||[];
 phone=available.find(device=>device.isAvailable&&device.name.startsWith('iPhone')&&device.state==='Booted')||available.find(device=>device.isAvailable&&device.name.startsWith('iPhone'));
 if(!phone)throw Error('no_iphone_simulator');
 console.log('Using '+phone.name+' on iOS '+runtimeVersion+' for local StoreKit verification.');
 mark('boot');if(phone.state!=='Booted')run('simctl','boot',phone.udid);
 mark('simulator_app');execute('open',['-a','Simulator','--args','-CurrentDeviceUDID',phone.udid]);
 mark('bootstatus');console.log('Waiting for simulator boot.');execute('xcrun',['simctl','bootstatus',phone.udid,'-b'],540000);
 const app='/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator/App.app';
 mark('fixture');if(!fs.existsSync(path.join(app,'BasketBossPremium.storekit')))throw Error('debug_storekit_fixture_missing');
 const testArguments=['-quiet','-workspace','ios/App/App.xcworkspace','-scheme','BasketBossStoreKitTests','-configuration','Debug','-sdk','iphonesimulator','-destination','platform=iOS Simulator,id='+phone.udid,'-derivedDataPath','/tmp/basketboss-ios-build','CODE_SIGNING_ALLOWED=NO'];
 mark('hosted_build');
 try{fs.writeFileSync(path.join(out,'hosted-build.log'),execute('xcodebuild',[...testArguments,'build-for-testing'],300000));}
 catch(error){fs.writeFileSync(path.join(out,'hosted-build.log'),String(error.stdout||'')+'\n'+String(error.stderr||''));console.log(String(error.stdout||'').slice(-10000)+String(error.stderr||'').slice(-4000));throw error;}
 const testBundle='/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator/BasketBossStoreKitTests.xctest';
 if(fs.existsSync(testBundle)){mark('sign_test_bundle');execute('codesign',['--force','--deep','--sign','-',testBundle]);}
 mark('adhoc_sign');execute('codesign',['--force','--deep','--sign','-',app]);
 mark('install_host');run('simctl','install',phone.udid,app);
 mark('clear_previous_report');
 const previousContainer=run('simctl','get_app_container',phone.udid,'uk.co.basketboss.app','data');
 fs.rmSync(path.join(previousContainer,'Documents/bb-native-iap-smoke.json'),{force:true});
 mark('hosted_tests');
 try{fs.writeFileSync(path.join(out,'hosted-xctest.log'),execute('xcodebuild',[...testArguments,'-parallel-testing-enabled','NO','-test-timeouts-enabled','YES','-default-test-execution-time-allowance','180','-maximum-test-execution-time-allowance','240','-resultBundlePath',path.join(out,'StoreKit.xcresult'),'test-without-building'],480000));}
 catch(error){failure='hosted_xctest_failed';commandError=String(error.code||error.status||'unknown');fs.writeFileSync(path.join(out,'hosted-xctest.log'),String(error.stdout||'')+'\n'+String(error.stderr||''));console.log(String(error.stdout||'').slice(-10000)+String(error.stderr||'').slice(-4000));}
 mark('container');
 const container=run('simctl','get_app_container',phone.udid,'uk.co.basketboss.app','data');
 const file=path.join(container,'Documents/bb-native-iap-smoke.json');
 mark('report');const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  if(fs.existsSync(file)){try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}if(raw?.complete===true)break;}
  await pause(300);
 }
 if(!failure){
  if(!raw?.complete)failure='report_timeout';
  else if(raw.passed!==true)failure='storekit_smoke_failed';
  else if(raw.localStoreKit!==true||raw.productionBillingTested!==false||raw.backendPremiumGranted!==false)failure='test_environment_mismatch';
 }
 const required=['productsLoaded','purchaseVerified','accountTokenPreserved','unfinishedBeforeServerAck','earlyFinishRejected','restoreVerified','duplicatePurchasePrevented','wrongAccountRejected','finishedAfterAcknowledgement','pendingDoesNotGrantAccess','pendingApprovalDelivered'];
 if(Number(runtimeVersion.split('.')[0])>=17)required.push('cancellationPreserved');
 if(!failure&&required.some(key=>raw[key]!==true))failure='required_purchase_check_failed';
}catch(error){failure=failure||(error.code==='ETIMEDOUT'?'command_timeout':'command_failed');commandError=String(error.code||error.message||'unknown').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,120);progress({failure,commandError,signal:error.signal||null});}
const report={reportReceived:!!raw,runtimeVersion,runtimeSelection,availableRuntimeVersions,failureStage:failure?stage:'',failure,commandError};
for(const key of ['complete','passed','localStoreKit','productionBillingTested','backendPremiumGranted','productsLoaded','purchaseVerified','accountTokenPreserved','unfinishedBeforeServerAck','earlyFinishRejected','restoreVerified','duplicatePurchasePrevented','wrongAccountRejected','finishedAfterAcknowledgement','cancellationPreserved','pendingDoesNotGrantAccess','pendingApprovalDelivered'])report[key]=raw?.[key]===true;
for(const key of ['stage','error'])report[key]=String(raw?.[key]||'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);
fs.writeFileSync(path.join(out,'local-storekit-report.json'),JSON.stringify(report,null,2));
if(failure&&phone){try{execute('xcrun',['simctl','io',phone.udid,'screenshot','--type=png',path.join(out,'failure.png')],30000);}catch{}}
console.log('::notice title=BasketBoss local StoreKit verification::'+JSON.stringify({localStoreKit:report}));
if(phone&&process.env.BB_IAP_KEEP_SIMULATOR_BOOTED!=='true'){try{execute('xcrun',['simctl','shutdown',phone.udid],30000);}catch{}}
else if(phone)console.log('Keeping the selected simulator booted for the following native navigation check.');
if(failure||!report.passed)process.exitCode=1;
