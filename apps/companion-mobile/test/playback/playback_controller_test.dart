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
  int playCalls = 0;
  final done = Completer<void>();
  @override
  Future<void> openFile(String path) async {
    this.path = path;
  }

  @override
  Future<void> play() {
    playCalls++;
    return done.future;
  }

  @override
  Future<void> pause() async {}
  @override
  Future<void> stop() async {
    if (!done.isCompleted) done.complete();
  }

  @override
  Future<void> dispose() async {
    if (path != null) expect(await File(path!).exists(), true);
    disposed = true;
  }
}

void main() {
  test('background pause cancels a pending download and permits a later explicit play', () async {
    final directory = await Directory.systemTemp.createTemp(
      'playback-background-pause-',
    );
    final player = Player();
    final playback = PlaybackController(
      player: player,
      files: TempFiles(directory),
      download: (_, _, _) async {},
    );
    final downloadStarted = Completer<void>();
    final finishDownload = Completer<void>();
    final first = playback.toggleAudio(
      cacheKey: 'session:pending',
      extension: 'm4a',
      download: (path, cancellation) async {
        downloadStarted.complete();
        await cancellation.whenCancel;
        await finishDownload.future;
        await File(path).writeAsBytes([1, 2, 3]);
      },
    );
    await downloadStarted.future;

    final pausing = playback.pause();
    finishDownload.complete();
    await Future.wait([pausing, first]);

    expect(player.playCalls, 0);
    expect(playback.cacheKey, isNull);
    expect(playback.loading, false);
    expect(await directory.list().toList(), isEmpty);

    await playback.toggleAudio(
      cacheKey: 'session:pending',
      extension: 'm4a',
      download: (path, _) async => File(path).writeAsBytes([4, 5, 6]),
    );
    expect(player.playCalls, 1);
    await playback.close();
    await directory.delete(recursive: true);
  });

  test(
    'ignores a second segment tap while the first switch is pending',
    () async {
      final directory = await Directory.systemTemp.createTemp('playback-taps-');
      final player = Player();
      final playback = PlaybackController(
        player: player,
        files: TempFiles(directory),
        download: (_, _, _) async {},
      );
      final downloadStarted = Completer<void>();
      final finishDownload = Completer<void>();
      var downloads = 0;
      Future<void> download(String path, _) async {
        downloads++;
        downloadStarted.complete();
        await finishDownload.future;
        await File(path).writeAsBytes([1, 2, 3]);
      }

      final first = playback.toggleAudio(
        cacheKey: 'session:first',
        extension: 'ogg',
        download: download,
      );
      await downloadStarted.future;
      await playback.toggleAudio(
        cacheKey: 'session:second',
        extension: 'm4a',
        download: download,
      );
      expect(downloads, 1);
      finishDownload.complete();
      await first;
      await playback.close();
      await directory.delete(recursive: true);
    },
  );

  test(
    'close waits for an in-flight download before disposing the player',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'playback-close-',
      );
      final player = Player();
      final playback = PlaybackController(
        player: player,
        files: TempFiles(directory),
        download: (_, _, _) async {},
      );
      final downloadStarted = Completer<void>();
      final start = playback.toggleAudio(
        cacheKey: 'session:chunk',
        extension: 'ogg',
        download: (path, cancellation) async {
          downloadStarted.complete();
          await cancellation.whenCancel;
        },
      );
      await downloadStarted.future;
      final closing = playback.close();
      await Future.wait([start, closing]);
      expect(player.disposed, true);
      expect(player.path, isNull);
      await directory.delete(recursive: true);
    },
  );

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
