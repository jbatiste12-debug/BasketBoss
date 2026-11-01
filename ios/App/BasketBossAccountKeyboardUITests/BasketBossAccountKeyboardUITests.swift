import XCTest

// Real UIKit keyboard + WKWebView accessibility frames. Empty input fields,
// no account credentials, no sign-in submission and no production API writes.
final class BasketBossAccountKeyboardUITests: XCTestCase {
    @MainActor private func waitFor(_ description: String, timeout: TimeInterval = 8, _ condition: @escaping () -> Bool) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed, description)
    }

    @MainActor private func assertAccountWithKeyboard(password: Bool) throws {
        executionTimeAllowance = 90
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "uk.co.basketboss.app")
        app.launchArguments = ["--bb-native-account-keyboard-smoke"]
        app.launch()
        defer {
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = password ? "Password focus — final screen" : "Email focus — final screen"
            attachment.lifetime = .keepAlways
            add(attachment)
            app.terminate()
        }
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 25), "The native WKWebView must load.")
        let close = app.buttons.matching(identifier: "Close account").firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 25), "The account dialog must open.")
        let field = password ? app.secureTextFields.firstMatch : app.textFields.matching(NSPredicate(format: "label == %@ OR placeholderValue == %@", "Email", "you@example.com")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 8), "The signed-out account input must exist.")
        // Numeric accessibility diagnostics only: no input values, credentials,
        // screenshots or recordings are copied into the failure message.
        let targetBeforeTap = "target=\(password ? "password" : "email"), hittable=\(field.isHittable), field=\(field.frame), web=\(web.frame)"
        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 8), "A real software keyboard is required; a hardware-keyboard-only run cannot pass. Before tap: \(targetBeforeTap). After tap: field=\(field.frame), web=\(web.frame).")
        waitFor("The focused input must remain above the keyboard.") {
            field.isHittable && field.frame.minY >= web.frame.minY - 1 && field.frame.maxY <= keyboard.frame.minY + 1
        }
        waitFor("Close account must remain reachable with the keyboard open.") {
            close.isHittable && close.frame.minY >= web.frame.minY - 1 && close.frame.maxY <= keyboard.frame.minY + 1
        }
        for label in ["Plan my week", "Discover", "What Have I Already Got?", "Make My Shopping List", "Open Make a Meal"] {
            for item in app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex {
                XCTAssertFalse(item.isHittable, "The background dock must not remain interactive: " + label)
            }
        }
        let signIn = app.buttons.matching(identifier: "Sign in").firstMatch
        XCTAssertTrue(signIn.exists, "The existing Sign in action must remain present.")
        for _ in 0..<5 {
            if signIn.isHittable && signIn.frame.maxY <= keyboard.frame.minY + 1 { break }
            // Swipe only the visible account area, never the keyboard or the
            // background page. The action may be inside the card's scroll area.
            let top = max(web.frame.minY, close.frame.maxY + 8)
            let bottom = keyboard.frame.minY - 18
            XCTAssertGreaterThan(bottom - top, 35, "There must be visible space to scroll the form.")
            let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            let start = origin.withOffset(CGVector(dx: app.frame.midX, dy: bottom))
            let end = origin.withOffset(CGVector(dx: app.frame.midX, dy: top + 10))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertTrue(keyboard.exists, "Reaching Sign in must not require dismissing the keyboard.")
        XCTAssertTrue(signIn.isHittable, "Sign in must be reachable within the account card.")
        XCTAssertGreaterThanOrEqual(signIn.frame.minY, web.frame.minY - 1)
        XCTAssertLessThanOrEqual(signIn.frame.maxY, keyboard.frame.minY + 1, "Sign in must fit above the real keyboard.")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = password ? "Password keyboard — account actions reachable" : "Email keyboard — account actions reachable"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertTrue(close.isHittable, "Close must remain reachable after scrolling the form.")
        close.tap()
        waitFor("Closing the account must dismiss the keyboard.") { !keyboard.exists }
        waitFor("Closing the account must restore the Plan dock.") { app.buttons.matching(identifier: "Plan my week").firstMatch.isHittable }
    }

    @MainActor func testEmailKeyboardKeepsAccountReachable() throws {
        try assertAccountWithKeyboard(password: false)
    }

    @MainActor func testPasswordKeyboardKeepsAccountReachable() throws {
        try assertAccountWithKeyboard(password: true)
    }
}
