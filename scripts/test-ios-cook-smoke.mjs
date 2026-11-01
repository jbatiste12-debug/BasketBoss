import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

if(process.platform!=='darwin')throw Error('The native Cook smoke test needs a macOS iOS simulator.');
const run=(...args)=>execFileSync('xcrun',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
const devices=JSON.parse(run('simctl','list','devices','available','--json')).devices;
const phone=Object.entries(devices).filter(([runtime])=>runtime.includes('iOS')).flatMap(([,list])=>list).find(device=>device.isAvailable&&device.name.startsWith('iPhone'));
if(!phone)throw Error('No available iPhone simulator.');
if(phone.state!=='Booted')run('simctl','boot',phone.udid);
run('simctl','bootstatus',phone.udid,'-b');
run('simctl','install',phone.udid,'/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator/App.app');
run('simctl','launch','--terminate-running-process',phone.udid,'uk.co.basketboss.app','--bb-native-cook-smoke');
const container=run('simctl','get_app_container',phone.udid,'uk.co.basketboss.app','data');
const file=path.join(container,'Documents/bb-native-cook-smoke.json');
let raw;
for(let tick=0;tick<200;tick++){if(fs.existsSync(file)){raw=JSON.parse(fs.readFileSync(file,'utf8'));break;}await new Promise(resolve=>setTimeout(resolve,250));}
const report={};
for(const key of ['passed','nativeOrigin','cookMounted','cookReady','navPresent','navVisible','navHit','legacyVisible','backToPlan','dataKept'])report[key]=raw?.[key]===true;
for(const key of ['errorCount','errorLine'])report[key]=Number.isInteger(raw?.[key])?Math.max(0,Math.min(raw[key],1000000)):0;
for(const key of ['errorKind','errorSource'])report[key]=String(raw?.[key]||'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);
console.log('::notice title=BasketBoss native Cook smoke::'+JSON.stringify({nativeCook:report}));
if(!raw)throw Error('Native Cook smoke report timed out.');
if(!report.passed)throw Error('Native Cook navigation smoke test failed.');
