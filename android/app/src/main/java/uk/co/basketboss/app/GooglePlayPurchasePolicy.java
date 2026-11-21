package uk.co.basketboss.app;

/** Store presentation and concurrency rules. This class never grants account access. */
final class GooglePlayPurchasePolicy {
    private GooglePlayPurchasePolicy() {}

    static boolean productId(String value) {
        return value != null && value.matches("[a-z0-9][a-z0-9._]{0,149}");
    }

    static boolean basePlanId(String value) {
        return value != null && value.matches("[a-z0-9][a-z0-9-]{0,62}");
    }

    static boolean accountId(String value) {
        // Purchase context supplies an opaque server identifier, never an email/user name.
        return value != null && value.matches("[A-Za-z0-9_-]{16,64}");
    }

    static boolean autoRenewingPeriod(String period, int recurrenceMode) {
        return recurrenceMode == 1 && ("P1M".equals(period) || "P1Y".equals(period));
    }

    static boolean offerMatches(String basePlan, String token, String returnedPlan, String returnedToken,
                                String renewalPeriod, int recurrenceMode, boolean installment) {
        return basePlan != null && token != null && basePlan.equals(returnedPlan) && token.equals(returnedToken) &&
            !installment && autoRenewingPeriod(renewalPeriod, recurrenceMode);
    }

    static String purchaseState(int state) {
        return state == 1 ? "purchased" : state == 2 ? "pending" : null;
    }

    /** A timed-out payment sheet keeps its lease until reconciliation or its callback. */
    static final class Gate {
        private long sequence;
        private long current;

        long begin() {
            if (current != 0) return 0;
            current = ++sequence;
            return current;
        }

        boolean owns(long lease) {
            return lease != 0 && current == lease;
        }

        boolean finish(long lease) {
            if (!owns(lease)) return false;
            current = 0;
            return true;
        }
    }
}
