import Flutter
import AVFoundation
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "SaviaAudioSegments") else {
      return
    }
    let channel = FlutterMethodChannel(
      name: "savia.companion/audio_segments",
      binaryMessenger: registrar.messenger()
    )
    channel.setMethodCallHandler { [weak self] call, result in
      guard call.method == "segmentAacFile" else {
        result(FlutterMethodNotImplemented)
        return
      }
      guard
        let arguments = call.arguments as? [String: Any],
        let sourcePath = arguments["sourcePath"] as? String,
        let outputDirectory = arguments["outputDirectory"] as? String,
        let artifactId = arguments["artifactId"] as? String,
        let segmentSeconds = arguments["segmentSeconds"] as? Int,
        let maxSegments = arguments["maxSegments"] as? Int
      else {
        result(FlutterError(code: "INVALID_ARGUMENT", message: "Audio source is unavailable.", details: nil))
        return
      }
      guard let self else {
        result(FlutterError(code: "SEGMENTATION_FAILED", message: "Could not segment the recording.", details: nil))
        return
      }
      Task.detached(priority: .userInitiated) {
        do {
          let segments = try await self.segmentAacFile(
            sourcePath: sourcePath,
            outputDirectory: outputDirectory,
            artifactId: artifactId,
            segmentSeconds: segmentSeconds,
            maxSegments: maxSegments
          )
          await MainActor.run { result(segments) }
        } catch {
          await MainActor.run {
            result(FlutterError(code: "SEGMENTATION_FAILED", message: "Could not segment the recording.", details: nil))
          }
        }
      }
    }
  }

  private func segmentAacFile(
    sourcePath: String,
    outputDirectory: String,
    artifactId: String,
    segmentSeconds: Int,
    maxSegments: Int
  ) async throws -> [[String: Any]] {
    let source = URL(fileURLWithPath: sourcePath)
    let output = URL(fileURLWithPath: outputDirectory, isDirectory: true)
    let attributes = try FileManager.default.attributesOfItem(atPath: sourcePath)
    let sourceBytes = (attributes[.size] as? NSNumber)?.intValue ?? 0
    guard
      sourceBytes > 0 && sourceBytes <= 50_000_000,
      artifactId.range(of: "^[0-9a-fA-F-]{36}$", options: .regularExpression) != nil,
      segmentSeconds == 30,
      maxSegments == 120
    else {
      throw NSError(domain: "SaviaAudioSegments", code: 1)
    }
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    let asset = AVURLAsset(url: source)
    guard asset.tracks(withMediaType: .audio).first != nil else {
      throw NSError(domain: "SaviaAudioSegments", code: 2)
    }
    let rawDuration = asset.duration.seconds
    guard rawDuration.isFinite && rawDuration > 0 else {
      throw NSError(domain: "SaviaAudioSegments", code: 3)
    }
    let duration = min(rawDuration, 3600.0)
    let totalSegments = Int(ceil(duration / Double(segmentSeconds)))
    guard totalSegments > 0 && totalSegments <= maxSegments else {
      throw NSError(domain: "SaviaAudioSegments", code: 4)
    }
    var completed: [[String: Any]] = []
    do {
      for sequence in 0..<totalSegments {
        let startSeconds = Double(sequence * segmentSeconds)
        let segmentDuration = min(Double(segmentSeconds), duration - startSeconds)
        let destination = output.appendingPathComponent(
          "\(artifactId)-segment-\(String(format: "%03d", sequence)).m4a"
        )
        try? FileManager.default.removeItem(at: destination)
        guard let exporter = AVAssetExportSession(
          asset: asset,
          presetName: AVAssetExportPresetPassthrough
        ) else {
          throw NSError(domain: "SaviaAudioSegments", code: 5)
        }
        guard exporter.supportedFileTypes.contains(.m4a) else {
          throw NSError(domain: "SaviaAudioSegments", code: 6)
        }
        exporter.outputURL = destination
        exporter.outputFileType = .m4a
        exporter.timeRange = CMTimeRange(
          start: CMTime(seconds: startSeconds, preferredTimescale: 600),
          duration: CMTime(seconds: segmentDuration, preferredTimescale: 600)
        )
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
          exporter.exportAsynchronously {
            if exporter.status == .completed {
              continuation.resume()
            } else {
              continuation.resume(throwing: exporter.error ?? NSError(domain: "SaviaAudioSegments", code: 7))
            }
          }
        }
        let outputAsset = AVURLAsset(url: destination)
        let outputDuration = outputAsset.duration.seconds
        let outputAttributes = try FileManager.default.attributesOfItem(atPath: destination.path)
        let bytes = (outputAttributes[.size] as? NSNumber)?.intValue ?? 0
        guard
          outputDuration.isFinite && outputDuration > 0
            && outputDuration <= segmentDuration + 0.1 && bytes > 0
        else {
          throw NSError(domain: "SaviaAudioSegments", code: 8)
        }
        completed.append([
          "path": destination.path,
          "startSeconds": startSeconds,
          "durationSeconds": min(outputDuration, segmentDuration),
          "bytes": bytes,
        ])
      }
      return completed
    } catch {
      completed.forEach { segment in
        if let path = segment["path"] as? String { try? FileManager.default.removeItem(atPath: path) }
      }
      throw error
    }
  }
}
