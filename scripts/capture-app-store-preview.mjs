import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
if(process.platform!=='darwin')throw Error('Actual iPhone simulator captures require macOS');
const out=path.resolve('artifacts/app-store-preview');
const raw=path.resolve('artifacts/preview-source');
fs.mkdirSync(raw,{recursive:true});
const diagnostics=path.resolve('artifacts/capture-diagnostics');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(diagnostics,{recursive:true});
const exec=(command,args,timeout=120000)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout}).trim();
const run=(...args)=>exec('xcrun',args);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const bundle='uk.co.basketboss.app';
const scenes=[{target:'budget',seconds:3},{target:'plan',seconds:4},{target:'discover',seconds:4},{target:'kitchen',seconds:3},{target:'shop',seconds:3},{target:'instructions',seconds:6},{target:'cook',seconds:4}];
const allTargets=scenes.map(scene=>scene.target),targets=allTargets;
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
 const manifest={sourceMain:'622706d56767c19dbdba909014a3c7cc9ebf19ff',captureCommit:process.env.GITHUB_SHA,device:'iPhone 16 Pro Max',runtime:runtime.version,dimensions:{width:1320,height:2868},captureCommand:'xcrun simctl io <udid> recordVideo --codec=h264 --force <file>',demoData:true,screens:[]};
 for(const target of targets){
  const index=allTargets.indexOf(target);
  console.log('Preparing actual simulator capture: '+target);
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
  const scene=scenes[index],name=String(index+1).padStart(2,'0')+'-'+target+'.mp4';
  const file=path.join(raw,name);
  const recordingLog=fs.openSync(path.join(diagnostics,target+'-recording.log'),'w');
  const recording=spawn('xcrun',['simctl','io',phone,'recordVideo','--codec=h264','--force',file],{stdio:['ignore',recordingLog,recordingLog]});
  let recordingError;
  recording.on('error',error=>{recordingError=error;});
  const closed=new Promise(resolve=>recording.once('close',resolve));
  await delay(2500);
  if(recordingError||recording.exitCode!==null)throw Error('Simulator recording failed: '+recordingError);
  // Trigger the existing UI controller only after screen recording is active.
  fs.writeFileSync(path.join(container,'Documents/bb-preview-action'),'action');
  await delay((scene.seconds+2)*1000);
  recording.kill('SIGINT');
  await Promise.race([closed,delay(30000).then(()=>{if(recording.exitCode===null){recording.kill('SIGKILL');throw Error('Screen recorder did not stop');}})]);
  fs.closeSync(recordingLog);
  if(!fs.existsSync(file)||fs.statSync(file).size<1000)throw Error('Recording is empty');
  const sourceProbe=JSON.parse(exec('ffprobe',['-v','error','-show_streams','-of','json',file]));
  const sourceVideo=sourceProbe.streams.find(stream=>stream.codec_type==='video');
  if(sourceVideo.width!==1320||sourceVideo.height!==2868)throw Error('Unexpected simulator recording resolution');
  const encoded=path.join(raw,'encoded-'+name);
  exec('ffmpeg',['-y','-i',file,'-ss','0','-t',String(scene.seconds),'-an','-vf','fps=30,tpad=stop_mode=clone:stop_duration=30,scale=886:1920:flags=lanczos,setsar=1','-c:v','libx264','-preset','fast','-profile:v','high','-level:v','4.0','-pix_fmt','yuv420p','-crf','18','-video_track_timescale','15360',encoded],240000);
  manifest.screens.push({file:name,target,seconds:scene.seconds,...report});
  console.log('Recorded actual simulator footage: '+target+' ('+scene.seconds+'s)');
 }
 const concatFile=path.join(raw,'concat.txt');
 fs.writeFileSync(concatFile,scenes.map((scene,index)=>"file 'encoded-"+String(index+1).padStart(2,'0')+'-'+scene.target+".mp4'").join('\n'));
 const final=path.join(out,'BasketBoss-App-Store-Preview.mp4');
 const duration=scenes.reduce((sum,scene)=>sum+scene.seconds,0);
 exec('ffmpeg',['-y','-f','concat','-safe','0','-i',concatFile,'-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000','-t',String(duration),'-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',final],240000);
 const probe=JSON.parse(exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',final]));
 const video=probe.streams.find(stream=>stream.codec_type==='video');
 if(video.width!==886||video.height!==1920||video.codec_name!=='h264'||video.avg_frame_rate!=='30/1'||Math.abs(Number(probe.format.duration)-duration)>0.15)throw Error('Final preview failed format checks');
 manifest.video={file:path.basename(final),seconds:duration,width:886,height:1920,fps:30,codec:video.codec_name,audio:'silent AAC stereo',sha256:crypto.createHash('sha256').update(fs.readFileSync(final)).digest('hex')};
 exec('ffmpeg',['-y','-ss','1','-i',final,'-frames:v','1',path.join(out,'BasketBoss-Preview-Poster.png')]);
 fs.writeFileSync(path.join(diagnostics,'preview-manifest.json'),JSON.stringify(manifest,null,2));
 fs.writeFileSync(path.join(out,'UPLOAD-INSTRUCTIONS.txt'),'Upload BasketBoss-App-Store-Preview.mp4 in App Store Connect under Distribution > iOS App 1.0 > App Previews and Screenshots > 6.9-inch iPhone. This is an App Preview video, separate from the optional App Clip mini-app. 27 seconds, 886x1920, H.264, 30fps, silent AAC stereo. Captured from the actual iPhone 16 Pro Max simulator with fictional demo data. All footage is the existing app UI. Main unchanged. Apple specification: https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications/\n');
 console.log('Preview verified: '+duration+' seconds, 886x1920 H.264, 30fps');

}catch(error){
 if(phone){try{run('simctl','io',phone,'screenshot','--type=png',path.join(diagnostics,'failure.png'));}catch{}}
 if(container){try{exec('cp',['-R',path.join(container,'Documents'),path.join(diagnostics,'Documents')]);}catch{}}
 throw error;
}finally{if(phone){try{run('simctl','shutdown',phone);}catch{}}}
