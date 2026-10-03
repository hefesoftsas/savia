import 'dart:async';

import 'package:companion_mobile/recordings/recording_sessions_controller.dart';
import 'package:companion_mobile/recordings/session_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'polls queued background work until a complete session arrives',
    () async {
      var reads = 0;
      final timer = FakePollTimerFactory();
      final controller = RecordingSessionsController(
        list: ({cursor}) async => RecordingSessionPage(
          sessions: [_session(SessionJobStatus.queued)],
          cursor: null,
        ),
        get: (id) async => _session(
          reads++ > 0
              ? SessionJobStatus.complete
              : SessionJobStatus.transcribing,
        ),
        process: (id, {required consent, required retryAmbiguous}) async =>
            _session(SessionJobStatus.queued),
        cancel: (id) async => _session(SessionJobStatus.cancelled),
        answer: (id, question, {required consent}) async => const SessionAnswer(
          answer: 'Supported.',
          insufficientEvidence: false,
          partial: false,
          evidence: [],
        ),
        timerFactory: timer.create,
      );
      addTearDown(controller.dispose);

      await controller.reload();
      await controller.select(_session(SessionJobStatus.queued).id);
      expect(timer.callback, isNotNull);
      timer.tick();
      await Future<void>.delayed(Duration.zero);
      expect(controller.selectedSession?.job.status, SessionJobStatus.complete);
      expect(timer.active, isFalse);
    },
  );

  test(
    'requires consent and explicit retry acknowledgement after cancellation',
    () async {
      var retries = <bool>[];
      final controller = RecordingSessionsController(
        list: ({cursor}) async =>
            RecordingSessionPage(sessions: [], cursor: null),
        get: (id) async => _session(SessionJobStatus.cancelled),
        process: (id, {required consent, required retryAmbiguous}) async {
          retries.add(retryAmbiguous);
          return _session(SessionJobStatus.queued);
        },
        cancel: (id) async => _session(SessionJobStatus.cancelled),
        answer: (id, question, {required consent}) async => const SessionAnswer(
          answer: '',
          insufficientEvidence: true,
          partial: true,
          evidence: [],
        ),
        timerFactory: FakePollTimerFactory().create,
      );
      addTearDown(controller.dispose);
      await controller.select(_session(SessionJobStatus.cancelled).id);

      await controller.process(consent: false);
      expect(retries, isEmpty);
      await controller.process(consent: true);
      expect(retries, [false]);
      await controller.select(_session(SessionJobStatus.cancelled).id);
      await controller.process(consent: true, retryAmbiguous: true);
      expect(retries, [false, true]);
    },
  );
}

RecordingSession _session(SessionJobStatus status) => RecordingSession(
  id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
  name: 'Long capture',
  createdAt: DateTime.utc(2026, 10, 3),
  state: RecordingSessionState.ready,
  durationSeconds: 30,
  chunks: const [],
  job: RecordingSessionJob(
    status: status,
    completedChunks: 0,
    totalChunks: 0,
    transcripts: const {},
    summary: null,
  ),
);

class FakePollTimerFactory {
  void Function()? callback;
  bool active = false;
  Timer create(Duration duration, void Function() onTick) {
    callback = onTick;
    active = true;
    return FakeTimer(() => active = false);
  }

  void tick() => callback?.call();
}

class FakeTimer implements Timer {
  FakeTimer(this.onCancel);
  final void Function() onCancel;
  @override
  void cancel() => onCancel();
  @override
  bool get isActive => true;
  @override
  int get tick => 0;
}
