package uk.co.basketboss.app;

import static org.junit.Assert.*;
import org.junit.Test;

public class GooglePlayPurchasePolicyTest {
    @Test public void onlyPurchasedAndPendingAreDeliverableAndNeitherMeansPremium() {
        assertEquals("purchased", GooglePlayPurchasePolicy.purchaseState(1));
        assertEquals("pending", GooglePlayPurchasePolicy.purchaseState(2));
        assertNull(GooglePlayPurchasePolicy.purchaseState(0));
        assertNull(GooglePlayPurchasePolicy.purchaseState(3));
        assertNull(GooglePlayPurchasePolicy.purchaseState(-1));
    }

    @Test public void supportsMonthlyAndAnnualRenewalsAndRejectsPrepaidAndOtherPeriods() {
        assertTrue(GooglePlayPurchasePolicy.autoRenewingPeriod("P1M", 1));
        assertTrue(GooglePlayPurchasePolicy.autoRenewingPeriod("P1Y", 1));
        assertFalse(GooglePlayPurchasePolicy.autoRenewingPeriod("P1M", 3));
        assertFalse(GooglePlayPurchasePolicy.autoRenewingPeriod("P1Y", 2));
        assertFalse(GooglePlayPurchasePolicy.autoRenewingPeriod("P1W", 1));
        assertFalse(GooglePlayPurchasePolicy.autoRenewingPeriod(null, 1));
    }

    @Test public void opaqueAccountContextCannotContainEmailNamesOrOverlongValues() {
        assertTrue(GooglePlayPurchasePolicy.accountId("opaque_account_context_123456"));
        assertTrue(GooglePlayPurchasePolicy.accountId("a".repeat(64)));
        assertFalse(GooglePlayPurchasePolicy.accountId("member@example.com"));
        assertFalse(GooglePlayPurchasePolicy.accountId("Mary Example"));
        assertFalse(GooglePlayPurchasePolicy.accountId("a".repeat(65)));
        assertFalse(GooglePlayPurchasePolicy.accountId(null));
    }

    @Test public void changedOrIneligibleOfferCannotLaunchUsingAPreviouslyDisplayedToken() {
        assertTrue(GooglePlayPurchasePolicy.offerMatches("monthly", "eligible-offer", "monthly", "eligible-offer", "P1M", 1, false));
        assertFalse(GooglePlayPurchasePolicy.offerMatches("monthly", "expired-offer", "monthly", "current-offer", "P1M", 1, false));
        assertFalse(GooglePlayPurchasePolicy.offerMatches("annual", "eligible-offer", "monthly", "eligible-offer", "P1M", 1, false));
        assertFalse(GooglePlayPurchasePolicy.offerMatches("monthly", "eligible-offer", "monthly", "eligible-offer", "P1M", 3, false));
        assertFalse(GooglePlayPurchasePolicy.offerMatches("monthly", "eligible-offer", "monthly", "eligible-offer", "P1M", 1, true));
    }

    @Test public void idsCannotInjectPathsIntoQueriesOrPlayManagementLinks() {
        assertTrue(GooglePlayPurchasePolicy.productId("basketboss_premium"));
        assertTrue(GooglePlayPurchasePolicy.productId("uk.co.basketboss.premium"));
        assertTrue(GooglePlayPurchasePolicy.basePlanId("premium-monthly"));
        for (String id : new String[] {"", "../premium", "premium?package=other", " premium", "PREMIUM", "https://checkout.paddle.com"}) {
            assertFalse(GooglePlayPurchasePolicy.productId(id));
            assertFalse(GooglePlayPurchasePolicy.basePlanId(id));
        }
    }

    @Test public void lateOldPurchaseCannotCompleteANewerCoordinatedSheet() {
        String current = "55555555-5555-4555-8555-555555555555";
        String old = "66666666-6666-4666-8666-666666666666";
        assertTrue(GooglePlayPurchasePolicy.profileId(current));
        assertTrue(GooglePlayPurchasePolicy.profileMatches(current, current));
        assertFalse(GooglePlayPurchasePolicy.profileMatches(current, old));
        assertFalse(GooglePlayPurchasePolicy.profileMatches(current, null));
        assertFalse(GooglePlayPurchasePolicy.profileId("member@example.com"));
        assertTrue(GooglePlayPurchasePolicy.profileMatches(null, old)); // Legacy checkout.
    }

    @Test public void doubleTapsCannotStartCompetingSheetsAndOldCallbacksCannotReleaseNewLease() {
        GooglePlayPurchasePolicy.Gate gate = new GooglePlayPurchasePolicy.Gate();
        long first = gate.begin(); assertTrue(first > 0);
        assertEquals(0, gate.begin());
        // A timed-out JS request does not finish the store's still-open sheet.
        assertTrue(gate.owns(first)); assertEquals(0, gate.begin());
        assertTrue(gate.finish(first));
        long second = gate.begin(); assertTrue(second > first);
        assertFalse(gate.finish(first)); assertTrue(gate.owns(second));
        assertFalse(gate.owns(first)); assertTrue(gate.finish(second));
        assertFalse(gate.finish(second)); assertFalse(gate.owns(0));
    }
}
