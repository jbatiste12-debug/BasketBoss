import Foundation
import XCTest
@testable import App

final class BasketBossStoreKitTests: XCTestCase {
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
        var required = ["productsLoaded", "purchaseVerified", "accountTokenPreserved",
                        "unfinishedBeforeServerAck", "earlyFinishRejected", "restoreVerified",
                        "duplicatePurchasePrevented", "wrongAccountRejected",
                        "finishedAfterAcknowledgement", "pendingDoesNotGrantAccess", "pendingApprovalDelivered"]
        if #available(iOS 17.0, *) { required.append("cancellationPreserved") }
        for key in required { XCTAssertEqual(report[key] as? Bool, true, key + ": " + detail) }
    }
}
