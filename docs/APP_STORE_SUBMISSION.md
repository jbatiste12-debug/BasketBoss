# BasketBoss 1.0 — App Store submission

Build 28 is installed in TestFlight. The user confirmed a real monthly Sandbox purchase, Premium activation, Premium retained after reopening, and unlocked Premium recipes. Restore Purchases still fails inside Apple's native account-sync operation after Apple Account verification. Build 29 is the next diagnostic candidate: it adds safe native restore details, ordinary cancellation handling and persistent verification messages. A TestFlight upload does not submit the app for App Review. Use the candidate's final verified release tag and results; do not infer Build 29 verification from Build 28's results.

## Upload the submission candidate

On the Mac, open the candidate's `ios/App/App.xcworkspace`. Confirm Version **1.0**, Build **29**, bundle **uk.co.basketboss.app**, and signing team **J25UTUATD2**. Choose **Any iOS Device (arm64)**, then **Product → Archive**. In Organizer choose **Distribute App → App Store Connect → Upload**. If build 29 has already been uploaded, use the next unused build number.

Wait for Apple to finish processing the build, then open [BasketBoss in App Store Connect](https://appstoreconnect.apple.com/apps/6829160611/distribution). Select the processed build on the **iOS App 1.0 / Prepare for Submission** page. Uploading it to TestFlight alone does not select it for the App Store version.

## Subscriptions and reviewer access

The only Apple products to submit are:

| Product | Product ID | Agreed UK price |
| --- | --- | --- |
| Premium Monthly | `uk.co.basketboss.premium.monthly` | £4.99 per month |
| Premium Annual | `uk.co.basketboss.premium.annual` | £39.99 per year, paid upfront |

Complete each product's required metadata, availability, price and review screenshot. Include both in the same first-version submission. Depending on the current App Store Connect screen, attach them in the version's **In-App Purchases and Subscriptions** section or add them to the same draft review submission; verify both appear with app version 1.0 before submitting. Do not recreate the deleted Apple Founder product. The existing web Founder offer remains separate.

Provide a dedicated, confirmed BasketBoss review login in **App Review Information → Sign-in information**. Put its password directly in App Store Connect. Apple reviewers use Sandbox purchases; the BasketBoss account's Auth UUID must be permitted by the server's Sandbox configuration. Save and redeploy Production after changing that allowlist. A review account may already have verified Sandbox Premium: real Apple purchase options remain available to that authorized Sandbox session. An existing Beta grant does not prove an Apple purchase works. A real Sandbox purchase and recipe access have been user-confirmed for Build 28; successful Restore Purchases remains required before the full purchase flow is signed off.

The App Store candidate contains no TestFlight activation control. Existing verified complimentary grants remain valid under the existing server rules. The PWA retains normal web plans and checkout; the native app uses StoreKit.

## Complete the version record

- Add accurate current iPhone screenshots, app description, subtitle, keywords and copyright.
- Complete **App Privacy**, the age-rating questionnaire, applicable export-compliance questions and other required declarations based on actual app behavior.
- Use `https://basketboss.co.uk/privacy` for the privacy policy and `https://basketboss.co.uk/` for the marketing website. The website and privacy policy list `support@basketboss.co.uk` for support; use a support page that visibly provides contact details for the Support URL.
- Check Apple agreements, tax/banking information and subscription availability. Verify the intended App Store countries and availability.
- Check the submitted physical-device build: cold launch, sign-in, pantry search/add, purchase/restore, account deletion and privacy/terms links. Camera, microphone and AI tools must remain optional and display their existing permissions/consent flows.
- If you want to control the launch date, select **Manually release this version**. Approval then does not immediately publish the app.

After the required fields are complete, choose **Add for Review**, open the draft submission and choose **Submit for Review**. Confirm the version reaches **Waiting for Review**. A build listed only under TestFlight has not reached this step.

## Suggested App Review notes

Paste the following after the review account has been confirmed and its Sandbox access tested. Enter the credentials in the dedicated sign-in fields rather than these notes.

> BasketBoss helps households plan dinners, track food at home, prepare a shopping list and cook from guided recipes. Free features are available without a paid subscription.
>
> A confirmed BasketBoss review account is provided in the Sign-in Information fields. To test Premium, sign in, open Settings and Your Premium membership, then choose the monthly or annual Apple subscription. Restore Purchases is on the same membership screen and should use the BasketBoss account used for the purchase. The app displays Apple's localized price and billing period.
>
> The five main tabs are Plan, Discover, At home, Shop and Cook. In At home, search for food and choose Add item to enter stock. Meal planning uses confirmed stock to calculate shopping shortfalls. Premium includes the full recipe collection, optional receipt/photo tools, Voice Cook and the Yellow sticker helper. Yellow-sticker times and shopping prices are estimates.
>
> Camera and microphone access are optional. The app requests consent before sending a selected photo for AI processing, and scanned results are reviewed before saving. Voice Cook can be turned off, and cooking questions can be typed.
>
> Account deletion is available in Settings under Delete Account & Data. The confirmation explains that deleting BasketBoss data does not cancel an Apple subscription; Apple billing is managed separately through Apple Account subscription settings. Privacy and terms links are available in the app.

## Evidence and limits

The release handoff records the exact tested source commit, native compilation, StoreKitTest, keyboard and Cook checks. Local StoreKit products and simulated server replies are not evidence that live Apple Sandbox credentials, App Store Connect metadata or a real purchase have been verified. Signing, uploading and pressing Submit for Review require the developer's Apple account; this workspace has no App Store Connect connection or signing credentials.

Apple references: [submit an app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/), [choose a build](https://developer.apple.com/help/app-store-connect/manage-builds/choose-a-build-to-submit/), [submit an In-App Purchase](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/).
