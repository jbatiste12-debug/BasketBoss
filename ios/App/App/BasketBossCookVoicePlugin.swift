import Foundation
import UIKit
import AVFoundation
import Speech
import Capacitor

// Speech is explicitly started by the Cook microphone toggle. Audio and
// transcripts are neither persisted nor forwarded to the BasketBoss backend.
@objc(BasketBossCookVoicePlugin)
public final class BasketBossCookVoicePlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "BasketBossCookVoicePlugin"
    public let jsName = "BasketBossCookVoice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise)
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
    private var silence: DispatchWorkItem?
    private var rollover: DispatchWorkItem?
    private var finalTimeout: DispatchWorkItem?
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
        silence?.cancel(); rollover?.cancel(); finalTimeout?.cancel()
        recognition?.cancel(); engine.stop()
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

    @objc public func speak(_ call: CAPPluginCall) {
        guard let id = call.getString("sessionId"), let raw = call.getString("text") else { call.reject("A voice response is required.", "BB_VOICE_SESSION"); return }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 500 else { call.reject("The voice response is too long.", "BB_VOICE_TEXT"); return }
        Task { @MainActor [weak self] in
            guard let self = self, self.intent, self.sessionId == id, UIApplication.shared.applicationState == .active else { call.resolve(["spoken": false]); return }
            self.stopCapture()
            self.spoken = nil
            self.speaker.stopSpeaking(at: .immediate)
            do {
                let audio = AVAudioSession.sharedInstance()
                try audio.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
                try audio.setActive(true)
                let utterance = AVSpeechUtterance(string: text)
                utterance.voice = AVSpeechSynthesisVoice(language: "en-GB")
                self.spoken = utterance
                self.status("paused")
                self.speaker.speak(utterance)
                call.resolve(["spoken": true])
            } catch { self.shutdown(code: "BB_VOICE_AUDIO"); call.reject("The response could not be read aloud.", "BB_VOICE_AUDIO") }
        }
    }

    @MainActor private func status(_ state: String, code: String? = nil) {
        guard let id = sessionId else { return }
        var value: JSObject = ["sessionId": id, "state": state]
        if let code = code { value["code"] = code }
        notifyListeners("voiceStatus", data: value)
    }

    @MainActor private func beginCapture() throws {
        guard intent, spoken == nil, UIApplication.shared.applicationState == .active,
              let recognizer = recognizer, recognizer.isAvailable else { throw NSError(domain: "CookVoice", code: 1) }
        stopCapture()
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try audio.setActive(true)
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .confirmation
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        request.contextualStrings = ["Next step", "Previous step", "Start timer", "How much"]
        self.request = request
        let format = engine.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "CookVoice", code: 2) }
        engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        tapInstalled = true
        engine.prepare(); try engine.start()
        let cycle = capture
        recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor [weak self] in
                guard let self = self, self.intent, self.capture == cycle else { return }
                if let result = result {
                    let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                    if result.isFinal {
                        self.stopCapture()
                        if !text.isEmpty, text.count <= 500, let id = self.sessionId {
                            self.notifyListeners("voiceResult", data: ["sessionId": id, "text": text, "isFinal": true])
                        }
                        self.resumeAfterPause()
                        return
                    }
                    // Partial text only identifies an utterance boundary. Only
                    // Apple's final result is ever delivered as a command.
                    if text != self.lastPartial, !text.isEmpty {
                        self.lastPartial = text
                        self.silence?.cancel()
                        let end = DispatchWorkItem { [weak self] in Task { @MainActor [weak self] in self?.endUtterance(cycle: cycle) } }
                        self.silence = end
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.95, execute: end)
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

    @MainActor private func stopCapture() {
        capture += 1
        silence?.cancel(); rollover?.cancel(); finalTimeout?.cancel()
        silence = nil; rollover = nil; finalTimeout = nil
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio(); recognition?.cancel()
        request = nil; recognition = nil; lastPartial = ""; endingAudio = false
    }

    @MainActor private func resumeAfterPause() {
        let epoch = operation
        let cycle = capture
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            // A later pause (for speech output or a replacement capture) makes
            // this resume obsolete, even within the same listening session.
            guard let self = self, self.operation == epoch, self.capture == cycle,
                  self.intent, self.spoken == nil else { return }
            do { try self.beginCapture() } catch { self.shutdown(code: "BB_VOICE_RECOGNITION") }
        }
    }

    @MainActor private func shutdown(code: String? = nil) {
        operation += 1; intent = false
        stopCapture()
        spoken = nil; speaker.stopSpeaking(at: .immediate)
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
            self.spoken = nil
            self.resumeAfterPause()
        }
    }
}
