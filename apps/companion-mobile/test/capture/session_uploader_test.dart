import 'dart:io';

import 'package:companion_mobile/capture/audio_segmenter.dart';
import 'package:companion_mobile/capture/draft.dart';
import 'package:companion_mobile/capture/session_uploader.dart';
import 'package:companion_mobile/capture/temp_files.dart';
import 'package:companion_mobile/recordings/session_models.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late Directory temp;
  late TempFiles files;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('savia-session-upload-');
    files = TempFiles(temp);
  });

  tearDown(() async => temp.delete(recursive: true));

  for (final overshoot in [3600.25, 3601.0]) {
    test(
      'trims a captured duration of $overshoot seconds to one hour',
      () async {
        final sourcePath = '${temp.path}/capture.m4a';
        await File(sourcePath).writeAsBytes([9, 8, 7]);
        final parts = List.generate(
          120,
          (sequence) => (
            start: sequence * 30.0,
            duration: 30.0,
            data: <int>[sequence % 255],
          ),
        );
        final segmenter = FakeSegmenter(files, parts);
        final api = FakeSessionUploadApi()
          ..created = recordingSession(
            chunks: [
              for (var sequence = 0; sequence < 120; sequence++)
                sessionChunk(
                  sequence: sequence,
                  start: sequence * 30.0,
                  duration: 30,
                  bytes: 1,
                ),
            ],
          );
        final uploader = CapturedSessionUploader(
          api: api,
          segmenter: segmenter,
          files: files,
        );

        await uploader.upload(
          RecordingDraft(
            id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
            path: sourcePath,
            name: 'Recording 2026-10-03 12:00',
            format: 'm4a',
            bytes: 3,
            durationSeconds: overshoot,
            isCapture: true,
          ),
          cancellation: CancelToken(),
        );

        expect(api.finalizeCall, (count: 120, duration: 3600.0));
      },
    );
  }

  test(
    'rejects nonfinite captured durations before creating a session',
    () async {
      final sourcePath = '${temp.path}/capture.m4a';
      await File(sourcePath).writeAsBytes([9, 8, 7]);
      final api = FakeSessionUploadApi();
      final uploader = CapturedSessionUploader(
        api: api,
        segmenter: FakeSegmenter(files, []),
        files: files,
      );

      for (final duration in [
        double.nan,
        double.infinity,
        double.negativeInfinity,
      ]) {
        await expectLater(
          uploader.upload(
            RecordingDraft(
              id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
              path: sourcePath,
              name: 'Recording 2026-10-03 12:00',
              format: 'm4a',
              bytes: 3,
              durationSeconds: duration,
              isCapture: true,
            ),
            cancellation: CancelToken(),
          ),
          throwsArgumentError,
        );
      }
      expect(api.createIds, isEmpty);
    },
  );

  test(
    'resumes from server chunks and finalizes without uploading duplicates',
    () async {
      final sourcePath = '${temp.path}/capture.m4a';
      await File(sourcePath).writeAsBytes([9, 8, 7]);
      final segmenter = FakeSegmenter(files, [
        (start: 0.0, duration: 30.0, data: [1, 2, 3]),
        (start: 30.0, duration: 12.0, data: [4, 5]),
      ]);
      final api = FakeSessionUploadApi()
        ..created = recordingSession(
          chunks: [sessionChunk(sequence: 0, start: 0, duration: 30, bytes: 3)],
        );
      final uploader = CapturedSessionUploader(
        api: api,
        segmenter: segmenter,
        files: files,
      );

      final progress = <(int, int)>[];
      final result = await uploader.upload(
        RecordingDraft(
          id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
          path: sourcePath,
          name: 'Recording 2026-10-03 12:00',
          format: 'm4a',
          bytes: 3,
          durationSeconds: 42,
          isCapture: true,
        ),
        cancellation: CancelToken(),
        onProgress: (sent, total) => progress.add((sent, total)),
      );

      expect(progress, contains((4, 5)));
      expect(progress.last, (5, 5));
      expect(progress.every((item) => item.$1 <= item.$2), isTrue);
      expect(api.createIds, ['8b87d175-a584-4e3d-95cb-e96c84248e15']);
      expect(api.uploads.map((upload) => upload.sequence), [1]);
      expect(api.finalizeCall, (count: 2, duration: 42.0));
      expect(result.state, RecordingSessionState.ready);
      expect(
        segmenter.outputPaths.every((path) => !File(path).existsSync()),
        isTrue,
      );
      expect(File(sourcePath).existsSync(), isTrue);
    },
  );

  test('cancellation does not finalize when all parts already exist', () async {
    final sourcePath = '${temp.path}/capture.m4a';
    await File(sourcePath).writeAsBytes([9, 8, 7]);
    final segmenter = FakeSegmenter(files, [
      (start: 0.0, duration: 30.0, data: [1, 2, 3]),
    ]);
    final api = FakeSessionUploadApi()
      ..created = recordingSession(
        chunks: [sessionChunk(sequence: 0, start: 0, duration: 30, bytes: 3)],
      );
    final cancellation = CancelToken();
    api.onCreate = () => cancellation.cancel('user cancelled');
    final uploader = CapturedSessionUploader(
      api: api,
      segmenter: segmenter,
      files: files,
    );

    await expectLater(
      uploader.upload(
        RecordingDraft(
          id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
          path: sourcePath,
          name: 'Recording 2026-10-03 12:00',
          format: 'm4a',
          bytes: 3,
          durationSeconds: 30,
          isCapture: true,
        ),
        cancellation: cancellation,
      ),
      throwsA(isA<DioException>()),
    );
    expect(api.finalizeCall, isNull);
  });

  test(
    'reuses generated segments after failure and removes them only on success',
    () async {
      final sourcePath = '${temp.path}/capture.m4a';
      await File(sourcePath).writeAsBytes([9, 8, 7]);
      final segmenter = FakeSegmenter(files, [
        (start: 0.0, duration: 30.0, data: [1, 2, 3]),
      ]);
      final api = FakeSessionUploadApi()..failUpload = true;
      var segmentsCalls = 0;
      final countingSegmenter = CountingSegmenter(
        segmenter,
        () => segmentsCalls++,
      );
      final uploader = CapturedSessionUploader(
        api: api,
        segmenter: countingSegmenter,
        files: files,
      );

      await expectLater(
        uploader.upload(
          RecordingDraft(
            id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
            path: sourcePath,
            name: 'Recording 2026-10-03 12:00',
            format: 'm4a',
            bytes: 3,
            durationSeconds: 30,
            isCapture: true,
          ),
          cancellation: CancelToken(),
        ),
        throwsStateError,
      );
      expect(
        segmenter.outputPaths.every((path) => File(path).existsSync()),
        isTrue,
      );
      expect(File(sourcePath).existsSync(), isTrue);
      api.failUpload = false;
      await uploader.upload(
        RecordingDraft(
          id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
          path: sourcePath,
          name: 'Recording 2026-10-03 12:00',
          format: 'm4a',
          bytes: 3,
          durationSeconds: 30,
          isCapture: true,
        ),
        cancellation: CancelToken(),
      );
      expect(segmentsCalls, 1);
      expect(
        segmenter.outputPaths.every((path) => !File(path).existsSync()),
        isTrue,
      );
    },
  );
}

class FakeSegmenter implements NativeAudioSegmenter {
  FakeSegmenter(this.files, this.parts);
  final TempFiles files;
  final List<({double start, double duration, List<int> data})> parts;
  final List<String> outputPaths = [];

  @override
  Future<List<AudioSegment>> segment(
    String sourcePath,
    String outputDirectory, {
    required String artifactId,
  }) async {
    final segments = <AudioSegment>[];
    for (var index = 0; index < parts.length; index++) {
      final part = parts[index];
      final path =
          '${files.root.path}/$artifactId-segment-${index.toString().padLeft(3, '0')}.m4a';
      await files.root.create(recursive: true);
      outputPaths.add(path);
      await File(path).writeAsBytes(part.data);
      segments.add(
        AudioSegment(
          path: path,
          startSeconds: part.start,
          durationSeconds: part.duration,
          bytes: part.data.length,
        ),
      );
    }
    return segments;
  }
}

class CountingSegmenter implements NativeAudioSegmenter {
  CountingSegmenter(this.inner, this.onCall);
  final NativeAudioSegmenter inner;
  final void Function() onCall;
  @override
  Future<List<AudioSegment>> segment(
    String sourcePath,
    String outputDirectory, {
    required String artifactId,
  }) {
    onCall();
    return inner.segment(sourcePath, outputDirectory, artifactId: artifactId);
  }
}

class FakeSessionUploadApi implements RecordingSessionUploadApi {
  RecordingSession created = recordingSession();
  final List<String> createIds = [];
  final List<({int sequence, double start})> uploads = [];
  ({int count, double duration})? finalizeCall;
  bool failUpload = false;
  void Function()? onCreate;

  @override
  Future<RecordingSession> createSession({
    required String id,
    required String name,
    required bool consent,
  }) async {
    createIds.add(id);
    onCreate?.call();
    expect(name.trim().isNotEmpty, isTrue);
    expect(name.trim().length, lessThanOrEqualTo(255));
    expect(consent, true);
    return created;
  }

  @override
  Future<RecordingSession> uploadSessionChunk({
    required String sessionId,
    required int sequence,
    required double startSeconds,
    required String path,
    required int expectedBytes,
    required CancelToken cancellation,
    void Function(int, int)? onProgress,
  }) async {
    if (failUpload) throw StateError('upload failed');
    onProgress?.call(500, 1000);
    onProgress?.call(1000, 1000);
    uploads.add((sequence: sequence, start: startSeconds));
    final previous = created.chunks;
    created = recordingSession(
      chunks: [
        ...previous,
        sessionChunk(
          sequence: sequence,
          start: startSeconds,
          duration: 12,
          bytes: expectedBytes,
        ),
      ],
    );
    return created;
  }

  @override
  Future<RecordingSession> finalizeSession({
    required String id,
    required int expectedChunks,
    required double durationSeconds,
  }) async {
    finalizeCall = (count: expectedChunks, duration: durationSeconds);
    return recordingSession(
      state: RecordingSessionState.ready,
      durationSeconds: durationSeconds,
      chunks: created.chunks,
    );
  }
}

RecordingSession recordingSession({
  RecordingSessionState state = RecordingSessionState.uploading,
  double? durationSeconds,
  List<RecordingSessionChunk> chunks = const [],
}) => RecordingSession(
  id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
  name: 'Recording 2026-10-03 12:00',
  createdAt: DateTime.utc(2026, 10, 3),
  state: state,
  durationSeconds: durationSeconds,
  chunks: chunks,
  job: const RecordingSessionJob(
    status: SessionJobStatus.idle,
    completedChunks: 0,
    totalChunks: 0,
    transcripts: {},
    summary: null,
  ),
);

RecordingSessionChunk sessionChunk({
  required int sequence,
  required double start,
  required double duration,
  required int bytes,
}) => RecordingSessionChunk(
  source: 'microphone',
  sequence: sequence,
  startSeconds: start,
  durationSeconds: duration,
  bytes: bytes,
  format: 'm4a',
);
