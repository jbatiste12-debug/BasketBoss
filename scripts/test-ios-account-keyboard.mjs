// Exercise the actual UIKit software keyboard in a disposable iPhone simulator.
// The UI tests enter no credentials and never submit the sign-in form.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('The native account keyboard check requires macOS and an iOS simulator.');
const output=path.resolve('artifacts/account-keyboard-diagnostics');fs.mkdirSync(output,{recursive:true});
const execute=(command,args,timeout=120000)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,killSignal:'SIGKILL',maxBuffer:16*1024*1024}).trim();
const run=(...args)=>execute('xcrun',args);
let stage='prepare',phone=null,failure='',keyboardPreference=null,preferenceRead=false,runtimeVersion='',deviceName='';
function save(name,value){fs.writeFileSync(path.join(output,name),value);}
try{
 execute('ruby',['scripts/prepare-ios-account-keyboard-tests.rb'],30000);
 const runtimes=JSON.parse(run('simctl','list','runtimes','--json')).runtimes.filter(item=>item.isAvailable&&item.name.startsWith('iOS')).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
 const types=JSON.parse(run('simctl','list','devicetypes','--json')).devicetypes.filter(item=>item.name.startsWith('iPhone'));
 const choices=[types.find(item=>item.name==='iPhone SE (3rd generation)'),types.find(item=>item.name==='iPhone 16'),...types.slice().reverse()].filter(Boolean);
 stage='create_disposable_simulator';
 for(const runtime of runtimes){
  for(const type of choices){try{phone=run('simctl','create','BasketBoss account keyboard checks',type.identifier,runtime.identifier);runtimeVersion=runtime.version;deviceName=type.name;break;}catch{}}
  if(phone)break;
 }
 if(!phone)throw Error('no_iphone_simulator');
 console.log('Checking the real email and password keyboard on '+deviceName+' / iOS '+runtimeVersion+'.');
 stage='software_keyboard';
 try{keyboardPreference=execute('defaults',['read','com.apple.iphonesimulator','ConnectHardwareKeyboard'],10000);preferenceRead=true;}catch{preferenceRead=true;}
 execute('defaults',['write','com.apple.iphonesimulator','ConnectHardwareKeyboard','-bool','NO'],10000);
 stage='boot';run('simctl','boot',phone);execute('open',['-a','Simulator','--args','-CurrentDeviceUDID',phone]);execute('xcrun',['simctl','bootstatus',phone,'-b'],360000);
 const argumentsForTests=['-quiet','-workspace','ios/App/App.xcworkspace','-scheme','BasketBossAccountKeyboardUITests','-configuration','Debug','-sdk','iphonesimulator','-destination','platform=iOS Simulator,id='+phone,'-derivedDataPath','/tmp/basketboss-ios-build','CODE_SIGNING_ALLOWED=NO'];
 stage='build_ui_tests';
 try{save('build.log',execute('xcodebuild',[...argumentsForTests,'build-for-testing'],300000));}catch(error){save('build.log',String(error.stdout||'')+'\n'+String(error.stderr||''));throw error;}
 stage='sign_ui_runner';
 const products='/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator',app=path.join(products,'App.app'),runner=path.join(products,'BasketBossAccountKeyboardUITests-Runner.app');
 if(!fs.existsSync(runner))throw Error('ui_runner_missing');
 execute('codesign',['--force','--deep','--sign','-',app]);execute('codesign',['--force','--deep','--sign','-',runner]);
 stage='real_keyboard_tests';
 const result=path.join(output,'AccountKeyboard.xcresult');
 try{save('tests.log',execute('xcodebuild',[...argumentsForTests,'-parallel-testing-enabled','NO','-test-timeouts-enabled','YES','-default-test-execution-time-allowance','90','-maximum-test-execution-time-allowance','120','-resultBundlePath',result,'test-without-building'],360000));}catch(error){save('tests.log',String(error.stdout||'')+'\n'+String(error.stderr||''));throw error;}
 stage='test_result';
 const summary=JSON.parse(run('xcresulttool','get','test-results','summary','--path',result));
 save('summary.json',JSON.stringify(summary,null,2));
 if(summary.passedTests!==2||summary.failedTests!==0||summary.skippedTests!==0)throw Error('required_keyboard_tests_missing');
}catch(error){failure=error.code==='ETIMEDOUT'?'command_timeout':String(error.message||'command_failed').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);}
finally{
 if(phone){try{run('simctl','io',phone,'screenshot','--type=png',path.join(output,failure?'failure.png':'completed.png'));}catch{}try{run('simctl','shutdown',phone);}catch{}try{run('simctl','delete',phone);}catch{}}
 if(preferenceRead)try{if(keyboardPreference===null)execute('defaults',['delete','com.apple.iphonesimulator','ConnectHardwareKeyboard'],10000);else execute('defaults',['write','com.apple.iphonesimulator','ConnectHardwareKeyboard','-bool',keyboardPreference==='1'?'YES':'NO'],10000);}catch{}
}
const report={passed:!failure,realSoftwareKeyboard:!failure,emailFocus:!failure,passwordFocus:!failure,credentialsEntered:false,signInSubmitted:false,runtimeVersion,deviceName,failureStage:failure?stage:'',failure};
save('report.json',JSON.stringify(report,null,2));console.log('::notice title=BasketBoss native account keyboard::'+JSON.stringify(report));
if(failure)process.exitCode=1;
