import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {

        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

}

// Register before the first page load. Keep Capacitor's WKNavigationDelegate,
// plugin lifecycle, authentication callbacks and media handling intact.
class BasketBossViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(BasketBossNavigationPlugin())
    }
}

// CAPPlugin.shouldOverrideLoad returns true to cancel a navigation, or nil to
// defer to Capacitor's normal policy. This also catches direct location.assign,
// scripted form submissions and target=_blank destinations that bypass DOM JS.
@objc(BasketBossNavigationPlugin)
public class BasketBossNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BasketBossNavigationPlugin"
    public let jsName = "BasketBossNavigation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "clearReceiptPhotos", returnType: CAPPluginReturnPromise)
    ]

    // Keep the billing patterns aligned with native/routing.mjs. Legal processor
    // documents are disclosures; they are the only payment-provider exception.
    private static let providerHost = #"(?:^|\.)(?:stripe\.com|stripe\.network|stripepay\.com|paddle\.com|paddle\.net|link\.com|payments\.link)$"#
    private static let purchasePages = #"^/(?:pricing(?:-sandbox)?|premium|plans|subscribe|subscriptions?|checkout|buy|payments?|compare)(?:\.html)?(?:/|$)"#
    private static let paymentAPI = #"^/api/(?:(?:stripe|paddle)(?:/|$)|(?:(?:subscriptions?|billing|payments?)/)?(?:checkout(?:-(?:config|sessions?))?|create-checkout-session|(?:create-)?payment-?links?|prices?|portal|customer-portal|billing-portal)(?:/|$))"#
    private static let legalProviderPath = #"^/(?:legal(?:/(?:privacy|privacy-policy|terms|terms-of-service|terms-of-use))?|privacy(?:-policy)?|terms(?:-of-service|-of-use)?)/?$"#
    private static let accountStatusURL = URL(string: "capacitor://localhost/pricing-sandbox.html")!
    private static let receiptPhotoName = #"\Aphoto-[0-9]+\.jpg\z"#

    private static func matches(_ pattern: String, _ value: String) -> Bool {
        return value.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func isBillingDestination(_ url: URL) -> Bool {
        let scheme = (url.scheme ?? "").lowercased()
        let rawHost = (url.host ?? "").lowercased()
        let host = rawHost.hasSuffix(".") ? String(rawHost.dropLast()) : rawHost
        let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath.removingPercentEncoding ?? url.path
        if scheme == "stripe" || scheme == "paddle" { return true }
        if matches(providerHost, host) {
            return !(scheme == "https" && url.query == nil && matches(legalProviderPath, path))
        }
        let local = scheme == "capacitor" && host == "localhost" && url.port == nil
        if local && path == "/pricing-sandbox.html" && url.query == nil {
            // This bundled file contains account status only. Allow our own
            // redirection to finish rather than redirecting it recursively.
            return false
        }
        return (local || host == "basketboss.co.uk" || host == "www.basketboss.co.uk") &&
            (matches(paymentAPI, path) || matches(purchasePages, path))
    }

    override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url, Self.isBillingDestination(url) else { return nil }
        if navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true {
            DispatchQueue.main.async { [weak self] in
                self?.webView?.load(URLRequest(url: Self.accountStatusURL))
            }
        }
        return NSNumber(value: true)
    }

    // Camera.getPhoto(resultType: .uri) creates these files in the app's own
    // temporary directory (CameraPlugin.saveTemporaryImage). No path supplied
    // by JavaScript is accepted; photo-library originals are never touched.
    @objc func clearReceiptPhotos(_ call: CAPPluginCall) {
        do {
            let manager = FileManager.default
            let directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey]
            let files = try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys))
            var removed = 0
            for file in files where file.lastPathComponent.range(of: Self.receiptPhotoName, options: .regularExpression) != nil {
                do {
                    let attributes = try file.resourceValues(forKeys: keys)
                    guard attributes.isRegularFile == true, attributes.isSymbolicLink != true else { continue }
                    try manager.removeItem(at: file)
                    removed += 1
                } catch let error as NSError where error.domain == NSCocoaErrorDomain &&
                    (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError) {
                    // Another cleanup call may already have removed this file.
                    continue
                }
            }
            call.resolve(["ok": true, "removed": removed])
        } catch {
            call.reject("Temporary receipt photos could not be cleared.", "BB_NATIVE_CLEANUP", error)
        }
    }
}
