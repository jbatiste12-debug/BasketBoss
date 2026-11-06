import Foundation
import StoreKit
import Capacitor
import XCTest
@testable import App

final class BasketBossStoreKitTests: XCTestCase {
    private func restoreError(_ domain: String, _ code: Int, underlying: Error? = nil) -> NSError {
        let userInfo = underlying.map { [NSUnderlyingErrorKey: $0] }
        return NSError(domain: domain, code: code, userInfo: userInfo)
    }

    private func restoreResponse(_ error: Error) throws -> (resolved: PluginCallResultData?, rejected: CAPPluginCallError?) {
        var resolved: PluginCallResultData?
        var rejected: CAPPluginCallError?
        let success: CAPPluginCallSuccessHandler = { result, _ in resolved = result?.data }
        let failure: CAPPluginCallErrorHandler = { rejected = $0 }
        let call = try XCTUnwrap(CAPPluginCall(callbackId: "restore-error-test", methodName: "restorePurchases",
                                             options: [:], success: success, error: failure))
        BasketBossPurchasesPlugin.respondToRestoreFailure(error, call: call)
        return (resolved, rejected)
    }

    @MainActor func testCurrentEntitlementsRestoreSkipsSyncAndUnfinishedCollection() async throws {
        var operations: [String] = []
        let result = try await BasketBossPurchasesPlugin.restoreTransactions(
            currentEntitlements: { operations.append("current"); return [["id": "current"]] },
            synchronize: { operations.append("sync"); throw StoreKitError.unknown },
            collectAfterSync: { operations.append("unfinished"); return [["id": "old-unfinished"]] })
        XCTAssertEqual(operations, ["current"])
        XCTAssertEqual(result["restoreSource"] as? String, "currentEntitlements")
        let transactions = try XCTUnwrap(result["transactions"] as? [JSObject])
        XCTAssertEqual(transactions.compactMap { $0["id"] as? String }, ["current"])
    }

    @MainActor func testMissingCurrentEntitlementsSyncBeforeCollectingTransactions() async throws {
        var operations: [String] = []
        let result = try await BasketBossPurchasesPlugin.restoreTransactions(
            currentEntitlements: { operations.append("current"); return [] },
            synchronize: { operations.append("sync") },
            collectAfterSync: { operations.append("collected"); return [["id": "synced"]] })
        XCTAssertEqual(operations, ["current", "sync", "collected"])
        XCTAssertEqual(result["restoreSource"] as? String, "appStoreSync")
        let transactions = try XCTUnwrap(result["transactions"] as? [JSObject])
        XCTAssertEqual(transactions.compactMap { $0["id"] as? String }, ["synced"])
    }

    @MainActor func testMissingCurrentEntitlementsPropagateSyncFailureWithoutCollecting() async {
        var operations: [String] = []
        do {
            _ = try await BasketBossPurchasesPlugin.restoreTransactions(
                currentEntitlements: { operations.append("current"); return [] },
                synchronize: { operations.append("sync"); throw StoreKitError.unknown },
                collectAfterSync: { operations.append("collected"); return [["id": "cached"]] })
            XCTFail("A failed App Store sync must reject restoration")
        } catch {
            guard case .unknown? = error as? StoreKitError else { return XCTFail("Unexpected error: \(type(of: error))") }
        }
        XCTAssertEqual(operations, ["current", "sync"])
    }

    func testCurrentRestoreCandidatesPermitGraceButRequireSupportedUnrevokedSubscriptions() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let future = now.addingTimeInterval(60)
        for productID in ["uk.co.basketboss.premium.monthly", "uk.co.basketboss.premium.annual"] {
            // Membership in the CURRENT stream is the entitlement signal,
            // including billing grace with a past signed transaction expiry.
            for expirationDate in [future, now, now.addingTimeInterval(-1), nil] as [Date?] {
                XCTAssertTrue(BasketBossPurchasesPlugin.isEligibleCurrentRestoreCandidate(
                    productID: productID, productType: .autoRenewable, revocationDate: nil, expirationDate: expirationDate))
            }
        }
        let ineligible: [(String, Product.ProductType, Date?, Date?)] = [
            ("uk.co.basketboss.premium.monthly.extra", .autoRenewable, nil, future),
            ("uk.co.basketboss.premium.founder", .autoRenewable, nil, future),
            ("uk.co.basketboss.premium.monthly", .nonConsumable, nil, future),
            ("uk.co.basketboss.premium.monthly", .nonRenewable, nil, future),
            ("uk.co.basketboss.premium.monthly", .autoRenewable, now, future)
        ]
        for (productID, productType, revoked, expires) in ineligible {
            XCTAssertFalse(BasketBossPurchasesPlugin.isEligibleCurrentRestoreCandidate(
                productID: productID, productType: productType, revocationDate: revoked, expirationDate: expires), productID)
        }
    }

    func testRestoreClassifiesOnlyTypedUnknownWithoutNumericHeuristics() throws {
        let unknown = StoreKitError.unknown
        let native = unknown as NSError
        let diagnostics = ["\(native.domain):\(native.code)"]
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(unknown),
                       .failed(code: "BB_APPLE_RESTORE_UNKNOWN", diagnostics: diagnostics))
        let wrapped = restoreError("ASDErrorDomain", 500, underlying: unknown)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(wrapped),
                       .failed(code: "BB_APPLE_RESTORE_UNKNOWN", diagnostics: ["ASDErrorDomain:500"] + diagnostics))
        let network = restoreError(NSURLErrorDomain, NSURLErrorTimedOut, underlying: unknown)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(network),
                       .failed(code: "BB_APPLE_RESTORE_NETWORK", diagnostics: ["NSURLErrorDomain:-1001"] + diagnostics))
        let cancellation = restoreError(SKErrorDomain, SKError.Code.paymentCancelled.rawValue, underlying: unknown)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(cancellation), .cancelled)
        for domain in ["StoreKit.StoreKitError", "StoreKitErrorDomain", "ASDErrorDomain", "AMSErrorDomain"] {
            XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(restoreError(domain, 2)),
                           .failed(code: "BB_APPLE_RESTORE", diagnostics: ["\(domain):2"]))
        }
        let response = try restoreResponse(unknown)
        XCTAssertNil(response.resolved)
        let rejected = try XCTUnwrap(response.rejected)
        XCTAssertNil(rejected.error)
        XCTAssertEqual(rejected.code, "BB_APPLE_RESTORE_UNKNOWN")
        let data = try XCTUnwrap(rejected.data?["data"] as? [String: Any])
        XCTAssertEqual(data["restoreDiagnostics"] as? [String], diagnostics)
    }

    func testRestoreClassifiesDocumentedCancellationIncludingNestedErrors() {
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(StoreKitError.userCancelled), .cancelled)
        let cancellation = restoreError(SKErrorDomain, SKError.Code.paymentCancelled.rawValue)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(cancellation), .cancelled)
        let wrapped = restoreError("ASDErrorDomain", 500, underlying: cancellation)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(wrapped), .cancelled)
        let wrappedSwiftCancellation = restoreError("AMSErrorDomain", 100, underlying: StoreKitError.userCancelled)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(wrappedSwiftCancellation), .cancelled)
        let networkAndCancellation = restoreError(NSURLErrorDomain, NSURLErrorNotConnectedToInternet, underlying: wrapped)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(networkAndCancellation), .cancelled)
    }

    func testRestoreDoesNotInferCancellationOrAuthenticationFromOtherCodes() {
        let unknown = restoreError("UnknownDomain", SKError.Code.paymentCancelled.rawValue)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(unknown),
                       .failed(code: "BB_APPLE_RESTORE", diagnostics: []))
        let appStoreFailure = restoreError(SKErrorDomain, 0,
                                          underlying: restoreError("ASDErrorDomain", 500, underlying: restoreError("AMSErrorDomain", 100)))
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(appStoreFailure),
                       .failed(code: "BB_APPLE_RESTORE", diagnostics: ["SKErrorDomain:0", "ASDErrorDomain:500", "AMSErrorDomain:100"]))
        let urlCancellation = restoreError(NSURLErrorDomain, NSURLErrorCancelled)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(urlCancellation),
                       .failed(code: "BB_APPLE_RESTORE_NETWORK", diagnostics: ["NSURLErrorDomain:-999"]))
    }

    func testRestoreFindsNestedNetworkFailureBeyondDiagnosticLimit() {
        let network = restoreError(NSURLErrorDomain, NSURLErrorNotConnectedToInternet)
        let cocoa = restoreError(NSCocoaErrorDomain, 2048, underlying: network)
        let media = restoreError("AMSErrorDomain", 100, underlying: cocoa)
        let appStore = restoreError("ASDErrorDomain", 500, underlying: media)
        let outer = restoreError(SKErrorDomain, 0, underlying: appStore)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(outer),
                       .failed(code: "BB_APPLE_RESTORE_NETWORK", diagnostics: ["SKErrorDomain:0", "ASDErrorDomain:500", "AMSErrorDomain:100"]))
    }

    func testRestoreUnpacksTypedStoreKitNetworkErrorsUsingTheirExactBridgeDomain() {
        let error = StoreKitError.networkError(URLError(.notConnectedToInternet))
        let nativeError = error as NSError
        XCTAssertTrue(["StoreKit.StoreKitError", "StoreKitErrorDomain"].contains(nativeError.domain), nativeError.domain)
        let expected = ["\(nativeError.domain):\(nativeError.code)", "NSURLErrorDomain:-1009"]
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(error),
                       .failed(code: "BB_APPLE_RESTORE_NETWORK", diagnostics: expected))
        let wrapped = restoreError("ASDErrorDomain", 500, underlying: error)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(wrapped),
                       .failed(code: "BB_APPLE_RESTORE_NETWORK", diagnostics: ["ASDErrorDomain:500"] + expected))
    }

    func testRestoreUnpacksTypedStoreKitSystemErrorsAndPreservesCancellation() {
        let network = StoreKitError.networkError(URLError(.timedOut))
        let system = StoreKitError.systemError(network)
        let nativeSystem = system as NSError
        let nativeNetwork = network as NSError
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(system),
                       .failed(code: "BB_APPLE_RESTORE_NETWORK", diagnostics: ["\(nativeSystem.domain):\(nativeSystem.code)",
                                                                            "\(nativeNetwork.domain):\(nativeNetwork.code)",
                                                                            "NSURLErrorDomain:-1001"]))
        let cancellation = restoreError(SKErrorDomain, SKError.Code.paymentCancelled.rawValue)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(StoreKitError.systemError(cancellation)), .cancelled)
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(StoreKitError.systemError(StoreKitError.userCancelled)), .cancelled)
    }

    func testRestoreTypedSystemErrorDoesNotExposeItsPrivateAssociatedError() throws {
        let secret = "private-apple-account@example.test"
        let underlying = NSError(domain: secret, code: 500,
                                 userInfo: [NSLocalizedDescriptionKey: secret, "receipt": "private-receipt"])
        let system = StoreKitError.systemError(underlying)
        let nativeSystem = system as NSError
        let response = try restoreResponse(system)
        XCTAssertNil(response.resolved)
        let rejected = try XCTUnwrap(response.rejected)
        XCTAssertNil(rejected.error)
        XCTAssertEqual(rejected.code, "BB_APPLE_RESTORE")
        let data = try XCTUnwrap(rejected.data?["data"] as? [String: Any])
        XCTAssertEqual(data["restoreDiagnostics"] as? [String], ["\(nativeSystem.domain):\(nativeSystem.code)"])
        let serialized = try JSONSerialization.data(withJSONObject: data)
        let json = try XCTUnwrap(String(data: serialized, encoding: .utf8))
        XCTAssertFalse(json.contains(secret))
        XCTAssertFalse(json.contains("private-receipt"))
    }

    func testRestoreDiagnosticsAllowOnlyKnownExactDomains() {
        let domains = [SKErrorDomain, "StoreKitErrorDomain", "StoreKit.StoreKitError", "ASDErrorDomain", "AMSErrorDomain", NSURLErrorDomain, NSCocoaErrorDomain]
        for domain in domains {
            let code = domain == NSURLErrorDomain ? "BB_APPLE_RESTORE_NETWORK" : "BB_APPLE_RESTORE"
            XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(restoreError(domain, -123)),
                           .failed(code: code, diagnostics: ["\(domain):-123"]))
        }
        let privateDomain = "SKErrorDomain:0 private-apple-account@example.test"
        let unknown = restoreError(privateDomain, 500, underlying: restoreError("ASDErrorDomain", 500))
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(unknown),
                       .failed(code: "BB_APPLE_RESTORE", diagnostics: ["ASDErrorDomain:500"]))
    }

    func testRestoreUnderlyingErrorTraversalIsBoundedAndAcyclic() {
        var deep: Error = restoreError(NSURLErrorDomain, NSURLErrorTimedOut)
        for _ in 0..<64 { deep = restoreError("UnknownDomain", 0, underlying: deep) }
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(deep),
                       .failed(code: "BB_APPLE_RESTORE", diagnostics: []))
        let cycle = CyclicRestoreError()
        cycle.underlyingError = cycle
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(cycle),
                       .failed(code: "BB_APPLE_RESTORE", diagnostics: ["ASDErrorDomain:500"]))
        XCTAssertLessThan(cycle.userInfoReadCount, 8)
        cycle.underlyingError = nil

        var typedDeep: Error = restoreError(NSURLErrorDomain, NSURLErrorTimedOut)
        for _ in 0..<64 { typedDeep = StoreKitError.systemError(typedDeep) }
        let typedDomain = (typedDeep as NSError).domain
        let typedCode = (typedDeep as NSError).code
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(typedDeep),
                       .failed(code: "BB_APPLE_RESTORE", diagnostics: Array(repeating: "\(typedDomain):\(typedCode)", count: 3)))

        let typedCycle = CyclicRestoreError()
        let typedWrapper = StoreKitError.systemError(typedCycle)
        typedCycle.underlyingError = typedWrapper
        let nativeWrapper = typedWrapper as NSError
        XCTAssertEqual(BasketBossPurchasesPlugin.classifyRestoreFailure(typedCycle),
                       .failed(code: "BB_APPLE_RESTORE", diagnostics: ["ASDErrorDomain:500", "\(nativeWrapper.domain):\(nativeWrapper.code)"]))
        XCTAssertLessThan(typedCycle.userInfoReadCount, 8)
        typedCycle.underlyingError = nil
    }

    func testRestoreCancellationResolvesWithNoTransactionsOrFailure() throws {
        let response = try restoreResponse(restoreError("ASDErrorDomain", 500,
                                                        underlying: restoreError(SKErrorDomain, SKError.Code.paymentCancelled.rawValue)))
        XCTAssertNil(response.rejected)
        let resolved = try XCTUnwrap(response.resolved)
        XCTAssertEqual(Set(resolved.keys), Set(["status", "transactions"]))
        XCTAssertEqual(resolved["status"] as? String, "cancelled")
        XCTAssertEqual((resolved["transactions"] as? [Any])?.count, 0)
    }

    func testRestoreFailureBridgeContainsOnlySafeDiagnosticDataAndNoRawError() throws {
        let secrets = ["private-apple-account@example.test", "private-receipt", "private-signed-transaction"]
        let underlying = NSError(domain: "AMSErrorDomain", code: 100,
                                 userInfo: [NSLocalizedDescriptionKey: secrets[0], "receipt": secrets[1], "jws": secrets[2]])
        let error = restoreError(SKErrorDomain, 0, underlying: restoreError("ASDErrorDomain", 500, underlying: underlying))
        let response = try restoreResponse(error)
        XCTAssertNil(response.resolved)
        let rejected = try XCTUnwrap(response.rejected)
        XCTAssertNil(rejected.error)
        XCTAssertEqual(rejected.code, "BB_APPLE_RESTORE")
        XCTAssertEqual(rejected.message, "Apple purchases could not be restored. Please try again.")
        let envelope = try XCTUnwrap(rejected.data)
        XCTAssertEqual(Set(envelope.keys), Set(["data"]))
        let data = try XCTUnwrap(envelope["data"] as? [String: Any])
        XCTAssertEqual(Set(data.keys), Set(["restoreDiagnostics"]))
        XCTAssertEqual(data["restoreDiagnostics"] as? [String], ["SKErrorDomain:0", "ASDErrorDomain:500", "AMSErrorDomain:100"])
        let serialized = try JSONSerialization.data(withJSONObject: envelope)
        let json = try XCTUnwrap(String(data: serialized, encoding: .utf8))
        for secret in secrets { XCTAssertFalse(json.contains(secret)) }
    }

    func testRestoreFailureBridgePreservesNetworkCodeAndEmptyUnknownDiagnostics() throws {
        let errors = [(restoreError(NSURLErrorDomain, NSURLErrorTimedOut), "BB_APPLE_RESTORE_NETWORK", ["NSURLErrorDomain:-1001"]),
                      (restoreError("private-apple-account@example.test", 500), "BB_APPLE_RESTORE", [])]
        for (error, code, diagnostics) in errors {
            let response = try restoreResponse(error)
            XCTAssertNil(response.resolved)
            let rejected = try XCTUnwrap(response.rejected)
            XCTAssertNil(rejected.error)
            XCTAssertEqual(rejected.code, code)
            let data = try XCTUnwrap(rejected.data?["data"] as? [String: Any])
            XCTAssertEqual(data["restoreDiagnostics"] as? [String], diagnostics)
        }
    }

    @MainActor func testRealPurchaseBridgeWithLocalStoreKit() async throws {
        executionTimeAllowance = 180
        let plugin = BasketBossPurchasesPlugin()
        await plugin.runHostedStoreKitVerification()
        let documents = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
        let data = try Data(contentsOf: documents.appendingPathComponent("bb-native-iap-smoke.json"))
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let detail = String(data: data, encoding: .utf8) ?? "Missing StoreKit report"
        XCTAssertEqual(report["complete"] as? Bool, true, detail)
        XCTAssertEqual(report["passed"] as? Bool, true, detail)
        XCTAssertEqual(report["localStoreKit"] as? Bool, true, detail)
        XCTAssertEqual(report["productionBillingTested"] as? Bool, false, detail)
        XCTAssertEqual(report["backendPremiumGranted"] as? Bool, false, detail)
        var required = ["productsLoaded", "purchaseVerified", "productIdRetryVerified", "accountTokenPreserved",
                        "unfinishedBeforeServerAck", "earlyFinishRejected", "restoreVerified",
                        "restoreCurrentEntitlementsVerified", "restoreStillUnfinishedBeforeServerAck", "emptyRestoreVerified",
                        "duplicatePurchasePrevented", "wrongAccountRejected",
                        "finishedAfterAcknowledgement", "pendingDoesNotGrantAccess", "pendingApprovalDelivered"]
        XCTAssertEqual(report["restoreSource"] as? String, "currentEntitlements", detail)
        XCTAssertEqual(report["emptyRestoreSource"] as? String, "appStoreSync", detail)
        if #available(iOS 17.0, *) { required.append(contentsOf: ["cancellationPreserved", "cancellationHasNoTransaction", "cancellationReleasesBusy"]) }
        for key in required { XCTAssertEqual(report[key] as? Bool, true, key + ": " + detail) }
    }
}

private final class CyclicRestoreError: NSError, @unchecked Sendable {
    var underlyingError: Error?
    private(set) var userInfoReadCount = 0

    init() { super.init(domain: "ASDErrorDomain", code: 500, userInfo: nil) }
    required init?(coder: NSCoder) { super.init(coder: coder) }

    override var userInfo: [String: Any] {
        userInfoReadCount += 1
        return underlyingError.map { [NSUnderlyingErrorKey: $0] } ?? [:]
    }
}
