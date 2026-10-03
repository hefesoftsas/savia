import 'package:companion_mobile/recordings/session_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses a session manifest with partial transcripts and job status', () {
    final session = RecordingSession.fromJson({
      'id': '8b87d175-a584-4e3d-95cb-e96c84248e15',
      'name': 'Planning',
      'createdAt': '2026-10-03T12:00:00.000Z',
      'state': 'ready',
      'durationSeconds': 31.2,
      'chunks': [
        {
          'source': 'microphone',
          'sequence': 0,
          'startSeconds': 0,
          'durationSeconds': 30,
          'bytes': 1200,
        },
        {
          'source': 'microphone',
          'sequence': 1,
          'startSeconds': 30,
          'durationSeconds': 1.2,
          'bytes': 90,
        },
      ],
      'job': {
        'status': 'transcribing',
        'completedChunks': 1,
        'totalChunks': 2,
        'error': null,
        'transcripts': {
          'microphone:0': {
            'text': 'A partial transcript.',
            'source': 'microphone',
            'model': 'whisper',
            'durationSeconds': 30,
          },
        },
        'summary': null,
      },
    });

    expect(session.chunks, hasLength(2));
    expect(session.chunks.first.format, 'ogg');
    expect(session.job.status, SessionJobStatus.transcribing);
    expect(
      session.job.transcripts['microphone:0']?.text,
      'A partial transcript.',
    );
    expect(session.job.summary, isNull);
    expect(session.durationSeconds, 31.2);
  });

  test('rejects invalid chunk identity and unknown job statuses', () {
    final invalid = <String, Object?>{
      'id': '8b87d175-a584-4e3d-95cb-e96c84248e15',
      'name': 'Bad',
      'createdAt': '2026-10-03T12:00:00.000Z',
      'state': 'ready',
      'durationSeconds': 1,
      'chunks': [
        {
          'source': 'upload',
          'sequence': -1,
          'startSeconds': 0,
          'durationSeconds': 1,
          'bytes': 10,
        },
      ],
      'job': {
        'status': 'unexpected',
        'completedChunks': 0,
        'totalChunks': 1,
        'transcripts': {},
        'summary': null,
      },
    };

    expect(() => RecordingSession.fromJson(invalid), throwsFormatException);
  });

  test('accepts M4A chunks and rejects unsupported playback formats', () {
    final chunk = {
      'source': 'system',
      'sequence': 0,
      'startSeconds': 0,
      'durationSeconds': 30,
      'bytes': 1200,
      'format': 'm4a',
    };
    expect(RecordingSessionChunk.fromJson(chunk).format, 'm4a');
    expect(
      () => RecordingSessionChunk.fromJson({...chunk, 'format': 'wav'}),
      throwsFormatException,
    );
  });

  test(
    'accepts upload responses that intentionally omit processing details',
    () {
      final session = RecordingSession.fromJson({
        'id': '8b87d175-a584-4e3d-95cb-e96c84248e15',
        'name': 'Capture',
        'createdAt': '2026-10-03T12:00:00.000Z',
        'state': 'uploading',
        'durationSeconds': null,
        'chunks': [],
      });

      expect(session.job.status, SessionJobStatus.idle);
      expect(session.job.transcripts, isEmpty);
    },
  );
}
