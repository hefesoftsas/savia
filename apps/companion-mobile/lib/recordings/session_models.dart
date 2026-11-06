import 'models.dart';

enum RecordingSessionState { uploading, ready }

enum SessionJobStatus {
  idle,
  queued,
  transcribing,
  summarizing,
  complete,
  needsAttention,
  cancelled,
  failed,
}

SessionJobStatus _jobStatus(Object? value) => switch (value) {
  'idle' => SessionJobStatus.idle,
  'queued' => SessionJobStatus.queued,
  'transcribing' => SessionJobStatus.transcribing,
  'summarizing' => SessionJobStatus.summarizing,
  'complete' => SessionJobStatus.complete,
  'needs_attention' => SessionJobStatus.needsAttention,
  'cancelled' => SessionJobStatus.cancelled,
  'failed' => SessionJobStatus.failed,
  _ => throw const FormatException(),
};

class RecordingSessionChunk {
  const RecordingSessionChunk({
    required this.source,
    required this.sequence,
    required this.startSeconds,
    required this.durationSeconds,
    required this.bytes,
    this.format = 'ogg',
  });

  final String source;
  final int sequence;
  final double startSeconds;
  final double durationSeconds;
  final int bytes;
  final String format;

  factory RecordingSessionChunk.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        !const ['microphone', 'system'].contains(value['source']) ||
        value['sequence'] is! int ||
        (value['sequence'] as int) < 0 ||
        (value['sequence'] as int) >= 120 ||
        value['startSeconds'] is! num ||
        value['durationSeconds'] is! num ||
        value['bytes'] is! int ||
        (value['format'] != null &&
            !const ['ogg', 'm4a'].contains(value['format'])) ||
        (value['bytes'] as int) < 1 ||
        (value['bytes'] as int) > 512 * 1024) {
      throw const FormatException();
    }
    final chunk = RecordingSessionChunk(
      source: value['source'] as String,
      sequence: value['sequence'] as int,
      startSeconds: (value['startSeconds'] as num).toDouble(),
      durationSeconds: (value['durationSeconds'] as num).toDouble(),
      bytes: value['bytes'] as int,
      format: (value['format'] as String?) ?? 'ogg',
    );
    if (chunk.startSeconds < 0 ||
        chunk.durationSeconds <= 0 ||
        chunk.durationSeconds > 60.1 ||
        chunk.startSeconds + chunk.durationSeconds > 3600.1) {
      throw const FormatException();
    }
    return chunk;
  }
}

class RecordingSessionJob {
  const RecordingSessionJob({
    required this.status,
    required this.completedChunks,
    required this.totalChunks,
    required this.transcripts,
    required this.summary,
    this.error,
  });

  final SessionJobStatus status;
  final int completedChunks;
  final int totalChunks;
  final String? error;
  final Map<String, RecordingTranscript> transcripts;
  final RecordingSummary? summary;

  factory RecordingSessionJob.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['completedChunks'] is! int ||
        value['totalChunks'] is! int ||
        (value['completedChunks'] as int) < 0 ||
        (value['totalChunks'] as int) < 0 ||
        (value['completedChunks'] as int) > (value['totalChunks'] as int) ||
        value['transcripts'] is! Map ||
        (value['error'] != null && value['error'] is! String)) {
      throw const FormatException();
    }
    final transcripts = <String, RecordingTranscript>{};
    for (final entry in (value['transcripts'] as Map).entries) {
      if (entry.key is! String ||
          !RegExp(r'^(microphone|system):(?:0|[1-9][0-9]{0,2})$')
              .hasMatch(entry.key as String)) {
        throw const FormatException();
      }
      transcripts[entry.key as String] = RecordingTranscript.fromJson(
        entry.value,
      );
    }
    final summary = value['summary'];
    return RecordingSessionJob(
      status: _jobStatus(value['status']),
      completedChunks: value['completedChunks'] as int,
      totalChunks: value['totalChunks'] as int,
      error: value['error'] as String?,
      transcripts: transcripts,
      summary: summary == null ? null : RecordingSummary.fromJson(summary),
    );
  }
}

class RecordingSession {
  const RecordingSession({
    required this.id,
    required this.name,
    required this.createdAt,
    required this.state,
    required this.durationSeconds,
    required this.chunks,
    required this.job,
  });

  final String id;
  final String name;
  final DateTime createdAt;
  final RecordingSessionState state;
  final double? durationSeconds;
  final List<RecordingSessionChunk> chunks;
  final RecordingSessionJob job;

  factory RecordingSession.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['id'] is! String ||
        value['name'] is! String ||
        value['createdAt'] is! String ||
        !const ['uploading', 'ready'].contains(value['state']) ||
        (value['durationSeconds'] != null &&
            value['durationSeconds'] is! num) ||
        value['chunks'] is! List) {
      throw const FormatException();
    }
    final createdAt = DateTime.tryParse(value['createdAt'] as String);
    final duration = (value['durationSeconds'] as num?)?.toDouble();
    if (createdAt == null ||
        (duration != null && (duration <= 0 || duration > 3600))) {
      throw const FormatException();
    }
    return RecordingSession(
      id: value['id'] as String,
      name: value['name'] as String,
      createdAt: createdAt,
      state: value['state'] == 'ready'
          ? RecordingSessionState.ready
          : RecordingSessionState.uploading,
      durationSeconds: duration,
      chunks: (value['chunks'] as List)
          .map(RecordingSessionChunk.fromJson)
          .toList(),
      job: value['job'] == null
          ? RecordingSessionJob(
              status: SessionJobStatus.idle,
              completedChunks: 0,
              totalChunks: 0,
              transcripts: const {},
              summary: null,
            )
          : RecordingSessionJob.fromJson(value['job']),
    );
  }
}

class RecordingSessionPage {
  const RecordingSessionPage({required this.sessions, required this.cursor});
  final List<RecordingSession> sessions;
  final String? cursor;

  factory RecordingSessionPage.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['sessions'] is! List ||
        (value['cursor'] != null && value['cursor'] is! String)) {
      throw const FormatException();
    }
    return RecordingSessionPage(
      sessions: (value['sessions'] as List)
          .map(RecordingSession.fromJson)
          .toList(),
      cursor: value['cursor'] as String?,
    );
  }
}

class SessionQuestionEvidence {
  const SessionQuestionEvidence({
    required this.source,
    required this.sequence,
    required this.startSeconds,
    required this.durationSeconds,
  });
  final String source;
  final int sequence;
  final double startSeconds;
  final double durationSeconds;

  factory SessionQuestionEvidence.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        !const ['microphone', 'system'].contains(value['source']) ||
        value['sequence'] is! int ||
        value['startSeconds'] is! num ||
        value['durationSeconds'] is! num) {
      throw const FormatException();
    }
    return SessionQuestionEvidence(
      source: value['source'] as String,
      sequence: value['sequence'] as int,
      startSeconds: (value['startSeconds'] as num).toDouble(),
      durationSeconds: (value['durationSeconds'] as num).toDouble(),
    );
  }
}

class SessionAnswer {
  const SessionAnswer({
    required this.answer,
    required this.insufficientEvidence,
    required this.partial,
    required this.evidence,
  });
  final String answer;
  final bool insufficientEvidence;
  final bool partial;
  final List<SessionQuestionEvidence> evidence;

  factory SessionAnswer.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['answer'] is! String ||
        value['insufficientEvidence'] is! bool ||
        value['partial'] is! bool ||
        value['evidence'] is! List) {
      throw const FormatException();
    }
    return SessionAnswer(
      answer: value['answer'] as String,
      insufficientEvidence: value['insufficientEvidence'] as bool,
      partial: value['partial'] as bool,
      evidence: (value['evidence'] as List)
          .map(SessionQuestionEvidence.fromJson)
          .toList(),
    );
  }
}
