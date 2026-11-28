import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=fs.readFileSync(new URL('../release-assets/prepare-android-mac.command',import.meta.url),'utf8');
const approved='dc3ffa155d377059c5156c65b47e708d519d1321';

test('Android code12 launcher pins the reviewed versioned source instead of a mutable branch',()=>{
 const match=source.match(/^BB_ANDROID_SOURCE='([a-f0-9]{40})'$/m);assert.ok(match);
 assert.equal(match[1],approved);
 const gradle=execFileSync('git',['show',match[1]+':android/app/build.gradle'],{cwd:root,encoding:'utf8'});
 assert.match(gradle,/versionCode 12\b/);assert.match(gradle,/versionName "1\.0\.12"/);
 const verifier=execFileSync('git',['show',match[1]+':scripts/verify-android-aab.mjs'],{cwd:root,encoding:'utf8'});
 assert.match(verifier,/getAttributeNS\(A,"versionCode"\)\)==12/);
 assert.match(source,/^git fetch --depth 1 origin "\$BB_ANDROID_SOURCE"$/m);
 assert.match(source,/^git checkout --detach "\$BB_ANDROID_SOURCE"$/m);
});

test('Android code12 release keeps fresh project paths and the existing external upload key',()=>{
 assert.match(source,/mktemp -d "\$HOME\/BasketBoss-Android-1\.0\.12\.XXXXXX"/);
 assert.match(source,/--branch release\/android12-loading-responsiveness-20261123 --single-branch/);
 assert.match(source,/BB_ANDROID_UPLOAD_KEY="\$BB_ANDROID_PRIVATE\/basketboss-upload-key\.jks"/);
 assert.ok(source.indexOf('if [[ ! -f "$BB_ANDROID_UPLOAD_KEY" ]]')<source.indexOf('git clone'));
 assert.doesNotMatch(source,/keytool\s+.*-(?:genkey|genkeypair)|--generate|--rotate/);
 assert.match(source,/node scripts\/android-signing\.mjs --interactive --keystore-file "\$BB_ANDROID_UPLOAD_KEY"/);
});

test('Android code12 reports ready only after the real bundle exists and signed verification passes',()=>{
 const build=source.indexOf('./gradlew --no-daemon bundleRelease'),exists=source.indexOf('[[ -f "$BB_ANDROID_AAB" ]]'),verify=source.indexOf('node scripts/verify-android-aab.mjs --bundle "$BB_ANDROID_AAB" --require-signed'),reveal=source.indexOf('open -R "$BB_ANDROID_AAB"');
 assert.ok(build>=0&&exists>build&&verify>exists&&reveal>verify);
 assert.match(source,/version 1\.0\.12 · version code 12/);
 assert.doesNotMatch(source,/1\.0\.(?:[89]|10|11)\b|version code (?:[89]|10|11)\b/);
 const syntax=spawnSync('bash',['-n'],{input:source,encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
});
