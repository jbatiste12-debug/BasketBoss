# Cook Mentor server rollout

Status: prepared for review; **not deployed by this change**. This focused branch starts from production/main `0557631bf12c90f58d9460f17d9810b1408cd4b6` and preserves its Cloudflare manual-redirect speech fix and regression test. It contains no client, native, recipe, dependency or deployment-workflow changes.

## Resulting server behaviour

`POST /api/cook-assistant` accepts a bounded cooking question, the active recipe with already-scaled ingredients/current step, up to six history entries and an optional companion nickname (default `Chef Boss`). It returns a short plain-text answer inside JSON. Questions remain scoped to that recipe. The server fixes the model (`gpt-4.1-mini`), instructions and response schema; requests use OpenAI Responses with `store:false` and no tools or app actions. Recipe quantities are not rescaled or saved.

`POST /api/tts` additionally accepts `{ "text": "A spoken reply", "private": true }`. This uses the server-owned natural British mentor delivery (`marin`), returns transient MP3 and never reads or writes the shared R2 recipe cache. Standard narration retains its existing `cedar` profile/cache. Both provider requests use Workers-compatible manual redirects and reject redirect responses without following them.

The current confirmed identity, Premium membership, newest paid-device session and account-deletion checks protect these routes. Question/history/name data and personalised reply audio are not stored in BasketBoss tables or R2. Existing `bb_ai_daily_usage` counters contain only actor/action/day counts; provider processing remains subject to OpenAI's own service policies, as disclosed in the updated privacy notice.

## Deployment and verification after separate approval

1. Merge only this focused server branch through the existing production Pages process. Existing TestFlight 4 has no conversational client; naming, typed questions and spoken follow-ups require the separate new app build.
2. Reuse the existing `BILLING_DB`, authentication/paid-access configuration and server-only `OPENAI_API_KEY`. That key must permit both Responses and Speech requests. `BB_PREMIUM_AI_ENABLED=true` gates questions; `BB_TTS_ENABLED=true` gates speech. This patch creates no SQL tables and changes no flags, caps, keys or R2 configuration.
3. `BB_TTS_DAILY_MISS_CAP` / `BB_TTS_GLOBAL_DAILY_MISS_CAP` bound each `cook-assistant` question action (currently 80/200 in the last observed configuration), separately from the existing `cook-tts` allowance. Private spoken replies consume that existing speech allowance on every generation; standard cached narration still avoids new-generation usage.
4. With the new client and a current verified Premium/owner session, ask a recipe question and a follow-up. Require JSON `{ "answer": "..." }`, verify recipe quantities/current-step context and listen to the private spoken reply. Confirm no personalised R2 cache object is created. Do not treat an unauthenticated response or successful build as an actual provider/listening test.
5. Check sign-out/account changes, Stop, backgrounding, recipe/serving changes, expired membership and quota exhaustion. The client must discard stale replies. Server provider work is bounded; immediate incoming-disconnect events also depend on Cloudflare's existing request-signal compatibility configuration, which this patch does not change.

Rollback: revert this focused merge through the normal production process. No schema rollback is needed. Existing recipe narration and its manual-redirect fix remain the baseline.

Prepared validation: all 59 focused backend/auth checks passed. The unchanged main native packaging built successfully (873 public files, exactly 100 Free recipes); the full main suite then passed 1,099 checks with zero failures, two skips and two existing TODOs. These are isolated checks, not live provider generation or an iPhone listening test.
