import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('Actual iPhone simulator captures require macOS');
const out=path.resolve('artifacts/app-store-screenshots');
const diagnostics=path.resolve('artifacts/capture-diagnostics');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(diagnostics,{recursive:true});
const exec=(command,args,timeout=120000)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout}).trim();
const run=(...args)=>exec('xcrun',args);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const bundle='uk.co.basketboss.app';
const targets=['plan','discover','recipe','kitchen','shop','receipt','cook'];
let phone,container;
try{
 const runtimes=JSON.parse(run('simctl','list','runtimes','--json')).runtimes.filter(r=>r.isAvailable&&r.name.startsWith('iOS')).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
 const runtime=runtimes[0];if(!runtime)throw Error('No available iOS runtime');
 const type=JSON.parse(run('simctl','list','devicetypes','--json')).devicetypes.find(t=>t.name==='iPhone 16 Pro Max');
 if(!type)throw Error('iPhone 16 Pro Max device type unavailable');
 phone=run('simctl','create','BasketBoss App Store iPhone 16 Pro Max',type.identifier,runtime.identifier);
 run('simctl','boot',phone);
 exec('open',['-a','Simulator','--args','-CurrentDeviceUDID',phone]);
 exec('xcrun',['simctl','bootstatus',phone,'-b'],540000);
 run('simctl','ui',phone,'appearance','light');
 run('simctl','status_bar',phone,'override','--time','9:41','--dataNetwork','wifi','--wifiMode','active','--wifiBars','3','--batteryState','charged','--batteryLevel','100');
 const app='/tmp/basketboss-ios-build/Build/Products/Debug-iphonesimulator/App.app';
 exec('codesign',['--force','--deep','--sign','-',app]);
 run('simctl','install',phone,app);
 container=run('simctl','get_app_container',phone,bundle,'data');
 const reportFile=path.join(container,'Documents/bb-screenshot-status.json');
 const manifest={sourceMain:'622706d56767c19dbdba909014a3c7cc9ebf19ff',captureCommit:process.env.GITHUB_SHA,device:'iPhone 16 Pro Max',runtime:runtime.version,dimensions:{width:1320,height:2868},captureCommand:'xcrun simctl io <udid> screenshot --type=png <file>',demoData:true,screens:[]};
 for(const [index,target] of targets.entries()){
  fs.rmSync(reportFile,{force:true});
  const launchedAt=Date.now();
  run('simctl','launch','--terminate-running-process',phone,bundle,'--bb-screenshot',target);
  let report;const deadline=Date.now()+100000;
  while(Date.now()<deadline){
   if(fs.existsSync(reportFile)){try{report=JSON.parse(fs.readFileSync(reportFile,'utf8'));}catch{}}
   if(report?.target===target&&(report.ready||report.error))break;
   await delay(300);
  }
  fs.writeFileSync(path.join(diagnostics,target+'.json'),JSON.stringify(report||{error:'no report'},null,2));
  if(report?.target!==target||!report?.ready||report.error||report.nativeOrigin!==true)throw Error(target+' screen not ready: '+JSON.stringify(report));
  // Native opening animation lasts four seconds. Leave WebKit two compositor frames
  // plus an additional settle period after the app's own readiness assertion.
  await delay(Math.max(2500,6000-(Date.now()-launchedAt)));
  const name=String(index+1).padStart(2,'0')+'-'+target+'.png',file=path.join(out,name);
  run('simctl','io',phone,'screenshot','--type=png',file);
  const bytes=fs.readFileSync(file);
  if(bytes.readUInt32BE(16)!==1320||bytes.readUInt32BE(20)!==2868)throw Error(name+' has wrong native pixel dimensions');
  manifest.screens.push({file:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),...report});
  console.log('Captured '+name+' — 1320×2868');
 }
 fs.writeFileSync(path.join(diagnostics,'manifest.json'),JSON.stringify(manifest,null,2));
 if(fs.readdirSync(out).filter(n=>n.endsWith('.png')).length!==7)throw Error('Expected exactly seven PNGs');
 console.log('All seven actual simulator screenshots captured successfully');
}catch(error){
 if(phone){try{run('simctl','io',phone,'screenshot','--type=png',path.join(diagnostics,'failure.png'));}catch{}}
 if(container){try{exec('cp',['-R',path.join(container,'Documents'),path.join(diagnostics,'Documents')]);}catch{}}
 throw error;
}finally{if(phone){try{run('simctl','shutdown',phone);}catch{}}}
