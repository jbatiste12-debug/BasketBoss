# Premium Cook AI voice

This draft adds a private Cloudflare Pages Function at `/api/tts`. It uses OpenAI `gpt-4o-mini-tts`, the built-in `cedar` voice, MP3 output and fixed British English kitchen-coach delivery instructions. It reads the supplied prompt without inventing quantities, timings or recipe guidance. The provider, voice, output format and instructions are server-owned; client options cannot override them.

No provider request, production deployment, R2 provisioning or database migration was run while preparing this change. Naturalness and the British accent still need an actual listening check once the server secret is configured. A new signed iOS build needs a physical iPhone streaming, pause/resume, interruption and offline-fallback check.

## Bindings and activation

Use the existing `BILLING_DB`, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` bindings and paid-entitlement configuration. Review and apply `sql/basketboss_cook_tts_20261102.sql` to Cloudflare D1 before enabling generation. It creates a non-personal generation lease table and, if absent, the existing AI usage table; this endpoint does not initialize the TTS lease/usage schema at runtime. The established account-deletion guard retains its existing schema checks.

Add these server-side bindings/settings in the Cloudflare Pages production environment and separately in any preview environment to be tested:

| Setting | Purpose |
| --- | --- |
| `BB_TTS_AUDIO` | Private R2 bucket binding, with public access disabled. No public R2 URL or bucket CORS is needed. |
| `OPENAI_API_KEY` | Server secret permitted to call the Speech API. Never put it in HTML, native configuration or a public JS file. |
| `BB_TTS_ENABLED=true` | Explicit activation flag. Disabled or missing bindings return 503 so the client can use its device voice. |
| `BB_TTS_DAILY_MISS_CAP` | Per-member/household-owner daily new-generation cap, an integer from 1 to 500. A conservative initial value is 80. |
| `BB_TTS_GLOBAL_DAILY_MISS_CAP` | Site-wide daily new-generation cap, an integer from 1 to 10,000. Set an intentional budget; 1,000 is an example, not a required value. |

Caps apply only to new clips, including failed provider attempts. Every cached request still authenticates and verifies current Premium access. A verified partner uses the subscribed owner's generation allowance. Existing scan/meal-generation quotas are unchanged. An unknown or unavailable auth, membership, deletion or quota state fails closed. Cached clips can still be served during a provider-key/configuration outage if the activation flag, private storage and membership checks remain available.

## API contract

`POST /api/tts` accepts JSON `{ "text": "First up, grab 250 grams of gnocchi.", "prepare": true }` with a valid Bearer token and an approved same-origin or Capacitor Origin. Prompts must be non-empty and at most 1,200 characters; bodies are bounded to 8 KiB and only `text` and optional boolean `prepare` are accepted.

With `prepare: true`, the response is JSON:

```json
{
  "clipId": "<64 lowercase hexadecimal characters>",
  "url": "/api/tts?clip=<clipId>",
  "contentType": "audio/mpeg",
  "cached": false
}
```

Preparation waits until the complete clip has been persisted. Native playback then requests the returned relative URL with the Bearer token in the Authorization header. Tokens and raw prompt text never appear in an audio URL. Without `prepare: true`, POST returns streaming MP3 and persists a separate stream copy using the request's background work context.

`GET /api/tts?clip=<clipId>` streams the private stored MP3. `HEAD` reports metadata. Single-byte ranges, open-ended ranges and suffix ranges return 206 with `Content-Range`, `Content-Length` and `Accept-Ranges: bytes`; invalid ranges return 416. All audio responses use `Cache-Control: private, no-store` and vary on Authorization and Origin. No public browser/CDN cache can bypass the endpoint's access checks.

Auth failures return 401, membership denials 403, deletion locks 409, malformed prompts 400/413/415, exhausted generation caps 429, provider/storage failures 502 and disabled/unavailable preparation 503. A competing generation briefly waits for the same cached clip and otherwise returns 503 with `Retry-After: 2`; it does not start a second provider request. The client should keep the full instruction intact when falling back; longer prompts can use the installed device voice.

## Caching and cost

R2 object keys contain a SHA-256 hash of the whitespace-normalized spoken text plus the speech profile, model, voice, format and delivery instructions. R2 metadata contains only the profile and content type. The bucket stores audio, not the text, account identifier or auth token. Identical prompts across entitled members reuse one retained clip; changing a quantity or the speech profile produces a different key.

An atomic D1 lease prevents concurrent cache misses from starting duplicate provider calls. Lease expiry allows recovery after an abandoned request, and lease release is pinned to its unique claim. A generation response is capped at 2 MiB and the provider request/body has a 30-second timeout. Cache hits consume no generation allowance and make no speech-provider request, so they add no TTS generation charge while the clip remains stored. R2 storage/read and Worker/auth operations still have their normal platform costs. Do not promise literally zero infrastructure cost, or reuse after a clip is deleted/expired or the voice profile changes. Avoid an automatic R2 expiry rule for this prefix if durable reuse is desired.

## Cook playback and fallback

The shared deterministic phrasing module expands spoken units and oven settings, puts ingredient amounts before names and adds stable conversational transitions. It never rounds amounts, guesses package sizes or truncates a safety instruction. Current public-catalogue tests cover 730 ingredient declarations and 597 method steps, preserving every numeric value. Prompts over the AI boundary keep their complete text and use the existing device voice.

Cook pauses speech recognition before preparing or playing a response. Browser MP3 uses MediaSource progressive playback where supported and a bounded Blob playback path otherwise. iOS plays authenticated ranged MP3 through public AVAssetResourceLoaderDelegate and URLSession APIs; bearer tokens stay in request headers and never appear in an audio URL. Only the canonical production clip route is accepted. Playback has progress/deadline limits and rejects redirects.

Each utterance has a speech ticket. Stop, navigation, backgrounding, account changes and a newer step cancel pending fetches and old audio. Temporary service, network, quota and audio failures use the installed native British voice, preferring `.premium`, then `.enhanced`, then the standard available en-GB voice. A definitive auth, Premium or deletion rejection stops voice instead. Same-account token renewal does not stop an active Cook guide. Recognition remains the existing Apple/browser service; microphone audio and recognised commands are not sent to the TTS provider. Offline command recognition still depends on the device's available on-device speech recognition support.

The voice control tells users that the online voice is AI-generated and a device voice is available as backup. No subscription access is granted by a client-side voice preference.

## Verification

The isolated endpoint suite checks real SQLite lease/quota statements, cache reuse without a provider key, simultaneous generation, current identity and server-owned membership, protected cache reads, request limits, MP3 response bounds, missing migrations, deletion races, partial reads and native-compatible ranges. No test sends actual recipe data to an AI service.

Implementation references checked on 2 November 2026:

- [OpenAI text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech): model, MP3, accent/tone instructions, built-in `cedar` voice and chunked speech responses.
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/): private bucket bindings and streaming/ranged object reads.

Portable validation: 1,159 automated checks passed with two skips and two TODOs and no failures. Native packaging and portable iOS verification passed with 880 bundled files and only the public 100 Free recipe records. Signed device playback, actual provider audio/accent listening and production activation remain outstanding.
