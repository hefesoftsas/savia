import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';

import '../capture/draft.dart';
import '../capture/session_uploader.dart';
import '../session/session_controller.dart';
import 'models.dart';
import 'session_models.dart';

/// Typed, workspace-bound client for the private Companion recording API.
/// It deliberately installs no logging or retry interceptors and disables
/// redirects on each authenticated request.
class RecordingsApi implements RecordingSessionUploadApi {
  RecordingsApi({
    required this.dio,
    required this.apiOrigin,
    required this.tokenProvider,
    required this.workspaceIdProvider,
  }) {
    if (apiOrigin.scheme != 'https' ||
        apiOrigin.host.isEmpty ||
        apiOrigin.userInfo.isNotEmpty ||
        apiOrigin.hasQuery ||
        apiOrigin.hasFragment) {
      throw ArgumentError.value(
        apiOrigin,
        'apiOrigin',
        'A fixed HTTPS origin is required.',
      );
    }
  }

  final Dio dio;
  final Uri apiOrigin;
  final Future<String> Function() tokenProvider;
  final int? Function() workspaceIdProvider;

  Future<CompanionSession> session({String? accessToken}) async =>
      companionSessionFromJson(
        await _requestJson(
          'GET',
          '/v1/companion/session',
          accessToken: accessToken,
          includeWorkspace: false,
          decode: (value) => value,
        ),
      );

  Future<RecordingPage> list({
    String? cursor,
    CancelToken? cancellation,
  }) async {
    final query = cursor == null ? null : <String, dynamic>{'cursor': cursor};
    final value = await _requestJson(
      'GET',
      '/v1/companion/recordings',
      queryParameters: query,
      cancellation: cancellation,
      decode: (value) {
        if (value is! Map<String, dynamic> ||
            value['recordings'] is! List ||
            (value['cursor'] != null && value['cursor'] is! String)) {
          throw const FormatException();
        }
        return RecordingPage(
          recordings: (value['recordings'] as List)
              .map(Recording.fromJson)
              .toList(),
          cursor: value['cursor'] as String?,
        );
      },
    );
    return value;
  }

  Future<RecordingSessionPage> listSessions({String? cursor}) => _requestJson(
    'GET',
    '/v1/companion/sessions',
    queryParameters: cursor == null ? null : {'cursor': cursor},
    decode: RecordingSessionPage.fromJson,
  );

  Future<RecordingSession> getSession(String id, {CancelToken? cancellation}) =>
      _requestJson(
        'GET',
        '/v1/companion/sessions/${Uri.encodeComponent(id)}',
        cancellation: cancellation,
        decode: RecordingSession.fromJson,
      );

  Future<RecordingSession> renameSession(String id, String name) {
    final trimmed = name.trim();
    if (trimmed.isEmpty || trimmed.length > 255) {
      throw const CompanionFailure('INVALID_NAME');
    }
    return _requestJson(
      'PATCH',
      '/v1/companion/sessions/${Uri.encodeComponent(id)}',
      body: {'name': trimmed},
      mutation: true,
      decode: RecordingSession.fromJson,
    );
  }

  @override
  Future<RecordingSession> createSession({
    required String id,
    required String name,
    required bool consent,
  }) {
    if (!consent) throw const CompanionFailure('CONSENT_REQUIRED');
    return _requestJson(
      'POST',
      '/v1/companion/sessions',
      body: {
        'id': id,
        'name': name,
        'sources': ['microphone'],
        'consent': true,
      },
      mutation: true,
      decode: RecordingSession.fromJson,
    );
  }

  @override
  Future<RecordingSession> uploadSessionChunk({
    required String sessionId,
    required int sequence,
    required double startSeconds,
    required String path,
    required int expectedBytes,
    required CancelToken cancellation,
    void Function(int sent, int total)? onProgress,
  }) async {
    if (sequence < 0 ||
        sequence >= 120 ||
        !startSeconds.isFinite ||
        startSeconds < 0 ||
        expectedBytes < 1 ||
        expectedBytes > 512 * 1024) {
      throw const CompanionFailure('INVALID_AUDIO');
    }
    final file = File(path);
    final actualLength = await file.length().catchError((_) => -1);
    if (actualLength != expectedBytes ||
        actualLength < 1 ||
        actualLength > 512 * 1024) {
      throw const CompanionFailure('INVALID_AUDIO');
    }
    final token = await _token();
    try {
      final response = await dio.post<Object?>(
        _url('/v1/companion/sessions/${Uri.encodeComponent(sessionId)}/chunks'),
        data: {
          'source': 'microphone',
          'sequence': sequence,
          'startSeconds': startSeconds,
          'audio': {
            'data': base64Encode(await file.readAsBytes()),
            'format': 'm4a',
          },
        },
        cancelToken: cancellation,
        onSendProgress: onProgress,
        options: _options(
          token,
          workspaceIdProvider(),
          contentType: Headers.jsonContentType,
        ),
      );
      return await _decodeResponse(
        response,
        RecordingSession.fromJson,
        mutation: true,
      );
    } on CompanionFailure {
      rethrow;
    } on DioException catch (error) {
      throw _failureFromDio(error, mutation: true);
    } on FormatException {
      throw const CompanionFailure(
        'UPLOAD_OUTCOME_UNKNOWN',
        unknownOutcome: true,
      );
    } catch (_) {
      throw const CompanionFailure(
        'UPLOAD_OUTCOME_UNKNOWN',
        unknownOutcome: true,
      );
    }
  }

  @override
  Future<RecordingSession> finalizeSession({
    required String id,
    required int expectedChunks,
    required double durationSeconds,
  }) => _requestJson(
    'POST',
    '/v1/companion/sessions/${Uri.encodeComponent(id)}/finalize',
    body: {
      'expectedChunks': expectedChunks,
      'durationSeconds': durationSeconds,
    },
    mutation: true,
    decode: RecordingSession.fromJson,
  );

  Future<RecordingSession> processSession(
    String id, {
    required bool consent,
    bool retryAmbiguous = false,
  }) {
    if (!consent) throw const CompanionFailure('CONSENT_REQUIRED');
    return _requestJson(
      'POST',
      '/v1/companion/sessions/${Uri.encodeComponent(id)}/notes',
      body: {'consent': true, if (retryAmbiguous) 'retryAmbiguous': true},
      mutation: true,
      decode: RecordingSession.fromJson,
    );
  }

  Future<RecordingSession> cancelSession(String id) => _requestJson(
    'POST',
    '/v1/companion/sessions/${Uri.encodeComponent(id)}/cancel',
    mutation: true,
    decode: RecordingSession.fromJson,
  );

  Future<SessionAnswer> answerSession(
    String id,
    String question, {
    required bool consent,
  }) {
    final trimmed = question.trim();
    if (!consent) throw const CompanionFailure('CONSENT_REQUIRED');
    if (trimmed.isEmpty || trimmed.length > 2000) {
      throw const CompanionFailure('INVALID_QUESTION');
    }
    return _requestJson(
      'POST',
      '/v1/companion/sessions/${Uri.encodeComponent(id)}/questions',
      body: {'question': trimmed, 'consent': true},
      mutation: true,
      decode: SessionAnswer.fromJson,
    );
  }

  Future<void> sessionChunkAudio(
    String sessionId,
    String source,
    int sequence,
    String destination, {
    CancelToken? cancellation,
    void Function(int received, int total)? onProgress,
  }) async {
    if (!_isUuid(sessionId) ||
        !const ['microphone', 'system'].contains(source) ||
        sequence < 0 ||
        sequence >= 120) {
      throw const CompanionFailure('AUDIO_UNAVAILABLE');
    }
    final tenantId = workspaceIdProvider();
    final token = await _token();
    final url = _url(
      '/v1/companion/sessions/${Uri.encodeComponent(sessionId)}/chunks/$source/$sequence',
    );
    try {
      final response = await dio.download(
        url,
        destination,
        cancelToken: cancellation,
        onReceiveProgress: onProgress,
        options: _options(token, tenantId, responseType: ResponseType.bytes),
      );
      if (response.statusCode == null ||
          response.statusCode! < 200 ||
          response.statusCode! >= 300) {
        _throwResponseFailure(
          response.statusCode,
          response.data,
          mutation: false,
        );
      }
    } on CompanionFailure {
      rethrow;
    } on DioException catch (error) {
      throw _failureFromDio(error, mutation: false);
    } catch (_) {
      throw const CompanionFailure('AUDIO_UNAVAILABLE');
    }
  }

  Future<void> audio(
    String id,
    String destination, {
    CancelToken? cancellation,
    void Function(int received, int total)? onProgress,
  }) async {
    final tenantId = workspaceIdProvider();
    final token = await _token();
    final url = _url('/v1/companion/recordings/${Uri.encodeComponent(id)}');
    try {
      final response = await dio.download(
        url,
        destination,
        cancelToken: cancellation,
        onReceiveProgress: onProgress,
        options: _options(token, tenantId, responseType: ResponseType.bytes),
      );
      if (response.statusCode == null ||
          response.statusCode! < 200 ||
          response.statusCode! >= 300) {
        _throwResponseFailure(
          response.statusCode,
          response.data,
          mutation: false,
        );
      }
    } on CompanionFailure {
      rethrow;
    } on DioException catch (error) {
      throw _failureFromDio(error, mutation: false);
    } catch (_) {
      throw const CompanionFailure('AUDIO_UNAVAILABLE');
    }
  }

  Future<Recording> upload(
    RecordingDraft draft, {
    CancelToken? cancellation,
    void Function(int sent, int total)? onProgress,
  }) async {
    final format = audioFormatForName(draft.name);
    if (!_isUuid(draft.id) ||
        format == null ||
        format.name != draft.format ||
        draft.bytes < 1 ||
        draft.bytes > maxRecordingBytes) {
      throw const CompanionFailure('INVALID_AUDIO');
    }
    final file = File(draft.path);
    final actualLength = await file.length().catchError((_) => -1);
    if (actualLength < 1 ||
        actualLength != draft.bytes ||
        actualLength > maxRecordingBytes) {
      throw const CompanionFailure('INVALID_AUDIO');
    }
    final tenantId = workspaceIdProvider();
    final token = await _token();
    final query = <String, String>{
      'id': draft.id,
      'name': draft.name,
      'format': format.name,
      'consent': 'true',
    };
    final url = _url('/v1/companion/recordings/upload', queryParameters: query);
    try {
      final response = await dio.post<Object?>(
        url,
        data: file.openRead(),
        cancelToken: cancellation,
        onSendProgress: onProgress,
        options: _options(
          token,
          tenantId,
          contentType: 'application/octet-stream',
          headers: {Headers.contentLengthHeader: actualLength.toString()},
        ),
      );
      return await _decodeResponse(
        response,
        Recording.fromJson,
        mutation: true,
      );
    } on CompanionFailure {
      rethrow;
    } on DioException catch (error) {
      throw _failureFromDio(error, mutation: true);
    } on FormatException {
      throw const CompanionFailure('INVALID_RESPONSE');
    } catch (_) {
      throw const CompanionFailure(
        'UPLOAD_OUTCOME_UNKNOWN',
        unknownOutcome: true,
      );
    }
  }

  Future<RecordingNotes> notes(String id, {CancelToken? cancellation}) async =>
      _requestJson(
        'GET',
        '/v1/companion/recordings/${Uri.encodeComponent(id)}/notes',
        cancellation: cancellation,
        decode: RecordingNotes.fromJson,
      );

  Future<RecordingNotes> generate(
    String id, {
    required bool consent,
    CancelToken? cancellation,
  }) async {
    if (!consent) throw const CompanionFailure('CONSENT_REQUIRED');
    return _requestJson(
      'POST',
      '/v1/companion/recordings/${Uri.encodeComponent(id)}/notes',
      body: const {'consent': true},
      cancellation: cancellation,
      mutation: true,
      decode: RecordingNotes.fromJson,
    );
  }

  Future<RecordingAnswer> answer(
    String id,
    String question, {
    required bool consent,
    CancelToken? cancellation,
  }) async {
    final trimmed = question.trim();
    if (!consent) throw const CompanionFailure('CONSENT_REQUIRED');
    if (trimmed.isEmpty || trimmed.length > 2000) {
      throw const CompanionFailure('INVALID_QUESTION');
    }
    return _requestJson(
      'POST',
      '/v1/companion/recordings/${Uri.encodeComponent(id)}/questions',
      body: {'question': trimmed, 'consent': true},
      cancellation: cancellation,
      mutation: true,
      decode: RecordingAnswer.fromJson,
    );
  }

  Future<T> _requestJson<T>(
    String method,
    String path, {
    Object? body,
    Map<String, dynamic>? queryParameters,
    String? accessToken,
    bool includeWorkspace = true,
    bool mutation = false,
    CancelToken? cancellation,
    required T Function(Object? value) decode,
  }) async {
    final tenantId = includeWorkspace ? workspaceIdProvider() : null;
    final token = accessToken ?? await _token();
    try {
      final response = await dio.request<Object?>(
        _url(path),
        data: body,
        queryParameters: queryParameters,
        cancelToken: cancellation,
        options: _options(
          token,
          tenantId,
          method: method,
          contentType: body == null ? null : Headers.jsonContentType,
        ),
      );
      return await _decodeResponse(response, decode, mutation: mutation);
    } on CompanionFailure {
      rethrow;
    } on DioException catch (error) {
      throw _failureFromDio(error, mutation: mutation);
    } on FormatException {
      throw const CompanionFailure('INVALID_RESPONSE');
    } catch (_) {
      throw CompanionFailure('REQUEST_FAILED', unknownOutcome: mutation);
    }
  }

  T _decodeResponse<T>(
    Response<Object?> response,
    T Function(Object? value) decode, {
    required bool mutation,
  }) {
    final status = response.statusCode;
    if (status == null || status < 200 || status >= 300) {
      _throwResponseFailure(status, response.data, mutation: mutation);
    }
    try {
      return decode(response.data);
    } on CompanionFailure {
      rethrow;
    } on FormatException {
      throw CompanionFailure(
        'INVALID_RESPONSE',
        status: status,
        unknownOutcome: mutation,
      );
    } catch (_) {
      throw CompanionFailure(
        'INVALID_RESPONSE',
        status: status,
        unknownOutcome: mutation,
      );
    }
  }

  Never _throwResponseFailure(
    int? status,
    Object? data, {
    required bool mutation,
  }) {
    if (status != null && status >= 300 && status < 400) {
      throw CompanionFailure('REDIRECT_REJECTED', status: status);
    }
    final error = _errorEnvelope(data);
    final code = error['code'];
    final stage = error['providerOperation'];
    final providerStatus = error['upstreamStatus'];
    throw CompanionFailure(
      code is String && RegExp(r'^[A-Z0-9_]{1,80}$').hasMatch(code)
          ? code
          : 'HTTP_ERROR',
      status: status,
      providerStage:
          const ['transcription', 'summary', 'question'].contains(stage)
          ? stage as String
          : null,
      providerStatus:
          providerStatus is int &&
              providerStatus >= 100 &&
              providerStatus <= 599
          ? providerStatus
          : null,
      unknownOutcome: mutation && (status == null || status >= 500),
    );
  }

  CompanionFailure _failureFromDio(
    DioException error, {
    required bool mutation,
  }) {
    if (error.type == DioExceptionType.cancel) {
      return CompanionFailure('REQUEST_CANCELLED', unknownOutcome: mutation);
    }
    final status = error.response?.statusCode;
    final response = error.response;
    if (response != null) {
      try {
        _throwResponseFailure(status, response.data, mutation: mutation);
      } on CompanionFailure catch (failure) {
        return failure;
      }
    }
    if (error.type == DioExceptionType.badResponse &&
        status != null &&
        status < 300) {
      return CompanionFailure('INVALID_RESPONSE', status: status);
    }
    return CompanionFailure(
      'NETWORK_ERROR',
      status: status,
      unknownOutcome: mutation,
    );
  }

  Map<String, dynamic> _errorEnvelope(Object? data) {
    Object? decoded = data;
    if (data is String) {
      try {
        decoded = jsonDecode(data);
      } catch (_) {
        return const {};
      }
    }
    if (decoded is! Map<String, dynamic> ||
        decoded['error'] is! Map<String, dynamic>) {
      return const {};
    }
    return decoded['error'] as Map<String, dynamic>;
  }

  Future<String> _token() async {
    try {
      final token = await tokenProvider();
      if (token.isEmpty) throw const SessionRequired();
      return token;
    } on SessionRequired {
      throw const CompanionFailure('SESSION_REQUIRED');
    } catch (_) {
      throw const CompanionFailure('SESSION_UNAVAILABLE');
    }
  }

  Options _options(
    String token,
    int? tenantId, {
    String? method,
    String? contentType,
    Map<String, dynamic>? headers,
    ResponseType? responseType,
  }) => Options(
    method: method,
    sendTimeout: const Duration(seconds: 120),
    receiveTimeout: const Duration(minutes: 3),
    contentType: contentType,
    headers: {
      Headers.acceptHeader: responseType == ResponseType.bytes
          ? '*/*'
          : Headers.jsonContentType,
      'Authorization': 'Bearer $token',
      if (tenantId != null) 'x-savia-tenant-id': tenantId.toString(),
      ...?headers,
    },
    responseType: responseType,
    followRedirects: false,
    maxRedirects: 0,
    validateStatus: (status) => status != null && status >= 200 && status < 500,
  );

  String _url(String path, {Map<String, dynamic>? queryParameters}) {
    final base = apiOrigin.resolve(path);
    if (base.origin != apiOrigin.origin) {
      throw const CompanionFailure('INVALID_API_ORIGIN');
    }
    return base
        .replace(
          queryParameters: queryParameters?.map(
            (key, value) => MapEntry(key, value.toString()),
          ),
        )
        .toString();
  }

  bool _isUuid(String value) => RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
  ).hasMatch(value);
}
