import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=fs.readFileSync(new URL('../release-assets/prepare-android-mac.command',import.meta.url),'utf8');
const approved='19d9b5dad84184448830bf3f5fb24e4b1ceea5b0';

test('Android code11 launcher pins the reviewed versioned source instead of a mutable branch',()=>{
 const match=source.match(/^BB_ANDROID_SOURCE='([a-f0-9]{40})'$/m);assert.ok(match);
 assert.equal(match[1],approved);
 const gradle=execFileSync('git',['show',match[1]+':android/app/build.gradle'],{cwd:root,encoding:'utf8'});
 assert.match(gradle,/versionCode 11\b/);assert.match(gradle,/versionName "1\.0\.11"/);
 const verifier=execFileSync('git',['show',match[1]+':scripts/verify-android-aab.mjs'],{cwd:root,encoding:'utf8'});
 assert.match(verifier,/getAttributeNS\(A,"versionCode"\)\)==11/);
 assert.match(source,/^git fetch --depth 1 origin "\$BB_ANDROID_SOURCE"$/m);
 assert.match(source,/^git checkout --detach "\$BB_ANDROID_SOURCE"$/m);
});

test('Android code11 release keeps fresh project paths and the existing external upload key',()=>{
 assert.match(source,/mktemp -d "\$HOME\/BasketBoss-Android-1\.0\.11\.XXXXXX"/);
 assert.match(source,/--branch release\/android11-tap-responsiveness-20261122 --single-branch/);
 assert.match(source,/BB_ANDROID_UPLOAD_KEY="\$BB_ANDROID_PRIVATE\/basketboss-upload-key\.jks"/);
 assert.ok(source.indexOf('if [[ ! -f "$BB_ANDROID_UPLOAD_KEY" ]]')<source.indexOf('git clone'));
 assert.doesNotMatch(source,/keytool\s+.*-(?:genkey|genkeypair)|--generate|--rotate/);
 assert.match(source,/node scripts\/android-signing\.mjs --interactive --keystore-file "\$BB_ANDROID_UPLOAD_KEY"/);
});

test('Android code11 reports ready only after the real bundle exists and signed verification passes',()=>{
 const build=source.indexOf('./gradlew --no-daemon bundleRelease'),exists=source.indexOf('[[ -f "$BB_ANDROID_AAB" ]]'),verify=source.indexOf('node scripts/verify-android-aab.mjs --bundle "$BB_ANDROID_AAB" --require-signed'),reveal=source.indexOf('open -R "$BB_ANDROID_AAB"');
 assert.ok(build>=0&&exists>build&&verify>exists&&reveal>verify);
 assert.match(source,/version 1\.0\.11 · version code 11/);
 assert.doesNotMatch(source,/1\.0\.(?:[89]|10)\b|version code (?:[89]|10)\b/);
 const syntax=spawnSync('bash',['-n'],{input:source,encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
});
