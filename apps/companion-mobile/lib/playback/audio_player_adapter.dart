import 'package:just_audio/just_audio.dart';

abstract interface class AudioPlayerAdapter {
  Future<void> openFile(String path);
  Future<void> play();
  Future<void> pause();
  Future<void> stop();
  Future<void> dispose();
}

class NativeAudioPlayer implements AudioPlayerAdapter {
  final AudioPlayer _player = AudioPlayer();
  @override
  Future<void> openFile(String path) async {
    await _player.setFilePath(path);
  }

  @override
  Future<void> play() async {
    if (_player.processingState == ProcessingState.completed) {
      await _player.seek(Duration.zero);
    }
    await _player.play();
  }

  @override
  Future<void> pause() => _player.pause();
  @override
  Future<void> stop() => _player.stop();
  @override
  Future<void> dispose() => _player.dispose();
}
