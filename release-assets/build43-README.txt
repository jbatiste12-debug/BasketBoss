BasketBoss 1.0.2 — Build 43

On your Mac, open prepare-build43-mac.command. It downloads the tested source, installs dependencies, prepares the 700-recipe client and opens Xcode. Requires Xcode and Node.js 22 or newer.

To test: connect your iPhone, select it at the top of Xcode and press the play button (Product > Run). Version is 1.0.2, Build 43.

To prepare and archive from Terminal:
  bash prepare-build43-mac.command --archive

The archive opens in Xcode Organizer. Choose Distribute App > App Store Connect > Upload. Signing and uploading happen on your Mac; this launcher does not upload or alter your current submission.

Your pantry:
- At home is the single visible pantry used for shopping and planned meals. An absent food contributes zero; old saved amounts are not offered in a second confirmation screen.
- Purchases, edits, removals, cooking and undo retain their precise existing quantities. Offline edits queue for account sync without adding device and saved balances together.
- The Premium inviter leads the household. Only the verified owner seeds a new empty household from their At home stock. The invited partner waits and joins that pantry; personal balances are backed up rather than merged.
- Linked eligible accounts refresh automatically while foregrounded, using a four-second polling interval and refresh on return/reconnect. This uses existing authenticated services, not a new WebSocket subscription. RLS, recipe calculations and subscription eligibility are unchanged.
- Genuine conflicts and other scope reconnections are managed under Account & cloud sync. Existing initialized household stock always wins over an older personal snapshot.
- Recipe pieces such as six sausages now display as 6 each. True package and weight quantities keep their meaning.

Local verification: 4,238 passed, zero failures, zero cancellations; 1 existing platform skip and 2 existing TODOs are recorded separately. Rebuilt PWA/native asset parity and all 22 protected calculation/file checks pass. See docs/qa/2026-11-11-account-pantry-single-source.md. Live publication proof is recorded separately in the current release packet.

No additional ios:sync is needed. Ordinary ios:sync after this launcher would replace the prepared 700-recipe assets.

Pinned application source:
https://github.com/jbatiste12-debug/BasketBoss/commit/c99afebf52ce65b56b083ddab4fcdc9ab1fe56c7

Complete source ZIP:
https://github.com/jbatiste12-debug/BasketBoss/archive/c99afebf52ce65b56b083ddab4fcdc9ab1fe56c7.zip
