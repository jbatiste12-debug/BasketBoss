import XCTest

// Real UIKit keyboard + WKWebView accessibility frames. Empty input fields,
// no account credentials, no sign-in submission and no production API writes.
final class BasketBossAccountKeyboardUITests: XCTestCase {
    private var uiTestLaunchArguments: [String] = []
    private var uiTestLaunchEnvironment: [String: String] = [:]
    // A cold Intel CI simulator can spend most of the former 25-second gate
    // bringing up WKWebView and its accessibility service. Give only startup
    // a bounded allowance; real keyboard and geometry waits stay unchanged.
    private let startupReadinessTimeout: TimeInterval = 90
    private let interactionExecutionAllowance: TimeInterval = 180

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
        uiTestLaunchArguments = ["--bb-ui-tests-disable-animations"]
        uiTestLaunchEnvironment = ["BB_UI_TESTS_DISABLE_ANIMATIONS": "1"]
    }

    @MainActor private func waitFor(_ description: String, timeout: TimeInterval = 8, _ condition: @escaping () -> Bool) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed, description)
    }

    @MainActor private func assertLockedBackground(_ probe: XCUIElement, onboarding: Bool, phase: String) {
        let scope = onboarding ? "onboarding" : "account"
        let prefix = "BB keyboard probe " + scope + " "
        let expected = prefix + "bodyFixed=true shellHidden=true shellInert=true viewportCovered=true rootLocked=true"
        var lastLabel = "missing"
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            // Startup readiness already established the probe. Each AX read
            // can request another WebView snapshot, so fetch its label once.
            let label = probe.label
            lastLabel = String(label.prefix(1800))
            return label.hasPrefix(expected + " metrics=")
        }, object: nil)
        let result = XCTWaiter.wait(for: [expectation], timeout: 8)
        // Diagnose the last poll without another potentially blocking snapshot.
        // A late positive label never substitutes for a completed expectation.
        print("BB keyboard geometry " + scope + " " + lastLabel)
        XCTAssertEqual(result, .completed, "The sign-in surface must cover the visible viewport and lock and hide the planner. Phase: \(phase). Probe: \(lastLabel)")
    }

    @MainActor private func swipeForm(_ app: XCUIApplication, web: XCUIElement, close: XCUIElement, keyboard: XCUIElement, gentle: Bool = false) {
        // Only the visible form area receives this drag. No credentials are
        // entered, and the Sign in/Create account actions are never activated.
        let webFrame = web.frame, closeFrame = close.frame, keyboardFrame = keyboard.frame, appFrame = app.frame
        let top = max(webFrame.minY, closeFrame.maxY + 8)
        let bottom = keyboardFrame.minY - 18
        XCTAssertGreaterThan(bottom - top, 35, "There must be visible space to scroll the form.")
        let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let start = origin.withOffset(CGVector(dx: appFrame.midX, dy: bottom))
        let endY = gentle ? max(top + 10, bottom - 60) : top + 10
        let end = origin.withOffset(CGVector(dx: appFrame.midX, dy: endY))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    @MainActor private func assertAccountWithKeyboard(password: Bool, onboarding: Bool = false) throws {
        executionTimeAllowance = startupReadinessTimeout + interactionExecutionAllowance
        let app = XCUIApplication(bundleIdentifier: "uk.co.basketboss.app")
        app.launchArguments = uiTestLaunchArguments + [onboarding ? "--bb-native-onboarding-keyboard-smoke" : "--bb-native-account-keyboard-smoke"]
        app.launchArguments.append(password ? "--bb-keyboard-password" : "--bb-keyboard-email")
        app.launchEnvironment = uiTestLaunchEnvironment
        // XCTest runs registered teardown even when continueAfterFailure stops
        // a test through an Objective-C exception; Swift defer is not reliable
        // across that boundary. Register before launch can fail as well.
        addTeardownBlock {
            await MainActor.run {
                XCUIDevice.shared.press(.home)
                app.terminate()
            }
        }
        // Clear any previous Simulator keyboard/focus state before launching
        // the app. Home must never be pressed after the input is focused.
        XCUIDevice.shared.press(.home)
        let startupStarted = ProcessInfo.processInfo.systemUptime
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15), "The test app must reach the foreground before querying its UI.")
        // There is one WKWebView container. Cache that typed container; all
        // interactive controls and the probe below use exact DOM identifiers.
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 25), "The native WKWebView must load.")
        // Both entry points wait for the real launch-cover acknowledgement.
        // A WKWebView can expose accessibility nodes before it is interactive.
        let probe = app.staticTexts["bbAccountKeyboardProbe"]
        var lastStartupProbe = "missing"
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard probe.exists else { lastStartupProbe = "missing"; return false }
            let label = probe.label
            lastStartupProbe = String(label.prefix(1800))
            return label.contains("\"startupReady\":true")
        }, object: nil)
        let readyResult = XCTWaiter.wait(for: [ready], timeout: startupReadinessTimeout)
        let startupSeconds = Int(ProcessInfo.processInfo.systemUptime - startupStarted)
        let startupScope = onboarding ? "onboarding" : "account"
        // Safe computed layout/status only, using the last poll. Do not issue
        // another potentially slow AX snapshot or accept a late-ready result.
        print("BB keyboard startup " + startupScope + " elapsedSeconds=\(startupSeconds) gateSeconds=\(Int(startupReadinessTimeout)) probe=" + lastStartupProbe)
        XCTAssertEqual(readyResult, .completed, "The native launch cover and sign-in entry point must be ready before interaction. Last probe: \(lastStartupProbe)")
        if onboarding {
            // WKWebView prepares Welcome underneath the native launch cover.
            // Its accessibility nodes can exist before UIKit finishes fading.
            // Wait for the production bridge's ready acknowledgement, then
            // use one real tap; never advance onboarding from injected JS.
            let next = app.buttons["bbobNext"]
            XCTAssertTrue(next.waitForExistence(timeout: 25), "Fresh onboarding must start at its real welcome screen.")
            next.tap()
        }
        let close = app.buttons[onboarding ? "bbobExit" : "cloud-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 25), "The sign-in surface must open.")
        assertLockedBackground(probe, onboarding: onboarding, phase: "initial")
        let field = password ? app.secureTextFields["cloud-password"] : app.textFields["cloud-email"]
        let targetName = password ? "password" : "email"
        XCTAssertTrue(field.waitForExistence(timeout: 10), "The signed-out account \(targetName) input must exist.")
        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "A real software keyboard is required; a hardware-keyboard-only run cannot pass. Target: \(targetName).")
        waitFor("The focused input must remain above the keyboard.") {
            guard field.isHittable else { return false }
            let fieldFrame = field.frame, webFrame = web.frame, keyboardFrame = keyboard.frame
            return fieldFrame.minY >= webFrame.minY - 1 && fieldFrame.maxY <= keyboardFrame.minY + 1
        }
        waitFor("Close account must remain reachable with the keyboard open.") {
            guard close.isHittable else { return false }
            let closeFrame = close.frame, webFrame = web.frame, keyboardFrame = keyboard.frame
            return closeFrame.minY >= webFrame.minY - 1 && closeFrame.maxY <= keyboardFrame.minY + 1
        }
        assertLockedBackground(probe, onboarding: onboarding, phase: "keyboard")
        // A keyboard can cover the dock and make it unhittable even when the
        // planner has leaked behind the form. The DOM probe above additionally
        // requires computed hidden/inert and fixed-body/viewport coverage.
        let protectedNavigation: [(String, XCUIElement)] = [
            ("Plan", app.buttons["bbPlanNav"]),
            ("Discover", app.buttons["bbDiscoverNav"]),
            ("At home", app.buttons["bbPantryNav"]),
            ("Shop", app.buttons["bbShopNav"]),
            ("Cook", app.links["bbCookNav"])
        ]
        for (name, item) in protectedNavigation {
            XCTAssertFalse(item.exists && item.isHittable, "The background dock must not remain interactive: " + name)
        }
        let signIn = app.buttons["cloud-login"]
        XCTAssertTrue(signIn.exists, "The existing Sign in action must remain present.")
        for _ in 0..<5 {
            if signIn.isHittable {
                let signInFrame = signIn.frame, keyboardFrame = keyboard.frame
                if signInFrame.maxY <= keyboardFrame.minY + 1 { break }
            }
            swipeForm(app, web: web, close: close, keyboard: keyboard)
        }
        // Always exercise an actual swipe, including layouts where Sign in
        // already fits, then require the planner and document to remain locked.
        swipeForm(app, web: web, close: close, keyboard: keyboard, gentle: true)
        assertLockedBackground(probe, onboarding: onboarding, phase: "after swipe")
        XCTAssertTrue(keyboard.exists, "Reaching Sign in must not require dismissing the keyboard.")
        XCTAssertTrue(signIn.isHittable, "Sign in must be reachable within the account card.")
        let signInFrame = signIn.frame, webFrame = web.frame, keyboardFrame = keyboard.frame
        XCTAssertGreaterThanOrEqual(signInFrame.minY, webFrame.minY - 1)
        XCTAssertLessThanOrEqual(signInFrame.maxY, keyboardFrame.minY + 1, "Sign in must fit above the real keyboard.")
        XCTAssertTrue(close.isHittable, "Close must remain reachable after scrolling the form.")
        close.tap()
        if #available(iOS 18.0, *) {
            XCTAssertTrue(keyboard.waitForNonExistence(timeout: 10), "Closing sign-in must dismiss the keyboard.")
        } else {
            waitFor("Closing sign-in must dismiss the keyboard.", timeout: 10) { !keyboard.exists }
        }
        let planDock = app.buttons["bbPlanNav"]
        waitFor("Closing sign-in must restore the Plan dock.") { planDock.isHittable }
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
