#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  printf 'Run this launcher on your Mac. GitHub Actions can build on Linux.\n' >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || { printf 'Install Node.js 22 or newer first.\n' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'

BB_ANDROID_SOURCE='1ce6816be236b2309e33578f1f02c0da477e84e5'
if [[ -d '/Applications/Android Studio.app/Contents/jbr/Contents/Home' ]]; then
  export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
else
  export JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null)" || { printf 'Install Android Studio or Java 21 first.\n' >&2; exit 1; }
fi
export PATH="$JAVA_HOME/bin:$PATH"
BB_ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [[ ! -d "$BB_ANDROID_SDK" ]]; then
  printf 'Open Android Studio once and complete its SDK setup, then rerun this command.\n' >&2
  exit 1
fi
export ANDROID_HOME="$BB_ANDROID_SDK"
if [[ ! -f "$ANDROID_HOME/platforms/android-36/android.jar" ]]; then
  BB_ANDROID_SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  [[ -x "$BB_ANDROID_SDKMANAGER" ]] || { printf 'Install Android SDK Command-line Tools in Android Studio > SDK Manager.\n' >&2; exit 1; }
  "$BB_ANDROID_SDKMANAGER" 'platforms;android-36' 'build-tools;36.0.0'
fi

BB_ANDROID_PROJECT="$(mktemp -d "$HOME/BasketBoss-Android-1.0.2.XXXXXX")"
git clone --depth 1 --branch feat/android-google-play-20261120 --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB_ANDROID_PROJECT"
cd "$BB_ANDROID_PROJECT"
git fetch --depth 1 origin "$BB_ANDROID_SOURCE"
git checkout --detach "$BB_ANDROID_SOURCE"

BB_ANDROID_PRIVATE="$HOME/.basketboss-android"
mkdir -p "$BB_ANDROID_PRIVATE"
chmod 700 "$BB_ANDROID_PRIVATE"
BB_ANDROID_UPLOAD_KEY="$BB_ANDROID_PRIVATE/basketboss-upload-key.jks"
if [[ ! -f "$BB_ANDROID_UPLOAD_KEY" ]]; then
  printf '\nCreate your private upload key. Choose a password and keep a secure backup.\n'
  (umask 077; keytool -genkeypair -v -keystore "$BB_ANDROID_UPLOAD_KEY" -alias basketboss-upload -keyalg RSA -keysize 2048 -validity 10000 -storetype JKS)
fi
npm ci --no-audit --no-fund
node scripts/android-signing.mjs --interactive --keystore-file "$BB_ANDROID_UPLOAD_KEY"
npm run android:sync
npm run android:verify
(cd android && ./gradlew --no-daemon bundleRelease)
BB_ANDROID_AAB="$BB_ANDROID_PROJECT/android/app/build/outputs/bundle/release/app-release.aab"
[[ -f "$BB_ANDROID_AAB" ]] || { printf 'Gradle did not create the release bundle.\n' >&2; exit 1; }
BB_ANDROID_SIGNATURE="$(LC_ALL=C jarsigner -verify "$BB_ANDROID_AAB" 2>&1)"
[[ "$BB_ANDROID_SIGNATURE" == *'jar verified.'* ]] || { printf 'The bundle signature could not be verified.\n' >&2; exit 1; }
open -R "$BB_ANDROID_AAB"
printf '\nSigned Android bundle ready: %s\nPackage: uk.co.basketboss.app · version 1.0.2 · version code 1\nUpload it manually in Play Console > Testing > Closed testing.\nKeep a secure backup of %s and its passwords.\n' "$BB_ANDROID_AAB" "$BB_ANDROID_UPLOAD_KEY"
