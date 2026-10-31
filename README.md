# BasketBoss

The existing Cloudflare Pages PWA stays at the repository root. The separate Capacitor iOS app is under `ios/` and uses a generated public web bundle at `dist/native/`.

On a Mac with Node 22+, Xcode 26+ and CocoaPods:

```sh
npm ci
npm run ios:sync
open ios/App/App.xcworkspace
```

Bundle ID: `uk.co.basketboss.app` · Team: `J25UTUATD2` · Minimum iOS:16.0.

See [iOS setup, signing and App Store release gates](docs/IOS_SETUP.md). The initial iOS companion supports Free use and existing-account sign-in; the PWA's Paddle purchases and account-creation flows remain on the web.
