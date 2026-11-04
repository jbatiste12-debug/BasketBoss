import Foundation

// A lightweight endpoint detector, not a second speech recognizer. Apple's
// non-empty hypothesis confirms speech; microphone energy determines when it
// stops. No audio samples or transcripts are retained by this helper.
struct BBCookSpeechBoundary {
    static let quietDuration = 0.55
    private struct Frame { let decibels: Double; let duration: Double }
    private var recent: [Frame] = []
    private var elapsed = 0.0
    private var noiseFloor = -60.0
    private var peak = -120.0
    private var quiet = 0.0
    private var recognizedSpeech = false
    private var ended = false

    // Use an onset margin before speech is recognized and a lower sustain
    // margin afterwards (hysteresis). The peak cap protects quiet/early speech
    // when the first buffers themselves contain the start of the utterance.
    private var threshold: Double {
        let margin = recognizedSpeech ? 6.0 : 10.0
        return max(-65, min(-32, noiseFloor + margin, peak - 12))
    }

    mutating func append(decibels: Double, duration: Double) -> Bool {
        guard !ended, decibels.isFinite, duration.isFinite, duration > 0, duration <= 0.25 else { return false }
        // A delayed main-queue callback must not count as extra microphone
        // silence. Durations come from the PCM buffer's sample count instead.
        let frame = Frame(decibels: max(-120, min(0, decibels)), duration: duration)
        elapsed += frame.duration
        peak = max(peak, frame.decibels)
        recent.append(frame)
        while recent.count > 64 { recent.removeFirst() }

        if !recognizedSpeech && elapsed <= 0.25 {
            // Learn a quiet percentile rather than averaging speech peaks into
            // the kitchen noise floor. Recognition is active during warm-up.
            let levels = recent.map { $0.decibels }.sorted()
            noiseFloor = max(-75, min(-35, levels[(levels.count - 1) / 5]))
        } else if frame.decibels < noiseFloor + (recognizedSpeech ? 0 : 8) {
            let rate = frame.decibels < noiseFloor ? 0.15 : 0.02
            noiseFloor += (frame.decibels - noiseFloor) * rate
        }
        quiet = frame.decibels >= threshold ? 0 : quiet + frame.duration
        return finishIfQuiet()
    }

    // A late partial can arrive after the speaker has stopped. Re-evaluate the
    // actual recent microphone frames so it does not add another debounce.
    mutating func recognized() -> Bool {
        guard !ended else { return false }
        if !recognizedSpeech {
            guard elapsed >= 0.04, peak > -65 else { return false }
            recognizedSpeech = true
            quiet = 0
            for frame in recent.reversed() {
                if frame.decibels >= threshold { break }
                quiet += frame.duration
            }
        }
        return finishIfQuiet()
    }

    private mutating func finishIfQuiet() -> Bool {
        guard recognizedSpeech, quiet + 0.000_001 >= Self.quietDuration else { return false }
        ended = true
        return true
    }
}
