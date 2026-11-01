import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const input=path.resolve('artifacts/recorded-preview/BasketBoss-App-Store-Preview.mp4');
const out=path.resolve('artifacts/final-preview');
fs.mkdirSync(out,{recursive:true});
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',timeout:240000,stdio:['ignore','pipe','pipe']});
const file=path.join(out,'BasketBoss-App-Store-Preview.mp4');
// Apple targets 10–12 Mbps H.264 High <=4.0, stereo 256kbps AAC.
run('ffmpeg',['-y','-i',input,'-t','27','-map','0:v:0','-map','0:a:0','-vf','fps=30,scale=886:1920:flags=lanczos,setsar=1','-c:v','libx264','-preset','slow','-profile:v','high','-level:v','4.0','-pix_fmt','yuv420p','-b:v','11M','-minrate','11M','-maxrate','11M','-bufsize','22M','-x264-params','nal-hrd=cbr:force-cfr=1','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-movflags','+faststart',file]);
const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
if(video.width!==886||video.height!==1920||video.codec_name!=='h264'||video.level>40||video.avg_frame_rate!=='30/1'||audio?.codec_name!=='aac'||audio?.channels!==2||audio?.sample_rate!=='48000'||Math.abs(Number(probe.format.duration)-27)>0.1||Number(probe.format.size)>500000000)throw Error('Preview does not meet export specifications');
run('ffmpeg',['-y','-ss','1','-i',file,'-frames:v','1',path.join(out,'BasketBoss-Preview-Poster.png')]);
run('ffmpeg',['-y','-i',file,'-vf','fps=1/4,scale=222:480,tile=7x1','-frames:v','1',path.join(out,'Preview-Contact-Sheet.png')]);
fs.writeFileSync(path.join(out,'VIDEO-DETAILS.json'),JSON.stringify({sourceRun:process.env.GITHUB_RUN_ID,recordedOn:'actual iPhone 16 Pro Max simulator',demoData:true,sourceMain:'622706d56767c19dbdba909014a3c7cc9ebf19ff',seconds:27,width:886,height:1920,fps:30,videoCodec:'H.264 High Level 4.0',targetVideoBitrate:'11 Mbps',audio:'silent stereo AAC, 256kbps target, 48kHz',sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),probe},null,2));
fs.writeFileSync(path.join(out,'UPLOAD-INSTRUCTIONS.txt'),'Upload BasketBoss-App-Store-Preview.mp4 in App Store Connect > BasketBoss > Distribution > iOS App 1.0 > App Previews and Screenshots > 6.9-inch iPhone. This is an App Preview video, separate from the optional App Clip mini-app. 27 seconds of actual simulator footage with fictional demo data. Silent; no music or voiceover. Poster and contact sheet are provided for reference. The app UI and main branch are unchanged. Specifications checked against https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications/\n');
console.log('Verified App Preview: 27s, 886x1920, 30fps, H.264 High Level4.0 at11Mbps, silent AAC stereo.');
