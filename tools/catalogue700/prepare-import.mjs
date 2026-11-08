#!/usr/bin/env node
// Offline preparation only: never imports SQL or changes production gates.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openPayload} from '../../scripts/private-catalogue-envelope.mjs';
import {validatePublic700Release} from './build-client.mjs';
import {assembleCatalogue700,catalogue700Metadata,catalogue700UpsertSql,private700OutputDirectory} from './release.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const assert=(value,label)=>{if(!value)throw Error('catalogue700_import_'+label);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function prepareCatalogue700Import(payload,release){
 assert(payload?.kind==='basketboss-catalogue700-release'&&payload.schemaVersion===1&&payload.activationEligible===false,'payload_kind');
 assert(Array.isArray(payload.rows)&&payload.rows.length===500,'row_count');
 const rows=payload.rows,addedPremium=rows.slice(400).map(row=>JSON.parse(row.recipe_json)),normalPremium=rows.slice(400).map(row=>JSON.parse(row.normalized_json));
 const bundle=assembleCatalogue700({freeRecipes:release.free.slice(0,100),freeNormalized:release.normal.slice(0,100),privateRows:rows.slice(0,400),additions:[...release.free.slice(100),...addedPremium],additionNormalized:[...release.normal.slice(100),...normalPremium]});
 assert(same(bundle.premiumRows,rows),'row_encoding');
 const metadata=catalogue700Metadata(bundle,{releaseId:release.manifest.release_id});
 assert(same(metadata,payload.metadata)&&Object.entries(metadata).every(([key,value])=>release.manifest[key]===value),'release_pins');
 return {bundle,metadata,sql:catalogue700UpsertSql(bundle,{releaseId:metadata.release_id})};
}
async function main(){
 const args=process.argv.slice(2),opt=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
 const directory=opt('--public-release',path.join(ROOT,'catalogues/700/release')),output=opt('--output-dir');
 assert(typeof output==='string'&&output,'output_required');
 const release=validatePublic700Release({directory,sourceDirectory:ROOT}),envelope=JSON.parse(fs.readFileSync(path.join(ROOT,'.github/private-catalogue/catalogue700-release.sealed.json'),'utf8'));
 assert(envelope.metadata?.plaintextSha256===release.manifest.encryptedPayload?.plaintextSha256&&envelope.metadata?.sourceCommit===release.manifest.sourceBaseCommit&&envelope.metadata?.releaseId===release.manifest.release_id,'envelope_pins');
 const token=process.env.BB_CATALOGUE_DECRYPT_TOKEN||process.env.CLOUDFLARE_API_TOKEN;
 assert(typeof token==='string'&&token.length>=32,'decryption_key_required');
 const plaintext=openPayload(envelope,token);let prepared;
 try{prepared=prepareCatalogue700Import(JSON.parse(plaintext.toString('utf8')),release);}finally{plaintext.fill(0);}
 const destination=private700OutputDirectory(output),write=(file,value)=>{const name=path.join(destination,file);fs.writeFileSync(name,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.chmodSync(name,0o600);};
 write('premium-500.upsert.private.sql',prepared.sql);write('catalogue700.release-metadata.json',prepared.metadata);
 console.log(JSON.stringify({status:'STAGED_FILES_ONLY',directory:destination,free:200,premium:500,total:700,networkUsed:false,databaseWritten:false,activationEligible:false}));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
