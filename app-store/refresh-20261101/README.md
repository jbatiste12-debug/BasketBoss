# Refreshed App Store artwork

Seven iPhone portrait graphics (1320 × 2868) and seven 13-inch iPad graphics (2064 × 2752), using the current packaged application interface and fictional demonstration data. The story covers planning, At home, quantity reconciliation, shopping, Discover, Voice Cook and receipt scanning. Premium features carry explicit labels.

Generate after `npm run build:native`:

```sh
BB_SCREENSHOT_OUT=/path/to/iphone node app-store/refresh-20261101/generate.cjs --native
BB_SCREENSHOT_OUT=/path/to/ipad node app-store/refresh-20261101/generate.cjs --native --ipad
```

Requires Playwright and Chromium. In this workspace the existing capture-tools installation is used. The default output is `/workspace/artifacts/BasketBoss-App-Store-20261101`.

These are local browser renders of the packaged web assets, not native simulator captures. Review the final build on an iPhone before uploading. No credentials are entered, no live API is contacted, and no personal production data is used. The capture fixtures block external network requests.

Only the seven numbered marketing PNGs belong in App Store Connect. The raw `-ui.png` captures, contact sheet and manifest are review/provenance files.
