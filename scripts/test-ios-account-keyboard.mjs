// Exercise the actual UIKit software keyboard on an isolated CI test device,
// or a disposable simulator when run locally.
// The UI tests enter no credentials and never submit the sign-in form.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {keyboardRuntimePlan} from './ios-keyboard-runtime.mjs';
if(process.platform!=='darwin')throw Error('The native account keyboard check requires macOS and an iOS simulator.');
const output=path.resolve('artifacts/account-keyboard-diagnostics');fs.mkdirSync(output,{recursive:true});
const execute=(command,args,timeout=120000)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,killSignal:'SIGKILL',maxBuffer:16*1024*1024}).trim();
const run=(...args)=>execute('xcrun',args);
let stage='prepare',phone=null,ownsSimulator=false,failure='',keyboardPreference=null,preferenceRead=false,runtimeVersion='',deviceName='',resetSyntheticCIApp=false;
const githubActions=process.env.GITHUB_ACTIONS==='true';
function mark(next){stage=next;console.log('Keyboard runner stage: '+next);}
function save(name,value){fs.writeFileSync(path.join(output,name),value);}
function saveFailure(name,error){
 const log=String(error.stdout||'')+'\n'+String(error.stderr||'');
 save(name,log);
 // Keep the real XCTest/build failure visible without requiring artifact
 // downloads; these checks enter no credentials or account data.
 console.log(log.slice(-16000));
}
function readTestSummary(result){
 const summary=JSON.parse(run('xcresulttool','get','test-results','summary','--path',result));
 save('summary.json',JSON.stringify(summary,null,2));
 console.log('::notice title=BasketBoss keyboard XCTest summary::'+JSON.stringify(summary).slice(0,16000));
 return summary;
}
try{
 mark('prepare_ui_scheme');execute('ruby',['scripts/prepare-ios-account-keyboard-tests.rb'],120000);
 stage='list_runtimes';
 const runtimes=JSON.parse(run('simctl','list','runtimes','--json')).runtimes;
 stage='list_devices';const devices=JSON.parse(run('simctl','list','devices','available','--json')).devices;
 const plan=keyboardRuntimePlan({runtimes,devices,githubActions});
 const types=JSON.parse(run('simctl','list','devicetypes','--json')).devicetypes.filter(item=>item.name.startsWith('iPhone'));
 const choices=[types.find(item=>item.name==='iPhone SE (3rd generation)'),types.find(item=>item.name==='iPhone 16'),...types.slice().reverse()].filter(Boolean);
 stage='select_test_simulator';
 if(plan.reuse){phone=plan.reuse.id;runtimeVersion=plan.reuse.runtimeVersion;deviceName=plan.reuse.name;resetSyntheticCIApp=plan.resetSyntheticCIApp;}
 for(const runtime of phone?[]:plan.runtimes){
  for(const type of choices){try{phone=run('simctl','create','BasketBoss account keyboard checks',type.identifier,runtime.identifier);runtimeVersion=runtime.version;deviceName=type.name;break;}catch{}}
  if(phone){ownsSimulator=true;break;}
 }
 if(!phone)throw Error('no_iphone_simulator');
 console.log('Checking real email and password keyboards in the account dialog and fresh onboarding on '+deviceName+' / iOS '+runtimeVersion+'.');
 mark('software_keyboard');
 try{keyboardPreference=execute('defaults',['read','com.apple.iphonesimulator','ConnectHardwareKeyboard'],10000);preferenceRead=true;}catch{preferenceRead=true;}
 execute('defaults',['write','com.apple.iphonesimulator','ConnectHardwareKeyboard','-bool','NO'],10000);
 // Prepare and sign before starting a new/cold simulator. An already exercised
 // CI phone stays warm: never shut it down or restart its healthy GUI session.
 const argumentsForTests=['-workspace','ios/App/App.xcworkspace','-scheme','BasketBossAccountKeyboardUITests','-configuration','Debug','-sdk','iphonesimulator','-destination','platform=iOS Simulator,id='+phone,'-derivedDataPath','/tmp/basketboss-ios-build','CODE_SIGNING_ALLOWED=NO'];
 mark('build_ui_tests');
 try{save('build.log',execute('xcodebuild',[...argumentsForTests,'build-for-testing'],900000));}catch(error){saveFailure('build.log',error);throw error;}
 mark('sign_ui_runner');
 const products='/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator',app=path.join(products,'App.app'),runner=path.join(products,'BasketBossAccountKeyboardUITests-Runner.app');
 if(!fs.existsSync(runner))throw Error('ui_runner_missing');
 execute('codesign',['--force','--deep','--sign','-','--timestamp=none',app],githubActions?300000:120000);
 execute('codesign',['--force','--deep','--sign','-','--timestamp=none',runner],githubActions?300000:120000);
 mark('boot');
 const currentPhone=Object.values(JSON.parse(run('simctl','list','devices','available','--json')).devices).flat().find(item=>item.udid===phone);
 if(!currentPhone?.isAvailable)throw Error('selected_simulator_unavailable');
 const state=currentPhone.state;
 if(state==='Shutdown')run('simctl','boot',phone);
 else if(!['Booting','Booted'].includes(state))throw Error('unexpected_simulator_state');
 execute('open',['-a','Simulator','--args','-CurrentDeviceUDID',phone]);
 // A selected CI device may already be booted. Re-waiting for its boot
 // bookkeeping can stall that healthy UI session.
 if(state!=='Booted'){mark('bootstatus');execute('xcrun',['simctl','bootstatus',phone,'-b'],180000);}
 // Simulator may have read its preference while the GUI was starting. Reapply
 // it to the active session before asking XCTest to focus real input fields.
 mark('software_keyboard_ready');
 execute('defaults',['write','com.apple.iphonesimulator','ConnectHardwareKeyboard','-bool','NO'],10000);
 mark('isolate_test_app');
 // This is a synthetic app on an isolated CI simulator. Local runs always use
 // a new simulator and never uninstall a developer's saved app.
 if(resetSyntheticCIApp)try{run('simctl','uninstall',phone,'uk.co.basketboss.app');}catch{}
 execute('xcrun',['simctl','install',phone,app],githubActions?300000:120000);
 // Give SpringBoard and the newly installed app's accessibility service time
 // to settle on headless runners. No keyboard or layout assertion is skipped.
 mark('settle_simulator');
 await new Promise(resolve=>setTimeout(resolve,10000));
 mark('real_keyboard_tests');
 const result=path.join(output,'AccountKeyboard.xcresult');
 // Four cases can each use 120 seconds. Leave another 120 seconds for runner
 // startup and result processing without changing any individual case limit.
 try{save('tests.log',execute('xcodebuild',[...argumentsForTests,'-parallel-testing-enabled','NO','-test-timeouts-enabled','YES','-default-test-execution-time-allowance','90','-maximum-test-execution-time-allowance','120','-resultBundlePath',result,'test-without-building'],600000));}catch(error){saveFailure('tests.log',error);try{readTestSummary(result);}catch{}throw error;}
 mark('test_result');
 const summary=readTestSummary(result);
 if(summary.passedTests!==4||summary.failedTests!==0||summary.skippedTests!==0)throw Error('required_keyboard_tests_missing');
}catch(error){failure=error.code==='ETIMEDOUT'?'command_timeout':String(error.message||'command_failed').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);}
finally{
 if(phone){try{run('simctl','io',phone,'screenshot','--type=png',path.join(output,failure?'failure.png':'completed.png'));}catch{}if(ownsSimulator){try{run('simctl','shutdown',phone);}catch{}try{run('simctl','delete',phone);}catch{}}}
 if(preferenceRead)try{if(keyboardPreference===null)execute('defaults',['delete','com.apple.iphonesimulator','ConnectHardwareKeyboard'],10000);else execute('defaults',['write','com.apple.iphonesimulator','ConnectHardwareKeyboard','-bool',keyboardPreference==='1'?'YES':'NO'],10000);}catch{}
}
const report={passed:!failure,realSoftwareKeyboard:!failure,emailFocus:!failure,passwordFocus:!failure,onboardingEmailFocus:!failure,onboardingPasswordFocus:!failure,backgroundLocked:!failure,requiredTests:4,credentialsEntered:false,signInSubmitted:false,runtimeVersion,deviceName,reusedCIOnlySimulator:resetSyntheticCIApp,failureStage:failure?stage:'',failure};
save('report.json',JSON.stringify(report,null,2));console.log('::notice title=BasketBoss native account keyboard::'+JSON.stringify(report));
if(failure)process.exitCode=1;
