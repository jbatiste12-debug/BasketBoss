import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {keyboardRuntimePlan} from '../scripts/ios-keyboard-runtime.mjs';

async function runScript(name,{ci=true,booted=true,includeLatest=false}={}){
 const commands=[],logs=[],written=new Map();
 const processStub={platform:'darwin',env:ci?{GITHUB_ACTIONS:'true'}:{}};
 let state=booted?'Booted':'Shutdown';
 const device=()=>({udid:'proven-phone',name:'iPhone 17 Pro',state,isAvailable:true});
 const runtime={identifier:'proven-runtime',name:'iOS 26.2',version:'26.2',isAvailable:true};
 const latestRuntime={identifier:'cold-latest-runtime',name:'iOS 26.5',version:'26.5',isAvailable:true};
 const source=fs.readFileSync(new URL('../scripts/'+name,import.meta.url),'utf8').replace(/^import .+;\r?\n/gm,'');
 const context={process:processStub,path,keyboardRuntimePlan,console:{log:value=>logs.push(value)},setTimeout:fn=>{fn();return 1;},fs:{
  mkdirSync(){},rmSync(){},existsSync(){return true;},writeFileSync:(file,value)=>written.set(file,value),
  readFileSync:()=>JSON.stringify({complete:true,passed:true})
 },execFileSync(command,args){
  commands.push([command,...args]);
  if(command==='xcrun'){
   if(args[0]==='xcresulttool')return JSON.stringify({passedTests:2,failedTests:0,skippedTests:0});
   if(args[0]==='simctl'){
    if(args[1]==='list'&&args[2]==='devices')return JSON.stringify({devices:{[runtime.identifier]:[device()],...(includeLatest?{[latestRuntime.identifier]:[{udid:'cold-latest-phone',name:'iPhone SE (3rd generation)',state:'Shutdown',isAvailable:true}]}:{})}});
    if(args[1]==='list'&&args[2]==='runtimes')return JSON.stringify({runtimes:includeLatest?[latestRuntime,runtime]:[runtime]});
    if(args[1]==='list'&&args[2]==='devicetypes')return JSON.stringify({devicetypes:[{name:'iPhone SE (3rd generation)',identifier:'se'}]});
    if(args[1]==='shutdown')state='Shutdown';
    if(args[1]==='boot')state='Booted';
    if(args[1]==='get_app_container')return '/synthetic-ci-app';
   }
  }
  return '';
 }};
 await vm.runInNewContext('(async()=>{'+source+'\n})()',context,{filename:name});
 return {commands,logs,written,process:processStub};
}

test('CI Cook runner resets the proven simulator and configures its keyboard before reopening it',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs');
 assert.equal(result.process.exitCode,undefined);
 const shutdown=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='shutdown');
 const boot=result.commands.findIndex(command=>command[1]==='simctl'&&command[2]==='boot');
 const preference=result.commands.findIndex(command=>command[0]==='defaults'&&command[1]==='write');
 const open=result.commands.findIndex(command=>command[0]==='open');
 assert.ok(shutdown>=0&&boot>shutdown);
 assert.ok(preference>shutdown&&preference<open);
 assert.ok(result.logs.some(line=>line.includes('"passed":true')));
});

test('local Cook runner does not reset a developer simulator or change its keyboard preference',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs',{ci:false});
 assert.equal(result.process.exitCode,undefined);
 assert.equal(result.commands.some(command=>command[0]==='defaults'||command[0]==='killall'||(command[1]==='simctl'&&command[2]==='shutdown')),false);
});

test('standalone CI Cook runner prefers the proven runtime when no previous check booted a phone',async()=>{
 const result=await runScript('test-ios-cook-smoke.mjs',{booted:false,includeLatest:true});
 assert.equal(result.process.exitCode,undefined);
 const boot=result.commands.find(command=>command[1]==='simctl'&&command[2]==='boot');
 assert.equal(boot?.[3],'proven-phone');
 assert.ok(result.logs.some(line=>line.includes('"runtimeVersion":"26.2"')&&line.includes('"passed":true')));
});

test('keyboard CI reuses the exercised session without killing its GUI or re-waiting for boot bookkeeping',async()=>{
 const result=await runScript('test-ios-account-keyboard.mjs');
 assert.equal(result.process.exitCode,undefined);
 assert.equal(result.commands.some(command=>command[0]==='killall'||(command[1]==='simctl'&&['boot','bootstatus','shutdown','delete'].includes(command[2]))),false);
 assert.ok(result.commands.some(command=>command[1]==='simctl'&&command[2]==='uninstall'&&command[3]==='proven-phone'));
 assert.ok(result.commands.some(command=>command[0]==='xcodebuild'&&command.includes('test-without-building')));
 assert.ok(result.logs.some(line=>line.includes('"passed":true')));
});
