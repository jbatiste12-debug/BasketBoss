# BasketBoss on Google Play

The Android package is **`uk.co.basketboss.app`**, named **BasketBoss**, with
`versionName "1.0.2"` and `versionCode 1`. It uses Capacitor Android **8.6.0**,
minimum Android API 24, and compile/target API 36. The package name must match
your Play Console app. Increase `versionCode` for every later uploaded bundle.

This first Closed Testing build has an Android membership screen with purchases
unavailable. Eligible existing members can sign in and have their access checked
by the server. Google Play Billing has not been implemented; Android does not
open Paddle or iOS StoreKit. Do not advertise Android subscription purchases or
trials until that separate work is ready.

## Build on your Mac

Use a checkout containing this Android setup. Install Node.js 22 or newer,
**JDK 21**, and Android SDK Platform 36, Build Tools 36.0.0 and Platform Tools.
Android Studio's SDK Manager can install those SDK packages. Set `JAVA_HOME` to
your JDK 21 and `ANDROID_HOME` to your SDK directory; the usual Mac SDK location
is `$HOME/Library/Android/sdk`. The [Capacitor setup guide](https://capacitorjs.com/docs/getting-started/environment-setup)
describes the Android tools. Builds below run entirely in Terminal.

Create your private upload key **once**, if you do not already have one registered
for BasketBoss. This command prompts for passwords and certificate details;
passwords are not included in shell history:

```bash
umask 077 && mkdir -p "$HOME/.basketboss-android" && keytool -genkeypair -v -storetype JKS -keystore "$HOME/.basketboss-android/basketboss-upload-key.jks" -alias basketboss-upload -keyalg RSA -keysize 2048 -validity 10000
```

Keep a private backup of the key and its passwords. Reuse that upload key for
updates. The [Android signing guide](https://developer.android.com/studio/publish/app-signing)
explains how your upload key differs from Google's Play App Signing key.

From the repository root, prepare signing and build the signed bundle:

```bash
npm ci --no-audit --no-fund && node scripts/android-signing.mjs --interactive --keystore-file "$HOME/.basketboss-android/basketboss-upload-key.jks" && npm run android:sync && npm run android:verify && (cd android && ./gradlew bundleRelease)
```

The signing helper asks for passwords privately, confirms the alias, and writes
`android/keystore.properties` with restricted permissions. Gradle reads its
`storeFile`, `storePassword`, `keyAlias` and `keyPassword` properties. Both that
file and keystores (`*.jks` / `*.keystore`) are ignored by Git; never commit them
or paste them into chat. Your private key remains outside the repository.

Upload this **signed** file to Play Console:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

Run `npm run android:sync` for future Android web-asset updates. It prepares a
separate Android catalogue-700 bundle and syncs Android only. The iOS project,
root Capacitor configuration and existing iOS packaging path stay intact. The
convenience launcher is [prepare-android-mac.command](../release-assets/prepare-android-mac.command).

## Build in GitHub Actions instead

Open **Actions → Build Android App Bundle → Run workflow**.

- Leave **signed** off for compile verification. The artifact is labelled
  `BasketBoss-Android-UNSIGNED-CI-1.0.2-code1`; it cannot be uploaded to Play.
- For a signed bundle, first add the following repository Actions secrets, then
  run the workflow with **signed** on. Missing secrets stop the signed build.

| Actions secret | Value you supply privately in GitHub |
| --- | --- |
| `BB_ANDROID_KEYSTORE_BASE64` | Base64 encoding of your existing upload keystore |
| `BB_ANDROID_STORE_PASSWORD` | Its keystore password |
| `BB_ANDROID_KEY_PASSWORD` | Its signing-key password |
| `BB_ANDROID_KEY_ALIAS` | `basketboss-upload`, or your existing registered alias |

On your Mac, copy the encoded keystore directly to the clipboard, then paste it
into the named GitHub secret:

```bash
base64 < "$HOME/.basketboss-android/basketboss-upload-key.jks" | tr -d '\n' | pbcopy
```

The workflow creates temporary signing files, runs `./gradlew bundleRelease`,
uploads only the `.aab`, and removes its temporary signing material. Download the
`BasketBoss-Android-SIGNED-1.0.2-code1` artifact and extract `app-release.aab` for
manual upload. It does not create an upload key, upload to Play Console, or
release your app. No Play Console service-account key is required for this build.
It runs the Node checks and Android JVM unit tests before bundling. This workflow
does not install Chromium: browser-only Node tests report skips when it is
unavailable and need their separate browser run. It does not exercise a real
Android phone or a Play-delivered installation.

## Connect the app and run Closed Testing

The Android API-origin/auth-transport changes also need their reviewed server
deployment before real Android sign-in and account requests can work. A
successful local or cloud compilation does not deploy those server changes or
prove production login. Existing server entitlement checks remain authoritative.

In Play Console, use **Testing → Closed testing**, configure your tester group,
and create a release using the signed `.aab`. Follow the Console's Play App
Signing setup. The new-personal-account rule currently requires at least **12
testers opted in continuously for 14 days** before you can apply for production
access; meeting that threshold is not automatic production approval. Confirm
the requirement shown for your account. [Google's personal-account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
were checked on 20 November 2026.

For **App content → App access**, provide a dedicated, working **email/password**
reviewer account if any features require sign-in. Give it legitimately authorised
access to the features you ask Google to review. Supply credentials privately in
Play Console, with concise sign-in instructions; an Apple-only account is not
usable for this Android fallback. This repository does not create accounts or
grant reviewer Premium access.

Before promoting the closed test, check on an Android phone:

1. Header, keyboard, bottom tabs and expanded sheets clear the camera cutout,
   gesture area and three-button navigation bar.
2. Email/password sign-in, sign-out and account recovery work against the
   deployed server; unrelated browser origins cannot use the Android transport.
3. Plan, Pantry and Shop work normally, including 500 g needed with 250 g at
   home leaving a 250 g gap. Use test data for purchase/cooking checks.
4. Existing eligible membership is recognised; Free users get the honest
   Android purchase-unavailable explanation, with no Paddle checkout.
