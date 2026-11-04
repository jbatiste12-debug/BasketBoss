import Foundation

func expect(_ value: @autoclosure () -> Bool, _ message: String) {
    if !value() { fatalError(message) }
}

@discardableResult func feed(_ detector: inout BBCookSpeechBoundary, _ decibels: Double, _ seconds: Double) -> Int {
    let frames = Int((seconds / 0.01).rounded())
    var ends = 0
    for _ in 0..<frames {
        if detector.append(decibels: decibels, duration: 0.01) { ends += 1 }
    }
    return ends
}

// Silence or kitchen noise alone must never generate a command boundary.
var idle = BBCookSpeechBoundary()
expect(!idle.recognized(), "No audio means no voice evidence")
expect(feed(&idle, -72, 2) == 0, "Initial silence must not end a turn")
expect(feed(&idle, -43, 5) == 0, "An appliance is not a recognized utterance")

// The 550 ms endpoint is measured from audio, not a changing transcript.
var normal = BBCookSpeechBoundary()
feed(&normal, -68, 0.3)
feed(&normal, -25, 0.4)
expect(!normal.recognized(), "A partial during ongoing speech must not finish")
expect(feed(&normal, -29, 1.5) == 0, "Slow recognition must not truncate audible speech")
expect(feed(&normal, -72, 0.54) == 0, "540 ms of silence is below the endpoint")
expect(!normal.recognized(), "A delayed revision must not reset or complete the endpoint early")
expect(feed(&normal, -72, 0.01) == 1, "550 ms must complete without waiting for Apple final")
expect(feed(&normal, -72, 2) == 0 && !normal.recognized(), "The same utterance completes exactly once")

// Pauses within a sentence and resumed speech reset the microphone quiet run.
var paused = BBCookSpeechBoundary()
feed(&paused, -67, 0.3)
feed(&paused, -30, 0.4)
expect(!paused.recognized(), "First word is still speaking")
expect(feed(&paused, -70, 0.35) == 0, "A natural short pause stays within the utterance")
expect(feed(&paused, -40, 0.5) == 0, "The next word cancels the preceding quiet time")
expect(feed(&paused, -70, 0.54) == 0, "Silence restarts from the last word")
expect(feed(&paused, -70, 0.01) == 1, "Only the final 550 ms quiet run completes")

// Adaptive floor handles normal room noise; hysteresis/peak cap retain quiet
// speech even if the user begins talking immediately when recording starts.
for setup in [(-48.0, -29.0, -48.0, 0.4), (-74.0, -58.0, -74.0, 0.3), (-54.0, -54.0, -76.0, 0.0)] {
    var detector = BBCookSpeechBoundary()
    feed(&detector, setup.0, setup.3)
    feed(&detector, setup.1, 0.35)
    expect(!detector.recognized(), "Speech must not finish during recognition")
    expect(feed(&detector, setup.1 - 3, 0.5) == 0, "Quieter ongoing speech remains audible")
    expect(feed(&detector, setup.2, 0.54) == 0, "Noise-floor release must retain the full quiet duration")
    expect(feed(&detector, setup.2, 0.01) == 1, "Room noise and quiet speech must still finish at 550 ms")
}

// A partial delivered after actual silence uses buffered energy, adding no
// additional transcript debounce, even when there have been no newer words.
var late = BBCookSpeechBoundary()
feed(&late, -70, 0.3)
feed(&late, -32, 0.4)
expect(feed(&late, -74, 0.7) == 0, "Energy cannot submit an unrecognized sound")
expect(late.recognized(), "A late valid hypothesis uses silence already observed")

// Invalid buffer metadata cannot advance quiet time or trigger a boundary.
var invalid = BBCookSpeechBoundary()
feed(&invalid, -70, 0.3)
feed(&invalid, -32, 0.3)
expect(!invalid.recognized(), "Valid speech begins normally")
expect(!invalid.append(decibels: .nan, duration: 10), "NaN level must not advance silence")
expect(!invalid.append(decibels: -70, duration: .infinity), "Invalid duration must not advance silence")
expect(!invalid.append(decibels: -70, duration: 0), "Empty PCM must not advance silence")
expect(feed(&invalid, -70, 0.54) == 0, "Rejected metadata did not consume any of the quiet interval")
expect(feed(&invalid, -70, 0.01) == 1, "Valid PCM still ends normally")

// Endpoint timing follows actual samples across input-route sample rates.
for sampleRate in [8_000.0, 16_000.0, 44_100.0, 48_000.0] {
    var detector = BBCookSpeechBoundary()
    let frameDuration = 1_024.0 / sampleRate
    for _ in 0..<Int((0.3 / frameDuration).rounded(.up)) {
        expect(!detector.append(decibels: -72, duration: frameDuration), "Warm-up cannot submit audio")
    }
    for _ in 0..<Int((0.4 / frameDuration).rounded(.up)) {
        expect(!detector.append(decibels: -30, duration: frameDuration), "Speech cannot end itself")
    }
    expect(!detector.recognized(), "Audio route recognizes an ongoing utterance")
    let quietFrames = Int((BBCookSpeechBoundary.quietDuration / frameDuration).rounded(.up))
    for frame in 1...quietFrames {
        expect(detector.append(decibels: -72, duration: frameDuration) == (frame == quietFrames),
               "Endpoint uses PCM time with at most one buffer of rounding")
    }
}

// A fresh capture never inherits the preceding capture's speech/quiet state.
var replacement = BBCookSpeechBoundary()
expect(feed(&replacement, -74, 1) == 0, "A restarted session has no preceding hypothesis")
print("Cook native energy endpoint fixtures passed")
