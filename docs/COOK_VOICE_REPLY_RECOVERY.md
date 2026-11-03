# Cook reply recovery

Prepared against build 5 source `80777bc3e0ce50ac63bc59ec18fef87c5e2a26ee`. This is not a signed TestFlight update or confirmation of the live failure's cause.

The mentor previously awaited native audio preparation before sending a question whenever voice was enabled. A failed or unresolved native preparation could therefore block both written and spoken answers. The question now obtains and displays its written answer first; audio preparation still holds the microphone before speech generation/playback. Audio failures retain the answer and offer retry without another question request. A native recognition failure while the question is pending turns voice off without cancelling the written answer.

Explicit Stop, cancellation, backgrounding, leaving Cook, account changes, Premium loss and recipe/step changes still discard stale replies.

The transports accept optional, bounded, allowlisted service failure codes from the separate server diagnostic patch. They never present arbitrary upstream error text. AI-service access or usage failures remain distinct from account authorization, BasketBoss daily allowances and device audio failure. The older server's generic errors remain supported.

Validation: all 108 focused voice, transport, native bridge and client/server contract checks pass. Native packaging and portable iOS verification pass with 894 public files and exactly 100 Free recipes. The full client suite has five failures also reproduced on the unmodified build 5 source: four viewport fixtures fail when run in the combined suite, and one onboarding assertion expects an obsolete asset version. These are outside this change; this is not an all-green full-suite or physical-iPhone listening claim.

Before release, verify on an authenticated physical iPhone: question with voice off, question with voice on, audible full reply, follow-up, Stop, background, account/recipe changes and a failed audio retry. The production endpoint is blocked by this workspace's outbound policy, so live provider access and iPhone playback remain unverified.
