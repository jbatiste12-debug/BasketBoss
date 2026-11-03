import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        #if DEBUG
        #if targetEnvironment(simulator)
        if BasketBossKeyboardUITestRuntime.disablesAnimations {
            UIView.setAnimationsEnabled(false)
        }
        #endif
        #endif
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

#if DEBUG
#if targetEnvironment(simulator)
// Explicit disposable-simulator UI tests only. Release and normal Debug app
// launches retain the requested intro and animation behavior.
private enum BasketBossKeyboardUITestRuntime {
    static var isKeyboardSmokeLaunch: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.contains("--bb-native-account-keyboard-smoke") || arguments.contains("--bb-native-onboarding-keyboard-smoke")
    }

    static var disablesAnimations: Bool {
        isKeyboardSmokeLaunch && ProcessInfo.processInfo.arguments.contains("--bb-ui-tests-disable-animations")
    }
}
#endif
#endif

// Register before the first page load. Keep Capacitor's WKNavigationDelegate,
// plugin lifecycle, authentication callbacks and media handling intact.
class BasketBossViewController: CAPBridgeViewController {
    private var startupView: BasketBossStartupView?
    private var startupTimeout: DispatchWorkItem?
    private var startupFinished = false

    #if DEBUG
    #if targetEnvironment(simulator)
    private var keyboardSmokeReporter: BasketBossKeyboardProbeReporter?
    #endif
    #endif

    #if DEBUG
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if ProcessInfo.processInfo.arguments.contains("--bb-native-cook-smoke-direct") {
            descriptor.appStartPath = "/make-a-meal.html"
        }
        return descriptor
    }
    #endif

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Keep the vertical app page steady on sideways drags. Preserve
        // vertical scrolling and the WebView's DOM-based recipe swipes.
        webView?.scrollView.alwaysBounceHorizontal = false
        webView?.scrollView.isDirectionalLockEnabled = true
        bridge?.registerPluginInstance(BasketBossNavigationPlugin())
        bridge?.registerPluginInstance(BasketBossPurchasesPlugin())
        bridge?.registerPluginInstance(BasketBossCookVoicePlugin())
        #if DEBUG
        if #available(iOS 16.4, *) { webView?.isInspectable = true }
        if ProcessInfo.processInfo.arguments.contains("--bb-native-cook-smoke"), let webView = webView {
            let content = webView.configuration.userContentController
            let reporter = BasketBossCookSmokeReporter()
            reporter.record(["phase": "armed", "complete": false, "passed": false])
            content.add(reporter, name: "bbNativeCookSmoke")
            content.addUserScript(WKUserScript(source: BasketBossCookSmokeReporter.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #if targetEnvironment(simulator)
        let keyboardArguments = ProcessInfo.processInfo.arguments
        if BasketBossKeyboardUITestRuntime.isKeyboardSmokeLaunch, let webView = webView {
            let onboarding = keyboardArguments.contains("--bb-native-onboarding-keyboard-smoke")
            webView.accessibilityIdentifier = "bbKeyboardWebView"
            let content = webView.configuration.userContentController
            keyboardSmokeReporter?.invalidate()
            content.removeScriptMessageHandler(forName: "bbNativeKeyboardProbe")
            let reporter = BasketBossKeyboardProbeReporter(container: view, onboarding: onboarding)
            keyboardSmokeReporter = reporter
            content.add(reporter, name: "bbNativeKeyboardProbe")
            content.addUserScript(WKUserScript(source: BasketBossAccountKeyboardSetup.script(onboarding: onboarding), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #endif
        #endif
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        if !startupFinished { showStartup() }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        startupView?.startMotion()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        #if DEBUG
        #if targetEnvironment(simulator)
        if isBeingDismissed || isMovingFromParent {
            webView?.configuration.userContentController.removeScriptMessageHandler(forName: "bbNativeKeyboardProbe")
            keyboardSmokeReporter?.invalidate()
            keyboardSmokeReporter = nil
        }
        #endif
        #endif
    }

    private func showStartup() {
        startupTimeout?.cancel()
        startupView?.removeFromSuperview()
        let brand = BasketBossStartupView(frame: view.bounds)
        brand.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        brand.retry = { [weak self] in
            guard let self = self else { return }
            self.startupFinished = false
            self.showStartup()
            self.startupView?.startMotion()
            self.webView?.reload()
        }
        view.addSubview(brand)
        startupView = brand
        let timeout = DispatchWorkItem { [weak self] in self?.startupView?.showRecovery() }
        startupTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: timeout)
    }

    func finishStartup(completion: @escaping () -> Void) {
        startupFinished = true
        startupTimeout?.cancel()
        guard let brand = startupView else { completion(); return }
        // Keep the requested four-second brand animation while the app prepares
        // underneath it. Later page navigation has no cover and no extra wait.
        DispatchQueue.main.asyncAfter(deadline: .now() + brand.remainingIntroDuration) { [weak self, weak brand] in
            guard let brand = brand, self?.startupView === brand else { completion(); return }
            self?.startupView = nil
            UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.14, animations: {
                brand.alpha = 0
            }, completion: { _ in brand.removeFromSuperview(); completion() })
        }
    }
}

#if DEBUG
#if targetEnvironment(simulator)
// WebKit did not expose the DOM probe's id as an XCUI StaticText identifier on
// the CI runtime. Transport the real DOM measurements to one native label;
// never synthesize readiness, geometry, focus or user actions in this bridge.
private final class BasketBossKeyboardProbeReporter: NSObject, WKScriptMessageHandler {
    private weak var container: UIView?
    private weak var probe: UILabel?
    private let prefix: String

    init(container: UIView, onboarding: Bool) {
        self.container = container
        self.prefix = "BB keyboard probe " + (onboarding ? "onboarding" : "account") + " "
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let text = message.body as? String,
              text.isEmpty || (text.count <= 4096 && text.hasPrefix(prefix)) else { return }
        DispatchQueue.main.async { [weak self] in self?.display(text) }
    }

    private func display(_ text: String) {
        guard !text.isEmpty else { invalidate(); return }
        guard let container = container else { return }
        let label: UILabel
        if let current = probe {
            label = current
        } else {
            label = UILabel()
            label.isAccessibilityElement = true
            label.accessibilityIdentifier = "bbAccountKeyboardProbe"
            label.accessibilityTraits = .staticText
            label.isUserInteractionEnabled = false
            label.numberOfLines = 3
            label.font = .monospacedSystemFont(ofSize: 7, weight: .regular)
            label.textColor = UIColor(red: 0.22, green: 0.37, blue: 0.27, alpha: 1)
            label.backgroundColor = UIColor(red: 0.96, green: 0.97, blue: 0.94, alpha: 1)
            label.autoresizingMask = [.flexibleWidth]
            container.addSubview(label)
            probe = label
        }
        label.frame = CGRect(x: 8, y: container.safeAreaInsets.top + 8, width: max(1, container.bounds.width - 88), height: 30)
        label.text = text
        label.accessibilityLabel = text
    }

    func invalidate() {
        probe?.removeFromSuperview()
        probe = nil
    }
}

// Only the explicit XCUITest launch on a disposable simulator uses this setup.
// XCTest itself taps real inputs; this script never focuses, types or signs in.
private enum BasketBossAccountKeyboardSetup {
    static func script(onboarding: Bool) -> String {
        "window.bbKeyboardSmokeOnboarding=" + (onboarding ? "true;" : "false;") + #"""
        (()=>{
          const onboarding=window.bbKeyboardSmokeOnboarding===true;
          localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify(onboarding?{complete:false,started:true,step:0,partnerStepV2:true}:{complete:true,step:10,house:'3–4 people',region:'UK',goals:['Plan dinners faster'],diets:['No specific preference'],partnerStepV2:true}));
          localStorage.setItem('basketboss_onboarding_seen_v1','true');
          sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
          sessionStorage.setItem('bb_funnel_nudge_dismissed_v1','1');
          let attempts=0,opened=false,baselineScroll=null,lastProbeText='';
          const reportProbe=text=>{
            if(text===lastProbeText)return;
            lastProbeText=text;
            window.webkit?.messageHandlers?.bbNativeKeyboardProbe?.postMessage(text);
          };
          // Exact test-only accessible names also work on runtimes that do not
          // forward DOM ids to XCTest. Visible labels, values, roles and actions
          // stay intact. Normal Debug and Release launches never run this code.
          const identifyControls=()=>{
            for(const [selector,identifier] of [
              ['#cloud-email','cloud-email'],
              ['#cloud-password','cloud-password'],
              ['#cloud-login','cloud-login'],
              ['#cloud-close','cloud-close'],
              ['#bbNewOnboarding .bbob-footer button[data-bbob="next"]','bbobNext'],
              ['#bbNewOnboarding button.bbob-exit','bbobExit'],
              ['.tabs button[data-tab="week"]','bbPlanNav'],
              ['.tabs button[data-tab="discover"]','bbDiscoverNav'],
              ['.tabs button[data-tab="shop"]','bbPantryNav'],
              ['.tabs button[data-tab="shop-list"]','bbShopNav'],
              ['.tabs a.bb173-make-meal-link','bbCookNav']
            ]){
              const control=document.querySelector(selector);
              if(!control)continue;
              if(!control.id)control.id=identifier;
              if(control.getAttribute('aria-label')!==identifier)control.setAttribute('aria-label',identifier);
            }
          };
          const check=setInterval(()=>{
            if(++attempts>1800){clearInterval(check);return;}
            identifyControls();
            if(!onboarding&&!opened){
              const button=document.getElementById('cloud-open');
              if(document.readyState!=='loading'&&window.BBNativeStartup?.phase==='ready'&&button){opened=true;button.click();}
            }
            const host=document.getElementById(onboarding?'bbNewOnboarding':'cloud-panel');
            const form=document.getElementById('cloud-auth'),shell=document.querySelector('.shell');
            if(!host||!host.getClientRects().length){reportProbe('');return;}
            const fixed=getComputedStyle(document.body).position==='fixed';
            const viewport=window.visualViewport,box=host.getBoundingClientRect();
            // Compare document coordinates: WKWebView's DOM rect and scrollY
            // include keyboard panning differently from Chromium. Visual-only
            // panning must not be confused with moving the locked page.
            const scrollY=Number(window.scrollY)||0,scrollX=Number(window.scrollX)||0;
            const top=Number.isFinite(viewport?.pageTop)?viewport.pageTop:scrollY;
            const left=Number.isFinite(viewport?.pageLeft)?viewport.pageLeft:scrollX;
            const layoutY=top-(Number(viewport?.offsetTop)||0);
            if(fixed&&baselineScroll===null)baselineScroll=layoutY;
            const height=Math.min(Number(viewport?.height)||innerHeight,innerHeight),width=Math.min(Number(viewport?.width)||innerWidth,innerWidth);
            const flags={bodyFixed:fixed,shellHidden:!!shell&&getComputedStyle(shell).visibility==='hidden',shellInert:!!shell?.closest('[inert]'),viewportCovered:Math.abs(box.top+scrollY-top)<3&&Math.abs(box.left+scrollX-left)<3&&Math.abs(box.bottom+scrollY-top-height)<3&&Math.abs(box.right+scrollX-left-width)<3,rootLocked:baselineScroll!==null&&Math.abs(layoutY-baselineScroll)<2};
            // Numeric layout metadata only: never include input values, user
            // text, account/session data, screenshots or recording bytes.
            const number=value=>Number.isFinite(Number(value))?Math.round(Number(value)*10)/10:null;
            const bodyStyle=getComputedStyle(document.body),hostStyle=getComputedStyle(host);
            const email=document.getElementById('cloud-email');
            const metrics={startupReady:window.BBNativeStartup?.phase==='ready',authSlot:!!document.getElementById('bbobAuthSlot'),formMounted:host.contains(form),emailVisible:!!email?.getClientRects().length,formHidden:!!form?.hidden,formInert:!!form?.closest('[inert]'),vvH:number(viewport?.height),vvW:number(viewport?.width),vvTop:number(viewport?.offsetTop),vvLeft:number(viewport?.offsetLeft),vvPageTop:number(viewport?.pageTop),vvScale:number(viewport?.scale),innerH:number(innerHeight),innerW:number(innerWidth),hostT:number(box.top),hostL:number(box.left),hostB:number(box.bottom),hostR:number(box.right),hostH:number(box.height),hostW:number(box.width),cssT:number(parseFloat(hostStyle.top)),cssH:number(parseFloat(hostStyle.height)),bodyT:number(parseFloat(bodyStyle.top)),rootY:number(window.scrollY),baselineY:baselineScroll===null?null:number(baselineScroll),htmlY:number(document.documentElement.scrollTop),bodyY:number(document.body.scrollTop)};
            const text='BB keyboard probe '+(onboarding?'onboarding':'account')+' '+Object.entries(flags).map(([name,value])=>name+'='+value).join(' ')+' metrics='+JSON.stringify(metrics);
            reportProbe(text);
          },100);
        })();
        """#
    }
}
#endif
// A fresh CI simulator can exercise the actual capacitor:// WKWebView. This
// hook is excluded from Release and never changes a user's normal installation.
private final class BasketBossCookSmokeReporter: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let report = message.body as? [String: Any] else { return }
        record(report)
    }

    func record(_ report: [String: Any]) {
        let keys = ["complete", "passed", "nativeOrigin", "cookMounted", "cookReady", "navPresent", "navVisible", "navHit", "legacyVisible", "backToPlan", "dataKept", "mainReady", "startupReady", "phase", "readyState", "errorCount", "errorLine", "errorKind", "errorSource", "lastScript", "scriptCount", "ingredientClosed", "ingredientPhoto", "ingredientSaved", "ingredientAutofill", "ingredientExistingKept", "ingredientRestored", "voiceFreeLocked", "voiceManualStart", "voiceNextStep", "voiceTimer", "voiceScaledAmount", "voiceExitStopped", "voiceRestored", "voicePrepAvailable", "voicePrepNarrated", "voicePrepAdvanced", "voiceCookNarrated", "voiceStepNarrated", "mentorAvailable", "mentorRecipeContext", "mentorSpokenQuestion", "mentorTypedQuestion", "mentorFollowupHistory", "mentorPrivateAudio", "mentorAnswerVisible", "mentorNoAutonomousActions", "mentorCancelledAnswer", "mentorInterrupt", "mentorHistoryCleared", "mentorNoDeviceFallback", "mentorGreetingName", "voiceFailure"]
        let safe = report.filter { keys.contains($0.key) }
        guard let data = try? JSONSerialization.data(withJSONObject: safe, options: [.sortedKeys]),
              let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? data.write(to: folder.appendingPathComponent("bb-native-cook-smoke.json"), options: .atomic)
    }

    static let script = #"""
    (()=>{
      window.webkit.messageHandlers.bbNativeCookSmoke.postMessage({phase:'documentStart',complete:false,nativeOrigin:location.protocol==='capacitor:'});
      const key='bb_native_cook_smoke', errors=[];
      addEventListener('error',e=>{errors.push({kind:e.error?.name||'ResourceError',line:e.lineno||0,source:String(e.filename||e.target?.src||'').split('/').pop().split('?')[0].replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100)});},true);
      localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({complete:true,step:10}));
      localStorage.setItem('basketboss_native_smoke_probe','keep');
      let ticks=0,scrolled=false,navigationPending=false,ingredientRunning=false,voiceRunning=false;
      function progress(report={},complete=false){const e=errors[0]||{},scripts=[...document.scripts],last=scripts.at(-1);window.webkit.messageHandlers.bbNativeCookSmoke.postMessage({...JSON.parse(sessionStorage.getItem(key+'_report')||'{}'),complete,nativeOrigin:location.protocol==='capacitor:',phase:location.pathname.endsWith('/make-a-meal.html')?'cook':sessionStorage.getItem(key)==='back'?'return':'main',readyState:document.readyState,mainReady:!!document.getElementById('app')?.firstElementChild,startupReady:window.BBNativeStartup?.phase==='ready',scriptCount:scripts.length,lastScript:String(last?.src||last?.id||'inline').split('/').pop().split('?')[0].replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100),...report,errorCount:errors.length,errorLine:e.line||0,errorKind:e.kind||'',errorSource:e.source||''});}
      function send(report){progress(report,true);clearInterval(timer);}
      async function verifyIngredients(){
        const report={},stateKey='basketboss_321_unified_state_v1';
        const wait=async read=>{for(let n=0;n<60;n++){const value=read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('IngredientSmokeTimeout');};
        await wait(()=>window.BBIngredientPreferences&&document.getElementById('bbAvoidIngredientTab'));
        const prior=localStorage.getItem(stateKey),saved=new Map();
        const recipes=await fetch(new URL('recipes.json',location.href)).then(response=>response.json());
        const planned=()=>JSON.parse(localStorage.getItem(stateKey)||'{}').planned||[];
        const refresh=()=>dispatchEvent(new StorageEvent('storage',{key:stateKey,newValue:localStorage.getItem(stateKey)}));
        const relevant=k=>k===stateKey||k==='basketboss_321_unified_recovery_v1'||k.startsWith('basketboss_autofill_');
        for(let n=0;n<localStorage.length;n++){const k=localStorage.key(n);if(relevant(k))saved.set(k,localStorage.getItem(k));}
        try{
          localStorage.setItem(stateKey,JSON.stringify({version:2,planned:[{recipeId:'fajitas',day:'Monday'}],servings:4,feedingSet:true}));refresh();
          const button=await wait(()=>document.getElementById('bbAvoidIngredientTab'));
          report.ingredientClosed=button.getAttribute('aria-expanded')==='false'&&document.getElementById('bbAvoidIngredientPanel').hidden;
          button.click();
          const input=await wait(()=>document.getElementById('bbAvoidIngredientSearch'));
          input.value='chicken';input.dispatchEvent(new Event('input',{bubbles:true}));
          const tile=await wait(()=>document.querySelector('[data-bb-avoid-id="chicken"]'));
          const image=await wait(()=>{const img=tile.querySelector('img');return img?.complete&&img.naturalWidth>0?img:null;});
          report.ingredientPhoto=!!image;tile.click();
          report.ingredientSaved=BBIngredientPreferences.getSelected().includes('chicken')&&JSON.parse(localStorage.getItem(stateKey)).ingredientAvoidance.excluded.includes('chicken');
          button.click();document.getElementById('bb172FillSixDinners').click();
          const confirm=await wait(()=>[...document.querySelectorAll('#bbQaConfirmOverlay button')].find(node=>node.textContent.trim()==='Add dinners'));
          confirm.click();await wait(()=>planned().length===7);
          const added=planned().filter(item=>item.day!=='Monday');
          report.ingredientAutofill=added.length===6&&added.every(item=>{const recipe=recipes.find(candidate=>candidate.id===item.recipeId);return recipe&&!recipe.ingredients.some(ingredient=>/\bchicken\b/i.test(String(ingredient[0])));});
          report.ingredientExistingKept=planned().some(item=>item.day==='Monday'&&item.recipeId==='fajitas');
        }finally{
          const remove=[];for(let n=0;n<localStorage.length;n++){const k=localStorage.key(n);if(relevant(k))remove.push(k);}
          for(const k of remove)localStorage.removeItem(k);for(const [k,value]of saved)localStorage.setItem(k,value);
          refresh();report.ingredientRestored=localStorage.getItem(stateKey)===prior;
        }
        return report;
      }
      async function verifyVoiceCook(){
        const report={},stateKey='basketboss_321_unified_state_v1',snapshot=localStorage.getItem(stateKey),recoveryKey='basketboss_321_unified_recovery_v1',recovery=localStorage.getItem(recoveryKey);
        const originalPremium=window.BasketBossVerifiedPremium,originalVoice=window.BBNativeCookVoice,originalController=window.BBCookVoice;
        const namePrefix='basketboss_cook_mentor_name_v1:',nameSnapshot=new Map();
        for(let n=0;n<localStorage.length;n++){const key=localStorage.key(n);if(key?.startsWith(namePrefix))nameSnapshot.set(key,localStorage.getItem(key));}
        let voiceStage='mount';
        const wait=async read=>{for(let n=0;n<60;n++){const value=read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('VoiceCookSmokeTimeout_'+voiceStage);};
        const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
        const refresh=()=>dispatchEvent(new StorageEvent('storage',{key:stateKey,newValue:localStorage.getItem(stateKey)}));
        let starts=0,stops=0,onFinal=null,onStatus=null,busy=false,active=false,utterance=0,held=null,fallbacks=0,sharedAudio=0,privateAudio=0,failAudio=false,pendingAnswer=null,defaultGreeting=false;
        const spoken=[],requests=[],prepared=[],playback=[],audioTexts=new Map();
        const answers={prep:'Set out your chicken and peppers first, then keep a clean board ready for the vegetables.',peppers:'The peppers should soften and take on a little colour, while still holding their shape.',followup:'Yes, use a clean board for the peppers, and clean anything that touched raw chicken.',cheddar:'You’ll need 265 grams of cheddar.',yoghurt:'Plain yoghurt can be used as a topping here; add it when serving.'};
        const assistant={ask:async(payload,options={})=>{
          requests.push({payload:JSON.parse(JSON.stringify(payload)),signal:options.signal});
          if(payload.question==='What if they start to stick?')return new Promise(resolve=>{pendingAnswer={resolve,signal:options.signal};});
          const answer=payload.question==='What should I prepare first?'?answers.prep:payload.question==='And should I use a separate board?'?answers.followup:payload.question==='How much cheddar?'?answers.cheddar:payload.question==='Can I use yoghurt instead?'?answers.yoghurt:answers.peppers;
          return {answer};
        }};
        const tts={prepareMentor:async(text,options={})=>{
          prepared.push({text,signal:options.signal});
          if(failAudio){failAudio=false;throw Object.assign(Error('synthetic-unavailable'),{code:'BB_TTS_UNAVAILABLE'});}
          const base64=btoa('ID3'+prepared.length);audioTexts.set(base64,text);return {base64,contentType:'audio/mpeg'};
        },playMentor:async()=>{throw Error('VoiceSmokeUnexpectedBrowserAudio');},prepare:async()=>{sharedAudio++;throw Error('VoiceSmokeSharedAudio');},play:async()=>{sharedAudio++;throw Error('VoiceSmokeSharedAudio');}};
        const open=async()=>{
          const day=await wait(()=>document.querySelector('.bbnext-day[data-bbnext-day="Monday"]'));day.open=true;
          const cook=await wait(()=>day.querySelector('[data-cook]'));cook.click();await wait(()=>document.getElementById('bbStart'));
          return wait(()=>document.querySelector('.bb-cook-voice .bbcv-toggle'));
        };
        const typed=async(question,answer)=>{
          const input=await wait(()=>document.querySelector('.bbcv-question-input'));
          input.value=question;input.dispatchEvent(new Event('input',{bubbles:true}));
          const send=await wait(()=>{const button=document.querySelector('.bbcv-question-send');return button&&!button.disabled?button:null;});send.click();
          await wait(()=>document.querySelector('.bbcv-answer')?.textContent.includes(answer));
        };
        try{
          for(const key of nameSnapshot.keys())localStorage.removeItem(key);
          // Stub only the external model/audio boundary. The real app still
          // mounts its actual mentor context, controls and conversation logic.
          window.BBCookVoice={...originalController,mount:options=>originalController.mount({...options,assistant,tts})};
          window.BBNativeCookVoice={available:async()=>true,start:async(final,status)=>{starts++;active=true;onFinal=final;onStatus=status;status({state:'listening'});},stop:async()=>{stops++;active=false;busy=false;held=null;utterance++;},prepareSpeech:async()=>{if(!active)throw Error('VoiceSmokeInactive');held='mentor-'+(++utterance);busy=true;onStatus?.({state:'paused'});return {speechId:held};},cancelSpeech:async({speechId}={})=>{if(speechId===held){held=null;busy=false;utterance++;if(active)onStatus?.({state:'listening'});}return {spoken:false,cancelled:true};},playAudioData:async audio=>{
            if(!active||audio.speechId!==held||audio.contentType!=='audio/mpeg'||typeof audio.base64!=='string'||audio.url||audio.token)throw Error('VoiceSmokePrivateAudio');
            if(!audioTexts.has(audio.base64))throw Error('VoiceSmokeUnknownAudio');
            const cycle=utterance;privateAudio++;playback.push({...audio});spoken.push(audioTexts.get(audio.base64));await pause(20);
            if(active&&cycle===utterance){held=null;busy=false;onStatus?.({state:'listening'});return {spoken:true};}return {spoken:false,cancelled:true};
          },speak:async()=>{fallbacks++;throw Error('VoiceSmokeDeviceFallback');},playAudio:async()=>{sharedAudio++;throw Error('VoiceSmokeSharedAudio');}};
          window.BasketBossVerifiedPremium={isActive:()=>false};
          localStorage.setItem(stateKey,JSON.stringify({version:2,planned:[{recipeId:'fajitas',day:'Monday'}],servings:4,feedingSet:true}));refresh();
          let toggle=await open();
          report.voicePrepAvailable=!document.querySelector('.bb-cook-voice').hidden&&!document.getElementById('bbInstruction');
          report.mentorAvailable=document.querySelector('.bb-cook-voice').classList.contains('is-mentor');
          report.voiceFreeLocked=toggle.textContent.includes('Premium')&&starts===0;
          window.BasketBossVerifiedPremium={isActive:()=>true};document.dispatchEvent(new Event('basketboss:premium-verified'));
          report.voiceManualStart=starts===0&&toggle.getAttribute('aria-pressed')==='false';
          voiceStage='typedQuestion';await typed('What should I prepare first?',answers.prep);
          report.mentorTypedQuestion=requests.at(-1)?.payload.question==='What should I prepare first?'&&starts===0&&privateAudio===0;
          voiceStage='followup';await typed('And should I use a separate board?',answers.followup);
          const followup=requests.at(-1)?.payload;
          report.mentorFollowupHistory=followup?.history?.some(turn=>turn.role==='user'&&turn.text==='What should I prepare first?')&&followup.history.some(turn=>turn.role==='assistant'&&turn.text===answers.prep);
          const recipes=await fetch(new URL('recipes.json',location.href)).then(response=>response.json()),recipe=recipes.find(item=>item.id==='fajitas');
          const cheddar=recipe.ingredients.find(item=>item[0]==='Cheddar');
          const amount=ingredient=>BBServing.scaleText(ingredient[1],4/recipe.servings,ingredient[0],{roundCounts:false});
          if(recipe.servings!==6||recipe.ingredients[0][0]!=='Chicken breast'||recipe.ingredients[0][1]!=='1 kg'||recipe.ingredients[1][0]!=='Mixed peppers'||recipe.ingredients[1][1]!=='3 peppers'||cheddar?.[1]!=='400 g'||recipe.method?.length!==5||amount(recipe.ingredients[0])!=='665 g'||amount(recipe.ingredients[1])!=='2 peppers'||amount(cheddar)!=='265 g')throw Error('VoiceCookFixtureChanged');
          voiceStage='firstIngredient';toggle.click();await wait(()=>onFinal&&starts===1&&spoken.some(text=>text.includes('665 grams of chicken breast')));
          report.voicePrepNarrated=spoken.some(text=>text.includes('665 grams of chicken breast'));await wait(()=>!busy);
          voiceStage='nextIngredient';onFinal('Next ingredient');await wait(()=>document.querySelector('[data-prep="0"]')?.checked&&spoken.some(text=>text.includes('2 mixed peppers')));
          report.voicePrepAdvanced=document.querySelector('[data-prep="0"]').checked;await wait(()=>!busy);
          voiceStage='startCooking';onFinal('Start cooking');await wait(()=>document.getElementById('bbInstruction'));
          const firstInstruction=document.getElementById('bbInstruction').textContent;
          if(!firstInstruction.includes('200°C')||!firstInstruction.includes('180°C fan')||!firstInstruction.includes('Slice chicken and peppers into strips'))throw Error('VoiceCookFirstInstruction');
          const firstStep='Heat oven to 200 degrees Celsius (180 degrees Celsius fan). Slice chicken and peppers into strips.';
          voiceStage='firstStep';const greeting='Hi, ready to get cooking? I’m Chef Boss. Let’s make '+recipe.name+' together.';
          await wait(()=>document.querySelector('.bbcv-answer')?.textContent.includes(greeting)&&spoken.some(text=>text.includes(greeting)));
          defaultGreeting=document.querySelector('.bbcv-name-display').textContent.includes('Chef Boss')&&spoken.filter(text=>text.includes(greeting)).length===1;
          await wait(()=>spoken.some(text=>text.toLowerCase().includes(firstStep.toLowerCase())));
          report.voiceCookNarrated=spoken.filter(text=>text.toLowerCase().includes(firstStep.toLowerCase())).length===1;await wait(()=>!busy);
          voiceStage='spokenQuestion';const beforeQuestion=document.getElementById('bbInstruction').textContent,beforeTimer=document.getElementById('bbTimerToggle').textContent;
          onFinal('What should the peppers look like?');await wait(()=>spoken.includes(answers.peppers)&&document.querySelector('.bbcv-answer')?.textContent.includes(answers.peppers));
          const question=requests.at(-1)?.payload;
          report.mentorSpokenQuestion=question?.question==='What should the peppers look like?';
          report.mentorAnswerVisible=document.querySelector('.bbcv-answer').textContent.includes(answers.peppers);
          report.mentorNoAutonomousActions=document.getElementById('bbInstruction').textContent===beforeQuestion&&document.getElementById('bbTimerToggle').textContent===beforeTimer;
          const context=question?.recipe;
          report.mentorRecipeContext=context?.id==='fajitas'&&context.title===recipe.name&&context.servings===4&&context.phase==='cook'&&context.region==='UK'&&context.currentStep===0&&context.steps.length===5&&context.steps[0]===recipe.method[0]&&context.ingredients.some(item=>item.name==='Chicken breast'&&item.quantity==='665 g')&&context.ingredients.some(item=>item.name==='Cheddar'&&item.quantity==='265 g');
          await wait(()=>!busy);
          voiceStage='cheddar';onFinal('How much cheddar?');await wait(()=>spoken.includes(answers.cheddar));
          report.voiceScaledAmount=spoken.includes(answers.cheddar)&&requests.at(-1)?.payload.recipe.ingredients.some(item=>item.name==='Cheddar'&&item.quantity==='265 g');await wait(()=>!busy);
          voiceStage='nextStep';onFinal('Next step');await wait(()=>/STEP 2 OF/.test(document.getElementById('bbBody').textContent));
          report.voiceNextStep=/STEP 2 OF/.test(document.getElementById('bbBody').textContent);
          if(!document.getElementById('bbInstruction').textContent.includes(recipe.method[1]))throw Error('VoiceCookNextInstruction');
          const nextStep='Toss chicken and peppers with oil, fajita seasoning, salt and pepper.';
          await wait(()=>spoken.some(text=>text.toLowerCase().includes(nextStep.toLowerCase())));
          report.voiceStepNarrated=spoken.filter(text=>text.toLowerCase().includes(nextStep.toLowerCase())).length===1;await wait(()=>!busy);
          voiceStage='timer';onFinal('Start timer');await wait(()=>/Pause/.test(document.getElementById('bbTimerToggle').textContent));
          await wait(()=>!busy);onFinal('Start timer');report.voiceTimer=/Pause/.test(document.getElementById('bbTimerToggle').textContent);await wait(()=>!busy);
          voiceStage='cancelQuestion';onFinal('What if they start to stick?');await wait(()=>pendingAnswer);
          const interrupt=await wait(()=>{const button=document.querySelector('.bbcv-interrupt');return button&&!button.hidden&&!button.disabled?button:null;});interrupt.click();
          await wait(()=>pendingAnswer.signal.aborted);const countBeforeCancel=privateAudio;
          pendingAnswer.resolve({answer:'This cancelled answer must never be displayed or spoken.'});await pause(60);
          report.mentorCancelledAnswer=!document.querySelector('.bbcv-answer').textContent.includes('cancelled answer')&&privateAudio===countBeforeCancel;
          report.mentorInterrupt=pendingAnswer.signal.aborted&&toggle.getAttribute('aria-pressed')==='true';
          voiceStage='naturalVoiceFailure';failAudio=true;onFinal('Can I use yoghurt instead?');await wait(()=>document.querySelector('.bbcv-answer')?.textContent.includes(answers.yoghurt));
          const retry=await wait(()=>{const button=document.querySelector('.bbcv-retry');return button&&!button.hidden&&!button.disabled?button:null;});
          report.mentorNoDeviceFallback=fallbacks===0&&sharedAudio===0&&!!retry;
          if(requests.at(-1)?.payload.history.some(turn=>turn.text==='What if they start to stick?'))throw Error('MentorCancelledHistory');
          retry.click();await wait(()=>spoken.includes(answers.yoghurt)&&!busy);
          report.mentorPrivateAudio=privateAudio>0&&privateAudio===playback.length&&sharedAudio===0&&prepared.length>=privateAudio&&playback.every(audio=>audio.contentType==='audio/mpeg'&&!audio.url&&!audio.token);
          voiceStage='exit';const previousStops=stops;document.getElementById('bbExit').click();await wait(()=>!document.querySelector('.cook-overlay'));
          report.voiceExitStopped=stops>previousStops;
          voiceStage='freshConversation';const startsBefore=starts;toggle=await open();await typed('How much cheddar?',answers.cheddar);
          report.mentorHistoryCleared=requests.at(-1)?.payload.history.length===0&&starts===startsBefore;
          voiceStage='mentorName';document.querySelector('.bbcv-name-edit').click();
          const nameInput=await wait(()=>document.querySelector('.bbcv-name-input'));nameInput.value='<img src=x>';document.querySelector('.bbcv-name-save').click();
          const invalidNameKept=document.querySelector('.bbcv-name-display').textContent.includes('Chef Boss')&&!document.querySelector('.bbcv-name-display img');
          nameInput.value='Pan Pal';document.querySelector('.bbcv-name-save').click();await wait(()=>document.querySelector('.bbcv-name-display').textContent.includes('Pan Pal'));
          const audioBeforeGreeting=privateAudio,questionsBeforeGreeting=requests.length;document.getElementById('bbStart').click();
          const customGreeting='Hi, ready to get cooking? I’m Pan Pal. Let’s make '+recipe.name+' together.';
          await wait(()=>document.querySelector('.bbcv-answer')?.textContent.includes(customGreeting));
          const silentGreeting=starts===startsBefore&&privateAudio===audioBeforeGreeting&&requests.length===questionsBeforeGreeting;
          await typed('How much cheddar?',answers.cheddar);
          report.mentorGreetingName=defaultGreeting&&invalidNameKept&&silentGreeting&&requests.at(-1)?.payload.mentorName==='Pan Pal';
          document.getElementById('bbExit').click();
        }finally{
          document.getElementById('bbExit')?.click();
          window.BasketBossVerifiedPremium=originalPremium;window.BBNativeCookVoice=originalVoice;window.BBCookVoice=originalController;
          const nameKeys=[];for(let n=0;n<localStorage.length;n++){const key=localStorage.key(n);if(key?.startsWith(namePrefix))nameKeys.push(key);}
          for(const key of nameKeys)localStorage.removeItem(key);for(const [key,value] of nameSnapshot)localStorage.setItem(key,value);
          if(snapshot===null)localStorage.removeItem(stateKey);else localStorage.setItem(stateKey,snapshot);
          if(recovery===null)localStorage.removeItem(recoveryKey);else localStorage.setItem(recoveryKey,recovery);
          refresh();report.voiceRestored=localStorage.getItem(stateKey)===snapshot&&window.BasketBossVerifiedPremium===originalPremium&&window.BBNativeCookVoice===originalVoice&&window.BBCookVoice===originalController;
        }
        return report;
      }
      addEventListener('load',()=>progress(),true);
      document.addEventListener('readystatechange',()=>progress());
      new MutationObserver(records=>{if(records.some(record=>[...record.addedNodes].some(node=>node.nodeName==='SCRIPT')))progress();}).observe(document.documentElement,{childList:true,subtree:true});
      const timer=setInterval(()=>{
        ticks++;if(ticks%10===0)progress();if(navigationPending){if(ticks>200)send({passed:false});return;}if(document.readyState==='loading'){if(ticks>200)send({passed:false});return;}
        const stage=sessionStorage.getItem(key),cook=location.pathname.endsWith('/make-a-meal.html');
        if(!cook){
          if(window.BBNativeStartup?.phase!=='ready'){if(ticks>200)send({passed:false});return;}
          if(stage==='back'){
            const report=JSON.parse(sessionStorage.getItem(key+'_report')||'{}');
            report.backToPlan=document.body.dataset.bbnextView==='week';report.dataKept=localStorage.getItem('basketboss_native_smoke_probe')==='keep';
            report.passed=!!(report.nativeOrigin&&report.cookMounted&&report.cookReady&&report.navVisible&&report.navHit&&report.backToPlan&&report.dataKept&&report.ingredientClosed&&report.ingredientPhoto&&report.ingredientSaved&&report.ingredientAutofill&&report.ingredientExistingKept&&report.ingredientRestored&&report.voiceFreeLocked&&report.voiceManualStart&&report.voiceNextStep&&report.voiceTimer&&report.voiceScaledAmount&&report.voiceExitStopped&&report.voiceRestored&&report.voicePrepAvailable&&report.voicePrepNarrated&&report.voicePrepAdvanced&&report.voiceCookNarrated&&report.voiceStepNarrated&&report.mentorAvailable&&report.mentorRecipeContext&&report.mentorSpokenQuestion&&report.mentorTypedQuestion&&report.mentorFollowupHistory&&report.mentorPrivateAudio&&report.mentorAnswerVisible&&report.mentorNoAutonomousActions&&report.mentorCancelledAnswer&&report.mentorInterrupt&&report.mentorHistoryCleared&&report.mentorNoDeviceFallback&&report.mentorGreetingName);send(report);return;
          }
          if(!sessionStorage.getItem(key+'_region')){const select=document.getElementById('bb307Island'),save=document.getElementById('bb307SaveMarket');if(select&&save){select.value='UK';select.dispatchEvent(new Event('change',{bubbles:true}));save.click();sessionStorage.setItem(key+'_region','1');return;}}
          if(!sessionStorage.getItem(key+'_ingredients')){
            if(!ingredientRunning){ingredientRunning=true;void verifyIngredients().then(report=>{sessionStorage.setItem(key+'_report',JSON.stringify(report));if(Object.values(report).some(value=>value!==true)){send({...report,passed:false});return;}sessionStorage.setItem(key+'_ingredients','1');ingredientRunning=false;}).catch(()=>send({passed:false}));}
            return;
          }
          if(!sessionStorage.getItem(key+'_voice')){
            if(!voiceRunning){voiceRunning=true;void verifyVoiceCook().then(report=>{sessionStorage.setItem(key+'_report',JSON.stringify({...JSON.parse(sessionStorage.getItem(key+'_report')||'{}'),...report}));if(Object.values(report).some(value=>value!==true)){send({...report,passed:false});return;}sessionStorage.setItem(key+'_voice','1');voiceRunning=false;}).catch(error=>send({passed:false,phase:'voice',voiceFailure:String(error.message||'VoiceCookSmokeError').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100)}));}
            return;
          }
          const link=document.querySelector('.bb173-make-meal-link');if(link){navigationPending=true;sessionStorage.setItem(key,'cook');link.click();}if(ticks>200)send({passed:false,navPresent:!!link});return;
        }
        if(!scrolled){scrollTo(0,document.body.scrollHeight);scrolled=true;return;}
        const nav=document.querySelector('nav.bb-r6-cook-nav'),r=nav?.getBoundingClientRect(),style=nav&&getComputedStyle(nav),height=visualViewport?.height||innerHeight;
        const visible=!!(r&&r.width>0&&r.height>0&&r.top>=0&&r.bottom<=height+1&&style.display!=='none'&&style.visibility!=='hidden');
        const hit=visible&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('nav')===nav;
        const report={...JSON.parse(sessionStorage.getItem(key+'_report')||'{}'),nativeOrigin:location.protocol==='capacitor:',cookMounted:!!document.querySelector('.bb-cook-studio'),cookReady:document.documentElement.classList.contains('bb-cook-ready'),navPresent:!!nav,navVisible:visible,navHit:!!hit,legacyVisible:!!document.querySelector('.bb-meal-dashboard')&&getComputedStyle(document.querySelector('.bb-meal-dashboard')).display!=='none'};
        if(report.cookMounted&&report.cookReady&&visible&&hit){navigationPending=true;sessionStorage.setItem(key+'_report',JSON.stringify(report));progress(report);sessionStorage.setItem(key,'back');nav.querySelector('a').click();return;}
        if(ticks>30)send({...report,passed:false});
      },100);
    })();
    """#
}
#endif

// Native animation runs before, and independently of, the WKWebView JavaScript.
// The wordmark is present from the first frame during the requested intro.
private final class BasketBossStartupView: UIView {
    private let presentedAt = CACurrentMediaTime()
    var remainingIntroDuration: TimeInterval {
        #if DEBUG
        #if targetEnvironment(simulator)
        if BasketBossKeyboardUITestRuntime.disablesAnimations { return 0 }
        #endif
        #endif
        return UIAccessibility.isReduceMotionEnabled ? 0 : max(0, 4.0 - (CACurrentMediaTime() - presentedAt))
    }
    var retry: (() -> Void)?
    private let logo = UIImageView(image: UIImage(named: "Splash"))
    private let name = UILabel()
    private let tagline = UILabel()
    private let recovery = UIStackView()
    private let retryButton = UIButton(type: .system)
    private var stars: [UILabel] = []
    private var brandCenter: NSLayoutConstraint?
    private var motionStarted = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 1, green: 0.992157, blue: 0.968627, alpha: 1)
        isAccessibilityElement = false
        accessibilityViewIsModal = true
        let forest = UIColor(red: 0.09, green: 0.23, blue: 0.196, alpha: 1)
        let green = UIColor(red: 0.173, green: 0.533, blue: 0.333, alpha: 1)
        logo.contentMode = .scaleAspectFit
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.accessibilityElementsHidden = true
        logo.layer.cornerRadius = 30
        logo.clipsToBounds = true
        name.attributedText = NSAttributedString(string: "BasketBoss", attributes: [
            .font: UIFont.systemFont(ofSize: 38, weight: .heavy), .foregroundColor: forest, .kern: -1.6
        ])
        let wordmark = NSMutableAttributedString(attributedString: name.attributedText!)
        wordmark.addAttribute(.foregroundColor, value: green, range: NSRange(location: 6, length: 4))
        name.attributedText = wordmark
        name.textAlignment = .center
        name.accessibilityLabel = "BasketBoss"
        tagline.text = "Plan smarter. Eat better. Less waste."
        tagline.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        tagline.textColor = UIColor(red: 0.286, green: 0.412, blue: 0.341, alpha: 1)
        tagline.textAlignment = .center
        let stack = UIStackView(arrangedSubviews: [logo, name, tagline])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        let centerBrand = stack.centerYAnchor.constraint(equalTo: centerYAnchor)
        brandCenter = centerBrand
        NSLayoutConstraint.activate([
            logo.widthAnchor.constraint(equalToConstant: 128), logo.heightAnchor.constraint(equalToConstant: 128),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor), centerBrand,
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -18)
        ])
        for index in 0..<4 {
            let star = UILabel()
            star.text = index % 2 == 0 ? "✦" : "✧"
            star.font = UIFont.systemFont(ofSize: index % 2 == 0 ? 25 : 20, weight: .semibold)
            star.textColor = index % 2 == 0 ? UIColor(red: 0.76, green: 0.58, blue: 0.16, alpha: 1) : green
            star.translatesAutoresizingMaskIntoConstraints = false
            star.alpha = 0
            star.accessibilityElementsHidden = true
            addSubview(star)
            let offsetX: CGFloat = index % 2 == 0 ? -104 : 104
            let offsetY: CGFloat = index < 2 ? -42 : 40
            NSLayoutConstraint.activate([
                star.centerXAnchor.constraint(equalTo: logo.centerXAnchor, constant: offsetX),
                star.centerYAnchor.constraint(equalTo: logo.centerYAnchor, constant: offsetY)
            ])
            stars.append(star)
        }
        let note = UILabel()
        note.text = "BasketBoss is taking longer to open."
        note.font = UIFont.systemFont(ofSize: 14)
        note.textColor = forest
        note.textAlignment = .center
        let again = retryButton
        again.setTitle("Try again", for: .normal)
        again.titleLabel?.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        again.tintColor = green
        again.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        again.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        recovery.addArrangedSubview(note)
        recovery.addArrangedSubview(again)
        recovery.axis = .vertical
        recovery.alignment = .center
        recovery.spacing = 8
        recovery.translatesAutoresizingMaskIntoConstraints = false
        recovery.isHidden = true
        addSubview(recovery)
        NSLayoutConstraint.activate([
            recovery.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -20),
            recovery.centerXAnchor.constraint(equalTo: centerXAnchor),
            recovery.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 18),
            recovery.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -18)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func startMotion() {
        guard !motionStarted else { return }
        motionStarted = true
        #if DEBUG
        #if targetEnvironment(simulator)
        if BasketBossKeyboardUITestRuntime.disablesAnimations { return }
        #endif
        #endif
        guard !UIAccessibility.isReduceMotionEnabled else { return }
        logo.transform = CGAffineTransform(rotationAngle: -0.07).scaledBy(x: 0.88, y: 0.88)
        name.transform = CGAffineTransform(translationX: 0, y: 6).scaledBy(x: 0.98, y: 0.98)
        UIView.animate(withDuration: 0.7, delay: 0, usingSpringWithDamping: 0.6, initialSpringVelocity: 0.3, options: [.allowUserInteraction], animations: {
            self.logo.transform = .identity
            self.name.transform = .identity
        }, completion: nil)
        for (index, star) in stars.enumerated() {
            star.transform = CGAffineTransform(scaleX: 0.5, y: 0.5)
            UIView.animate(withDuration: 0.32, delay: Double(index) * 0.05, options: [.curveEaseOut], animations: {
                star.alpha = 0.85
                star.transform = .identity
            }, completion: { _ in
                UIView.animate(withDuration: 0.4, animations: { star.alpha = 0 })
            })
        }
        let sway = CABasicAnimation(keyPath: "transform.rotation.z")
        sway.fromValue = -0.018
        sway.toValue = 0.018
        sway.duration = 1.1
        sway.autoreverses = true
        sway.repeatCount = .infinity
        sway.beginTime = CACurrentMediaTime() + 0.7
        logo.layer.add(sway, forKey: "basketboss-gentle-sway")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Leave the recovery button clear of the central brand on short screens.
        brandCenter?.constant = !recovery.isHidden && bounds.height < 500 ? -48 : 0
    }

    func showRecovery() {
        recovery.isHidden = false
        setNeedsLayout()
        UIAccessibility.post(notification: .layoutChanged, argument: retryButton)
    }

    @objc private func retryTapped() { retry?() }
}

// CAPPlugin.shouldOverrideLoad returns true to cancel a navigation, or nil to
// defer to Capacitor's normal policy. This also catches direct location.assign,
// scripted form submissions and target=_blank destinations that bypass DOM JS.
@objc(BasketBossNavigationPlugin)
public class BasketBossNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BasketBossNavigationPlugin"
    public let jsName = "BasketBossNavigation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "clearReceiptPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishStartup", returnType: CAPPluginReturnPromise)
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

    @objc func finishStartup(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let controller = self?.bridge?.viewController as? BasketBossViewController else {
                call.reject("Startup controller is unavailable.", "BB_NATIVE_STARTUP")
                return
            }
            controller.finishStartup { call.resolve(["ok": true]) }
        }
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
