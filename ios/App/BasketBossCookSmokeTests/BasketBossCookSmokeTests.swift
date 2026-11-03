import Foundation
import XCTest

// XCTest starts the real App host with --bb-native-cook-smoke. The existing
// Debug-only WebView QA runs unchanged; no separate or shortened UI is used.
final class BasketBossCookSmokeTests: XCTestCase {
    @MainActor func testCookNavigationIngredientsVoiceAndDataRetention() async throws {
        executionTimeAllowance = 180
        continueAfterFailure = false
        let documents = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
        let file = documents.appendingPathComponent("bb-native-cook-smoke.json")
        let deadline = Date().addingTimeInterval(120)
        var latest: [String: Any]?
        while Date() < deadline {
            if let data = try? Data(contentsOf: file),
               let report = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                latest = report
                if report["complete"] as? Bool == true { break }
            }
            // Yield the main actor so WKWebView, navigation and speech callbacks
            // continue. Blocking XCTest waits here would prevent the test itself.
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        let report = try XCTUnwrap(latest, "The actual App host must produce its Cook report.")
        let detail = String(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), encoding: .utf8) ?? "Missing Cook report"
        XCTAssertEqual(report["complete"] as? Bool, true, detail)
        XCTAssertEqual(report["passed"] as? Bool, true, detail)
        XCTAssertEqual(report["legacyVisible"] as? Bool, false, detail)
        let required = ["nativeOrigin", "cookMounted", "cookReady", "navPresent", "navVisible", "navHit",
                        "backToPlan", "dataKept", "mainReady", "startupReady", "ingredientClosed",
                        "ingredientPhoto", "ingredientSaved", "ingredientAutofill", "ingredientExistingKept",
                        "ingredientRestored", "voiceFreeLocked", "voiceManualStart", "voiceNextStep",
                        "voiceTimer", "voiceScaledAmount", "voiceExitStopped", "voiceRestored",
                        "voicePrepAvailable", "voicePrepNarrated", "voicePrepAdvanced", "voiceCookNarrated", "voiceStepNarrated",
                        "mentorAvailable", "mentorRecipeContext", "mentorSpokenQuestion", "mentorTypedQuestion",
                        "mentorFollowupHistory", "mentorPrivateAudio", "mentorAnswerVisible", "mentorNoAutonomousActions",
                        "mentorCancelledAnswer", "mentorInterrupt", "mentorHistoryCleared", "mentorNoDeviceFallback", "mentorGreetingName"]
        for key in required { XCTAssertEqual(report[key] as? Bool, true, key + ": " + detail) }
    }
}
