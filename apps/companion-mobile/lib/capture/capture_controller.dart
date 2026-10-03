import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../recordings/models.dart';
import 'draft.dart';
import 'document_import.dart';
import 'native_capture.dart';
import 'temp_files.dart';

const mobileCaptureDurationLimit = Duration(hours: 1);
typedef CaptureTimerFactory = Timer Function(
  Duration duration,
  void Function() callback,
);

enum CapturePhase { idle, recording, ready, uploading, unknownOutcome, error }

enum _CaptureOperation { start, stop, import, upload }

typedef DraftUploader = Future<void> Function(
  RecordingDraft,
  CancelToken,
  void Function(int, int),
);

class CaptureController extends ChangeNotifier {
  CaptureController({
    required this.native,
    required this.importer,
    required this.files,
    required this.uploader,
    this.limit = mobileCaptureDurationLimit,
    this.timerFactory = Timer.new,
  }) {
    _interruption = native.interruptions.listen((_) {
      unawaited(stop());
    });
  }
  final NativeCapture native;
  final DocumentImport importer;
  final TempFiles files;
  final DraftUploader uploader;
  final Duration limit;
  final CaptureTimerFactory timerFactory;
  CapturePhase phase = CapturePhase.idle;
  RecordingDraft? draft;
  CompanionFailure? failure;
  double progress = 0;
  bool busy = false;
  int _generation = 0;
  bool _disposed = false;
  bool _shuttingDown = false;
  String? _capturePath;
  Timer? _timer;
  Timer? _elapsedTicker;
  StreamSubscription<void>? _interruption;
  CancelToken? _cancellation;
  Future<void>? _active;
  _CaptureOperation? _activeKind;
  Future<void>? _clearInFlight;
  Future<void>? _shutdownInFlight;
  final Stopwatch _elapsed = Stopwatch();
  Duration get elapsed => _elapsed.elapsed;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> start() => _run(_CaptureOperation.start, () async {
    if (draft != null || phase == CapturePhase.recording) return;
    final generation = _generation;
    failure = null;
    final path = await files.createPath('m4a');
    _capturePath = path;
    try {
      await native.start(path);
      if (generation != _generation) {
        await native.cancel();
        await files.remove(path);
        return;
      }
      _elapsed
        ..reset()
        ..start();
      phase = CapturePhase.recording;
      _elapsedTicker = Timer.periodic(const Duration(seconds: 1), (_) {
        if (phase == CapturePhase.recording) _notify();
      });
      _timer = timerFactory(limit, () {
        unawaited(stop());
      });
    } catch (error) {
      await files.remove(path);
      _capturePath = null;
      if (generation == _generation) {
        phase = CapturePhase.error;
        failure = _safe(error);
      }
    }
  });
  Future<void> stop() => _run(_CaptureOperation.stop, () async {
    if (phase != CapturePhase.recording) return;
    _timer?.cancel();
    _elapsedTicker?.cancel();
    _elapsedTicker = null;
    _elapsed.stop();
    final generation = _generation;
    final path = _capturePath;
    try {
      final recorded = await native.stop();
      if (generation != _generation || path == null) return;
      if (recorded == null || recorded != path) {
        throw const CompanionFailure('CAPTURE_FAILED');
      }
      final bytes = await File(path).length();
      if (bytes == 0 || bytes > 50000000) {
        throw const CompanionFailure('INVALID_AUDIO');
      }
      draft = RecordingDraft(
        id: const Uuid().v4(),
        path: path,
        name: 'Recording.m4a',
        format: 'm4a',
        bytes: bytes,
        durationSeconds: elapsed.inMilliseconds / 1000,
      );
      phase = CapturePhase.ready;
    } catch (error) {
      try {
        await native.cancel();
      } catch (_) {
        // Still remove the app-owned partial file and report a safe failure.
      }
      if (path != null) {
        try {
          await files.remove(path);
        } catch (_) {
          // Startup orphan cleanup is the last recovery path for file errors.
        }
      }
      if (_capturePath == path) _capturePath = null;
      if (generation == _generation) {
        failure = _safe(error);
        phase = CapturePhase.error;
      }
    }
  });
  Future<void> onBackground() async {
    if (busy) await _active;
    await stop();
  }

  Future<void> importAudio() => _run(_CaptureOperation.import, () async {
    if (draft != null || phase == CapturePhase.recording) return;
    final generation = _generation;
    failure = null;
    try {
      final picked = await importer.pick();
      if (picked == null || generation != _generation) return;
      final copied = await files.copyImport(picked);
      if (generation != _generation) {
        await files.remove(copied.path);
        return;
      }
      draft = copied;
      phase = CapturePhase.ready;
    } catch (error) {
      if (generation == _generation) {
        failure = _safe(error);
        phase = CapturePhase.error;
      }
    } finally {
      await importer.clearPickerCache();
    }
  });
  Future<void> upload({required bool consent}) =>
      _run(_CaptureOperation.upload, () async {
        if (!consent || draft == null) return;
        final current = draft!;
        final generation = _generation;
        failure = null;
        phase = CapturePhase.uploading;
        progress = 0;
        _cancellation = CancelToken();
        _notify();
        try {
          await uploader(current, _cancellation!, (sent, total) {
            if (generation == _generation && total > 0) {
              progress = sent / total;
              _notify();
            }
          });
          await files.remove(current.path);
          if (generation == _generation) {
            draft = null;
            _capturePath = null;
            phase = CapturePhase.idle;
          }
        } catch (error) {
          if (generation == _generation) {
            failure = _safe(error);
            phase = failure!.unknownOutcome
                ? CapturePhase.unknownOutcome
                : CapturePhase.ready;
          }
        } finally {
          _cancellation = null;
        }
      });

  /// Called only after the server lists this draft ID as a confirmed recording.
  Future<void> reconcile(Set<String> savedIds) async {
    if (draft != null && savedIds.contains(draft!.id) && !busy) await discard();
  }

  Future<void> discard() async {
    if (busy) return;
    await clear();
  }

  Future<void> clear() async {
    final current = _clearInFlight;
    if (current != null) return current;
    final operation = _clearOnce();
    late final Future<void> tracked;
    tracked = operation.whenComplete(() {
      if (identical(_clearInFlight, tracked)) _clearInFlight = null;
    });
    _clearInFlight = tracked;
    return tracked;
  }

  Future<void> _clearOnce() async {
    _generation++;
    _timer?.cancel();
    _elapsedTicker?.cancel();
    _elapsedTicker = null;
    _elapsed.stop();
    _cancellation?.cancel();
    // A picker can stay open; its late result is rejected by generation.
    if (phase == CapturePhase.uploading ||
        phase == CapturePhase.recording ||
        _activeKind == _CaptureOperation.start ||
        _activeKind == _CaptureOperation.stop) {
      await _active;
      await native.cancel();
    }
    final paths = {if (draft != null) draft!.path, ?_capturePath};
    for (final path in paths) {
      await files.remove(path);
    }
    draft = null;
    _capturePath = null;
    failure = null;
    phase = CapturePhase.idle;
    _notify();
  }

  Future<void> shutdown() {
    final current = _shutdownInFlight;
    if (current != null) return current;
    _shuttingDown = true;
    final operation = _shutdownOnce();
    _shutdownInFlight = operation;
    return operation;
  }

  Future<void> _shutdownOnce() async {
    try {
      await _interruption?.cancel();
    } catch (_) {
      // The recorder will still be disposed below.
    }
    _interruption = null;
    try {
      await clear();
    } finally {
      await native.dispose();
    }
  }

  Future<void> _run(
    _CaptureOperation kind,
    Future<void> Function() operation,
  ) async {
    if (busy || _disposed || _shuttingDown || _clearInFlight != null) return;
    busy = true;
    _notify();
    final pending = operation();
    _active = pending;
    _activeKind = kind;
    try {
      await pending;
    } finally {
      busy = false;
      _active = null;
      _activeKind = null;
      _notify();
    }
  }

  CompanionFailure _safe(Object error) => error is CompanionFailure
      ? error
      : const CompanionFailure('CAPTURE_FAILED');
  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    unawaited(shutdown());
    super.dispose();
  }
}
