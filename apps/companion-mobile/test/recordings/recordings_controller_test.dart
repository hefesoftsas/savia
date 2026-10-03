import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:companion_mobile/recordings/recordings_controller.dart';
import 'package:companion_mobile/recordings/models.dart';

void main() {
  test('late library response after clear is ignored', () async {
    final pending = Completer<RecordingPage>();
    final controller = RecordingsController(
      list: ({cursor}) => pending.future,
      notes: (_) async => const RecordingNotes(transcript: null, summary: null),
      generate: (_) async =>
          const RecordingNotes(transcript: null, summary: null),
      answer: (_, _) async =>
          const RecordingAnswer(answer: '', insufficientEvidence: true),
    );
    final loading = controller.reload();
    controller.clear();
    pending.complete(const RecordingPage(recordings: [], cursor: 'stale'));
    await loading;
    expect(controller.cursor, isNull);
    expect(controller.recordings, isEmpty);
  });
  test(
    'processing requires consent and suppresses duplicate submission',
    () async {
      var calls = 0;
      final pending = Completer<RecordingNotes>();
      final controller = RecordingsController(
        list: ({cursor}) async =>
            const RecordingPage(recordings: [], cursor: null),
        notes: (_) async =>
            const RecordingNotes(transcript: null, summary: null),
        generate: (_) {
          calls++;
          return pending.future;
        },
        answer: (_, _) async =>
            const RecordingAnswer(answer: '', insufficientEvidence: true),
      );
      await controller.select('recording');
      await controller.generate(consent: false);
      expect(calls, 0);
      final a = controller.generate(consent: true);
      await controller.generate(consent: true);
      expect(calls, 1);
      pending.complete(const RecordingNotes(transcript: null, summary: null));
      await a;
    },
  );
  test(
    'summary failure recovers the saved transcript and retains safe failure',
    () async {
      const transcript = RecordingTranscript(
        text: 'Saved speech',
        source: 'upload',
        model: 'fixture',
        durationSeconds: null,
      );
      var reads = 0;
      final c = RecordingsController(
        list: ({cursor}) async =>
            const RecordingPage(recordings: [], cursor: null),
        notes: (_) async {
          reads++;
          return RecordingNotes(
            transcript: reads > 1 ? transcript : null,
            summary: null,
          );
        },
        generate: (_) async => throw const CompanionFailure(
          'PROVIDER_FAILED',
          providerStage: 'summary',
          providerStatus: 502,
        ),
        answer: (_, _) async =>
            const RecordingAnswer(answer: '', insufficientEvidence: true),
      );
      await c.select('a');
      await c.generate(consent: true);
      expect(c.savedNotes!.transcript!.text, 'Saved speech');
      expect(c.failure!.providerStage, 'summary');
    },
  );
  test('a late question cannot appear on another recording', () async {
    const notes = RecordingNotes(
      transcript: RecordingTranscript(
        text: 'Speech',
        source: 'upload',
        model: 'fixture',
        durationSeconds: null,
      ),
      summary: null,
    );
    final pending = Completer<RecordingAnswer>();
    var calls = 0;
    final c = RecordingsController(
      list: ({cursor}) async =>
          const RecordingPage(recordings: [], cursor: null),
      notes: (_) async => notes,
      generate: (_) async => notes,
      answer: (_, _) {
        calls++;
        return pending.future;
      },
    );
    await c.select('a');
    final work = c.ask('question', consent: true);
    await c.ask('duplicate', consent: true);
    expect(calls, 1);
    await c.select('b');
    pending.complete(
      const RecordingAnswer(
        answer: 'Answer from a',
        insufficientEvidence: false,
      ),
    );
    await work;
    expect(c.answer, isNull);
    expect(c.selectedId, 'b');
  });
}
