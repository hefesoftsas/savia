import 'package:record/record.dart';

import '../recordings/models.dart';

abstract interface class NativeCapture {
  Stream<void> get interruptions;
  Future<void> start(String path);
  Future<String?> stop();
  Future<void> cancel();
  Future<void> dispose();
}

class MicrophoneCapture implements NativeCapture {
  final AudioRecorder _recorder = AudioRecorder();
  @override
  Stream<void> get interruptions => _recorder
      .onStateChanged()
      .where((state) => state == RecordState.pause)
      .map((_) {});
  @override
  Future<void> start(String path) async {
    if (!await _recorder.hasPermission()) {
      throw const CompanionFailure('MICROPHONE_PERMISSION');
    }
    if (!await _recorder.isEncoderSupported(AudioEncoder.aacLc)) {
      throw const CompanionFailure('UNSUPPORTED_CODEC');
    }
    await _recorder.start(
      const RecordConfig(
        encoder: AudioEncoder.aacLc,
        numChannels: 1,
        sampleRate: 24000,
        bitRate: 64000,
        audioInterruption: AudioInterruptionMode.pause,
      ),
      path: path,
    );
  }

  @override
  Future<String?> stop() => _recorder.stop();
  @override
  Future<void> cancel() => _recorder.cancel();
  @override
  Future<void> dispose() => _recorder.dispose();
}
