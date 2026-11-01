// Capture branch only. Apply after ios:sync so production packaging stays unchanged.
import fs from 'node:fs';
const swift='ios/App/App/AppDelegate.swift';
let source=fs.readFileSync(swift,'utf8');
if(source.includes('BasketBossScreenshotReporter'))throw Error('Screenshot instrumentation already applied');
source=source.replace('if ProcessInfo.processInfo.arguments.contains("--bb-native-cook-smoke-direct") {','if ProcessInfo.processInfo.arguments.contains("--bb-native-cook-smoke-direct") || (ProcessInfo.processInfo.arguments.contains("--bb-screenshot") && ProcessInfo.processInfo.arguments.last == "cook") {');
const hook=`
        if let flag = ProcessInfo.processInfo.arguments.firstIndex(of: "--bb-screenshot"),
           ProcessInfo.processInfo.arguments.count > flag + 1, let webView = webView,
           let publicURL = Bundle.main.url(forResource: "public", withExtension: nil),
           let script = try? String(contentsOf: publicURL.appendingPathComponent("bb-screenshot-demo.js"), encoding: .utf8) {
            let target = ProcessInfo.processInfo.arguments[flag + 1]
            let allowed = ["plan", "discover", "recipe", "kitchen", "shop", "receipt", "cook", "budget"]
            if allowed.contains(target) {
                let reporter = BasketBossScreenshotReporter()
                let content = webView.configuration.userContentController
                content.add(reporter, name: "bbScreenshot")
                content.addUserScript(WKUserScript(source: "window.__BB_SCREENSHOT_TARGET__='" + target + "';\\n" + script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
        }
`;
source=source.replace('if #available(iOS 16.4, *) { webView?.isInspectable = true }','if #available(iOS 16.4, *) { webView?.isInspectable = true }'+hook);
source+=`
#if DEBUG
// Local simulator-only status bridge. No web UI, backend or user account changes.
private final class BasketBossScreenshotReporter: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let report = message.body as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]),
              let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? data.write(to: folder.appendingPathComponent("bb-screenshot-status.json"), options: .atomic)
    }
}
#endif
`;
fs.writeFileSync(swift,source);
fs.copyFileSync('scripts/screenshot-demo.js','ios/App/App/public/bb-screenshot-demo.js');
console.log('Installed Debug launch-flag-only screenshot instrumentation');
