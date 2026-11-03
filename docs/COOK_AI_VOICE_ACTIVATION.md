# Cook AI voice: focused production service patch

Status: prepared locally; **not deployed or enabled**. Base: production/main `6495437339c8950128999d6dafe63ef2ed27f76e`.

This patch adds the speech endpoint and its Premium-session guard without changing app HTML, recipes or the existing production UI. TestFlight 1.0 (4) already calls `https://basketboss.co.uk/api/tts`, so server activation does not require another signed app build. The last verified main source lacks this endpoint; an earlier settings screenshot showed `BB_TTS_ENABLED=false`. Current live settings have not been verified from this workspace.

The endpoint uses OpenAI `gpt-4o-mini-tts`, voice `cedar`, British English delivery instructions and private cached MP3 clips. Server-owned auth, current Premium membership, account-deletion checks and existing native CORS remain required. Temporary failure uses the installed device voice; a successful native build does not establish that the AI voice is active or natural.

## Activation after review

1. Deploy this focused server patch through the existing production Pages process, retaining the current main frontend. Do not merge the wider recipe/UI release merely to publish this route.
2. Review/apply `sql/basketboss_cook_tts_20261102.sql` to the existing production `BILLING_DB`. It adds the generation lease table and creates the existing AI usage table only if absent. No recipe payload or receipt-policy migration is needed.
3. Confirm existing `BILLING_DB`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and paid-entitlement settings. Bind `BB_TTS_AUDIO` to the private R2 bucket with public access disabled; configure a server-only `OPENAI_API_KEY` permitted to use the Speech API.
4. Set intentional generation caps: `BB_TTS_DAILY_MISS_CAP` is an integer 1–500 per member/household-owner per UTC day; `BB_TTS_GLOBAL_DAILY_MISS_CAP` is 1–10,000 across the site. They count new distinct utterances, including failed provider attempts, rather than complete recipes. Cached clips incur no new generation allowance. The earlier screenshot's 80/200 values are not changed by this patch; choose the site budget deliberately.
5. Enable `BB_TTS_ENABLED=true` only after those dependencies are ready, then apply the configuration through the production deployment process. Preview settings do not configure TestFlight's production endpoint. Set the flag false and deploy that configuration to disable AI generation/playback again; device backup remains available.

## Verify before calling it active

- An unauthenticated GET to `/api/tts` must return an API response: JSON 503 can mean disabled/incomplete configuration, and JSON 401 shows the sign-in boundary is present. A 200 HTML page is a failed API check and can indicate the unmatched-route fallback. These checks do not prove generation works.
- With a current verified Premium/owner session, POST a short recipe-derived prompt as `{ "text": "First up, grab 250 grams of gnocchi.", "prepare": true }`, using the Bearer header and approved production or Capacitor Origin. Require a valid JSON clip ID and canonical `/api/tts?clip=...` URL. Keep credentials out of URLs and logs.
- Authenticated GET that clip must return playable `audio/mpeg`. Listen on the physical iPhone, then repeat identical preparation and require `cached:true` without another provider call/usage increment.
- Test the actual Cook narration, stop/navigation cancellation and offline device backup. A confirmed 401/403/409 must stop voice rather than fall back. Do not describe device backup as AI voice.

TestFlight 4 has a 20-second preparation deadline versus the provider's 30-second deadline, so a slow first generation can still fall back. Prompts over 1,200 characters also retain full device narration. A new app build is needed only for subsequent client-side status/deadline changes, not to activate this existing endpoint integration.

Portable checks (no provider requests):

```sh
node --test --test-isolation=none tests/basketboss-tts.test.mjs tests/basketboss-native-api-origin.test.mjs tests/basketboss-premium-session-route-regression.test.mjs
```
