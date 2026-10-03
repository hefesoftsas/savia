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
  String? get cacheKey => _cacheKey;
  String? _path;
  String? _cacheKey;
  CancelToken? _cancel;
  Future<void>? _opening;
  Future<void>? _toggleInFlight;
  int _generation = 0;
  bool _disposed = false;
  bool _closingStarted = false;
  Future<void>? _closing;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> toggle(Recording recording) => toggleAudio(
    cacheKey: 'recording:${recording.id}',
    extension: recording.format.name,
    download: (path, cancel) => download(recording.id, path, cancel),
  );

  Future<void> pause() async {
    if (!playing || loading || _disposed) return;
    loading = true;
    _notify();
    try {
      await player.pause();
      playing = false;
    } finally {
      loading = false;
      _notify();
    }
  }

  Future<void> toggleAudio({
    required String cacheKey,
    required String extension,
    required Future<void> Function(String path, CancelToken cancellation)
    download,
  }) {
    // Claim the transition synchronously, before the first await. A second
    // segment tap cannot race the cleanup started by this tap.
    if (loading || _disposed || _closingStarted) return Future.value();
    final operation = _toggleAudio(
      cacheKey: cacheKey,
      extension: extension,
      download: download,
    );
    _toggleInFlight = operation;
    operation.whenComplete(() {
      if (identical(_toggleInFlight, operation)) _toggleInFlight = null;
    });
    return operation;
  }

  Future<void> _toggleAudio({
    required String cacheKey,
    required String extension,
    required Future<void> Function(String path, CancelToken cancellation)
    download,
  }) async {
    if (loading || _disposed || _closingStarted) return;
    if (playing && cacheKey == _cacheKey) {
      loading = true;
      _notify();
      try {
        await player.pause();
        playing = false;
      } finally {
        loading = false;
        _notify();
      }
      return;
    }
    failure = null;
    loading = true;
    _notify();
    var generation = _generation;
    try {
      if (_cacheKey != cacheKey) await _discardCurrent();
      if (_disposed || _closingStarted) return;
      generation = _generation;
      final opening = _open(cacheKey, extension, download, generation);
      _opening = opening;
      await opening;
    } finally {
      loading = false;
      _notify();
      _opening = null;
    }
  }

  Future<void> _open(
    String cacheKey,
    String extension,
    Future<void> Function(String path, CancelToken cancellation) download,
    int generation,
  ) async {
    try {
      if (_path == null) {
        final path = await files.createPath(extension);
        _path = path;
        _cacheKey = cacheKey;
        _cancel = CancelToken();
        await download(path, _cancel!);
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
        _cacheKey = null;
      }
    }
  }

  Future<void> _discardCurrent() async {
    _generation++;
    _cancel?.cancel();
    await _opening;
    await player.stop();
    if (_path != null) await files.remove(_path!);
    _path = null;
    _cacheKey = null;
    _cancel = null;
    playing = false;
  }

  Future<void> close() {
    _closingStarted = true;
    return _closing ??= _close();
  }

  Future<void> _close() async {
    _generation++;
    _cancel?.cancel();
    await _toggleInFlight;
    await _opening;
    await player.stop();
    // Dispose native decoder handles before deleting the downloaded file.
    await player.dispose();
    if (_path != null) {
      await files.remove(_path!);
      _path = null;
      _cacheKey = null;
    }
    loading = false;
    playing = false;
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(close());
    super.dispose();
  }
}
