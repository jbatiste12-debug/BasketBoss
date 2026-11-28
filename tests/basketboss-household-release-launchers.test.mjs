import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {execFileSync,spawnSync} from 'node:child_process';
const SHA='8ec8760669b017251a9fb09141275a4527cf72df';
const android=fs.readFileSync('release-assets/prepare-android-household-mac.command','utf8'),ios=fs.readFileSync('release-assets/prepare-build64-household-mac.command','utf8');
test('both launchers pin source that actually contains ordered sync and current native integrations',()=>{
 for(const source of [android,ios]){assert.ok(source.includes(SHA));assert.match(source,/--branch release\/android12-household-sync-20261128 --single-branch/);assert.equal(spawnSync('bash',['-n'],{input:source,encoding:'utf8'}).status,0);}
 const show=name=>execFileSync('git',['show',SHA+':'+name],{encoding:'utf8',maxBuffer:8*1024*1024});
 assert.ok(show('app.html').includes('bb-household-auto-sync.js'));
 assert.ok(show('scripts/build-native-web.mjs').includes('bb-onboarding-checkout-return.js'));
 assert.match(show('android/app/build.gradle'),/versionCode 12\b/);
 assert.match(show('native/runtime.mjs'),/installNativeApplePurchases/);
 assert.match(show('bb-auth-flow.js'),/google/);
});
test('Android keeps the existing external upload key and verifies the signed bundle before reveal',()=>{
 assert.match(android,/basketboss-upload-key\.jks/);assert.doesNotMatch(android,/keytool[^\n]*-(genkey|genkeypair)|--generate|--rotate/);
 assert.ok(android.indexOf('if [[ ! -f "$BB_ANDROID_UPLOAD_KEY" ]]')<android.indexOf('git clone'));
 assert.ok(android.indexOf('--require-signed')<android.indexOf('open -R'));
});
test('iOS prepares build64, defaults to device testing and archives only on an explicit flag',()=>{
 assert.match(ios,/row\[1\]==='64'/);assert.match(ios,/version 1\.0\.6, build 64/);
 assert.match(ios,/"\$BB64_MODE" == 'archive'/);assert.match(ios,/select it at the top of Xcode, then press the play button/);
 assert.doesNotMatch(ios,/upload-app|altool|notarytool/);
 assert.match(ios,/expected|Expected/);
});
