#!/usr/bin/env node
// Bundle the existing pure classifier; never maintain a second household list.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const START='/* BB_KITCHEN_RULES_FALLBACK_GENERATED_START */';
export const END='/* BB_KITCHEN_RULES_FALLBACK_GENERATED_END */';

export async function renderKitchenRulesFallback(root=ROOT){
 const result=await build({
  stdin:{contents:"import * as rules from './bb-kitchen-choice-rules.mjs'; window.BBKitchenChoiceRulesFallback=Object.freeze({isHousehold:rules.isHousehold,previewOrder:rules.previewOrder,FOOD_PREVIEWS:rules.FOOD_PREVIEWS,HOUSEHOLD_PREVIEWS:rules.HOUSEHOLD_PREVIEWS});",resolveDir:root,sourcefile:'kitchen-rules-fallback-entry.mjs',loader:'js'},
  bundle:true,format:'iife',platform:'browser',target:'es2020',treeShaking:true,minify:true,legalComments:'none',charset:'utf8',write:false,logLevel:'silent'
 });
 // The receipt core imports the pantry policy. Isolate all bundled globals so
 // evaluating this fallback cannot replace the live pantry policy or storage.
 return START+'\n'+
  '(function(realWindow){if(!realWindow)return;const isolated=Object.create(null);(function(window,globalThis,self){\n'+result.outputFiles[0].text+
  '\n})(isolated,isolated,isolated);const rules=isolated.BBKitchenChoiceRulesFallback;if(rules)realWindow.BBKitchenChoiceRulesFallback=rules;})(typeof window!=="undefined"?window:null);\n'+END;
}

export function replaceKitchenRulesFallback(source,block){
 const start=source.indexOf(START),end=source.indexOf(END);
 if(start===-1&&end===-1)return source.trimEnd()+'\n\n'+block+'\n';
 if(start<0||end<start||source.indexOf(START,start+START.length)!==-1||source.indexOf(END,end+END.length)!==-1)throw Error('kitchen_fallback_markers_invalid');
 return source.slice(0,start)+block+source.slice(end+END.length);
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{
  const args=process.argv.slice(2);if(args.length>1||args.length===1&&args[0]!=='--check')throw Error('Usage: node scripts/build-kitchen-rules-fallback.mjs [--check]');
  const file=path.join(ROOT,'bb-kitchen-essentials.js'),source=fs.readFileSync(file,'utf8'),expected=replaceKitchenRulesFallback(source,await renderKitchenRulesFallback());
  if(args[0]==='--check'){if(source!==expected)throw Error('kitchen_fallback_stale');console.log('Kitchen classifier fallback matches the shared source.');}
  else{fs.writeFileSync(file,expected);console.log('Kitchen classifier fallback generated from the shared source.');}
 }catch(error){console.error(error.message);process.exitCode=1;}
}
