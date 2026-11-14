#!/usr/bin/env node
// Read-only public provider configuration. Never prints credentials, response
// bodies, user records or personal information, and never submits authentication.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export async function auditPublicAuth({root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),fetcher=fetch}={}){
 const box={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'cloud-config.js'),'utf8'),box,{timeout:1000});
 const config=box.window.BASKETBOSS_CLOUD_CONFIG;
 const url=new URL(config.url);
 if(url.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(url.hostname)||typeof config.anonKey!=='string')throw Error('invalid_public_auth_configuration');
 const report={projectRef:url.hostname.split('.')[0],providerSettingsReachable:false,emailEnabled:null,appleEnabled:null,emailConfirmationRequired:null,productionProjectMatches:null,submitsAuthentication:false,changesConfiguration:false};
 try{
  const response=await fetcher(new URL('/auth/v1/settings',url),{headers:{apikey:config.anonKey},redirect:'error',signal:AbortSignal.timeout(15000)});
  report.providerHttpStatus=response.status;
  if(response.ok){
   const data=await response.json();report.providerSettingsReachable=true;
   for(const [name,value]of [['emailEnabled',data.external?.email],['appleEnabled',data.external?.apple]])report[name]=typeof value==='boolean'?value:null;
   report.emailConfirmationRequired=typeof data.mailer_autoconfirm==='boolean'?!data.mailer_autoconfirm:null;
  }
 }catch{report.providerFailure='network_or_invalid_response';}
 try{
  const response=await fetcher('https://basketboss.co.uk/cloud-config.js',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(response.ok){const source=await response.text();const match=source.match(/url\s*:\s*['"](https:\/\/[-a-z0-9]+\.supabase\.co)\/?['"]/);report.productionProjectMatches=!!match&&new URL(match[1]).origin===url.origin;}
 }catch{report.productionConfigFailure='network_or_invalid_response';}
 return report;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const result=await auditPublicAuth();console.log(JSON.stringify(result,null,2));
 if(!result.providerSettingsReachable||result.productionProjectMatches!==true)process.exitCode=1;
}
