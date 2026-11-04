#!/usr/bin/env node
// Use an isolated pinned compiler; TypeScript is not a production dependency.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const compiler=process.env.BB_PANTRY_TYPESCRIPT_PATH;
if(!compiler)throw Error('Set BB_PANTRY_TYPESCRIPT_PATH to an isolated TypeScript 5.9.3 lib/tsc.js installation.');
const absolute=path.resolve(compiler),metadata=JSON.parse(fs.readFileSync(path.resolve(path.dirname(absolute),'..','package.json'),'utf8'));
if(metadata.name!=='typescript'||metadata.version!=='5.9.3')throw Error('Pantry type verification requires pinned TypeScript 5.9.3.');
const result=spawnSync(process.execPath,[absolute,'--project',path.join(root,'typechecks/tsconfig.pantry.json')],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
console.log('Pantry model input/output contracts passed (TypeScript 5.9.3; checkJs, strict, noEmit).');
