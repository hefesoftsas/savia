import '../session/session_controller.dart';

const int maxRecordingBytes = 50000000;

enum AudioFormat { ogg, wav, mp3, m4a }

AudioFormat? audioFormatForName(String name) {
  final extension = name.split('.').last.toLowerCase();
  if (extension == 'opus' || extension == 'oga') return AudioFormat.ogg;
  for (final format in AudioFormat.values) {
    if (format.name == extension) return format;
  }
  return null;
}

class Recording {
  const Recording({
    required this.id,
    required this.source,
    required this.format,
    required this.bytes,
    required this.durationSeconds,
    required this.createdAt,
    required this.sha256,
    this.name,
    this.origin,
    this.tenantId,
  });

  final String id;
  final String source;
  final AudioFormat format;
  final int bytes;
  final double? durationSeconds;
  final DateTime createdAt;
  final String sha256;
  final String? name;
  final String? origin;
  final int? tenantId;

  factory Recording.fromJson(Object? value) {
    if (value is! Map<String, dynamic>) throw const FormatException();
    final formatName = value['format'];
    final format = formatName is String
        ? AudioFormat.values
              .where((candidate) => candidate.name == formatName)
              .firstOrNull
        : null;
    final source = value['source'];
    final id = value['id'];
    final bytes = value['bytes'];
    final createdAt = value['createdAt'];
    final sha256 = value['sha256'];
    final duration = value['durationSeconds'];
    final tenant = value['tenantId'];
    if (format == null ||
        source is! String ||
        !const ['microphone', 'system', 'upload'].contains(source) ||
        id is! String ||
        bytes is! int ||
        bytes < 1 ||
        bytes > maxRecordingBytes ||
        createdAt is! String ||
        sha256 is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(sha256) ||
        (duration != null && duration is! num) ||
        (tenant != null && tenant is! int)) {
      throw const FormatException();
    }
    final parsedDate = DateTime.tryParse(createdAt);
    if (parsedDate == null) throw const FormatException();
    final name = value['name'];
    final origin = value['origin'];
    if ((name != null && name is! String) ||
        (origin != null && origin is! String)) {
      throw const FormatException();
    }
    return Recording(
      id: id,
      source: source,
      format: format,
      bytes: bytes,
      durationSeconds: (duration as num?)?.toDouble(),
      createdAt: parsedDate,
      sha256: sha256,
      name: name as String?,
      origin: origin as String?,
      tenantId: tenant as int?,
    );
  }
}

class RecordingPage {
  const RecordingPage({required this.recordings, required this.cursor});

  final List<Recording> recordings;
  final String? cursor;
}

class RecordingTranscript {
  const RecordingTranscript({
    required this.text,
    required this.source,
    required this.model,
    required this.durationSeconds,
  });

  final String text;
  final String source;
  final String model;
  final double? durationSeconds;

  factory RecordingTranscript.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['text'] is! String ||
        value['source'] is! String ||
        value['model'] is! String ||
        (value['durationSeconds'] != null &&
            value['durationSeconds'] is! num)) {
      throw const FormatException();
    }
    return RecordingTranscript(
      text: value['text'] as String,
      source: value['source'] as String,
      model: value['model'] as String,
      durationSeconds: (value['durationSeconds'] as num?)?.toDouble(),
    );
  }
}

class RecordingAction {
  const RecordingAction({required this.description, this.owner, this.dueDate});

  final String description;
  final String? owner;
  final String? dueDate;

  factory RecordingAction.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['description'] is! String ||
        (value['owner'] != null && value['owner'] is! String) ||
        (value['dueDate'] != null && value['dueDate'] is! String)) {
      throw const FormatException();
    }
    return RecordingAction(
      description: value['description'] as String,
      owner: value['owner'] as String?,
      dueDate: value['dueDate'] as String?,
    );
  }
}

class RecordingSummary {
  const RecordingSummary({
    required this.summary,
    required this.decisions,
    required this.actions,
    required this.openQuestions,
  });

  final String summary;
  final List<String> decisions;
  final List<RecordingAction> actions;
  final List<String> openQuestions;

  factory RecordingSummary.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['summary'] is! String ||
        value['decisions'] is! List ||
        value['actions'] is! List ||
        value['openQuestions'] is! List) {
      throw const FormatException();
    }
    return RecordingSummary(
      summary: value['summary'] as String,
      decisions: _stringList(value['decisions']),
      actions: (value['actions'] as List)
          .map(RecordingAction.fromJson)
          .toList(),
      openQuestions: _stringList(value['openQuestions']),
    );
  }
}

List<String> _stringList(Object? value) {
  if (value is! List || value.any((item) => item is! String)) {
    throw const FormatException();
  }
  return value.cast<String>();
}

class RecordingNotes {
  const RecordingNotes({required this.transcript, required this.summary});

  final RecordingTranscript? transcript;
  final RecordingSummary? summary;

  factory RecordingNotes.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        !value.containsKey('transcript') ||
        !value.containsKey('summary')) {
      throw const FormatException();
    }
    final transcript = value['transcript'];
    final summary = value['summary'];
    return RecordingNotes(
      transcript: transcript == null
          ? null
          : RecordingTranscript.fromJson(transcript),
      summary: summary == null ? null : RecordingSummary.fromJson(summary),
    );
  }
}

class RecordingAnswer {
  const RecordingAnswer({
    required this.answer,
    required this.insufficientEvidence,
  });

  final String answer;
  final bool insufficientEvidence;

  factory RecordingAnswer.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['answer'] is! String ||
        value['insufficientEvidence'] is! bool) {
      throw const FormatException();
    }
    return RecordingAnswer(
      answer: value['answer'] as String,
      insufficientEvidence: value['insufficientEvidence'] as bool,
    );
  }
}

class CompanionFailure implements Exception {
  const CompanionFailure(
    this.code, {
    this.status,
    this.providerStage,
    this.providerStatus,
    this.unknownOutcome = false,
  });

  final String code;
  final int? status;
  final String? providerStage;
  final int? providerStatus;
  final bool unknownOutcome;

  @override
  String toString() =>
      'CompanionFailure($code${status == null ? '' : ', HTTP $status'})';
}

CompanionSession companionSessionFromJson(Object? value) {
  if (value is! Map<String, dynamic> ||
      value['subject'] is! String ||
      value['displayName'] is! String ||
      value['workspaces'] is! List ||
      value['grantedRecordingScopes'] is! List) {
    throw const FormatException();
  }
  final scopes = _stringList(value['grantedRecordingScopes']).toSet();
  final workspaces = (value['workspaces'] as List).map((item) {
    if (item is! Map<String, dynamic> ||
        item['id'] is! int ||
        item['name'] is! String ||
        item['slug'] is! String) {
      throw const FormatException();
    }
    return Workspace(
      id: item['id'] as int,
      name: item['name'] as String,
      slug: item['slug'] as String,
    );
  }).toList();
  return CompanionSession(
    subject: value['subject'] as String,
    displayName: value['displayName'] as String,
    workspaces: workspaces,
    grantedRecordingScopes: scopes,
  );
}
