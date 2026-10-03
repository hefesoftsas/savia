import 'dart:io';

import 'package:dio/dio.dart';

import '../recordings/session_models.dart';
import 'audio_segmenter.dart';
import 'draft.dart';
import 'temp_files.dart';

abstract interface class RecordingSessionUploadApi {
  Future<RecordingSession> createSession({
    required String id,
    required String name,
    required bool consent,
  });

  Future<RecordingSession> uploadSessionChunk({
    required String sessionId,
    required int sequence,
    required double startSeconds,
    required String path,
    required int expectedBytes,
    required CancelToken cancellation,
    void Function(int sent, int total)? onProgress,
  });

  Future<RecordingSession> finalizeSession({
    required String id,
    required int expectedChunks,
    required double durationSeconds,
  });
}

class CapturedSessionUploader {
  const CapturedSessionUploader({
    required this.api,
    required this.segmenter,
    required this.files,
  });

  final RecordingSessionUploadApi api;
  final NativeAudioSegmenter segmenter;
  final TempFiles files;

  Future<RecordingSession> upload(
    RecordingDraft draft, {
    required CancelToken cancellation,
    void Function(int sent, int total)? onProgress,
  }) async {
    _throwIfCancelled(cancellation);
    if (!draft.isCapture ||
        draft.format != 'm4a' ||
        !_isUuid(draft.id) ||
        draft.bytes < 1 ||
        draft.bytes > 50000000 ||
        (draft.durationSeconds != null &&
            (draft.durationSeconds! <= 0 || draft.durationSeconds! > 3600))) {
      throw ArgumentError('Invalid long recording draft.');
    }
    final source = File(draft.path);
    if (source.parent.absolute.path != files.root.absolute.path ||
        await source.length().catchError((_) => -1) != draft.bytes) {
      throw ArgumentError(
        'Recording draft is outside the private temporary directory.',
      );
    }

    _throwIfCancelled(cancellation);
    final created = await api.createSession(
      id: draft.id,
      name: draft.name,
      consent: true,
    );
    if (created.id != draft.id) throw const FormatException();
    if (created.state == RecordingSessionState.ready) {
      await files.removeDraftSegments(draft.id);
      return created;
    }

    List<AudioSegment> segments = const [];
    var complete = false;
    try {
      segments =
          await files.loadDraftSegments(
            draftId: draft.id,
            sourcePath: draft.path,
            sourceBytes: draft.bytes,
          ) ??
          await segmenter.segment(
            draft.path,
            files.root.path,
            artifactId: draft.id,
          );
      if (segments.isEmpty || segments.length > mobileSessionMaxSegments) {
        throw const FormatException('Invalid session segment count.');
      }
      await files.saveDraftSegments(
        draftId: draft.id,
        sourcePath: draft.path,
        sourceBytes: draft.bytes,
        segments: segments,
      );
      final totalBytes = segments.fold<int>(
        0,
        (sum, segment) => sum + segment.bytes,
      );
      final existing = <int, RecordingSessionChunk>{};
      for (final chunk in created.chunks) {
        if (chunk.source != 'microphone' ||
            chunk.format != 'm4a' ||
            chunk.sequence >= segments.length ||
            existing.containsKey(chunk.sequence)) {
          throw const FormatException('Server session has unexpected chunks.');
        }
        final segment = segments[chunk.sequence];
        if ((chunk.startSeconds - segment.startSeconds).abs() > 0.1 ||
            (chunk.durationSeconds - segment.durationSeconds).abs() > 0.1 ||
            chunk.bytes != segment.bytes) {
          throw const FormatException(
            'Server chunk does not match this draft.',
          );
        }
        existing[chunk.sequence] = chunk;
      }

      var completedBytes = 0;
      for (var sequence = 0; sequence < segments.length; sequence++) {
        _throwIfCancelled(cancellation);
        final segment = segments[sequence];
        if (existing.containsKey(sequence)) {
          completedBytes += segment.bytes;
          onProgress?.call(completedBytes, totalBytes);
          continue;
        }
        final file = File(segment.path);
        if (file.parent.absolute.path != files.root.absolute.path ||
            await file.length().catchError((_) => -1) != segment.bytes) {
          throw const FormatException(
            'Native segment is outside the private temporary directory.',
          );
        }
        await api.uploadSessionChunk(
          sessionId: draft.id,
          sequence: sequence,
          startSeconds: segment.startSeconds,
          path: segment.path,
          expectedBytes: segment.bytes,
          cancellation: cancellation,
          onProgress: (sent, requestBytes) {
            // Dio reports JSON/base64 transport bytes, not raw segment bytes.
            final fraction = requestBytes > 0
                ? (sent / requestBytes).clamp(0.0, 1.0)
                : 0.0;
            onProgress?.call(
              completedBytes + (segment.bytes * fraction).floor(),
              totalBytes,
            );
          },
        );
        completedBytes += segment.bytes;
        onProgress?.call(completedBytes, totalBytes);
      }
      final endOfAudio =
          segments.last.startSeconds + segments.last.durationSeconds;
      final requestedDuration = draft.durationSeconds ?? 0;
      final duration =
          (requestedDuration > endOfAudio ? requestedDuration : endOfAudio)
              .clamp(0.001, 3600.0)
              .toDouble();
      _throwIfCancelled(cancellation);
      final finalized = await api.finalizeSession(
        id: draft.id,
        expectedChunks: segments.length,
        durationSeconds: duration,
      );
      if (finalized.state != RecordingSessionState.ready) {
        throw const FormatException('Session finalization was not confirmed.');
      }
      complete = true;
      return finalized;
    } finally {
      if (complete) await files.removeDraftSegments(draft.id);
    }
  }

  bool _isUuid(String value) => RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    caseSensitive: false,
  ).hasMatch(value);

  void _throwIfCancelled(CancelToken cancellation) {
    final error = cancellation.cancelError;
    if (error != null) throw error;
  }
}
