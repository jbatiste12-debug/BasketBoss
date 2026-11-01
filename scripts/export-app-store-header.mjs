// Export the generated marketing master at Apple's exact creative-asset sizes.
// This only crops, resamples and converts file format; it changes no app UI.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const master=path.join(root,'marketing/app-store/BasketBoss-Header-Master.png');
const out=path.join(root,'dist/app-store-artwork');
fs.mkdirSync(out,{recursive:true});
const tool=spawnSync('magick',['-version'],{stdio:'ignore'}).status===0?'magick':'convert';
const exports=[
 {file:'BasketBoss-Header-3840x1646.png',width:3840,height:1646,placement:'Header'},
 {file:'BasketBoss-Search-Results-3840x2560.png',width:3840,height:2560,placement:'Search Results'},
 {file:'BasketBoss-Universal-5244x2950.png',width:5244,height:2950,placement:'Header and Search Results'}
];
for(const asset of exports){
 const size=asset.width+'x'+asset.height;
 const destination=path.join(out,asset.file);
 execFileSync(tool,[master,'-filter','Lanczos','-resize',size+'^','-gravity','center','-extent',size,'-background','#fff9ed','-alpha','remove','-alpha','off','-colorspace','sRGB','-depth','8','-strip','PNG24:'+destination],{stdio:'inherit'});
 const bytes=fs.readFileSync(destination);
 if(bytes.readUInt32BE(16)!==asset.width||bytes.readUInt32BE(20)!==asset.height||bytes[24]!==8||bytes[25]!==2)throw Error('PNG dimensions, bit depth or RGB/no-alpha verification failed: '+asset.file);
 asset.bytes=bytes.length;
 asset.sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 console.log('Verified opaque RGB PNG: '+asset.file+' ('+size+')');
}
fs.copyFileSync(path.join(root,'marketing/app-store/UPLOAD-GUIDE.txt'),path.join(out,'UPLOAD-GUIDE.txt'));
fs.writeFileSync(path.join(out,'ASSET-DETAILS.json'),JSON.stringify({theme:'Dinner sorted.',source:'Generated artwork based on existing BasketBoss recipe photographs and crowned basket icon.',generatedMasterPixels:{width:1672,height:941},exportNote:'Centre crops resampled from the generated master to exact required upload dimensions.',format:'8-bit RGB sRGB PNG; no alpha channel',sourceMasterSha256:crypto.createHash('sha256').update(fs.readFileSync(master)).digest('hex'),exports},null,2));
console.log('App Store artwork ready: '+out);
