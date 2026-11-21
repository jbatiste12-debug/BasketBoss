package uk.co.basketboss.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import com.android.billingclient.api.AccountIdentifiers;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONObject;

/** Google Play proves purchases; only the BasketBoss backend can grant Premium. */
@CapacitorPlugin(name = "BasketBossGooglePlay")
public final class BasketBossGooglePlayPlugin extends Plugin {
    private static final String PACKAGE_NAME = "uk.co.basketboss.app";
    private static final long REQUEST_TIMEOUT_MS = 20000;
    private static final long PURCHASE_TIMEOUT_MS = 180000;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<Request> requests = new LinkedHashSet<>();
    private final List<ConnectionWork> waiting = new ArrayList<>();
    private final GooglePlayPurchasePolicy.Gate purchaseGate = new GooglePlayPurchasePolicy.Gate();
    private BillingClient billing;
    private boolean connecting;
    private boolean destroyed;
    private boolean recoveryRunning;
    private long recoveryGeneration;
    private PurchaseFlow flow;

    private final class Request {
        final PluginCall call;
        final Runnable timeout;
        boolean active = true;

        Request(PluginCall call, long duration) {
            this.call = call;
            timeout = () -> {
                reject("Google Play did not respond. Refresh or restore purchases before trying again.", "BB_PLAY_TIMEOUT");
                // Do not launch a second sheet while the first could still be open.
                if (flow != null && flow.request == this && !flow.launched) retire(flow);
            };
            requests.add(this);
            main.postDelayed(timeout, duration);
        }

        boolean current() { return active && !destroyed; }

        void close() {
            active = false;
            main.removeCallbacks(timeout);
            requests.remove(this);
            waiting.removeIf(work -> work.request == this);
        }

        void resolve(JSObject result) {
            if (!current()) return;
            close();
            call.resolve(result);
        }

        void reject(String message, String code) {
            if (!active) return;
            close();
            call.reject(message, code);
        }
    }

    private final class ConnectionWork {
        final Request request;
        final Runnable action;
        ConnectionWork(Request request, Runnable action) { this.request = request; this.action = action; }
    }

    private final class PurchaseFlow {
        final long lease;
        final Request request;
        final String productId;
        final String accountId;
        boolean launched;
        PurchaseFlow(long lease, Request request, String productId, String accountId) {
            this.lease = lease; this.request = request; this.productId = productId; this.accountId = accountId;
        }
    }

    @Override public void load() {
        main.post(() -> {
            if (destroyed) return;
            try {
                billing = BillingClient.newBuilder(getContext().getApplicationContext())
                    .setListener((result, purchases) -> main.post(() -> onPurchasesUpdated(result, purchases)))
                    .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                    .enableAutoServiceReconnection()
                    .build();
                connect();
            } catch (RuntimeException unavailable) {
                billing = null;
                failWaiting();
            }
        });
    }

    private void connect() {
        if (destroyed || billing == null || connecting || billing.isReady()) return;
        connecting = true;
        try {
            billing.startConnection(new BillingClientStateListener() {
                @Override public void onBillingSetupFinished(BillingResult result) {
                    main.post(() -> {
                        if (destroyed) return;
                        connecting = false;
                        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { failWaiting(); return; }
                        List<ConnectionWork> ready = new ArrayList<>(waiting);
                        waiting.clear();
                        for (ConnectionWork work : ready) if (work.request.current()) work.action.run();
                        recoverPurchases();
                    });
                }
                @Override public void onBillingServiceDisconnected() {
                    main.post(() -> { if (!destroyed) connecting = false; });
                }
            });
        } catch (RuntimeException unavailable) {
            connecting = false;
            failWaiting();
        }
    }

    private void failWaiting() {
        for (ConnectionWork work : new ArrayList<>(waiting)) {
            work.request.reject("Google Play Billing is unavailable. Try again after checking your Play Store connection.", "BB_PLAY_UNAVAILABLE");
        }
        waiting.clear();
        if (flow != null && !flow.launched && !flow.request.active) retire(flow);
    }

    private void withClient(Request request, Runnable action) {
        if (!request.current()) return;
        if (billing == null) { request.reject("Google Play Billing is unavailable on this device.", "BB_PLAY_UNAVAILABLE"); return; }
        if (billing.isReady()) { action.run(); return; }
        waiting.add(new ConnectionWork(request, action));
        connect();
    }

    private static JSObject envelope(JSArray purchases) {
        JSObject value = new JSObject(); value.put("purchases", purchases); return value;
    }

    private static JSObject purchasePayload(Purchase purchase) {
        String state = GooglePlayPurchasePolicy.purchaseState(purchase.getPurchaseState());
        List<String> products = purchase.getProducts();
        String token = purchase.getPurchaseToken();
        if (state == null || !PACKAGE_NAME.equals(purchase.getPackageName()) || products == null || products.isEmpty() ||
            products.size() > 10 || token == null || token.isEmpty() || token.length() > 16384) return null;
        for (String product : products) if (!GooglePlayPurchasePolicy.productId(product)) return null;
        JSObject value = new JSObject();
        value.put("purchaseToken", token); value.put("productId", products.get(0)); value.put("products", new JSArray(products));
        value.put("state", state); value.put("acknowledged", purchase.isAcknowledged());
        AccountIdentifiers identifiers = purchase.getAccountIdentifiers();
        if (identifiers != null && identifiers.getObfuscatedAccountId() != null) {
            String account = identifiers.getObfuscatedAccountId();
            if (GooglePlayPurchasePolicy.accountId(account)) value.put("obfuscatedAccountId", account);
        }
        return value;
    }

    private static JSArray purchasePayloads(List<Purchase> purchases, String productId, String accountId) {
        JSArray values = new JSArray(); Set<String> tokens = new LinkedHashSet<>();
        if (purchases == null) return values;
        for (Purchase purchase : purchases) {
            if (purchase == null || purchase.getProducts() == null || productId != null && !purchase.getProducts().contains(productId)) continue;
            if (accountId != null) {
                AccountIdentifiers identifiers = purchase.getAccountIdentifiers();
                if (identifiers == null || !accountId.equals(identifiers.getObfuscatedAccountId())) continue;
            }
            JSObject value = purchasePayload(purchase);
            if (value != null && tokens.add(purchase.getPurchaseToken())) values.put(value);
        }
        return values;
    }

    private static boolean autoRenewingOffer(ProductDetails.SubscriptionOfferDetails offer) {
        if (offer.getInstallmentPlanDetails() != null) return false;
        List<ProductDetails.PricingPhase> phases = offer.getPricingPhases().getPricingPhaseList();
        if (phases == null || phases.isEmpty()) return false;
        ProductDetails.PricingPhase renewal = phases.get(phases.size() - 1);
        return GooglePlayPurchasePolicy.autoRenewingPeriod(renewal.getBillingPeriod(), renewal.getRecurrenceMode());
    }

    private static JSObject productPayload(ProductDetails product) {
        JSObject value = new JSObject(); value.put("id", product.getProductId());
        value.put("title", product.getTitle()); value.put("description", product.getDescription());
        JSArray offers = new JSArray();
        List<ProductDetails.SubscriptionOfferDetails> details = product.getSubscriptionOfferDetails();
        if (details != null) for (ProductDetails.SubscriptionOfferDetails detail : details) {
            if (!autoRenewingOffer(detail)) continue;
            JSObject offer = new JSObject(); offer.put("basePlanId", detail.getBasePlanId());
            offer.put("offerId", detail.getOfferId() == null ? JSONObject.NULL : detail.getOfferId());
            offer.put("offerToken", detail.getOfferToken());
            JSArray phases = new JSArray();
            for (ProductDetails.PricingPhase phase : detail.getPricingPhases().getPricingPhaseList()) {
                JSObject price = new JSObject(); price.put("formattedPrice", phase.getFormattedPrice());
                price.put("priceCurrencyCode", phase.getPriceCurrencyCode());
                // Preserve the store's integer precision through the JavaScript bridge.
                price.put("priceAmountMicros", Long.toString(phase.getPriceAmountMicros()));
                price.put("billingPeriod", phase.getBillingPeriod()); price.put("recurrenceMode", phase.getRecurrenceMode());
                price.put("billingCycleCount", phase.getBillingCycleCount()); phases.put(price);
            }
            offer.put("pricingPhases", phases); offers.put(offer);
        }
        value.put("subscriptionOfferDetails", offers); return value;
    }

    private static QueryProductDetailsParams productQuery(List<String> productIds) {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String product : productIds) products.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(product).setProductType(BillingClient.ProductType.SUBS).build());
        return QueryProductDetailsParams.newBuilder().setProductList(products).build();
    }

    private static QueryPurchasesParams purchasesQuery() {
        // Deliver suspended subscriptions too: only the backend decides their current access.
        return QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS)
            .includeSuspendedSubscriptions(true).build();
    }

    private boolean closed(PluginCall call) {
        if (!destroyed) return false;
        call.reject("Reopen BasketBoss before using Google Play Billing.", "BB_PLAY_UNAVAILABLE"); return true;
    }

    @PluginMethod public void getProducts(PluginCall call) {
        main.post(() -> {
            if (closed(call)) return;
            JSArray input = call.getArray("productIds"); Set<String> ids = new LinkedHashSet<>();
            if (input != null && input.length() > 0 && input.length() <= 10) {
                for (int index = 0; index < input.length(); index++) {
                    Object value = input.opt(index);
                    if (!(value instanceof String) || !GooglePlayPurchasePolicy.productId((String) value)) { ids.clear(); break; }
                    ids.add((String) value);
                }
            }
            if (ids.isEmpty()) { call.reject("Valid subscription product IDs are required.", "BB_PLAY_INVALID_ARGUMENT"); return; }
            Request request = new Request(call, REQUEST_TIMEOUT_MS);
            withClient(request, () -> {
                try {
                    billing.queryProductDetailsAsync(productQuery(new ArrayList<>(ids)), (result, details) -> main.post(() -> {
                        if (!request.current()) return;
                        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                            request.reject("Google Play could not load subscription prices. Refresh prices to retry.", "BB_PLAY_PRODUCT_UNAVAILABLE"); return;
                        }
                        JSArray products = new JSArray();
                        for (ProductDetails product : details.getProductDetailsList()) {
                            if (ids.contains(product.getProductId()) && BillingClient.ProductType.SUBS.equals(product.getProductType())) products.put(productPayload(product));
                        }
                        JSObject answer = new JSObject(); answer.put("products", products); request.resolve(answer);
                    }));
                } catch (RuntimeException unavailable) { request.reject("Google Play could not load subscription prices.", "BB_PLAY_PRODUCT_UNAVAILABLE"); }
            });
        });
    }

    private void retire(PurchaseFlow candidate) {
        if (flow == candidate && purchaseGate.finish(candidate.lease)) flow = null;
    }

    private boolean current(PurchaseFlow candidate) {
        return flow == candidate && purchaseGate.owns(candidate.lease) && candidate.request.current();
    }

    private void reject(PurchaseFlow candidate, String message, String code) {
        if (flow != candidate) return;
        candidate.request.reject(message, code); retire(candidate);
    }

    private void resolve(PurchaseFlow candidate, String status, JSArray purchases) {
        if (flow != candidate) return;
        JSObject answer = envelope(purchases); answer.put("status", status);
        candidate.request.resolve(answer); retire(candidate);
    }

    @PluginMethod public void purchase(PluginCall call) {
        main.post(() -> {
            if (closed(call)) return;
            String productId = call.getString("productId"), basePlanId = call.getString("basePlanId");
            String offerToken = call.getString("offerToken"), accountId = call.getString("obfuscatedAccountId");
            if (!GooglePlayPurchasePolicy.productId(productId) || !GooglePlayPurchasePolicy.basePlanId(basePlanId) ||
                !GooglePlayPurchasePolicy.accountId(accountId) || offerToken == null || offerToken.isEmpty() || offerToken.length() > 4096) {
                call.reject("A valid subscription and signed-in purchase context are required.", "BB_PLAY_INVALID_ARGUMENT"); return;
            }
            long lease = purchaseGate.begin();
            if (lease == 0) { call.reject("Another Google Play purchase is in progress. Restore purchases if its result was interrupted.", "BB_PLAY_BUSY"); return; }
            Request request = new Request(call, PURCHASE_TIMEOUT_MS);
            PurchaseFlow candidate = new PurchaseFlow(lease, request, productId, accountId); flow = candidate;
            withClient(request, () -> {
                try {
                    // A known subscription must be reconciled, not bought a second time or silently changed to another plan.
                    billing.queryPurchasesAsync(purchasesQuery(), (result, purchases) -> main.post(() -> {
                        if (!current(candidate)) return;
                        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { reject(candidate, "Google Play could not check existing purchases.", "BB_PLAY_UNAVAILABLE"); return; }
                        JSArray owned = purchasePayloads(purchases, productId, null);
                        if (owned.length() > 0) { resolve(candidate, containsPurchased(owned) ? "alreadyOwned" : "pending", owned); return; }
                        loadPurchaseOffer(candidate, basePlanId, offerToken);
                    }));
                } catch (RuntimeException unavailable) { reject(candidate, "Google Play could not start this purchase.", "BB_PLAY_UNAVAILABLE"); }
            });
            if (!request.active && flow == candidate) retire(candidate);
        });
    }

    private void loadPurchaseOffer(PurchaseFlow candidate, String basePlanId, String offerToken) {
        try {
            billing.queryProductDetailsAsync(productQuery(Collections.singletonList(candidate.productId)), (result, details) -> main.post(() -> {
                if (!current(candidate)) return;
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { reject(candidate, "Google Play could not load this subscription.", "BB_PLAY_PRODUCT_UNAVAILABLE"); return; }
                ProductDetails found = null; ProductDetails.SubscriptionOfferDetails selected = null;
                for (ProductDetails product : details.getProductDetailsList()) {
                    if (!candidate.productId.equals(product.getProductId()) || !BillingClient.ProductType.SUBS.equals(product.getProductType())) continue;
                    found = product;
                    if (product.getSubscriptionOfferDetails() != null) for (ProductDetails.SubscriptionOfferDetails offer : product.getSubscriptionOfferDetails()) {
                        List<ProductDetails.PricingPhase> phases = offer.getPricingPhases().getPricingPhaseList();
                        if (phases == null || phases.isEmpty()) continue;
                        ProductDetails.PricingPhase renewal = phases.get(phases.size() - 1);
                        if (GooglePlayPurchasePolicy.offerMatches(basePlanId, offerToken, offer.getBasePlanId(), offer.getOfferToken(),
                            renewal.getBillingPeriod(), renewal.getRecurrenceMode(), offer.getInstallmentPlanDetails() != null)) selected = offer;
                    }
                }
                if (found == null) { reject(candidate, "This Google Play subscription is unavailable. Refresh prices.", "BB_PLAY_PRODUCT_UNAVAILABLE"); return; }
                if (selected == null) { reject(candidate, "This subscription offer changed or is unavailable for your Play account. Refresh prices.", "BB_PLAY_OFFER_UNAVAILABLE"); return; }
                Activity activity = getActivity();
                if (activity == null || activity.isFinishing() || activity.isDestroyed()) { reject(candidate, "Reopen BasketBoss before starting this purchase.", "BB_PLAY_UNAVAILABLE"); return; }
                try {
                    BillingFlowParams.ProductDetailsParams product = BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(found).setOfferToken(selected.getOfferToken()).build();
                    BillingFlowParams params = BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(product))
                        .setObfuscatedAccountId(candidate.accountId).build();
                    candidate.launched = true;
                    BillingResult launch = billing.launchBillingFlow(activity, params);
                    if (launch.getResponseCode() != BillingClient.BillingResponseCode.OK) completeBillingResult(candidate, launch);
                } catch (RuntimeException unavailable) { reject(candidate, "Google Play could not open its purchase screen.", "BB_PLAY_PURCHASE_FAILED"); }
            }));
        } catch (RuntimeException unavailable) { reject(candidate, "Google Play could not load this subscription.", "BB_PLAY_PRODUCT_UNAVAILABLE"); }
    }

    private static boolean containsPurchased(JSArray purchases) {
        for (int index = 0; index < purchases.length(); index++) {
            JSONObject purchase = purchases.optJSONObject(index);
            if (purchase != null && "purchased".equals(purchase.optString("state"))) return true;
        }
        return false;
    }

    private void completeBillingResult(PurchaseFlow candidate, BillingResult result) {
        if (flow != candidate) return;
        if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            resolve(candidate, "cancelled", new JSArray());
        } else if (result.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            try {
                billing.queryPurchasesAsync(purchasesQuery(), (queried, purchases) -> main.post(() -> {
                    if (flow != candidate || destroyed) return;
                    JSArray owned = purchasePayloads(purchases, candidate.productId, null);
                    if (queried.getResponseCode() == BillingClient.BillingResponseCode.OK && owned.length() > 0) {
                        resolve(candidate, containsPurchased(owned) ? "alreadyOwned" : "pending", owned);
                    } else reject(candidate, "This subscription is already owned. Restore purchases to check its BasketBoss account.", "BB_PLAY_PURCHASE_FAILED");
                }));
            } catch (RuntimeException unavailable) { reject(candidate, "Restore purchases to check the existing subscription.", "BB_PLAY_PURCHASE_FAILED"); }
        } else {
            reject(candidate, "Google Play could not complete this purchase. Refresh membership before trying again.", "BB_PLAY_PURCHASE_FAILED");
        }
    }

    private void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (destroyed) return;
        int code = result.getResponseCode();
        JSObject event = envelope(code == BillingClient.BillingResponseCode.OK ? purchasePayloads(purchases, null, null) : new JSArray());
        event.put("billingResponseCode", code); notifyListeners("purchasesUpdated", event, true);
        PurchaseFlow candidate = flow;
        if (candidate == null || !candidate.launched) return;
        if (code != BillingClient.BillingResponseCode.OK) { completeBillingResult(candidate, result); return; }
        // An unrelated/replayed purchase update cannot complete another account's sheet.
        JSArray matching = purchasePayloads(purchases, candidate.productId, candidate.accountId);
        if (matching.length() > 0) resolve(candidate, containsPurchased(matching) ? "purchased" : "pending", matching);
    }

    @PluginMethod public void getPurchases(PluginCall call) {
        main.post(() -> {
            if (closed(call)) return;
            Request request = new Request(call, REQUEST_TIMEOUT_MS);
            PurchaseFlow interrupted = flow;
            withClient(request, () -> {
                try {
                    billing.queryPurchasesAsync(purchasesQuery(), (result, purchases) -> main.post(() -> {
                        if (!request.current()) return;
                        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { request.reject("Google Play could not restore purchases. Try again when connected.", "BB_PLAY_UNAVAILABLE"); return; }
                        request.resolve(envelope(purchasePayloads(purchases, null, null)));
                        if (interrupted != null && !interrupted.request.active) retire(interrupted);
                    }));
                } catch (RuntimeException unavailable) { request.reject("Google Play could not restore purchases.", "BB_PLAY_UNAVAILABLE"); }
            });
        });
    }

    private void recoverPurchases() {
        if (destroyed || billing == null || !billing.isReady() || recoveryRunning) return;
        recoveryRunning = true;
        long generation = ++recoveryGeneration;
        Runnable timeout = () -> { if (generation == recoveryGeneration) { recoveryGeneration++; recoveryRunning = false; } };
        main.postDelayed(timeout, REQUEST_TIMEOUT_MS);
        try {
            billing.queryPurchasesAsync(purchasesQuery(), (result, purchases) -> main.post(() -> {
                if (generation != recoveryGeneration) return;
                main.removeCallbacks(timeout); recoveryRunning = false;
                if (destroyed || result.getResponseCode() != BillingClient.BillingResponseCode.OK) return;
                JSObject event = envelope(purchasePayloads(purchases, null, null)); event.put("billingResponseCode", result.getResponseCode());
                notifyListeners("purchasesUpdated", event, true);
            }));
        } catch (RuntimeException unavailable) { main.removeCallbacks(timeout); recoveryRunning = false; }
    }

    @PluginMethod public void manageSubscriptions(PluginCall call) {
        main.post(() -> {
            if (closed(call)) return;
            String productId = call.getString("productId");
            if (call.getData().has("productId") && !GooglePlayPurchasePolicy.productId(productId)) {
                call.reject("A valid subscription product is required.", "BB_PLAY_INVALID_ARGUMENT"); return;
            }
            Activity activity = getActivity();
            if (activity == null || activity.isFinishing() || activity.isDestroyed()) { call.reject("Reopen BasketBoss to manage your subscription.", "BB_PLAY_UNAVAILABLE"); return; }
            Uri.Builder addressBuilder = Uri.parse("https://play.google.com/store/account/subscriptions").buildUpon()
                .appendQueryParameter("package", PACKAGE_NAME);
            if (productId != null) addressBuilder.appendQueryParameter("sku", productId);
            Uri address = addressBuilder.build();
            Intent intent = new Intent(Intent.ACTION_VIEW, address).setPackage("com.android.vending");
            try {
                try { activity.startActivity(intent); }
                catch (ActivityNotFoundException missingStore) { activity.startActivity(new Intent(Intent.ACTION_VIEW, address)); }
                JSObject result = new JSObject(); result.put("opened", true); call.resolve(result);
            } catch (RuntimeException unavailable) { call.reject("Google Play subscription settings could not be opened.", "BB_PLAY_UNAVAILABLE"); }
        });
    }

    @Override protected void handleOnResume() {
        main.post(() -> { if (!destroyed) { connect(); recoverPurchases(); } });
    }

    @Override protected void handleOnDestroy() {
        main.post(() -> {
            destroyed = true;
            for (Request request : new ArrayList<>(requests)) request.reject("The app closed before Google Play replied. Restore purchases after reopening.", "BB_PLAY_UNAVAILABLE");
            waiting.clear(); if (flow != null) retire(flow);
            main.removeCallbacksAndMessages(null);
            if (billing != null) { billing.endConnection(); billing = null; }
        });
    }
}
