import CoreAudio
import AVFoundation
import Foundation

// Bound temporary raw PCM independently; Ogg encoding has its own 512 KiB cap.
private let limitBytes = 8 * 1024 * 1024
private let segmentSeconds: Double = 30
private let sessionLimitSeconds: Double = 3_600

private final class TapCapture {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?
    private let lock = NSLock()
    private var pcm = Data(capacity: 48_000 * 30 * 2)
    private var sampleRate: Double = 0
    private var started = DispatchTime.now().uptimeNanoseconds
    private var segmentStarted = DispatchTime.now().uptimeNanoseconds
    private var stopped = false
    private var captureError: String?

    var outputSampleRate: Int { Int(sampleRate) }

    init() {}

    func start() throws {
        guard #available(macOS 14.2, *) else {
            throw CaptureError("System audio capture requires macOS 14.2 or later.")
        }

        let description = CATapDescription(monoGlobalTapButExcludeProcesses: [])
        let tapUID = UUID()
        description.uuid = tapUID
        description.name = "Savia Companion System Audio"
        description.isPrivate = true
        description.muteBehavior = .unmuted

        var status = AudioHardwareCreateProcessTap(description, &tapID)
        guard status == noErr else { throw CaptureError("macOS could not create the system audio tap (\(status)).") }

        let aggregateDescription: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Savia Companion Capture",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapUIDKey: tapUID.uuidString,
                kAudioSubTapDriftCompensationKey: true,
            ]],
            kAudioAggregateDeviceTapAutoStartKey: true,
        ]
        status = AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateID)
        guard status == noErr else { throw CaptureError("macOS could not create the capture device (\(status)).") }

        var formatAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamFormat,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var format = AudioStreamBasicDescription()
        var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        status = AudioObjectGetPropertyData(aggregateID, &formatAddress, 0, nil, &formatSize, &format)
        guard status == noErr, format.mSampleRate > 0,
              format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
              format.mBitsPerChannel == 32 else {
            throw CaptureError("macOS returned an unsupported system audio format (\(status)).")
        }
        sampleRate = format.mSampleRate
        started = DispatchTime.now().uptimeNanoseconds
        segmentStarted = started

        status = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, DispatchQueue(label: "com.hefesoft.savia.capture.audio")) { [weak self] _, input, _, _, _ in
            self?.append(input)
        }
        guard status == noErr, let ioProcID else { throw CaptureError("macOS could not start the system audio stream (\(status)).") }
        status = AudioDeviceStart(aggregateID, ioProcID)
        guard status == noErr else { throw CaptureError("macOS could not start system audio capture (\(status)).") }
    }

    private func append(_ buffers: UnsafePointer<AudioBufferList>?) {
        guard let buffers else { return }
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000_000
        guard elapsed < sessionLimitSeconds else { return }
        let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: buffers))
        guard let buffer = list.first, let data = buffer.mData else { return }
        let channels = max(1, Int(buffer.mNumberChannels))
        let frames = Int(buffer.mDataByteSize) / (MemoryLayout<Float>.size * channels)
        let input = data.assumingMemoryBound(to: Float.self)
        var output = Data(capacity: min(frames * 2, 64 * 1024))
        for frame in 0..<frames {
            var total: Float = 0
            for channel in 0..<channels { total += input[frame * channels + channel] }
            let sample = total / Float(channels)
            let finite = sample.isFinite ? sample : 0
            let value = Int16((max(-1, min(1, finite)) * Float(Int16.max)).rounded())
            var littleEndian = value.littleEndian
            withUnsafeBytes(of: &littleEndian) { output.append(contentsOf: $0) }
        }

        lock.lock()
        defer { lock.unlock() }
        guard !stopped else { return }
        let maxFrames = Int(sampleRate * sessionLimitSeconds)
        let maxSegmentFrames = Int(sampleRate * segmentSeconds)
        var consumedFrames = 0
        while consumedFrames < frames && pcm.count / 2 < maxSegmentFrames && pcm.count < limitBytes && pcm.count / 2 < maxFrames {
            let remainingFrames = min(frames - consumedFrames, maxSegmentFrames - pcm.count / 2)
            let byteStart = consumedFrames * 2
            let byteEnd = min(output.count, byteStart + remainingFrames * 2)
            guard byteEnd > byteStart else { break }
            pcm.append(output[byteStart..<byteEnd])
            consumedFrames += (byteEnd - byteStart) / 2
            if pcm.count / 2 >= maxSegmentFrames || pcm.count >= limitBytes { flushSegment() }
        }
    }

    func stop() throws {
        lock.lock()
        stopped = true
        lock.unlock()
        if aggregateID != kAudioObjectUnknown, let ioProcID {
            AudioDeviceStop(aggregateID, ioProcID)
            AudioDeviceDestroyIOProcID(aggregateID, ioProcID)
            self.ioProcID = nil
        }
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = kAudioObjectUnknown
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = kAudioObjectUnknown
        }
        lock.lock()
        flushSegment()
        let captureError = captureError
        lock.unlock()
        if let captureError { throw CaptureError(captureError) }
    }

    private func flushSegment() {
        guard !pcm.isEmpty else { return }
        let now = DispatchTime.now().uptimeNanoseconds
        var packet = Data("SSEG".utf8)
        var start = segmentStarted &- started
        var size = UInt32(pcm.count).littleEndian
        start = start.littleEndian
        withUnsafeBytes(of: &start) { packet.append(contentsOf: $0) }
        withUnsafeBytes(of: &size) { packet.append(contentsOf: $0) }
        packet.append(pcm)
        do {
            try FileHandle.standardOutput.write(contentsOf: packet)
        } catch {
            captureError = "Could not send a system audio segment to the host."
        }
        pcm.removeAll(keepingCapacity: true)
        segmentStarted = now
    }
}

private struct CaptureError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--authorize-microphone" {
    let authorization = AVCaptureDevice.authorizationStatus(for: .audio)
    if authorization == .authorized {
        print("AUTHORIZED")
        exit(0)
    }
    guard authorization == .notDetermined else {
        fputs("Microphone permission was denied. Enable it in System Settings > Privacy & Security > Microphone.\n", stderr)
        exit(1)
    }
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    AVCaptureDevice.requestAccess(for: .audio) { isGranted in
        granted = isGranted
        semaphore.signal()
    }
    semaphore.wait()
    if granted {
        print("AUTHORIZED")
        exit(0)
    }
    fputs("Microphone permission was denied. Enable it in System Settings > Privacy & Security > Microphone.\n", stderr)
    exit(1)
}

guard CommandLine.arguments.count == 1 else {
    fputs("Capture helper does not accept capture paths.\n", stderr)
    exit(2)
}

private let capture = TapCapture()
do {
    try capture.start()
    print("READY \(capture.outputSampleRate)")
    fflush(stdout)
    _ = readLine()
    try capture.stop()
} catch {
    fputs("\(error)\n", stderr)
    try? capture.stop()
    exit(1)
}
