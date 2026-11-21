#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  printf 'Run this launcher on your Mac. GitHub Actions can build on Linux.\n' >&2
  exit 1
fi
BB_ANDROID_PRIVATE="$HOME/.basketboss-android"
BB_ANDROID_UPLOAD_KEY="$BB_ANDROID_PRIVATE/basketboss-upload-key.jks"
if [[ ! -f "$BB_ANDROID_UPLOAD_KEY" ]]; then
  printf 'Your existing BasketBoss upload key was not found at %s.\nRestore the original key from your private backup before building this update. Do not create a replacement key.\n' "$BB_ANDROID_UPLOAD_KEY" >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { printf 'Install Node.js 22 or newer first.\n' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'

BB_ANDROID_SOURCE='9635eef97e3c546aaddf3a543f1ead397d33c70a'
bb_android_is_java21() {
  "$1/bin/java" -XshowSettings:properties -version 2>&1 | grep -E 'java.specification.version = 21$' >/dev/null
}
BB_ANDROID_JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
if [[ ! -x "$BB_ANDROID_JAVA_HOME/bin/java" ]] || ! bb_android_is_java21 "$BB_ANDROID_JAVA_HOME"; then
  BB_ANDROID_JAVA_HOME="$(/usr/libexec/java_home -F -v 21 2>/dev/null)" || { printf 'Install Temurin JDK 21 for macOS, then rerun this command.\nhttps://adoptium.net/temurin/releases/?version=21&os=mac&arch=aarch64&package=jdk\n' >&2; exit 1; }
fi
bb_android_is_java21 "$BB_ANDROID_JAVA_HOME" || { printf 'This build needs Java 21.\n' >&2; exit 1; }
export JAVA_HOME="$BB_ANDROID_JAVA_HOME"
export PATH="$JAVA_HOME/bin:$PATH"
BB_ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [[ ! -d "$BB_ANDROID_SDK" ]]; then
  printf 'Open Android Studio once and complete its SDK setup, then rerun this command.\n' >&2
  exit 1
fi
export ANDROID_HOME="$BB_ANDROID_SDK"
if [[ ! -f "$ANDROID_HOME/platforms/android-36/android.jar" || ! -x "$ANDROID_HOME/build-tools/36.0.0/aapt2" ]]; then
  BB_ANDROID_SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  [[ -x "$BB_ANDROID_SDKMANAGER" ]] || { printf 'Install Android SDK Command-line Tools in Android Studio > SDK Manager.\n' >&2; exit 1; }
  "$BB_ANDROID_SDKMANAGER" 'platforms;android-36' 'build-tools;36.0.0'
fi

BB_ANDROID_PROJECT="$(mktemp -d "$HOME/BasketBoss-Android-1.0.4.XXXXXX")"
git clone --depth 1 --branch release/android-fresh-household-sync-20261121 --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB_ANDROID_PROJECT"
cd "$BB_ANDROID_PROJECT"
git fetch --depth 1 origin "$BB_ANDROID_SOURCE"
git checkout --detach "$BB_ANDROID_SOURCE"

npm ci --no-audit --no-fund
node scripts/android-signing.mjs --interactive --keystore-file "$BB_ANDROID_UPLOAD_KEY"
npm run android:sync
npm run android:verify
(cd android && ./gradlew --no-daemon bundleRelease)
BB_ANDROID_AAB="$BB_ANDROID_PROJECT/android/app/build/outputs/bundle/release/app-release.aab"
[[ -f "$BB_ANDROID_AAB" ]] || { printf 'Gradle did not create the release bundle.\n' >&2; exit 1; }
node scripts/verify-android-aab.mjs --bundle "$BB_ANDROID_AAB" --require-signed
open -R "$BB_ANDROID_AAB"
printf '\nSigned Android bundle ready: %s\nPackage: uk.co.basketboss.app · version 1.0.4 · version code 4\nUpload it manually in Play Console > Testing > Internal testing first.\nKeep a secure backup of %s and its passwords.\n' "$BB_ANDROID_AAB" "$BB_ANDROID_UPLOAD_KEY"
