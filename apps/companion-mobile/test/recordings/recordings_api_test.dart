import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:companion_mobile/capture/draft.dart';
import 'package:companion_mobile/recordings/models.dart';
import 'package:companion_mobile/recordings/recordings_api.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late QueueAdapter adapter;
  late Dio dio;
  late int? workspaceId;
  late RecordingApiHarness api;
  late Directory temp;

  setUp(() async {
    adapter = QueueAdapter();
    dio = Dio(BaseOptions(baseUrl: 'https://savia-preview.hefesoft.com'))
      ..httpClientAdapter = adapter;
    workspaceId = 27;
    api = RecordingApiHarness(
      dio: dio,
      apiOrigin: Uri.parse('https://savia-preview.hefesoft.com'),
      tokenProvider: () async => 'access-token-secret',
      workspaceIdProvider: () => workspaceId,
    );
    temp = await Directory.systemTemp.createTemp('savia-recordings-test-');
  });

  tearDown(() async {
    dio.close(force: true);
    await temp.delete(recursive: true);
  });

  test(
    'sends bearer and selected tenant context on workspace API calls',
    () async {
      adapter.enqueue(200, jsonEncode({'recordings': [], 'cursor': null}));

      await api.list();

      expect(
        adapter.requests.single.headers['authorization'],
        'Bearer access-token-secret',
      );
      expect(adapter.requests.single.headers['x-savia-tenant-id'], '27');
    },
  );

  test(
    'uploads raw audio with the same draft UUID for each explicit retry',
    () async {
      final path = '${temp.path}/interview.wav';
      await File(path).writeAsBytes([1, 2, 3, 4]);
      final draft = RecordingDraft(
        id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
        path: path,
        name: 'interview.wav',
        format: 'wav',
        bytes: 4,
      );
      adapter
        ..enqueue(200, jsonEncode(recordingJson(id: draft.id)))
        ..enqueue(200, jsonEncode(recordingJson(id: draft.id)));

      await api.upload(draft);
      await api.upload(draft);

      expect(adapter.requests, hasLength(2));
      for (final request in adapter.requests) {
        expect(request.uri.queryParameters['id'], draft.id);
        expect(request.uri.queryParameters['consent'], 'true');
        expect(request.contentType, 'application/octet-stream');
        expect(request.bytes, [1, 2, 3, 4]);
        expect(request.bodyWasJsonEncoded, isFalse);
      }
    },
  );

  test(
    'rejects actual files larger than 50 MB before contacting the server',
    () async {
      final path = '${temp.path}/oversized.wav';
      final file = await File(path).open(mode: FileMode.write);
      await file.setPosition(50000000);
      await file.writeByte(1);
      await file.close();
      final draft = RecordingDraft(
        id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
        path: path,
        name: 'oversized.wav',
        format: 'wav',
        bytes: 50000001,
      );

      await expectLater(api.upload(draft), throwsA(isA<CompanionFailure>()));

      expect(adapter.requests, isEmpty);
    },
  );

  test(
    'a mutation that receives a server failure is not automatically replayed',
    () async {
      final path = '${temp.path}/interview.wav';
      await File(path).writeAsBytes([1, 2, 3, 4]);
      final draft = RecordingDraft(
        id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
        path: path,
        name: 'interview.wav',
        format: 'wav',
        bytes: 4,
      );
      adapter.enqueue(
        504,
        jsonEncode({
          'error': {'code': 'UPSTREAM_TIMEOUT'},
        }),
      );

      final failure = await captureFailure(() => api.upload(draft));

      expect(adapter.requests, hasLength(1));
      expect(failure.status, 504);
      expect(failure.unknownOutcome, isTrue);
      expect(failure.toString(), isNot(contains('access-token-secret')));
    },
  );

  test('a 401 upload is not retried after dispatch', () async {
    final path = '${temp.path}/interview.wav';
    await File(path).writeAsBytes([1, 2, 3, 4]);
    final draft = RecordingDraft(
      id: '8b87d175-a584-4e3d-95cb-e96c84248e15',
      path: path,
      name: 'interview.wav',
      format: 'wav',
      bytes: 4,
    );
    adapter.enqueue(
      401,
      jsonEncode({
        'error': {'code': 'UNAUTHORIZED'},
      }),
    );

    final failure = await captureFailure(() => api.upload(draft));

    expect(failure.status, 401);
    expect(failure.unknownOutcome, isFalse);
    expect(adapter.requests, hasLength(1));
  });

  test(
    'rejects cross-origin redirects instead of forwarding credentials',
    () async {
      adapter.enqueue(
        302,
        '',
        headers: {'location': 'https://attacker.invalid/steal'},
      );

      final failure = await captureFailure(() => api.list());

      expect(failure, isA<CompanionFailure>());
      expect(adapter.requests, hasLength(1));
      expect(adapter.requests.single.followRedirects, isFalse);
    },
  );

  test('malformed response data becomes a safe typed failure', () async {
    adapter.enqueue(200, '{"recordings":[{"id":2}],"cursor":null}');

    final failure = await captureFailure(() => api.list());

    expect(failure.code, 'INVALID_RESPONSE');
    expect(failure.toString(), isNot(contains('id":2')));
  });

  test(
    'partial persisted notes retain transcript when summary is null',
    () async {
      adapter.enqueue(
        200,
        jsonEncode({
          'transcript': {
            'text': 'The team agreed to review the draft.',
            'source': 'upload',
            'model': 'transcriber',
            'durationSeconds': null,
          },
          'summary': null,
        }),
      );

      final notes = await api.notes('8b87d175-a584-4e3d-95cb-e96c84248e15');

      expect(notes.transcript?.text, 'The team agreed to review the draft.');
      expect(notes.transcript?.durationSeconds, isNull);
      expect(notes.summary, isNull);
    },
  );

  test(
    'a denied scope exposes only the server error code and status',
    () async {
      adapter.enqueue(
        403,
        jsonEncode({
          'error': {
            'code': 'RECORDING_SCOPE_REQUIRED',
            'message': 'Private diagnostic',
          },
        }),
      );

      final failure = await captureFailure(() => api.list());

      expect(failure.code, 'RECORDING_SCOPE_REQUIRED');
      expect(failure.status, 403);
      expect(failure.toString(), isNot(contains('Private diagnostic')));
    },
  );

  test(
    'a malformed successful mutation keeps its outcome uncertain without retry',
    () async {
      adapter.enqueue(200, jsonEncode({'unexpected': 'payload'}));
      final failure = await captureFailure(
        () =>
            api.generate('8b87d175-a584-4e3d-95cb-e96c84248e15', consent: true),
      );
      expect(failure.unknownOutcome, true);
      expect(adapter.requests, hasLength(1));
    },
  );

  test('cancelled requests do not dispatch to the transport', () async {
    final cancellation = CancelToken()..cancel('private cancellation note');

    final failure = await captureFailure(
      () => api.audio(
        '8b87d175-a584-4e3d-95cb-e96c84248e15',
        '${temp.path}/audio.wav',
        cancellation: cancellation,
      ),
    );

    expect(failure.code, 'REQUEST_CANCELLED');
    expect(adapter.requests, isEmpty);
  });

  test(
    'session discovery does not send an unselected workspace header',
    () async {
      workspaceId = null;
      adapter.enqueue(
        200,
        jsonEncode({
          'subject': 'user-1',
          'displayName': 'A user',
          'workspaces': [
            {'id': 27, 'name': 'Operations', 'slug': 'ops'},
          ],
          'grantedRecordingScopes': ['recordings:read'],
        }),
      );

      final session = await api.session();

      expect(session.workspaces.single.id, 27);
      expect(
        adapter.requests.single.headers.containsKey('x-savia-tenant-id'),
        isFalse,
      );
    },
  );

  test(
    'uploads one captured M4A session chunk with consent and tenant context',
    () async {
      final id = '8b87d175-a584-4e3d-95cb-e96c84248e15';
      final path = '${temp.path}/segment.m4a';
      await File(path).writeAsBytes([1, 2, 3, 4]);
      adapter
        ..enqueue(200, jsonEncode(sessionJson(id: id)))
        ..enqueue(
          200,
          jsonEncode(sessionJson(id: id, chunks: [sessionChunkJson()])),
        )
        ..enqueue(
          200,
          jsonEncode(
            sessionJson(
              id: id,
              state: 'ready',
              chunks: [sessionChunkJson()],
              durationSeconds: 30,
            ),
          ),
        );

      await api.createSession(id: id, name: 'Recording.m4a', consent: true);
      await api.uploadSessionChunk(
        sessionId: id,
        sequence: 0,
        startSeconds: 0,
        path: path,
        expectedBytes: 4,
        cancellation: CancelToken(),
      );
      await api.finalizeSession(id: id, expectedChunks: 1, durationSeconds: 30);

      expect(adapter.requests, hasLength(3));
      final create = jsonDecode(
        utf8.decode(adapter.requests[0].bytes),
      ) as Map<String, dynamic>;
      expect(create, {
        'id': id,
        'name': 'Recording.m4a',
        'sources': ['microphone'],
        'consent': true,
      });
      final uploaded = jsonDecode(
        utf8.decode(adapter.requests[1].bytes),
      ) as Map<String, dynamic>;
      expect(uploaded['source'], 'microphone');
      expect(uploaded['sequence'], 0);
      expect(uploaded['startSeconds'], 0);
      expect(uploaded['audio'], {
        'data': base64Encode([1, 2, 3, 4]),
        'format': 'm4a',
      });
      final finalize = jsonDecode(
        utf8.decode(adapter.requests[2].bytes),
      ) as Map<String, dynamic>;
      expect(finalize, {'expectedChunks': 1, 'durationSeconds': 30});
      for (final request in adapter.requests) {
        expect(request.headers['x-savia-tenant-id'], '27');
        expect(request.headers['authorization'], 'Bearer access-token-secret');
        expect(request.followRedirects, isFalse);
      }
    },
  );
}

class RecordingApiHarness extends RecordingsApi {
  RecordingApiHarness({
    required super.dio,
    required super.apiOrigin,
    required super.tokenProvider,
    required super.workspaceIdProvider,
  });
}

Map<String, Object?> recordingJson({required String id}) => {
  'id': id,
  'source': 'upload',
  'format': 'wav',
  'bytes': 4,
  'durationSeconds': null,
  'createdAt': '2026-10-03T12:00:00.000Z',
  'sha256': 'a' * 64,
  'name': 'interview.wav',
  'origin': 'local',
};

Map<String, Object?> sessionJson({
  required String id,
  String state = 'uploading',
  List<Map<String, Object?>> chunks = const [],
  double? durationSeconds,
}) => {
  'id': id,
  'name': 'Recording.m4a',
  'createdAt': '2026-10-03T12:00:00.000Z',
  'state': state,
  'durationSeconds': durationSeconds,
  'chunks': chunks,
  'job': {
    'status': 'idle',
    'completedChunks': 0,
    'totalChunks': 0,
    'transcripts': <String, Object?>{},
    'summary': null,
  },
};

Map<String, Object?> sessionChunkJson() => {
  'source': 'microphone',
  'format': 'm4a',
  'sequence': 0,
  'startSeconds': 0,
  'durationSeconds': 30,
  'bytes': 4,
};

Future<CompanionFailure> captureFailure(Future<void> Function() action) async {
  try {
    await action();
  } on CompanionFailure catch (failure) {
    return failure;
  }
  throw StateError('Expected a safe CompanionFailure.');
}

class CapturedRequest {
  CapturedRequest(this.options, this.bytes)
    : uri = Uri.parse(options.uri.toString()),
      headers = options.headers.map(
        (key, value) => MapEntry(key.toLowerCase(), value),
      ),
      contentType = options.contentType;

  final RequestOptions options;
  final List<int> bytes;
  final Uri uri;
  final Map<String, dynamic> headers;
  final String? contentType;
  bool get bodyWasJsonEncoded => contentType == Headers.jsonContentType;
  bool get followRedirects => options.followRedirects;
}

class QueueAdapter implements HttpClientAdapter {
  final List<CapturedRequest> requests = [];
  final List<_Reply> _replies = [];

  void enqueue(int status, String body, {Map<String, String>? headers}) {
    _replies.add(_Reply(status, body, headers ?? const {}));
  }

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final body = <int>[];
    if (requestStream != null) {
      await for (final chunk in requestStream) {
        body.addAll(chunk);
      }
    }
    requests.add(CapturedRequest(options, body));
    final reply = _replies.removeAt(0);
    return ResponseBody.fromString(
      reply.body,
      reply.status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
        ...reply.headers.map((key, value) => MapEntry(key, [value])),
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _Reply {
  const _Reply(this.status, this.body, this.headers);

  final int status;
  final String body;
  final Map<String, String> headers;
}
