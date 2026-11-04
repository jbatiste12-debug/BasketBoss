import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const plugin=fs.readFileSync(new URL('../ios/App/App/BasketBossCookVoicePlugin.swift',import.meta.url),'utf8');

test('native recognition endpoints use PCM energy and invalidate old Apple callbacks before dispatch',()=>{
 const capture=plugin.slice(plugin.indexOf('@MainActor private func beginCapture'),plugin.indexOf('@MainActor private func resumeAfterPause'));
 assert.match(capture,/request\.shouldReportPartialResults = true/);
 assert.match(capture,/installTap[\s\S]*request\.append\(buffer\)[\s\S]*Self\.decibels\(buffer\)/);
 assert.match(capture,/Double\(buffer\.frameLength\) \/ format\.sampleRate/);
 assert.match(capture,/self\.intent, self\.capture == cycle, !self\.endingAudio/);
 assert.match(capture,/speechBoundary\.append\(decibels: energy, duration: duration\)/);
 assert.match(capture,/speechBoundary\.recognized\(\)/);
 assert.doesNotMatch(capture,/\.now\(\) \+ 0\.95|silence\?\./);
 const finish=capture.slice(capture.indexOf('@MainActor private func finishUtterance'),capture.indexOf('private static func decibels'));
 assert.match(finish,/guard intent, capture == cycle[\s\S]*stopCapture\(\)[\s\S]*text\.count <= 500[\s\S]*notifyListeners\("voiceResult"/);
 assert.match(capture,/capture \+= 1[\s\S]*recognition\?\.cancel\(\)[\s\S]*speechBoundary = BBCookSpeechBoundary\(\)/);
 const project=fs.readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj',import.meta.url),'utf8');
 assert.match(project,/BBCookSpeechBoundary\.swift in Sources/);
});

test('actual Swift endpoint detector handles quiet speech, room noise, natural pauses and late hypotheses',t=>{
 const compiler=spawnSync('swiftc',['--version'],{encoding:'utf8',timeout:15000});
 if(compiler.error?.code==='ENOENT'&&process.platform!=='darwin')return t.skip('Swift is unavailable on this host; native macOS CI executes the same Swift fixtures.');
 assert.equal(compiler.status,0,compiler.stderr||compiler.error?.message);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'basketboss-cook-vad-'));
 try{
  const executable=path.join(directory,'cook-vad-fixtures');
  const build=spawnSync('swiftc',[
   path.join(root,'ios/App/App/BBCookSpeechBoundary.swift'),
   path.join(root,'tests/fixtures/cook-speech-boundary/main.swift'),'-o',executable
  ],{encoding:'utf8',timeout:60000});
  assert.equal(build.status,0,build.stderr||build.error?.message);
  const run=spawnSync(executable,[],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,run.stderr||run.error?.message);
  assert.match(run.stdout,/Cook native energy endpoint fixtures passed/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
