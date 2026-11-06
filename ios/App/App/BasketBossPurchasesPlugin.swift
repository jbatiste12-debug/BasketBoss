import Foundation
import UIKit
import StoreKit
import Capacitor
#if DEBUG && targetEnvironment(simulator)
import StoreKitTest
#endif

// StoreKit only proves Apple transactions. The BasketBoss server remains the
// authority for account ownership, Premium access and subscription lifecycle.
@objc(BasketBossPurchasesPlugin)
public final class BasketBossPurchasesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BasketBossPurchasesPlugin"
    public let jsName = "BasketBossPurchases"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAppTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingTransactions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise)
    ]
    private static let productIDs: Set<String> = [
        "uk.co.basketboss.premium.monthly", "uk.co.basketboss.premium.annual"
    ]
    // Mutable state is touched only by MainActor tasks. No entitlement is stored
    // in UserDefaults and no bearer token is ever accepted by this native bridge.
    private var products: [String: Product] = [:]
    private var unfinished: [String: Transaction] = [:]
    private var unfinishedPayloads: [String: JSObject] = [:]
    private var interactiveOperation = false
    private var updatesTask: Task<Void, Never>?
    private var startupTask: Task<Void, Never>?
    private var purchaseIntentsTask: Task<Void, Never>?

    #if DEBUG && targetEnvironment(simulator)
    // Internal to the hosted XCTest bundle; absent from Release and the JS API.
    @MainActor func runHostedStoreKitVerification() async {
        await runLocalStoreKitSmoke()
    }
    #endif

    override public func load() {
        if #available(iOS 16.4, *) {
            purchaseIntentsTask = Task { @MainActor [weak self] in
                for await intent in PurchaseIntent.intents {
                    guard !Task.isCancelled, let self = self else { break }
                    let product = intent.product
                    guard Self.productIDs.contains(product.id), product.type == .autoRenewable else { continue }
                    self.products[product.id] = product
                    // An external intent is only a request to show our account
                    // flow. It never opens payment before confirmed sign-in and
                    // a fresh server purchase-context/Founder reservation.
                    self.notifyListeners("purchaseIntentReceived", data: ["productId": product.id], retainUntilConsumed: true)
                }
            }
        }
        updatesTask = Task { @MainActor [weak self] in
            for await verification in Transaction.updates {
                guard !Task.isCancelled else { break }
                guard let self = self else { break }
                do {
                    let payload = try self.remember(verification)
                    self.notifyListeners("transactionsUpdated", data: ["transactions": [payload]], retainUntilConsumed: true)
                } catch {
                    // A locally unverified result cannot unlock access or be
                    // delivered as a successful transaction to JavaScript.
                    self.notifyListeners("transactionsUpdated", data: ["transactions": [], "error": "BB_APPLE_UNVERIFIED"], retainUntilConsumed: true)
                }
            }
        }
        startupTask = Task { @MainActor [weak self] in
            guard let self = self else { return }
            #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--bb-native-iap-smoke") {
                await self.runLocalStoreKitSmoke()
                return
            }
            #endif
            let payloads = await self.collectTransactions()
            guard !Task.isCancelled, !payloads.isEmpty else { return }
            self.notifyListeners("transactionsUpdated", data: ["transactions": payloads], retainUntilConsumed: true)
        }
    }

    deinit {
        updatesTask?.cancel()
        startupTask?.cancel()
        purchaseIntentsTask?.cancel()
    }

    private enum PurchaseBridgeError: Error {
        case unsupportedProduct, productUnavailable, productLookupFailed, unverified, wrongAccount, pendingTransaction, missingTransaction
    }

    @MainActor private func remember(_ verification: VerificationResult<Transaction>) throws -> JSObject {
        guard case .verified(let transaction) = verification else { throw PurchaseBridgeError.unverified }
        guard Self.productIDs.contains(transaction.productID), transaction.productType == .autoRenewable else {
            throw PurchaseBridgeError.unsupportedProduct
        }
        let id = String(transaction.id)
        var payload: JSObject = [
            "id": id,
            "originalId": String(transaction.originalID),
            "productId": transaction.productID,
            "signedTransactionInfo": verification.jwsRepresentation,
            "environment": transaction.environment.rawValue
        ]
        if let token = transaction.appAccountToken { payload["appAccountToken"] = token.uuidString.lowercased() }
        if let expires = transaction.expirationDate { payload["expiresAt"] = expires.timeIntervalSince1970 * 1000 }
        if let revoked = transaction.revocationDate { payload["revokedAt"] = revoked.timeIntervalSince1970 * 1000 }
        unfinished[id] = transaction
        unfinishedPayloads[id] = payload
        return payload
    }

    @MainActor private func collectTransactions() async -> [JSObject] {
        var result: [String: JSObject] = [:]
        // Include queued renewals/refunds as well as current entitlements. A
        // refunded subscription can be absent from currentEntitlements while its
        // verified update still needs to reach the BasketBoss server.
        for await verification in Transaction.unfinished {
            if Task.isCancelled { return [] }
            if let payload = try? remember(verification), let id = payload["id"] as? String { result[id] = payload }
        }
        for await verification in Transaction.currentEntitlements {
            if Task.isCancelled { return [] }
            if let payload = try? remember(verification), let id = payload["id"] as? String { result[id] = payload }
        }
        return result.keys.sorted().compactMap { result[$0] }
    }

    @MainActor private func product(_ id: String) async throws -> Product {
        guard Self.productIDs.contains(id) else { throw PurchaseBridgeError.unsupportedProduct }
        if let existing = products[id] { return existing }
        let received: [Product]
        do { received = try await Product.products(for: [id]) }
        catch { throw PurchaseBridgeError.productLookupFailed }
        guard let found = received.first(where: { $0.id == id && $0.type == .autoRenewable }) else {
            throw PurchaseBridgeError.productUnavailable
        }
        products[id] = found
        return found
    }

    private static func productPayload(_ product: Product) -> JSObject {
        var payload: JSObject = [
            "id": product.id, "displayName": product.displayName,
            "description": product.description, "displayPrice": product.displayPrice,
            "price": NSDecimalNumber(decimal: product.price).stringValue,
            "currencyCode": product.priceFormatStyle.currencyCode
        ]
        if let period = product.subscription?.subscriptionPeriod {
            let unit: String
            switch period.unit {
            case .day: unit = "day"
            case .week: unit = "week"
            case .month: unit = "month"
            case .year: unit = "year"
            @unknown default: unit = "unknown"
            }
            payload["subscriptionPeriod"] = ["unit": unit, "value": period.value]
        }
        return payload
    }

    @objc public func getProducts(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self = self else { call.reject("Apple purchases are unavailable.", "BB_APPLE_UNAVAILABLE"); return }
            let requested = call.getArray("productIds", String.self) ?? Array(Self.productIDs)
            guard !requested.isEmpty, requested.count <= Self.productIDs.count,
                  Set(requested).count == requested.count,
                  requested.allSatisfy({ Self.productIDs.contains($0) }) else {
                call.reject("Unsupported subscription product.", "BB_APPLE_PRODUCT"); return
            }
            do {
                let received = try await Product.products(for: requested)
                let safe = received.filter { Self.productIDs.contains($0.id) && $0.type == .autoRenewable }
                for product in safe { self.products[product.id] = product }
                call.resolve(["products": safe.sorted { $0.id < $1.id }.map(Self.productPayload)])
            } catch { call.reject("Apple subscription prices could not be loaded. Try again later.", "BB_APPLE_PRODUCTS", error) }
        }
    }

    @objc public func purchase(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self = self else { call.reject("Apple purchases are unavailable.", "BB_APPLE_UNAVAILABLE"); return }
            guard !self.interactiveOperation else { call.reject("Another Apple purchase or restore is in progress.", "BB_APPLE_BUSY"); return }
            guard let id = call.getString("productId"), Self.productIDs.contains(id),
                  let tokenText = call.getString("appAccountToken"), let token = UUID(uuidString: tokenText),
                  token.uuidString != "00000000-0000-0000-0000-000000000000" else {
                call.reject("A supported product and verified BasketBoss account token are required.", "BB_APPLE_ARGUMENTS"); return
            }
            self.interactiveOperation = true
            defer { self.interactiveOperation = false }
            do {
                // Prevent a second purchase when the Apple Account already owns
                // an active subscription, including one linked to a different
                // BasketBoss account. Never relink it or start a duplicate sale.
                for await verification in Transaction.currentEntitlements {
                    guard case .verified(let existing) = verification,
                          Self.productIDs.contains(existing.productID), existing.revocationDate == nil,
                          existing.expirationDate.map({ $0 > Date() }) == true else { continue }
                    _ = try self.remember(verification)
                    if existing.appAccountToken != token { throw PurchaseBridgeError.wrongAccount }
                    call.resolve(["status": "alreadyOwned", "transaction": try self.remember(verification)])
                    return
                }
                let subscription = try await self.product(id)
                let result = try await subscription.purchase(options: [.appAccountToken(token)])
                switch result {
                case .success(let verification):
                    let payload = try self.remember(verification)
                    call.resolve(["status": "purchased", "transaction": payload])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    // Ask to Buy and interrupted purchases are completed later
                    // through Transaction.updates; there is no local access grant.
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.reject("Apple returned an unsupported purchase result.", "BB_APPLE_RESULT")
                }
            } catch StoreKitError.userCancelled {
                call.resolve(["status": "cancelled"])
            } catch PurchaseBridgeError.wrongAccount {
                call.reject("This Apple subscription belongs to another BasketBoss account. Sign in to its original account or contact support.", "BB_APPLE_ACCOUNT_MISMATCH")
            } catch PurchaseBridgeError.unverified {
                call.reject("Apple could not verify this purchase. Premium has not been activated.", "BB_APPLE_UNVERIFIED")
            } catch PurchaseBridgeError.productUnavailable {
                call.reject("Apple did not return this subscription, so its purchase sheet could not be opened. Refresh prices or try again later.", "BB_APPLE_PRODUCT_UNAVAILABLE")
            } catch PurchaseBridgeError.productLookupFailed {
                call.reject("Apple could not load this subscription, so its purchase sheet could not be opened. Check your App Store connection, then try again.", "BB_APPLE_PRODUCT_LOOKUP")
            } catch { call.reject("The Apple purchase could not be completed. Please try again.", "BB_APPLE_PURCHASE", error) }
        }
    }

    @objc public func restorePurchases(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self = self else { call.reject("Apple purchases are unavailable.", "BB_APPLE_UNAVAILABLE"); return }
            guard !self.interactiveOperation else { call.reject("Another Apple purchase or restore is in progress.", "BB_APPLE_BUSY"); return }
            self.interactiveOperation = true
            defer { self.interactiveOperation = false }
            do {
                try await AppStore.sync()
                call.resolve(["transactions": await self.collectTransactions()])
            } catch { call.reject("Apple purchases could not be restored. Check your Apple Account and try again.", "BB_APPLE_RESTORE", error) }
        }
    }

    @objc public func getAppTransaction(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard #available(iOS 16.0, *) else {
                call.reject("TestFlight beta access requires iOS 16 or later.", "BB_APPLE_APP_TRANSACTION_UNSUPPORTED"); return
            }
            do {
                // This is proof of the app download, without an in-app purchase.
                // Never refresh automatically: refresh() can prompt for App Store
                // authentication. The server verifies the JWS and grants access.
                let verification = try await AppTransaction.shared
                guard case .verified(let transaction) = verification else {
                    call.reject("Apple could not verify this app download. Try again from the TestFlight app.", "BB_APPLE_APP_TRANSACTION_UNVERIFIED"); return
                }
                guard transaction.environment == .sandbox else {
                    call.reject("Beta access is available only in the TestFlight sandbox app.", "BB_APPLE_APP_TRANSACTION_ENVIRONMENT"); return
                }
                call.resolve(["signedAppTransaction": verification.jwsRepresentation])
            } catch {
                call.reject("Apple could not check this app download. Check your connection and App Store sign-in, then try again.", "BB_APPLE_APP_TRANSACTION_UNAVAILABLE", error)
            }
        }
    }

    @objc public func getPendingTransactions(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self = self else { call.reject("Apple purchases are unavailable.", "BB_APPLE_UNAVAILABLE"); return }
            call.resolve(["transactions": await self.collectTransactions()])
        }
    }

    @objc public func finishTransaction(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self = self else { call.reject("Apple purchases are unavailable.", "BB_APPLE_UNAVAILABLE"); return }
            // This guard documents the required delivery order. It does not
            // grant Premium: the backend has to verify ownership and current
            // subscription state before the JS controller acknowledges delivery.
            guard call.getBool("serverVerified") == true,
                  let id = call.getString("transactionId"), !id.isEmpty else {
                call.reject("Verify the transaction with BasketBoss before acknowledging it.", "BB_APPLE_SERVER_ACK"); return
            }
            if self.unfinished[id] == nil { _ = await self.collectTransactions() }
            guard let transaction = self.unfinished[id] else {
                call.reject("The transaction is not available to acknowledge.", "BB_APPLE_TRANSACTION"); return
            }
            await transaction.finish()
            self.unfinished.removeValue(forKey: id)
            self.unfinishedPayloads.removeValue(forKey: id)
            call.resolve(["ok": true, "transactionId": id])
        }
    }

    @objc public func manageSubscriptions(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self = self else { call.reject("Apple subscription management is unavailable.", "BB_APPLE_UNAVAILABLE"); return }
            guard !self.interactiveOperation else { call.reject("Another Apple purchase or restore is in progress.", "BB_APPLE_BUSY"); return }
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                call.reject("Open BasketBoss before managing Apple subscriptions.", "BB_APPLE_SCENE"); return
            }
            self.interactiveOperation = true
            defer { self.interactiveOperation = false }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve(["ok": true])
            } catch { call.reject("Apple subscription management could not be opened.", "BB_APPLE_MANAGE", error) }
        }
    }
}

#if DEBUG && targetEnvironment(simulator)
// The local fixture is copied only to Debug simulator builds. This path is
// opt-in, performs no network/backend requests and never grants Premium.
private extension BasketBossPurchasesPlugin {
    struct LocalSmokeFailure: Error { let code: String }

    @MainActor func smokeCall(_ method: String, options: JSObject = [:], invoke: (CAPPluginCall) -> Void) async throws -> PluginCallResultData {
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<PluginCallResultData, Error>) in
            let success: CAPPluginCallSuccessHandler = { (result: CAPPluginCallResult?, _: CAPPluginCall?) in
                let payload: PluginCallResultData = result?.data ?? [:]
                continuation.resume(returning: payload)
            }
            let failure: CAPPluginCallErrorHandler = { (error: CAPPluginCallError?) in
                let code: String = error?.code ?? "bridge_error"
                continuation.resume(throwing: LocalSmokeFailure(code: code))
            }
            let pendingCall: CAPPluginCall? = CAPPluginCall(callbackId: "local-storekit-smoke", methodName: method,
                                                           options: options, success: success, error: failure)
            guard let call = pendingCall else {
                continuation.resume(throwing: LocalSmokeFailure(code: "call_unavailable")); return
            }
            invoke(call)
        }
    }

    @MainActor func writeSmokeReport(_ report: JSObject) {
        guard let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
              let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? data.write(to: folder.appendingPathComponent("bb-native-iap-smoke.json"), options: .atomic)
    }

    @MainActor func resetSmokeScenario(_ session: SKTestSession) async throws {
        // Finishing a transaction does not expire its subscription. Isolate
        // scenarios and refresh StoreKit's receipt before checking another
        // result, otherwise the real duplicate-purchase guard can correctly
        // return alreadyOwned before a simulated cancellation is exercised.
        await Task.detached {
            session.resetToDefaultState()
            session.disableDialogs = true
            session.clearTransactions()
        }.value
        products.removeAll()
        unfinished.removeAll()
        unfinishedPayloads.removeAll()
        try await AppStore.sync()
        for _ in 0..<50 {
            var active = false
            for await verification in Transaction.currentEntitlements {
                if case .verified(let transaction) = verification,
                   Self.productIDs.contains(transaction.productID), transaction.revocationDate == nil,
                   transaction.expirationDate.map({ $0 > Date() }) == true { active = true }
            }
            if !active { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw LocalSmokeFailure(code: "fixture_entitlements_not_cleared")
    }

    @MainActor func runLocalStoreKitSmoke() async {
        var report: JSObject = ["complete": false, "passed": false, "localStoreKit": true,
                                "productionBillingTested": false, "backendPremiumGranted": false]
        var stage = "fixture"
        var activeSession: SKTestSession?
        report["stage"] = stage
        writeSmokeReport(report)
        do {
            // Test-session controls make synchronous XPC calls. Keep the app's
            // main run loop available while StoreKit configures its test server.
            stage = "fixture_init"
            report["stage"] = stage; writeSmokeReport(report)
            let session = try await Task.detached(priority: .userInitiated) {
                try SKTestSession(configurationFileNamed: "BasketBossPremium")
            }.value
            activeSession = session
            stage = "fixture_reset"
            report["stage"] = stage; writeSmokeReport(report)
            await Task.detached { session.resetToDefaultState() }.value
            stage = "fixture_dialogs"
            report["stage"] = stage; writeSmokeReport(report)
            await Task.detached { session.disableDialogs = true }.value
            stage = "fixture_clear"
            report["stage"] = stage; writeSmokeReport(report)
            await Task.detached { session.clearTransactions() }.value
            let token = UUID()
            stage = "products"
            report["stage"] = stage; writeSmokeReport(report)
            let catalog = try await smokeCall("getProducts") { self.getProducts($0) }
            let received = catalog["products"] as? [JSObject] ?? []
            guard received.count == 2,
                  received.contains(where: { ($0["id"] as? String) == "uk.co.basketboss.premium.monthly" && ($0["price"] as? String) == "4.99" }),
                  received.contains(where: { ($0["id"] as? String) == "uk.co.basketboss.premium.annual" && ($0["price"] as? String) == "39.99" }) else {
                throw LocalSmokeFailure(code: "catalog_invalid")
            }
            report["productsLoaded"] = true

            // Test cancellation before creating any active subscription. The
            // production ownership check must never be weakened just to make a
            // later cancellation fixture bypass an already-owned subscription.
            if #available(iOS 17.0, *) {
                stage = "cancel_reset"
                report["stage"] = stage; writeSmokeReport(report)
                try await resetSmokeScenario(session)
                stage = "cancel"
                report["stage"] = stage; writeSmokeReport(report)
                try await session.setSimulatedError(.generic(.userCancelled), forAPI: .purchase)
                let cancelled = try await smokeCall("purchase", options: ["productId": "uk.co.basketboss.premium.monthly", "appAccountToken": token.uuidString]) { self.purchase($0) }
                let cancellationResult = cancelled["status"] as? String ?? "missing"
                report["cancellationResult"] = ["cancelled", "pending", "purchased", "alreadyOwned"].contains(cancellationResult) ? cancellationResult : "unexpected"
                guard cancellationResult == "cancelled" else { throw LocalSmokeFailure(code: "cancel_not_preserved") }
                guard cancelled["transaction"] == nil else { throw LocalSmokeFailure(code: "cancel_returned_transaction") }
                guard !interactiveOperation else { throw LocalSmokeFailure(code: "cancel_busy_not_released") }
                report["cancellationPreserved"] = true
                report["cancellationHasNoTransaction"] = true
                report["cancellationReleasesBusy"] = true
            }
            stage = "purchase_reset"
            report["stage"] = stage; writeSmokeReport(report)
            try await resetSmokeScenario(session)
            let purchaseStartsWithoutCachedProduct = products.isEmpty
            stage = "purchase"
            report["stage"] = stage; writeSmokeReport(report)
            let purchase = try await smokeCall("purchase", options: ["productId": "uk.co.basketboss.premium.monthly", "appAccountToken": token.uuidString]) { self.purchase($0) }
            guard purchase["status"] as? String == "purchased", let transaction = purchase["transaction"] as? JSObject,
                  let id = transaction["id"] as? String,
                  transaction["appAccountToken"] as? String == token.uuidString.lowercased(),
                  transaction["environment"] as? String == "Xcode",
                  !(transaction["signedTransactionInfo"] as? String ?? "").isEmpty else {
                throw LocalSmokeFailure(code: "purchase_invalid")
            }
            report["purchaseVerified"] = true
            report["productIdRetryVerified"] = purchaseStartsWithoutCachedProduct
            report["accountTokenPreserved"] = true
            var queued = false
            for await result in Transaction.unfinished {
                if case .verified(let item) = result, String(item.id) == id { queued = true }
            }
            guard queued else { throw LocalSmokeFailure(code: "finished_before_server_ack") }
            report["unfinishedBeforeServerAck"] = true
            stage = "ack_guard"
            report["stage"] = stage; writeSmokeReport(report)
            do {
                _ = try await smokeCall("finishTransaction", options: ["transactionId": id]) { self.finishTransaction($0) }
                throw LocalSmokeFailure(code: "unverified_finish_accepted")
            } catch let error as LocalSmokeFailure {
                guard error.code == "BB_APPLE_SERVER_ACK" else { throw error }
            }
            report["earlyFinishRejected"] = true
            stage = "restore"
            report["stage"] = stage; writeSmokeReport(report)
            let restored = try await smokeCall("restorePurchases") { self.restorePurchases($0) }
            let restoredTransactions = restored["transactions"] as? [JSObject] ?? []
            guard restoredTransactions.contains(where: { $0["id"] as? String == id }) else { throw LocalSmokeFailure(code: "restore_missing") }
            report["restoreVerified"] = true
            stage = "duplicate"
            report["stage"] = stage; writeSmokeReport(report)
            let duplicate = try await smokeCall("purchase", options: ["productId": "uk.co.basketboss.premium.annual", "appAccountToken": token.uuidString]) { self.purchase($0) }
            guard duplicate["status"] as? String == "alreadyOwned" else { throw LocalSmokeFailure(code: "duplicate_sale_started") }
            report["duplicatePurchasePrevented"] = true
            stage = "account_mismatch"
            report["stage"] = stage; writeSmokeReport(report)
            do {
                _ = try await smokeCall("purchase", options: ["productId": "uk.co.basketboss.premium.annual", "appAccountToken": UUID().uuidString]) { self.purchase($0) }
                throw LocalSmokeFailure(code: "wrong_account_accepted")
            } catch let error as LocalSmokeFailure {
                guard error.code == "BB_APPLE_ACCOUNT_MISMATCH" else { throw error }
            }
            report["wrongAccountRejected"] = true
            stage = "finish"
            report["stage"] = stage; writeSmokeReport(report)
            _ = try await smokeCall("finishTransaction", options: ["transactionId": id, "serverVerified": true]) { self.finishTransaction($0) }
            var stillQueued = false
            for await result in Transaction.unfinished {
                if case .verified(let item) = result, String(item.id) == id { stillQueued = true }
            }
            guard !stillQueued else { throw LocalSmokeFailure(code: "finish_not_applied") }
            report["finishedAfterAcknowledgement"] = true
            stage = "pending_reset"
            report["stage"] = stage; writeSmokeReport(report)
            try await resetSmokeScenario(session)
            stage = "pending"
            report["stage"] = stage; writeSmokeReport(report)
            await Task.detached { session.askToBuyEnabled = true }.value
            let pending = try await smokeCall("purchase", options: ["productId": "uk.co.basketboss.premium.annual", "appAccountToken": token.uuidString]) { self.purchase($0) }
            guard pending["status"] as? String == "pending" else { throw LocalSmokeFailure(code: "pending_not_preserved") }
            report["pendingDoesNotGrantAccess"] = true
            let waitingApproved = try await Task.detached {
                guard let waiting = session.allTransactions().first(where: { $0.pendingAskToBuyConfirmation }) else { return false }
                try session.approveAskToBuyTransaction(identifier: waiting.identifier)
                return true
            }.value
            guard waitingApproved else { throw LocalSmokeFailure(code: "ask_to_buy_missing") }
            var approved = false
            for _ in 0..<50 {
                let transactions = await collectTransactions()
                approved = transactions.contains(where: { $0["productId"] as? String == "uk.co.basketboss.premium.annual" && $0["appAccountToken"] as? String == token.uuidString.lowercased() })
                if approved { break }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            guard approved else { throw LocalSmokeFailure(code: "ask_to_buy_approval_missing") }
            report["pendingApprovalDelivered"] = true
            stage = "cleanup"
            report["stage"] = stage; writeSmokeReport(report)
            await Task.detached { session.clearTransactions(); session.resetToDefaultState() }.value
            activeSession = nil
            report["complete"] = true
            report["passed"] = true
            report["stage"] = "complete"
        } catch {
            report["complete"] = true
            report["passed"] = false
            report["stage"] = stage
            report["error"] = (error as? LocalSmokeFailure)?.code ?? String(describing: type(of: error))
        }
        writeSmokeReport(report)
        if let session = activeSession {
            // A failed test reports immediately; cleanup must not hide its
            // failure behind another synchronous StoreKit control operation.
            Task.detached { session.clearTransactions(); session.resetToDefaultState() }
        }
    }
}
#endif
