import 'dart:async';
import 'dart:io';

import 'package:companion_mobile/recordings/models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:companion_mobile/capture/capture_controller.dart';
import 'package:companion_mobile/capture/native_capture.dart';
import 'package:companion_mobile/capture/document_import.dart';
import 'package:companion_mobile/capture/temp_files.dart';

class ManualTimer implements Timer {
  ManualTimer(this.callback);
  final void Function() callback;
  @override
  bool isActive = true;
  @override
  int tick = 0;
  @override
  void cancel() => isActive = false;
  void fire() {
    if (!isActive) return;
    isActive = false;
    callback();
  }
}

class FakeCapture implements NativeCapture {
  int starts = 0, stops = 0;
  int cancels = 0, disposals = 0;
  Object? stopError;
  String? path;
  final events = StreamController<void>.broadcast();
  @override
  Stream<void> get interruptions => events.stream;
  @override
  Future<void> start(String path) async {
    starts++;
    this.path = path;
    await File(path).writeAsBytes([1, 2, 3]);
  }

  @override
  Future<String?> stop() async {
    stops++;
    if (stopError != null) throw stopError!;
    return path;
  }

  @override
  Future<void> cancel() async {
    cancels++;
  }

  @override
  Future<void> dispose() async {
    disposals++;
    if (!events.isClosed) await events.close();
  }
}

class BlockingRemoveTempFiles extends TempFiles {
  BlockingRemoveTempFiles(super.root);
  final entered = Completer<void>();
  final release = Completer<void>();
  int removeCalls = 0;

  @override
  Future<void> remove(String path) async {
    removeCalls++;
    if (!entered.isCompleted) {
      entered.complete();
      await release.future;
    }
    await super.remove(path);
  }
}

class FakeImport implements DocumentImport {
  final pending = Completer<PickedAudio?>();
  @override
  Future<PickedAudio?> pick() => pending.future;
  @override
  Future<void> clearPickerCache() async {}
}

void main() {
  late Directory root;
  late FakeCapture mic;
  late FakeImport picker;
  late CaptureController capture;
  late TempFiles files;
  setUp(() async {
    root = await Directory.systemTemp.createTemp('companion-test-');
    files = TempFiles(root);
    mic = FakeCapture();
    picker = FakeImport();
    capture = CaptureController(
      native: mic,
      importer: picker,
      files: files,
      uploader: (draft, cancel, progress) async {},
      limit: const Duration(milliseconds: 40),
    );
  });
  tearDown(() async {
    await capture.shutdown();
    capture.dispose();
    await root.delete(recursive: true);
  });
  test('one-hour foreground timer stops capture once', () async {
    ManualTimer? timer;
    final hourlyCapture = CaptureController(
      native: mic,
      importer: picker,
      files: files,
      uploader: (draft, cancel, progress) async {},
      timerFactory: (duration, callback) {
        expect(duration, const Duration(hours: 1));
        return timer = ManualTimer(callback);
      },
    );
    await hourlyCapture.start();

    timer!.fire();
    expect(hourlyCapture.busy, isTrue);
    while (hourlyCapture.busy) {
      await Future<void>.delayed(const Duration(milliseconds: 1));
    }
    timer!.fire();

    expect(mic.stops, 1);
    expect(hourlyCapture.phase, CapturePhase.ready);
    await hourlyCapture.shutdown();
    hourlyCapture.dispose();
  });
  test(
    'duplicate start ignored; foreground limit stops once and retains a draft',
    () async {
      await Future.wait([capture.start(), capture.start()]);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(mic.starts, 1);
      expect(mic.stops, 1);
      expect(capture.phase, CapturePhase.ready);
      expect(capture.draft?.bytes, 3);
    },
  );
  test(
    'background finalizes once, even when followed by an interruption',
    () async {
      await capture.start();
      await capture.onBackground();
      mic.events.add(null);
      await Future<void>.delayed(Duration.zero);
      expect(mic.stops, 1);
      expect(capture.draft, isNotNull);
    },
  );
  test(
    'late import after clear never restores a draft or deletes source',
    () async {
      final source = await File(
        '${root.parent.path}/source-${root.uri.pathSegments.last}.wav',
      ).writeAsBytes([1, 2]);
      final operation = capture.importAudio();
      await capture.clear();
      picker.pending.complete(PickedAudio(path: source.path, name: 'test.wav'));
      await operation;
      expect(capture.draft, isNull);
      expect(await source.exists(), isTrue);
      await source.delete();
    },
  );
  test('confirmed upload removes only app-owned draft', () async {
    await capture.start();
    await capture.stop();
    final path = capture.draft!.path;
    await capture.upload(consent: true);
    expect(capture.phase, CapturePhase.idle);
    expect(await File(path).exists(), isFalse);
  });
  test('uncertain upload retains UUID until the server confirms it', () async {
    var calls = 0;
    final uncertain = CaptureController(
      native: mic,
      importer: picker,
      files: TempFiles(root),
      uploader: (draft, cancel, progress) async {
        calls++;
        throw const CompanionFailure('NETWORK_ERROR', unknownOutcome: true);
      },
    );
    await uncertain.start();
    await uncertain.stop();
    final id = uncertain.draft!.id;
    final path = uncertain.draft!.path;
    await uncertain.upload(consent: true);
    expect(uncertain.phase, CapturePhase.unknownOutcome);
    expect(uncertain.draft!.id, id);
    expect(await File(path).exists(), true);
    expect(calls, 1);
    await uncertain.reconcile({id});
    expect(uncertain.draft, isNull);
    expect(await File(path).exists(), false);
    await uncertain.shutdown();
    uncertain.dispose();
  });
  test(
    'oversized import is rejected before copying and preserves source',
    () async {
      final source = File('${root.path}/large.wav');
      final handle = await source.open(mode: FileMode.write);
      await handle.truncate(50000001);
      await handle.close();
      expect(
        () =>
            TempFiles(Directory('${root.path}/owned'))
                .copyImport(PickedAudio(path: source.path, name: 'large.wav')),
        throwsA(isA<CompanionFailure>()),
      );
      expect(await source.exists(), true);
    },
  );
  test('no upload without explicit consent', () async {
    await capture.start();
    await capture.stop();
    await capture.upload(consent: false);
    expect(capture.draft, isNotNull);
    expect(capture.phase, CapturePhase.ready);
  });

  test(
    'concurrent clear calls share cleanup and remove the draft once',
    () async {
      final blockingFiles = BlockingRemoveTempFiles(root);
      final serialized = CaptureController(
        native: mic,
        importer: picker,
        files: blockingFiles,
        uploader: (draft, cancel, progress) async {},
      );
      await serialized.start();
      await serialized.stop();

      final firstClear = serialized.clear();
      await blockingFiles.entered.future;
      final secondClear = serialized.clear();
      blockingFiles.release.complete();
      await Future.wait([firstClear, secondClear]);

      expect(blockingFiles.removeCalls, 1);
      expect(serialized.draft, isNull);
      await serialized.shutdown();
      serialized.dispose();
    },
  );

  test(
    'failed microphone finalization cancels and removes its partial file',
    () async {
      mic.stopError = StateError('private recorder error');
      await capture.start();
      final partialPath = mic.path!;

      await capture.stop();

      expect(mic.cancels, 1);
      expect(await File(partialPath).exists(), isFalse);
      expect(capture.draft, isNull);
      expect(capture.phase, CapturePhase.error);
    },
  );

  test(
    'shutdown cancels active capture and disposes native recorder once',
    () async {
      await capture.start();
      final path = mic.path!;

      await capture.shutdown();
      capture.dispose();

      expect(mic.cancels, 1);
      expect(mic.disposals, 1);
      expect(await File(path).exists(), isFalse);
      expect(mic.events.isClosed, isTrue);
    },
  );

  test('recording notifies listeners as elapsed time advances', () async {
    final tickerMic = FakeCapture();
    final ticking = CaptureController(
      native: tickerMic,
      importer: picker,
      files: files,
      uploader: (draft, cancel, progress) async {},
      limit: const Duration(seconds: 5),
    );
    var notifications = 0;
    ticking.addListener(() => notifications++);
    await ticking.start();
    notifications = 0;

    await Future<void>.delayed(const Duration(milliseconds: 1100));

    expect(notifications, greaterThan(0));
    expect(ticking.elapsed, greaterThan(const Duration(seconds: 1)));
    await ticking.stop();
    await ticking.shutdown();
    ticking.dispose();
  });
}
