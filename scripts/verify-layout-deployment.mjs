import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ASSETS=['bb-simple-layout.js','bb-pantry-inline.js','bb-pantry-inline.css','bb-plan-premium-polish.css','bb-premium-finish.css'];
export async function verifyLayoutDeployment({root=ROOT,perform=fetch}={}){
 for(const name of ASSETS){
  const expected=fs.readFileSync(path.join(root,name));
  const response=await perform('https://basketboss.co.uk/'+name,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(response.status!==200||!(name.endsWith('.css')?/text\/css/i:/javascript/i).test(response.headers.get('content-type')||'')){await response.body?.cancel();throw Error('LAYOUT_ASSET_UNAVAILABLE');}
  const reader=response.body?.getReader();if(!reader)throw Error('LAYOUT_BODY_UNAVAILABLE');
  const parts=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1024*1024)throw Error('LAYOUT_BODY_TOO_LARGE');parts.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  if(!Buffer.concat(parts).equals(expected))throw Error('LAYOUT_ASSET_STALE');
 }
 return {ok:true,layoutAssets:ASSETS.length,plannerTabsBytesVerified:true,pantryTabsBytesVerified:true,shoppingPresentationBytesVerified:true};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{console.log(JSON.stringify(await verifyLayoutDeployment()));}
 catch(error){console.error(JSON.stringify({ok:false,error:/^LAYOUT_[A-Z_]+$/.test(error?.message||'')?error.message:'LAYOUT_UNAVAILABLE'}));process.exitCode=1;}
}
