import Foundation
import UIKit
import AVFoundation
import Speech
import Capacitor

// Speech is explicitly started by the Cook microphone toggle. This bridge
// never persists recording, transcripts or personalised reply audio. The web
// controller sends opted-in cooking questions to the authenticated mentor.
@objc(BasketBossCookVoicePlugin)
public final class BasketBossCookVoicePlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    public let identifier = "BasketBossCookVoicePlugin"
    public let jsName = "BasketBossCookVoice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playAudioData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelSpeech", returnType: CAPPluginReturnPromise)
    ]
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-GB"))
    private let engine = AVAudioEngine()
    private let speaker = AVSpeechSynthesizer()
    private var recognition: SFSpeechRecognitionTask?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var observers: [NSObjectProtocol] = []
    private var sessionId: String?
    private var operation = 0
    private var capture = 0
    private var intent = false
    private var tapInstalled = false
    private var spoken: AVSpeechUtterance?
    private var speechId: String?
    private var speechHeld = false
    private var player: AVPlayer?
    private var memoryPlayer: AVAudioPlayer?
    private var memoryProgress: Timer?
    private var playerItem: AVPlayerItem?
    private var audioLoader: BBCookAudioLoader?
    private var playerStatus: NSKeyValueObservation?
    private var playerProgress: Any?
    private var playbackObservers: [NSObjectProtocol] = []
    private var playbackCall: CAPPluginCall?
    private var playbackTimeout: DispatchWorkItem?
    private var playbackDeadline: DispatchWorkItem?
    private var playbackKeepHeld = false
    private var lastPlaybackTime = 0.0
    private var rollover: DispatchWorkItem?
    private var finalTimeout: DispatchWorkItem?
    private var speechBoundary = BBCookSpeechBoundary()
    private var lastPartial = ""
    private var endingAudio = false
    private var previousAudio: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?

    override public func load() {
        speaker.delegate = self
        for name in [UIApplication.didEnterBackgroundNotification, AVAudioSession.interruptionNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in self?.shutdown(code: "BB_VOICE_INTERRUPTED") }
            })
        }
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            guard let value = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  value == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue || value == AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue else { return }
            Task { @MainActor [weak self] in self?.shutdown(code: "BB_VOICE_INTERRUPTED") }
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                // Permission prompts temporarily deactivate the app before any
                // recording begins. A live session still stops immediately.
                if self?.intent == true { self?.shutdown(code: "BB_VOICE_INTERRUPTED") }
            }
        })
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        rollover?.cancel(); finalTimeout?.cancel()
        recognition?.cancel(); engine.stop()
        playerStatus?.invalidate()
        for observer in playbackObservers { NotificationCenter.default.removeObserver(observer) }
        if let progress = playerProgress { player?.removeTimeObserver(progress) }
        playbackTimeout?.cancel(); playbackDeadline?.cancel()
        player?.pause(); audioLoader?.cancel()
        memoryProgress?.invalidate(); memoryPlayer?.delegate = nil; memoryPlayer?.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0) }
    }

    @objc public func available(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self = self else { call.resolve(["available": false]); return }
            call.resolve(["available": self.recognizer?.isAvailable == true,
                          "onDevice": self.recognizer?.supportsOnDeviceRecognition == true])
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        guard let id = call.getString("sessionId"), id.range(of: "^[A-Za-z0-9-]{1,80}$", options: .regularExpression) != nil else {
            call.reject("A Cook voice session is required.", "BB_VOICE_SESSION"); return
        }
        Task { @MainActor [weak self] in
            guard let self = self else { call.reject("Speech is unavailable.", "BB_VOICE_UNAVAILABLE"); return }
            self.shutdown()
            self.operation += 1
            let epoch = self.operation
            self.sessionId = id
            guard self.recognizer?.isAvailable == true else { self.shutdown(); call.reject("Speech is unavailable.", "BB_VOICE_UNAVAILABLE"); return }
            let speech = await self.speechPermission()
            guard self.operation == epoch, self.sessionId == id else { call.reject("Listening was stopped.", "BB_VOICE_STOPPED"); return }
            guard speech else { self.shutdown(); call.reject("Allow Speech Recognition in Settings to use Cook voice.", "BB_VOICE_SPEECH_PERMISSION"); return }
            let microphone = await self.microphonePermission()
            guard self.operation == epoch, self.sessionId == id else { call.reject("Listening was stopped.", "BB_VOICE_STOPPED"); return }
            guard microphone else { self.shutdown(); call.reject("Allow Microphone in Settings to use Cook voice.", "BB_VOICE_MICROPHONE_PERMISSION"); return }
            for _ in 0..<15 where UIApplication.shared.applicationState != .active {
                try? await Task.sleep(nanoseconds: 100_000_000)
                guard self.operation == epoch, self.sessionId == id else { call.reject("Listening was stopped.", "BB_VOICE_STOPPED"); return }
            }
            guard UIApplication.shared.applicationState == .active else { self.shutdown(); call.reject("Open Cook before listening.", "BB_VOICE_STOPPED"); return }
            let audio = AVAudioSession.sharedInstance()
            self.previousAudio = (audio.category, audio.mode, audio.categoryOptions)
            self.intent = true
            do {
                try self.beginCapture()
                call.resolve(["active": true, "onDevice": self.recognizer?.supportsOnDeviceRecognition == true])
            } catch {
                self.shutdown(); call.reject("The microphone could not start.", "BB_VOICE_MICROPHONE_UNAVAILABLE")
            }
        }
    }

    @MainActor private func speechPermission() async -> Bool {
        let current = SFSpeechRecognizer.authorizationStatus()
        if current != .notDetermined { return current == .authorized }
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
    }

    @MainActor private func microphonePermission() async -> Bool {
        let audio = AVAudioSession.sharedInstance()
        if audio.recordPermission != .undetermined { return audio.recordPermission == .granted }
        return await withCheckedContinuation { continuation in
            audio.requestRecordPermission { continuation.resume(returning: $0) }
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        let id = call.getString("sessionId")
        Task { @MainActor [weak self] in
            guard let self = self else { call.resolve(); return }
            if id == nil || self.sessionId == id { self.shutdown() }
            call.resolve()
        }
    }

    @objc public func prepareSpeech(_ call: CAPPluginCall) {
        guard let id = call.getString("sessionId") else { call.reject("A voice session is required.", "BB_VOICE_SESSION"); return }
        Task { @MainActor [weak self] in
            guard let self = self, self.active(id) else { call.resolve(["cancelled": true]); return }
            let ticket = self.holdSpeech()
            call.resolve(["speechId": ticket])
        }
    }

    @objc public func cancelSpeech(_ call: CAPPluginCall) {
        guard let id = call.getString("sessionId"), let ticket = call.getString("speechId") else { call.resolve(["cancelled": true]); return }
        Task { @MainActor [weak self] in
            guard let self = self, self.sessionId == id, self.speechId == ticket else { call.resolve(["cancelled": true]); return }
            self.clearOutput()
            self.speechHeld = false; self.speechId = nil
            self.resumeAfterPause()
            call.resolve(["cancelled": true])
        }
    }

    @objc public func speak(_ call: CAPPluginCall) {
        guard let id = call.getString("sessionId"), let raw = call.getString("text") else { call.reject("A voice response is required.", "BB_VOICE_SESSION"); return }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 4000 else { call.reject("The voice response is too long.", "BB_VOICE_TEXT"); return }
        let requestedTicket = call.getString("speechId")
        Task { @MainActor [weak self] in
            guard let self = self, self.active(id) else { call.resolve(["spoken": false, "cancelled": true]); return }
            if let ticket = requestedTicket {
                guard self.speechHeld, self.speechId == ticket else { call.resolve(["spoken": false, "cancelled": true]); return }
                self.clearOutput()
            } else { _ = self.holdSpeech() }
            do {
                try self.playbackCategory()
                let utterance = AVSpeechUtterance(string: text)
                utterance.voice = Self.cookeryVoice()
                utterance.rate = AVSpeechUtteranceDefaultSpeechRate
                utterance.pitchMultiplier = 1.0
                utterance.preUtteranceDelay = 0.10
                utterance.postUtteranceDelay = 0.12
                self.spoken = utterance
                self.status("paused")
                self.speaker.speak(utterance)
                call.resolve(["spoken": true])
            } catch { self.shutdown(code: "BB_VOICE_AUDIO"); call.reject("The response could not be read aloud.", "BB_VOICE_AUDIO") }
        }
    }

    @objc public func playAudio(_ call: CAPPluginCall) {
        guard let id = call.getString("sessionId"), let ticket = call.getString("speechId"),
              let address = call.getString("url"), let url = Self.audioURL(address),
              let token = call.getString("token"), !token.isEmpty, token.utf8.count <= 16384,
              token.range(of: "^[A-Za-z0-9._~-]+$", options: .regularExpression) != nil else {
            call.reject("A valid Cook audio response is required.", "BB_VOICE_AUDIO_URL"); return
        }
        Task { @MainActor [weak self] in
            guard let self = self, self.active(id), self.speechHeld, self.speechId == ticket else { call.resolve(["spoken": false, "cancelled": true]); return }
            self.clearOutput()
            do {
                try self.playbackCategory()
                var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
                parts.scheme = "bbcook-audio"
                let asset = AVURLAsset(url: parts.url!)
                let loader = BBCookAudioLoader(url: url, token: token) { [weak self] code in
                    Task { @MainActor [weak self] in
                        guard let self = self, self.active(id), self.speechId == ticket, self.playbackCall != nil else { return }
                        self.audioFailed(code: code)
                    }
                }
                loader.attach(to: asset)
                let item = AVPlayerItem(asset: asset), player = AVPlayer(playerItem: item)
                player.automaticallyWaitsToMinimizeStalling = false
                self.audioLoader = loader; self.playerItem = item; self.player = player; self.playbackCall = call
                let valid: @MainActor () -> Bool = { [weak self, weak item] in self?.active(id) == true && self?.speechId == ticket && self?.playerItem === item }
                self.playerStatus = item.observe(\.status, options: [.new]) { [weak self] item, _ in
                    Task { @MainActor [weak self] in
                        guard let self = self, valid() else { return }
                        if item.status == .failed { self.audioFailed() }
                    }
                }
                self.playbackObservers.append(NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
                    Task { @MainActor [weak self] in guard let self = self, valid() else { return }; self.audioFinished() }
                })
                self.playbackObservers.append(NotificationCenter.default.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { [weak self] _ in
                    Task { @MainActor [weak self] in guard let self = self, valid() else { return }; self.audioFailed() }
                })
                self.playerProgress = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 10), queue: .main) { [weak self] time in
                    Task { @MainActor [weak self] in
                        guard let self = self, valid(), time.seconds.isFinite, time.seconds > self.lastPlaybackTime + 0.05 else { return }
                        self.lastPlaybackTime = time.seconds
                        self.playbackWatchdog(id: id, ticket: ticket, item: item, delay: 15)
                    }
                }
                self.playbackWatchdog(id: id, ticket: ticket, item: item, delay: 15)
                let deadline = DispatchWorkItem { [weak self, weak item] in
                    Task { @MainActor [weak self] in guard let self = self, let item = item, self.active(id), self.speechId == ticket, self.playerItem === item else { return }; self.audioFailed() }
                }
                self.playbackDeadline = deadline
                DispatchQueue.main.asyncAfter(deadline: .now() + 360, execute: deadline)
                self.status("paused"); player.play()
            } catch {
                // The caller falls back to installed speech using the same held
                // ticket. Do not stop the voice session for a recoverable stream error.
                self.clearOutput(); call.reject("AI audio is unavailable.", "BB_VOICE_AI_AUDIO")
            }
        }
    }

    // Personalised mentor replies use bounded in-memory MP3 bytes. They never
    // enter a shared recipe clip cache, a temporary file or a network player.
    @objc public func playAudioData(_ call: CAPPluginCall) {
        guard let id = call.getString("sessionId"), let ticket = call.getString("speechId"),
              call.getString("contentType") == "audio/mpeg", let encoded = call.getString("base64"),
              encoded.utf8.count <= ((2 * 1024 * 1024 + 2) / 3) * 4 else {
            call.reject("A valid Cook audio response is required.", "BB_VOICE_AI_AUDIO"); return
        }
        Task { @MainActor [weak self] in
            guard let self = self, self.active(id), self.speechHeld, self.speechId == ticket else { call.resolve(["spoken": false, "cancelled": true]); return }
            guard let data = Data(base64Encoded: encoded), Self.validAudioData(data) else {
                call.reject("The Cook audio response could not be read.", "BB_VOICE_AI_AUDIO"); return
            }
            self.clearOutput(); self.playbackCall = call
            self.playbackKeepHeld = call.getBool("keepHeld") == true
            do {
                try self.playbackCategory()
                let player = try AVAudioPlayer(data: data, fileTypeHint: AVFileType.mp3.rawValue)
                guard player.duration.isFinite, player.duration > 0, player.duration <= 360 else {
                    self.audioFailed(); return
                }
                player.delegate = self; player.numberOfLoops = 0
                self.memoryPlayer = player
                guard player.prepareToPlay(), player.play() else { self.audioFailed(); return }
                self.status("paused")
                let progress = Timer(timeInterval: 1, repeats: true) { [weak self, weak player] _ in
                    Task { @MainActor [weak self, weak player] in
                        guard let self = self, let player = player, self.active(id), self.speechId == ticket,
                              self.memoryPlayer === player, player.currentTime.isFinite,
                              player.currentTime > self.lastPlaybackTime + 0.05 else { return }
                        self.lastPlaybackTime = player.currentTime
                        self.memoryPlaybackWatchdog(id: id, ticket: ticket, player: player)
                    }
                }
                self.memoryProgress = progress
                RunLoop.main.add(progress, forMode: .common)
                self.memoryPlaybackWatchdog(id: id, ticket: ticket, player: player)
                let deadline = DispatchWorkItem { [weak self, weak player] in
                    Task { @MainActor [weak self, weak player] in
                        guard let self = self, let player = player, self.active(id), self.speechId == ticket,
                              self.memoryPlayer === player else { return }
                        self.audioFailed()
                    }
                }
                self.playbackDeadline = deadline
                DispatchQueue.main.asyncAfter(deadline: .now() + 360, execute: deadline)
                // Resolve only from completion, cancellation or failure. The
                // controller retains this ticket so its interrupt control works.
            } catch { self.audioFailed() }
        }
    }

    private static func validAudioData(_ data: Data) -> Bool {
        guard data.count >= 3, data.count <= 2 * 1024 * 1024 else { return false }
        let head = Array(data.prefix(3))
        return (head[0] == 73 && head[1] == 68 && head[2] == 51) ||
            (head[0] == 255 && (head[1] & 224) == 224)
    }

    private static func audioURL(_ value: String) -> URL? {
        guard let parts = URLComponents(string: value), parts.scheme == "https", parts.host == "basketboss.co.uk",
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
              parts.percentEncodedPath == "/api/tts", let query = parts.queryItems, query.count == 1,
              query[0].name == "clip", let clip = query[0].value,
              clip.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
        return parts.url
    }

    @MainActor private func active(_ id: String) -> Bool {
        intent && sessionId == id && UIApplication.shared.applicationState == .active
    }

    @MainActor private func playbackCategory() throws {
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try audio.setActive(true)
    }

    @MainActor private func holdSpeech() -> String {
        stopCapture(); clearOutput()
        let ticket = UUID().uuidString
        speechId = ticket; speechHeld = true
        status("paused")
        return ticket
    }

    @MainActor private func clearOutput() {
        spoken = nil; speaker.stopSpeaking(at: .immediate)
        playerStatus?.invalidate(); playerStatus = nil
        for observer in playbackObservers { NotificationCenter.default.removeObserver(observer) }
        playbackObservers.removeAll()
        if let progress = playerProgress { player?.removeTimeObserver(progress) }; playerProgress = nil
        playbackTimeout?.cancel(); playbackTimeout = nil
        playbackDeadline?.cancel(); playbackDeadline = nil; lastPlaybackTime = 0
        playbackKeepHeld = false
        player?.pause(); player?.replaceCurrentItem(with: nil); player = nil; playerItem = nil
        memoryProgress?.invalidate(); memoryProgress = nil
        memoryPlayer?.delegate = nil; memoryPlayer?.stop(); memoryPlayer = nil
        audioLoader?.cancel(); audioLoader = nil
        let call = playbackCall; playbackCall = nil
        call?.resolve(["spoken": false, "cancelled": true])
    }

    @MainActor private func playbackWatchdog(id: String, ticket: String, item: AVPlayerItem, delay: Double) {
        playbackTimeout?.cancel()
        let timeout = DispatchWorkItem { [weak self, weak item] in
            Task { @MainActor [weak self] in
                guard let self = self, let item = item, self.active(id), self.speechId == ticket, self.playerItem === item else { return }
                self.audioFailed()
            }
        }
        playbackTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: timeout)
    }

    @MainActor private func memoryPlaybackWatchdog(id: String, ticket: String, player: AVAudioPlayer) {
        playbackTimeout?.cancel()
        let timeout = DispatchWorkItem { [weak self, weak player] in
            Task { @MainActor [weak self, weak player] in
                guard let self = self, let player = player, self.active(id), self.speechId == ticket,
                      self.memoryPlayer === player else { return }
                self.audioFailed()
            }
        }
        playbackTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
    }

    @MainActor private func audioFailed(code: String? = nil) {
        // Resource failures can also arrive through AVPlayer's generic failure
        // observer. Read the locked denial first so that race never downgrades
        // a revoked membership to an ordinary offline-fallback error.
        let reason = code ?? audioLoader?.accessFailureCode ?? "BB_VOICE_AI_AUDIO"
        let call = playbackCall; playbackCall = nil
        clearOutput()
        // Keep the ticket held until the controller cancels definitive denials
        // or starts installed speech for a recoverable connection failure.
        call?.reject(reason == "BB_VOICE_AI_AUDIO" ? "AI audio is unavailable." : "Voice Cook access needs checking.", reason)
    }

    @MainActor private func audioFinished() {
        let call = playbackCall; playbackCall = nil
        let keepHeld = playbackKeepHeld
        clearOutput()
        if !keepHeld { speechHeld = false; speechId = nil }
        call?.resolve(["spoken": true])
        // A sentence sequence owns one ticket until cancelSpeech releases it.
        // Even a long network gap must never capture the speaker's own reply.
        if !keepHeld { resumeAfterPause() }
    }

    @MainActor private func status(_ state: String, code: String? = nil) {
        guard let id = sessionId else { return }
        var value: JSObject = ["sessionId": id, "state": state]
        if let code = code { value["code"] = code }
        notifyListeners("voiceStatus", data: value)
    }

    private static func cookeryVoice() -> AVSpeechSynthesisVoice? {
        // Select an original installed system voice, never an imitation of a
        // named person. An enhanced/premium voice must win over a compact
        // female voice: quality matters more than gender for natural speech.
        // Voice availability and quality depend on the device's downloads.
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.lowercased() == "en-gb" }
        return voices.sorted { left, right in
            func quality(_ voice: AVSpeechSynthesisVoice) -> Int {
                switch voice.quality { case .premium: return 3; case .enhanced: return 2; default: return 1 }
            }
            if quality(left) != quality(right) { return quality(left) > quality(right) }
            let leftFemale = left.gender == .female, rightFemale = right.gender == .female
            if leftFemale != rightFemale { return leftFemale }
            return left.identifier < right.identifier
        }.first ?? AVSpeechSynthesisVoice(language: "en-GB")
    }

    @MainActor private func beginCapture() throws {
        guard intent, spoken == nil, !speechHeld, UIApplication.shared.applicationState == .active,
              let recognizer = recognizer, recognizer.isAvailable else { throw NSError(domain: "CookVoice", code: 1) }
        stopCapture()
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try audio.setActive(true)
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        let format = engine.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "CookVoice", code: 2) }
        let cycle = capture
        engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            request.append(buffer)
            // Read samples on the audio callback. Never move an AVAudioPCMBuffer
            // across queues: the engine reuses its storage after this returns.
            guard let energy = Self.decibels(buffer) else { return }
            let duration = Double(buffer.frameLength) / format.sampleRate
            Task { @MainActor [weak self] in
                guard let self = self, self.intent, self.capture == cycle, !self.endingAudio else { return }
                if self.speechBoundary.append(decibels: energy, duration: duration), !self.lastPartial.isEmpty {
                    self.endUtterance(cycle: cycle)
                }
            }
        }
        tapInstalled = true
        engine.prepare(); try engine.start()
        recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor [weak self] in
                guard let self = self, self.intent, self.capture == cycle else { return }
                if let result = result {
                    let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                    if result.isFinal {
                        self.finishUtterance(text: text, cycle: cycle)
                        return
                    }
                    if !text.isEmpty {
                        self.lastPartial = text
                        if self.endingAudio || self.speechBoundary.recognized() {
                            self.finishUtterance(text: text, cycle: cycle)
                            return
                        }
                    }
                }
                if error != nil {
                    if self.endingAudio && self.lastPartial.isEmpty { self.stopCapture(); self.resumeAfterPause() }
                    else { self.shutdown(code: "BB_VOICE_RECOGNITION") }
                }
            }
        }
        let end = DispatchWorkItem { [weak self] in Task { @MainActor [weak self] in self?.endUtterance(cycle: cycle) } }
        rollover = end
        DispatchQueue.main.asyncAfter(deadline: .now() + 45, execute: end)
        status("listening")
    }

    @MainActor private func endUtterance(cycle: Int) {
        guard intent, capture == cycle, !endingAudio else { return }
        // Once real microphone silence establishes the boundary, dispatch the
        // latest bounded hypothesis immediately. Apple final/error callbacks
        // from the cancelled capture are invalidated by finishUtterance.
        if !lastPartial.isEmpty {
            finishUtterance(text: lastPartial, cycle: cycle)
            return
        }
        endingAudio = true
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio()
        let timeout = DispatchWorkItem { [weak self] in
            Task { @MainActor [weak self] in
                guard let self = self, self.capture == cycle else { return }
                self.stopCapture(); self.resumeAfterPause()
            }
        }
        finalTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: timeout)
    }

    @MainActor private func finishUtterance(text: String, cycle: Int) {
        guard intent, capture == cycle else { return }
        let id = sessionId
        stopCapture()
        if !text.isEmpty, text.count <= 500, let id = id {
            notifyListeners("voiceResult", data: ["sessionId": id, "text": text, "isFinal": true])
        }
        resumeAfterPause()
    }

    private static func decibels(_ buffer: AVAudioPCMBuffer) -> Double? {
        let count = Int(buffer.frameLength)
        guard count > 0, let channels = buffer.floatChannelData else { return nil }
        var sum = 0.0
        // The input node supplies Float32 PCM. Read one channel; speech input
        // is mono, while a multichannel route's first channel is sufficient.
        for index in 0..<count {
            let sample = Double(channels[0][index])
            sum += sample * sample
        }
        return 10 * log10(max(sum / Double(count), 1e-12))
    }

    @MainActor private func stopCapture() {
        capture += 1
        rollover?.cancel(); finalTimeout?.cancel()
        rollover = nil; finalTimeout = nil
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio(); recognition?.cancel()
        request = nil; recognition = nil; lastPartial = ""; endingAudio = false
        speechBoundary = BBCookSpeechBoundary()
    }

    @MainActor private func resumeAfterPause() {
        let epoch = operation
        let cycle = capture
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            // A later pause (for speech output or a replacement capture) makes
            // this resume obsolete, even within the same listening session.
            guard let self = self, self.operation == epoch, self.capture == cycle,
                  self.intent, self.spoken == nil, !self.speechHeld else { return }
            do { try self.beginCapture() } catch { self.shutdown(code: "BB_VOICE_RECOGNITION") }
        }
    }

    @MainActor private func shutdown(code: String? = nil) {
        operation += 1; intent = false
        stopCapture()
        clearOutput(); speechHeld = false; speechId = nil
        status(code == nil ? "stopped" : "error", code: code)
        sessionId = nil
        let audio = AVAudioSession.sharedInstance()
        try? audio.setActive(false, options: [.notifyOthersOnDeactivation])
        if let previous = previousAudio { try? audio.setCategory(previous.0, mode: previous.1, options: previous.2) }
        previousAudio = nil
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { finishSpeech(utterance) }
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { finishSpeech(utterance) }
    private func finishSpeech(_ utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            guard let self = self, self.spoken === utterance else { return }
            self.spoken = nil; self.speechHeld = false; self.speechId = nil
            self.resumeAfterPause()
        }
    }

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self, weak player] in
            guard let self = self, let player = player, self.memoryPlayer === player else { return }
            if flag { self.audioFinished() } else { self.audioFailed() }
        }
    }

    public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor [weak self, weak player] in
            guard let self = self, let player = player, self.memoryPlayer === player else { return }
            self.audioFailed()
        }
    }
}

// Authenticated progressive MP3 loading using public AVFoundation APIs.
// The asset uses a private scheme; all network requests use this fixed HTTPS URL.
private final class BBCookAudioLoader: NSObject, AVAssetResourceLoaderDelegate, URLSessionDataDelegate {
    private static let maximumBytes: Int64 = 2 * 1024 * 1024
    private let url: URL
    private let token: String
    private let onAccessDenied: (String) -> Void
    private let failureLock = NSLock()
    private var accessFailure: String?
    var accessFailureCode: String? {
        failureLock.lock(); defer { failureLock.unlock() }
        return accessFailure
    }
    private let queue = DispatchQueue(label: "uk.co.basketboss.cook-audio-loader")
    private var network: URLSession?
    private var cancelled = false
    private var jobs: [Int: Job] = [:]

    private final class Job {
        let request: AVAssetResourceLoadingRequest
        let task: URLSessionDataTask
        let offset: Int64
        let length: Int64?
        var nextOffset: Int64
        var targetEnd: Int64 = 0
        var streamOffset: Int64 = 0
        var received: Int64 = 0
        var expectedBytes: Int64 = 0
        var hasResponse = false
        init(request: AVAssetResourceLoadingRequest, task: URLSessionDataTask, offset: Int64, length: Int64?) {
            self.request = request; self.task = task; self.offset = offset
            self.length = length; self.nextOffset = offset
        }
    }

    init(url: URL, token: String, onAccessDenied: @escaping (String) -> Void) {
        self.url = url; self.token = token; self.onAccessDenied = onAccessDenied; super.init()
    }

    func attach(to asset: AVURLAsset) { asset.resourceLoader.setDelegate(self, queue: queue) }

    func cancel() {
        queue.async { [self] in
            guard !cancelled else { return }
            cancelled = true
            let active = Array(jobs.values); jobs.removeAll()
            for job in active { job.task.cancel(); job.request.finishLoading(with: Self.failure()) }
            network?.invalidateAndCancel(); network = nil
        }
    }

    private static func failure() -> NSError {
        NSError(domain: "BasketBossCookAudio", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "The spoken instruction could not be streamed."])
    }

    private func connection() -> URLSession {
        if let network = network { return network }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil; configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false; configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 120
        let callbacks = OperationQueue(); callbacks.maxConcurrentOperationCount = 1; callbacks.underlyingQueue = queue
        let value = URLSession(configuration: configuration, delegate: self, delegateQueue: callbacks)
        network = value; return value
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        guard !cancelled else { loadingRequest.finishLoading(with: Self.failure()); return true }
        let data = loadingRequest.dataRequest
        let offset = data.map { max($0.requestedOffset, $0.currentOffset) } ?? 0
        let requestedLength = data.map { Int64($0.requestedLength) }
        guard offset >= 0, offset < Self.maximumBytes,
              requestedLength == nil || requestedLength! >= 0 else {
            loadingRequest.finishLoading(with: Self.failure()); return true
        }
        let length: Int64? = data?.requestsAllDataToEndOfResource == true ? nil : requestedLength
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue("audio/mpeg", forHTTPHeaderField: "Accept")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if data == nil || length == 0 {
            request.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        } else if let length = length {
            let end = min(Self.maximumBytes - 1, offset + min(length, Self.maximumBytes) - 1)
            request.setValue("bytes=\(offset)-\(end)", forHTTPHeaderField: "Range")
        } else {
            request.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range")
        }
        let task = connection().dataTask(with: request)
        jobs[task.taskIdentifier] = Job(request: loadingRequest, task: task, offset: offset, length: length)
        task.resume(); return true
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        guard let entry = jobs.first(where: { $0.value.request === loadingRequest }) else { return }
        jobs.removeValue(forKey: entry.key); entry.value.task.cancel()
    }

    private func finish(_ job: Job, error: Bool = false) {
        guard jobs.removeValue(forKey: job.task.taskIdentifier) != nil else { return }
        job.task.cancel()
        if error { job.request.finishLoading(with: Self.failure()) } else { job.request.finishLoading() }
    }

    private static func contentRange(_ value: String?) -> (lower: Int64, upper: Int64, total: Int64)? {
        guard let value = value, let expression = try? NSRegularExpression(pattern: "^bytes ([0-9]+)-([0-9]+)/([0-9]+)$"),
              let match = expression.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
              match.range.length == value.utf16.count else { return nil }
        let parts = (1...3).compactMap { index -> Int64? in
            guard let range = Range(match.range(at: index), in: value) else { return nil }
            return Int64(value[range])
        }
        guard parts.count == 3, parts[0] <= parts[1], parts[1] < parts[2],
              parts[2] > 0, parts[2] <= maximumBytes else { return nil }
        return (parts[0], parts[1], parts[2])
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if !cancelled, let job = jobs[dataTask.taskIdentifier], let http = response as? HTTPURLResponse {
            let code: String?
            switch http.statusCode {
            case 401: code = "BB_TTS_AUTH"
            case 403: code = "BB_TTS_PREMIUM_REQUIRED"
            case 409: code = "BB_TTS_DELETING"
            default: code = nil
            }
            if let code = code {
                // Store before finishing the resource, because AVPlayer may
                // report its generic failure before the MainActor callback runs.
                failureLock.lock(); accessFailure = code; failureLock.unlock()
                onAccessDenied(code)
                finish(job, error: true); completionHandler(.cancel); return
            }
        }
        guard !cancelled, let job = jobs[dataTask.taskIdentifier], let http = response as? HTTPURLResponse,
              [200, 206].contains(http.statusCode), http.mimeType?.lowercased() == "audio/mpeg",
              http.value(forHTTPHeaderField: "Content-Encoding").map({ $0.lowercased() == "identity" }) ?? true else {
            if let job = jobs[dataTask.taskIdentifier] { finish(job, error: true) }
            completionHandler(.cancel); return
        }
        let total: Int64, lower: Int64, expected: Int64
        if http.statusCode == 206 {
            guard let range = Self.contentRange(http.value(forHTTPHeaderField: "Content-Range")),
                  range.lower == (job.request.dataRequest == nil || job.length == 0 ? 0 : job.offset) else {
                finish(job, error: true); completionHandler(.cancel); return
            }
            total = range.total; lower = range.lower; expected = range.upper - range.lower + 1
        } else {
            guard let count = http.value(forHTTPHeaderField: "Content-Length").flatMap({ Int64($0) }),
                  count > 0, count <= Self.maximumBytes else {
                finish(job, error: true); completionHandler(.cancel); return
            }
            total = count; lower = 0; expected = count
        }
        if response.expectedContentLength >= 0 && response.expectedContentLength != expected {
            finish(job, error: true); completionHandler(.cancel); return
        }
        if let info = job.request.contentInformationRequest {
            info.contentType = AVFileType.mp3.rawValue; info.contentLength = total
            // A server ignoring Range is handled by streaming past the offset.
            info.isByteRangeAccessSupported = true
        }
        if job.request.dataRequest == nil || job.length == 0 {
            finish(job); completionHandler(.cancel); return
        }
        guard job.offset < total else { finish(job, error: true); completionHandler(.cancel); return }
        let end = job.length.map { min(total, job.offset + min($0, Self.maximumBytes)) } ?? total
        guard lower <= job.offset, lower + expected >= end else {
            finish(job, error: true); completionHandler(.cancel); return
        }
        job.targetEnd = end; job.streamOffset = lower; job.expectedBytes = expected; job.hasResponse = true
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !cancelled, let job = jobs[dataTask.taskIdentifier], job.hasResponse else { return }
        let size = Int64(data.count)
        guard size <= Self.maximumBytes, job.received + size <= job.expectedBytes else { finish(job, error: true); return }
        let lower = job.streamOffset, upper = lower + size
        job.streamOffset = upper; job.received += size
        let start = max(lower, job.nextOffset), end = min(upper, job.targetEnd)
        if start < end {
            job.request.dataRequest?.respond(with: data.subdata(in: Int(start - lower)..<Int(end - lower)))
            job.nextOffset = end
        }
        if job.nextOffset >= job.targetEnd { finish(job) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let job = jobs[task.taskIdentifier] else { return }
        finish(job, error: error != nil || !job.hasResponse || job.nextOffset < job.targetEnd)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward the bearer token to redirects, even to another trusted host.
        completionHandler(nil)
        if let job = jobs[task.taskIdentifier] { finish(job, error: true) }
    }
}
