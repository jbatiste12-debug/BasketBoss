# Apple seven-day free trial

The iOS paywall reads the introductory offer and eligibility from StoreKit. It
shows **7 days free, then the Apple-localized monthly or annual price** only when
Apple returns a zero-price seven-day introductory offer and confirms the Apple
Account is eligible. Missing offers and ineligible accounts keep the normal
subscription presentation. No trial is granted from local state.

Starting the trial requires the customer to confirm Apple's subscription sheet.
Apple then renews the selected subscription automatically at its normal price
after the trial unless the customer cancels. The paywall discloses that price,
renewal period and cancellation terms. Restore Purchases remains available.

## App Store Connect setup

No production introductory offer has been created by this code change. In
[App Store Connect](https://appstoreconnect.apple.com/), an Account Holder,
Admin, App Manager or Marketing user must:

1. Open **Apps → BasketBoss → Subscriptions → BasketBoss Premium**.
2. Select `uk.co.basketboss.premium.monthly`.
3. Open **Subscription Prices → View all Subscription Pricing → Set up
   Introductory Offer**.
4. Choose the intended countries/regions and start/end dates. Review existing
   offers first because overlapping offers can replace them.
5. Choose **Free** with a duration of **1 week**. Review and confirm.
6. Repeat for `uk.co.basketboss.premium.annual` if both plans should offer the
   seven-day trial. Keep the existing subscription group and product IDs.

Apple permits only one introductory offer per customer within a subscription
group, including when changing from monthly to annual. Product metadata can
take up to one hour to appear in the sandbox. The actual storefront offer and
eligibility returned by Apple determine whether the app advertises the trial.

## UK pounds and Apple storefronts

Native subscription prices come directly from StoreKit's localized
`Product.displayPrice`. The app also receives Apple's `currencyCode`; it does
not replace a dollar sign with a pound sign or change the amount Apple charges.
The existing local StoreKit test configuration already uses `en_GB` and `GBR`
with test prices of £4.99 monthly and £39.99 annually. This fixture does not set
production App Store pricing.

In App Store Connect, open each existing subscription's **Subscription Prices
→ View all Subscription Pricing** and check the **United Kingdom** storefront.
Confirm the intended UK prices, **£4.99 monthly** and **£39.99 annually**, and
that the one-week free offer includes the UK where intended. Review any
scheduled changes and treatment of existing subscribers before confirming a
production price change. Other storefronts retain their appropriate currencies.

For a UK device test, check the Apple Account's **Settings → [your name] → Media
& Purchases → View Account → Country/Region**. StoreKit uses that purchasing
account's storefront; choosing UK or Guernsey inside BasketBoss does not change
the Apple billing country. A Sandbox test account must likewise use a UK
storefront. Do not change a real customer's Apple Account region merely to
alter a displayed symbol: Apple applies account, payment and active-subscription
requirements when changing countries. After correcting a test account or App
Store Connect pricing, reopen the app and use **Refresh membership & prices**
to fetch the current Apple-localized prices.

If the Premium card and Apple's purchase confirmation show different currencies,
record which screen differs and the purchasing account's storefront before
changing code. Apple's confirmation sheet determines the actual charge.

## Release verification

- Use a fresh eligible Sandbox Apple Account to verify the seven-day trial and
  selected renewal price on Apple's confirmation sheet. Sandbox trial time is
  accelerated, so it does not last seven real days.
- Verify receipt/server acknowledgement unlocks Premium and normal renewal
  continues through the existing signed-transaction verification path.
- Verify an ineligible Apple Account sees the normal paid plan, and cancel,
  restore and existing subscriptions continue to work.
- Verify the live App Store Connect offer is present before advertising the
  trial in marketing. A local StoreKit fixture does not enable a live offer.

Official references: [Apple introductory-offer setup](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions/)
and [StoreKit introductory-offer eligibility](https://developer.apple.com/documentation/storekit/product/subscriptioninfo/iseligibleforintrooffer),
[subscription pricing](https://developer.apple.com/help/app-store-connect/manage-subscriptions/manage-pricing-for-auto-renewable-subscriptions/),
[Apple storefront availability](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-availability-for-an-auto-renewable-subscription/)
and [Apple Account country/region](https://support.apple.com/en-gb/118283).
