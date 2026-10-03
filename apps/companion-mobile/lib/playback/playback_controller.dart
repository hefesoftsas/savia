import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../capture/temp_files.dart';
import '../recordings/models.dart';
import 'audio_player_adapter.dart';

class PlaybackController extends ChangeNotifier {
  PlaybackController({
    required this.player,
    required this.files,
    required this.download,
  });
  final AudioPlayerAdapter player;
  final TempFiles files;
  final Future<void> Function(String, String, CancelToken) download;
  bool loading = false, playing = false;
  CompanionFailure? failure;
  String? _path;
  CancelToken? _cancel;
  Future<void>? _opening;
  int _generation = 0;
  bool _disposed = false;
  Future<void>? _closing;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> toggle(Recording recording) async {
    if (loading || _disposed) return;
    if (playing) {
      await player.pause();
      playing = false;
      _notify();
      return;
    }
    final generation = _generation;
    failure = null;
    loading = true;
    _notify();
    final opening = _open(recording, generation);
    _opening = opening;
    try {
      await opening;
    } finally {
      if (generation == _generation) {
        loading = false;
        _notify();
      }
      _opening = null;
    }
  }

  Future<void> _open(Recording recording, int generation) async {
    try {
      if (_path == null) {
        final path = await files.createPath(recording.format.name);
        _path = path;
        _cancel = CancelToken();
        await download(recording.id, path, _cancel!);
        if (generation != _generation) return;
        await player.openFile(path);
      }
      if (generation != _generation) return;
      playing = true;
      _notify();
      unawaited(
        player.play().then(
          (_) {
            if (generation == _generation) {
              playing = false;
              _notify();
            }
          },
          onError: (Object _) {
            if (generation == _generation) {
              playing = false;
              failure = const CompanionFailure('UNSUPPORTED_CODEC');
              _notify();
            }
          },
        ),
      );
    } catch (error) {
      if (generation == _generation) {
        failure = error is CompanionFailure
            ? error
            : const CompanionFailure('UNSUPPORTED_CODEC');
      }
      await player.stop();
      if (_path != null) {
        await files.remove(_path!);
        _path = null;
      }
    }
  }

  Future<void> close() => _closing ??= _close();

  Future<void> _close() async {
    _generation++;
    _cancel?.cancel();
    await _opening;
    await player.stop();
    // Dispose native decoder handles before deleting the downloaded file.
    await player.dispose();
    if (_path != null) {
      await files.remove(_path!);
      _path = null;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(close());
    super.dispose();
  }
}
