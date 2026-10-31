#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeWeb} from './build-native-web.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{const result=verifyNativeWeb({directory:path.join(root,'dist/native')});console.log('Native web verification passed: '+result.files+' files, '+result.freeRecipes+' Free recipes, no private recipe bundle.');}
catch(error){console.error('Native web verification failed: '+error.message);process.exitCode=1;}
