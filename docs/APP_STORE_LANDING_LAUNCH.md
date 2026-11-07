# BasketBoss App Store landing-page launch

BasketBoss’s current website uses static HTML, CSS and JavaScript. The React and Tailwind examples in `examples/react/` are reusable components for a React project; they add no React runtime or dependency to this website.

The App Store ID is `6829160611`. Its country-neutral product URL is:

```text
https://apps.apple.com/app/id6829160611
```

The user confirmed approval and a public UK App Store listing with a **Get** button on 2026-11-07. `bb-server-lib/bb-app-store-launch.js` now records that public release, so website promotion is enabled by default after deploying this change. App Store territory settings remain under Apple's control; the UK confirmation does not establish availability in every country.

`BB_APP_STORE_LAUNCH_ENABLED` is an optional Cloudflare Pages override. Leave it unset to use the confirmed release default, set the exact string `false` to disable promotion, or set the exact string `true` to enable it explicitly. Any other supplied value disables promotion. Redeploy after changing the override. No environment-variable entry is needed for the normal launch.

Existing `/app` web entry points continue to work before and after the App Store launch.

## React and Tailwind badge examples

Copy `examples/react/AppStoreBadge.tsx` and `examples/react/BasketBossAppStoreExamples.tsx` into the React project. Ensure Tailwind scans their destination directory. The examples use the unchanged official SVG at `/landing-assets/download-on-the-app-store.svg`; copy that asset to the project’s public directory at the same path.

`landing-assets/download-on-the-app-store.provenance.txt` records the original Apple artwork filename and the unmodified source used to obtain this asset.

```tsx
import {
  BasketBossHeroExample,
  BasketBossStickyNavbarExample,
} from "./BasketBossAppStoreExamples";

const appStoreUrl = "https://apps.apple.com/app/id6829160611";
const isAppStoreLive = true; // Public UK listing confirmed on 2026-11-07.

// Option A: badge next to the hero copy.
<BasketBossHeroExample
  appStoreUrl={appStoreUrl}
  isAppStoreLive={isAppStoreLive}
/>;

// Option B: compact badge in a sticky navbar, as an alternative layout.
<BasketBossStickyNavbarExample
  appStoreUrl={appStoreUrl}
  isAppStoreLive={isAppStoreLive}
/>;
```

The badge accepts an `appStoreUrl` prop and renders a real anchor with an accessible label and image alt text. Invalid product URLs cannot produce a download link. `isAppStoreLive` defaults to `false`; the component shows a plain “Coming soon on the App Store” message while the launch is pending.

Hero artwork is 56 px high with 14 px clear space. Compact artwork is 40 px high with 10 px clear space. Use the two placements as alternatives: Apple specifies one badge per layout. The official badge remains stationary; the separate surrounding highlight scales slightly on hover and respects reduced-motion preferences. Apple’s guidelines prohibit animating or modifying the badge artwork. [Official badge and marketing guidance](https://developer.apple.com/app-store/marketing/guidelines/)

## Smart App Banner and social metadata

The production marketing document is `welcome.html`, served at the website root. In a React application with an `index.html` entry, place the following in that document’s `<head>`. Replace `APP_ID` and `PREVIEW_IMAGE_URL` before publication. The preview image must be an absolute public HTTPS URL to an actual image.

```html
<!-- Enable only after the App Store listing is publicly available. -->
<meta name="apple-itunes-app" content="app-id=APP_ID">

<title>BasketBoss — Use what you have. Buy what you need.</title>
<meta name="description" content="Plan meals around what is already in your cupboard, fridge and freezer. Build a shopping list for the gaps, track your spend and waste less food.">
<link rel="canonical" href="https://basketboss.co.uk/">

<meta property="og:type" content="website">
<meta property="og:locale" content="en_GB">
<meta property="og:site_name" content="BasketBoss">
<meta property="og:url" content="https://basketboss.co.uk/">
<meta property="og:title" content="BasketBoss — Shop your kitchen first.">
<meta property="og:description" content="Turn food you already have into meals. Buy what is missing, keep your spending in view and cut avoidable waste.">
<meta property="og:image" content="PREVIEW_IMAGE_URL">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="BasketBoss meal planning, At home food and shopping list screens.">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="BasketBoss — Shop your kitchen first.">
<meta name="twitter:description" content="Plan around food already at home. Shop for the gaps and waste less.">
<meta name="twitter:image" content="PREVIEW_IMAGE_URL">
<meta name="twitter:image:alt" content="BasketBoss meal planning, At home food and shopping list screens.">
```

For BasketBoss, the banner tag becomes:

```html
<meta name="apple-itunes-app" content="app-id=6829160611">
```

Use the numeric App Store ID, rather than the app’s bundle ID. Safari controls when its native banner appears; a tag cannot force display after dismissal, in every browser, or before store availability. `app-argument` is optional and should only be added when the native app handles that URL and its context. [Apple Smart App Banner documentation](https://developer.apple.com/documentation/webkit/promoting-apps-with-smart-app-banners)

OpenGraph is useful for WhatsApp and other link previews; Twitter uses the card tags. These tags describe links shared from the BasketBoss website. Apple controls previews of `apps.apple.com` links. To use the BasketBoss preview, share the website or `/download` URL. Match `og:image:type`, dimensions and alt text to the image actually supplied. Social services may cache older previews.

## `/download` route

`functions/download.js` and `bb-download-routing.mjs` provide the route and its device-routing utility. The Cloudflare function reads the same launch flag as the landing page.

The official badge links directly to the App Store product page. Use `https://basketboss.co.uk/download` for campaign and shared links that need device routing.

- With promotion disabled, `/download` returns visitors to `/#features`.
- With the confirmed release enabled, the route provides lightweight client-side detection that sends iPhone and iPad visitors to the configured App Store URL.
- Desktop and Android visitors continue to `/#features`.
- Normal App Store and features links remain available when JavaScript cannot run.

A client check is needed because iPadOS can identify itself as a Mac when requesting desktop websites. The Mac-plus-touch heuristic is best effort, so retain the ordinary links. An edge-only User-Agent rule cannot reliably distinguish every desktop-mode iPad. [WebKit explanation of iPadOS user agents](https://bugs.webkit.org/show_bug.cgi?id=212937)

The download page uses a small application-owned inline script and does not add a Content Security Policy itself. If the deployment adds a restrictive policy, permit that script with a nonce or its exact hash. Do not add `unsafe-inline` to the whole website to make the redirect work. Keep metadata server-rendered so link crawlers can read it without running JavaScript. Changes to the launch environment variable require a deployment; do not cache a device-specific redirect across visitors.

## Pantry-first copy

Three hero headline options:

1. **Shop your kitchen before the supermarket.**
2. **Your next dinner could already be at home.**
3. **Use what you have. Buy only what you need.**

Subheadline:

> Turn what is in your cupboard, fridge and freezer into a meal plan. Build a list for what is missing and keep your shopping spend in view.

Three benefit bullets:

- Plan meals around food you already have.
- Shop for the gaps and track your spend as you go.
- Use food sooner and cut avoidable waste.

Use “track your spend as you shop” for BasketBoss’s recorded shopping amounts. Describe unconfirmed prices as estimates. Avoid promising a live supermarket price feed, an automatic pantry audit, guaranteed savings or a measured waste reduction percentage.

## Launch verification

Confirm that the public product page, official badge SVG and 1200×630 social image load. Check the launch-off experience, both React badge variants, the launch-on iPhone/iPad download route, the desktop/Android features fallback, keyboard focus and reduced-motion settings. Review the page with a narrow viewport so the compact badge retains its 40 px minimum height without clipping. Existing Start free and sign-in links must still open the web app.

## Prepared previews and checks

[Phone preview with future live badge](previews/app-store-landing-mobile.png) · [Desktop prelaunch preview](previews/app-store-landing-desktop-prelaunch.png) · [Verification summary](APP_STORE_LANDING_QA.json)

The live badge screenshot uses a local DOM visibility fixture; it does not claim that the App Store listing or production launch is live. The `/download` browser tests execute the actual route response and JavaScript. Node tests independently exercise the production HTMLRewriter activation handlers.
