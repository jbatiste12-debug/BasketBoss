import XCTest

// Real UIKit keyboard + WKWebView accessibility frames. Empty input fields,
// no account credentials, no sign-in submission and no production API writes.
final class BasketBossAccountKeyboardUITests: XCTestCase {
    @MainActor private func waitFor(_ description: String, timeout: TimeInterval = 8, _ condition: @escaping () -> Bool) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed, description)
    }

    @MainActor private func assertLockedBackground(_ app: XCUIApplication, onboarding: Bool, phase: String) {
        let scope = onboarding ? "onboarding" : "account"
        let prefix = "BB keyboard probe " + scope + " "
        let expected = prefix + "bodyFixed=true shellHidden=true shellInert=true viewportCovered=true rootLocked=true"
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            probe.exists && probe.label.hasPrefix(expected + " metrics=")
        }, object: nil)
        let result = XCTWaiter.wait(for: [expectation], timeout: 8)
        // Read after waiting so a failure reports the latest geometry, rather
        // than a stale first frame or "missing" captured before the wait.
        let actual = probe.exists ? String(probe.label.prefix(1800)) : "missing"
        print("BB keyboard geometry " + scope + " " + actual)
        XCTAssertEqual(result, .completed, "The sign-in surface must cover the visible viewport and lock and hide the planner. Phase: \(phase). Probe: \(actual)")
    }

    @MainActor private func swipeForm(_ app: XCUIApplication, web: XCUIElement, close: XCUIElement, keyboard: XCUIElement, gentle: Bool = false) {
        // Only the visible form area receives this drag. No credentials are
        // entered, and the Sign in/Create account actions are never activated.
        let top = max(web.frame.minY, close.frame.maxY + 8)
        let bottom = keyboard.frame.minY - 18
        XCTAssertGreaterThan(bottom - top, 35, "There must be visible space to scroll the form.")
        let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let start = origin.withOffset(CGVector(dx: app.frame.midX, dy: bottom))
        let endY = gentle ? max(top + 10, bottom - 60) : top + 10
        let end = origin.withOffset(CGVector(dx: app.frame.midX, dy: endY))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    @MainActor private func assertAccountWithKeyboard(password: Bool, onboarding: Bool = false) throws {
        executionTimeAllowance = 90
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "uk.co.basketboss.app")
        app.launchArguments = [onboarding ? "--bb-native-onboarding-keyboard-smoke" : "--bb-native-account-keyboard-smoke"]
        // Clear any previous Simulator keyboard/focus state before launching
        // the app. Home must never be pressed after the input is focused.
        XCUIDevice.shared.press(.home)
        app.launch()
        defer {
            // End editing before terminating the app. Explicit screenshots
            // can stall AX on headless runners; retain XCTest failure results
            // and the runner's final diagnostic screenshot instead.
            XCUIDevice.shared.press(.home)
            app.terminate()
        }
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15), "The test app must reach the foreground before querying its UI.")
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 25), "The native WKWebView must load.")
        // Both entry points wait for the real launch-cover acknowledgement.
        // A WKWebView can expose accessibility nodes before it is interactive.
        let prefix = "BB keyboard probe " + (onboarding ? "onboarding" : "account") + " "
        let readyProbe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            readyProbe.exists && readyProbe.label.contains("\"startupReady\":true")
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 25), .completed, "The native launch cover and sign-in entry point must be ready before interaction.")
        if onboarding {
            // WKWebView prepares Welcome underneath the native launch cover.
            // Its accessibility nodes can exist before UIKit finishes fading.
            // Wait for the production bridge's ready acknowledgement, then
            // use one real tap; never advance onboarding from injected JS.
            let next = app.buttons.matching(identifier: "Let’s get started").firstMatch
            XCTAssertTrue(next.waitForExistence(timeout: 25), "Fresh onboarding must start at its real welcome screen.")
            next.tap()
        }
        let close = app.buttons.matching(identifier: onboarding ? "Exit onboarding and explore free recipes" : "Close account").firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 25), "The sign-in surface must open.")
        assertLockedBackground(app, onboarding: onboarding, phase: "initial")
        let field = password ? app.secureTextFields.firstMatch : app.textFields.matching(NSPredicate(format: "label == %@ OR placeholderValue == %@", "Email", "you@example.com")).firstMatch
        let inputExists = field.waitForExistence(timeout: 10)
        let inputProbe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
        let inputState = inputProbe.exists ? String(inputProbe.label.prefix(1800)) : "missing"
        XCTAssertTrue(inputExists, "The signed-out account input must exist. Probe: " + inputState)
        // Numeric accessibility diagnostics only: no input values, credentials,
        // screenshots or recordings are copied into the failure message.
        let targetBeforeTap = "target=\(password ? "password" : "email"), hittable=\(field.isHittable), field=\(field.frame), web=\(web.frame)"
        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "A real software keyboard is required; a hardware-keyboard-only run cannot pass. Before tap: \(targetBeforeTap). After tap: field=\(field.frame), web=\(web.frame).")
        waitFor("The focused input must remain above the keyboard.") {
            field.isHittable && field.frame.minY >= web.frame.minY - 1 && field.frame.maxY <= keyboard.frame.minY + 1
        }
        waitFor("Close account must remain reachable with the keyboard open.") {
            close.isHittable && close.frame.minY >= web.frame.minY - 1 && close.frame.maxY <= keyboard.frame.minY + 1
        }
        assertLockedBackground(app, onboarding: onboarding, phase: "keyboard")
        // A keyboard can cover the dock and make it unhittable even when the
        // planner has leaked behind the form. The DOM probe above additionally
        // requires computed hidden/inert and fixed-body/viewport coverage.
        for label in ["Plan my week", "Discover", "What Have I Already Got?", "Make My Shopping List", "Open Make a Meal"] {
            for item in app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex {
                XCTAssertFalse(item.isHittable, "The background dock must not remain interactive: " + label)
            }
        }
        let signIn = app.buttons.matching(identifier: "Sign in").firstMatch
        XCTAssertTrue(signIn.exists, "The existing Sign in action must remain present.")
        for _ in 0..<5 {
            if signIn.isHittable && signIn.frame.maxY <= keyboard.frame.minY + 1 { break }
            swipeForm(app, web: web, close: close, keyboard: keyboard)
        }
        // Always exercise an actual swipe, including layouts where Sign in
        // already fits, then require the planner and document to remain locked.
        swipeForm(app, web: web, close: close, keyboard: keyboard, gentle: true)
        assertLockedBackground(app, onboarding: onboarding, phase: "after swipe")
        XCTAssertTrue(keyboard.exists, "Reaching Sign in must not require dismissing the keyboard.")
        XCTAssertTrue(signIn.isHittable, "Sign in must be reachable within the account card.")
        XCTAssertGreaterThanOrEqual(signIn.frame.minY, web.frame.minY - 1)
        XCTAssertLessThanOrEqual(signIn.frame.maxY, keyboard.frame.minY + 1, "Sign in must fit above the real keyboard.")
        XCTAssertTrue(close.isHittable, "Close must remain reachable after scrolling the form.")
        close.tap()
        waitFor("Closing sign-in must dismiss the keyboard.") { !keyboard.exists }
        waitFor("Closing sign-in must restore the Plan dock.") { app.buttons.matching(identifier: "Plan my week").firstMatch.isHittable }
    }

    @MainActor func testEmailKeyboardKeepsAccountReachable() throws {
        try assertAccountWithKeyboard(password: false)
    }

    @MainActor func testPasswordKeyboardKeepsAccountReachable() throws {
        try assertAccountWithKeyboard(password: true)
    }

    @MainActor func testFreshOnboardingEmailKeyboardKeepsLoginLocked() throws {
        try assertAccountWithKeyboard(password: false, onboarding: true)
    }

    @MainActor func testFreshOnboardingPasswordKeyboardKeepsLoginLocked() throws {
        try assertAccountWithKeyboard(password: true, onboarding: true)
    }
}
