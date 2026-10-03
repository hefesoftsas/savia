import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:companion_mobile/playback/playback_controller.dart';
import 'package:companion_mobile/playback/audio_player_adapter.dart';
import 'package:companion_mobile/capture/temp_files.dart';
import 'package:companion_mobile/recordings/models.dart';

class Player implements AudioPlayerAdapter {
  String? path;
  bool disposed = false;
  final done = Completer<void>();
  @override
  Future<void> openFile(String path) async {
    this.path = path;
  }

  @override
  Future<void> play() => done.future;
  @override
  Future<void> pause() async {}
  @override
  Future<void> stop() async {
    if (!done.isCompleted) done.complete();
  }

  @override
  Future<void> dispose() async {
    expect(await File(path!).exists(), true);
    disposed = true;
  }
}

void main() {
  test(
    'playback disposes decoder before deleting authenticated temporary audio',
    () async {
      final directory = await Directory.systemTemp.createTemp('playback-test-');
      final player = Player();
      final playback = PlaybackController(
        player: player,
        files: TempFiles(directory),
        download: (_, path, _) async {
          await File(path).writeAsBytes([1, 2, 3]);
        },
      );
      await playback.toggle(
        Recording(
          id: 'sample',
          source: 'upload',
          format: AudioFormat.wav,
          bytes: 3,
          durationSeconds: null,
          createdAt: DateTime.now(),
          sha256: 'a' * 64,
        ),
      );
      final path = player.path!;
      await playback.close();
      expect(player.disposed, true);
      expect(await File(path).exists(), false);
      await directory.delete(recursive: true);
    },
  );
}
