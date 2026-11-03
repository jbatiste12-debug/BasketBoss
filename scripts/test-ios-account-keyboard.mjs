// Exercise the actual UIKit software keyboard on an isolated CI test device,
// or a disposable simulator when run locally. CI compiles and executes in
// separate workflow steps; this runner prepares, activates and verifies them.
// The UI tests enter no credentials and never submit the sign-in form.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {keyboardRuntimePlan} from './ios-keyboard-runtime.mjs';
if(process.platform!=='darwin')throw Error('The native account keyboard check requires macOS and an iOS simulator.');
const output=path.resolve('artifacts/account-keyboard-diagnostics');fs.mkdirSync(output,{recursive:true});
const stateFile=path.join(output,'state.json');
const result=path.join(output,'AccountKeyboard.xcresult');
const mode=(process.argv||[]).slice(2)[0]||'--local';
const execute=(command,args,timeout=120000)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,killSignal:'SIGKILL',maxBuffer:16*1024*1024}).trim();
const run=(...args)=>execute('xcrun',args);
let stage='prepare',phone=null,ownsSimulator=false,failure='',failureStage='',keyboardPreference=null,preferenceRead=false,runtimeVersion='',deviceName='',resetSyntheticCIApp=false,prepared=false,activated=false;
const githubActions=process.env.GITHUB_ACTIONS==='true';
function save(name,value){fs.writeFileSync(path.join(output,name),value);}
function persist(){save('state.json',JSON.stringify({version:1,stage,phone,ownsSimulator,failure,failureStage,keyboardPreference,preferenceRead,runtimeVersion,deviceName,resetSyntheticCIApp,prepared,activated},null,2));}
function mark(next){stage=next;console.log('Keyboard runner stage: '+next);persist();}
function loadState(){
 const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 if(saved.version!==1||typeof saved.phone!=='string'||!saved.phone.match(/^[A-Za-z0-9-]+$/))throw Error('keyboard_state_missing_or_invalid');
 ({stage,phone,ownsSimulator,failure,failureStage,keyboardPreference,preferenceRead,runtimeVersion,deviceName,resetSyntheticCIApp,prepared,activated}=saved);
}
function recordFailure(error){failure=error.code==='ETIMEDOUT'?'command_timeout':String(error.message||'command_failed').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);failureStage=stage;persist();}
function saveFailure(name,error){
 const log=String(error.stdout||'')+'\n'+String(error.stderr||'');save(name,log);
 // Keep the real XCTest/build failure visible without requiring an artifact.
 console.log(log.slice(-16000));
}
function readTestSummary(){
 const summary=JSON.parse(run('xcresulttool','get','test-results','summary','--path',result));
 save('summary.json',JSON.stringify(summary,null,2));
 console.log('::notice title=BasketBoss keyboard XCTest summary::'+JSON.stringify(summary).slice(0,16000));
 return summary;
}
function requireFourPassingTests(summary){if(summary.passedTests!==4||summary.failedTests!==0||summary.skippedTests!==0)throw Error('required_keyboard_tests_missing');}
function report(){
 const report={passed:!failure,realSoftwareKeyboard:!failure,emailFocus:!failure,passwordFocus:!failure,onboardingEmailFocus:!failure,onboardingPasswordFocus:!failure,backgroundLocked:!failure,requiredTests:4,credentialsEntered:false,signInSubmitted:false,runtimeVersion,deviceName,reusedCIOnlySimulator:resetSyntheticCIApp,failureStage:failure?failureStage:'',failure};
 save('report.json',JSON.stringify(report,null,2));console.log('::notice title=BasketBoss native account keyboard::'+JSON.stringify(report));
 if(failure)process.exitCode=1;
}
function argumentsForTests(){return ['-workspace','ios/App/App.xcworkspace','-scheme','BasketBossAccountKeyboardUITests','-configuration','Debug','-sdk','iphonesimulator','-destination','platform=iOS Simulator,id='+phone,'-derivedDataPath','/tmp/basketboss-ios-build','CODE_SIGNING_ALLOWED=NO'];}
function prepare(){
 // A new session must never consume a previous run's passing result bundle.
 for(const name of ['AccountKeyboard.xcresult','summary.json','report.json'])fs.rmSync(path.join(output,name),{recursive:true,force:true});
 mark('prepare_ui_scheme');execute('ruby',['scripts/prepare-ios-account-keyboard-tests.rb'],120000);
 mark('list_runtimes');const runtimes=JSON.parse(run('simctl','list','runtimes','--json')).runtimes;
 mark('list_devices');const devices=JSON.parse(run('simctl','list','devices','available','--json')).devices;
 const plan=keyboardRuntimePlan({runtimes,devices,githubActions});
 const types=JSON.parse(run('simctl','list','devicetypes','--json')).devicetypes.filter(item=>item.name.startsWith('iPhone'));
 const choices=[types.find(item=>item.name==='iPhone SE (3rd generation)'),types.find(item=>item.name==='iPhone 16'),...types.slice().reverse()].filter(Boolean);
 mark('select_test_simulator');
 if(plan.reuse){phone=plan.reuse.id;runtimeVersion=plan.reuse.runtimeVersion;deviceName=plan.reuse.name;resetSyntheticCIApp=plan.resetSyntheticCIApp;}
 for(const runtime of phone?[]:plan.runtimes){
  for(const type of choices){try{phone=run('simctl','create','BasketBoss account keyboard checks',type.identifier,runtime.identifier);runtimeVersion=runtime.version;deviceName=type.name;break;}catch{}}
  if(phone){ownsSimulator=true;break;}
 }
 if(!phone)throw Error('no_iphone_simulator');
 console.log('Checking real email and password keyboards in the account dialog and fresh onboarding on '+deviceName+' / iOS '+runtimeVersion+'.');
 mark('software_keyboard');
 try{keyboardPreference=execute('defaults',['read','com.apple.iphonesimulator','ConnectHardwareKeyboard'],10000);preferenceRead=true;}catch{preferenceRead=true;}
 // Save the original preference before mutating it so an always() cleanup step
 // can restore it even if the compile or activation step is interrupted.
 persist();execute('defaults',['write','com.apple.iphonesimulator','ConnectHardwareKeyboard','-bool','NO'],10000);
 prepared=true;mark('prepared');
 if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,'BB_KEYBOARD_SIMULATOR='+phone+'\n');
}
function compile(){
 mark('build_ui_tests');
 try{save('build.log',execute('xcodebuild',[...argumentsForTests(),'COMPILER_INDEX_STORE_ENABLE=NO','build-for-testing'],900000));}catch(error){saveFailure('build.log',error);throw error;}
}
async function activate(){
 if(!prepared||failure)throw Error('keyboard_prepare_incomplete');
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
 // Do not re-wait for bookkeeping on a healthy, already booted CI session.
 if(state!=='Booted'){mark('bootstatus');execute('xcrun',['simctl','bootstatus',phone,'-b'],180000);}
 mark('software_keyboard_ready');
 execute('defaults',['write','com.apple.iphonesimulator','ConnectHardwareKeyboard','-bool','NO'],10000);
 mark('isolate_test_app');
 // Local runs always own a fresh device; only isolated CI apps may be reset.
 if(resetSyntheticCIApp)try{run('simctl','uninstall',phone,'uk.co.basketboss.app');}catch{}
 execute('xcrun',['simctl','install',phone,app],githubActions?300000:120000);
 mark('settle_simulator');await new Promise(resolve=>setTimeout(resolve,10000));
 activated=true;mark('activated');
}
function executeTests(){
 mark('real_keyboard_tests');
 try{save('tests.log',execute('xcodebuild',[...argumentsForTests(),'-parallel-testing-enabled','NO','-test-timeouts-enabled','YES','-default-test-execution-time-allowance','180','-maximum-test-execution-time-allowance','300','-resultBundlePath',result,'test-without-building'],600000));}
 catch(error){saveFailure('tests.log',error);try{readTestSummary();}catch{}throw error;}
 mark('test_result');requireFourPassingTests(readTestSummary());
}
function verifyWorkflow(){
 const outcomes=[['BB_KEYBOARD_COMPILE_OUTCOME','build_ui_tests'],['BB_KEYBOARD_ACTIVATE_OUTCOME',failureStage||'activate_ui_runner'],['BB_KEYBOARD_EXECUTE_OUTCOME','real_keyboard_tests']];
 // Read any available result for diagnostics, but never let a partial/stale
 // summary mask a failed, skipped, cancelled or timed-out workflow step.
 let summary,summaryError;try{summary=readTestSummary();}catch(error){summaryError=error;}
 for(const [key,failedStage] of outcomes){if(process.env[key]!=='success'){stage=failedStage;throw Error(key.toLowerCase()+'_'+(process.env[key]||'missing'));}}
 if(failure){stage=failureStage;throw Error(failure);}
 stage='test_result';
 if(!prepared||!activated)throw Error('keyboard_setup_incomplete');
 if(summaryError)throw summaryError;
 requireFourPassingTests(summary);
}
function cleanup(){
 if(phone){if(failure)try{run('simctl','io',phone,'screenshot','--type=png',path.join(output,'failure.png'));}catch{}if(ownsSimulator){try{run('simctl','shutdown',phone);}catch{}try{run('simctl','delete',phone);}catch{}}}
 if(preferenceRead)try{if(keyboardPreference===null)execute('defaults',['delete','com.apple.iphonesimulator','ConnectHardwareKeyboard'],10000);else execute('defaults',['write','com.apple.iphonesimulator','ConnectHardwareKeyboard','-bool',keyboardPreference==='1'?'YES':'NO'],10000);}catch{}
}
if(mode==='--local'){
 try{prepare();compile();await activate();executeTests();}catch(error){recordFailure(error);}finally{cleanup();}
 report();
}else if(['--prepare','--activate','--report','--cleanup'].includes(mode)){
 try{
  if(mode==='--prepare')prepare();
  else{loadState();if(mode==='--activate')await activate();else if(mode==='--report')verifyWorkflow();else cleanup();}
 }catch(error){recordFailure(error);process.exitCode=1;}
 if(mode==='--report')report();
}else{throw Error('Unknown keyboard runner mode: '+mode);}
