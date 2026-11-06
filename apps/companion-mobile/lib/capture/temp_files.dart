import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../recordings/models.dart';
import 'draft.dart';
import 'document_import.dart';
import 'audio_segmenter.dart';

/// Only direct children of this dedicated, app-owned cache may be deleted.
class TempFiles {
  TempFiles(this.root);
  final Directory root;
  static Future<TempFiles> create() async => TempFiles(
    Directory('${(await getTemporaryDirectory()).path}/savia-companion'),
  );
  Future<String> createPath(String extension) async {
    await root.create(recursive: true);
    return '${root.path}/${const Uuid().v4()}.$extension';
  }

  Future<List<AudioSegment>?> loadDraftSegments({
    required String draftId,
    required String sourcePath,
    required int sourceBytes,
  }) async {
    final manifest = File('${root.path}/$draftId.segments.json');
    if (!await manifest.exists()) return null;
    try {
      final decoded = jsonDecode(await manifest.readAsString());
      if (decoded is! Map<String, dynamic> ||
          decoded['sourcePath'] != sourcePath ||
          decoded['sourceBytes'] != sourceBytes ||
          decoded['segments'] is! List) {
        return null;
      }
      final segments = (decoded['segments'] as List)
          .map(AudioSegment.fromNative)
          .toList();
      if (segments.isEmpty || segments.length > mobileSessionMaxSegments) {
        return null;
      }
      var lastEnd = 0.0;
      for (var index = 0; index < segments.length; index++) {
        final segment = segments[index];
        if (File(segment.path).parent.absolute.path != root.absolute.path ||
            !File(segment.path).uri.pathSegments.last
                .startsWith('$draftId-segment-') ||
            segment.startSeconds + segment.durationSeconds > 3600.1 ||
            (index == 0 && segment.startSeconds > 0.1) ||
            segment.startSeconds < lastEnd - 0.1 ||
            await File(segment.path).length().catchError((_) => -1) !=
                segment.bytes) {
          return null;
        }
        lastEnd = segment.startSeconds + segment.durationSeconds;
      }
      return segments;
    } on FormatException {
      return null;
    } on FileSystemException {
      return null;
    }
  }

  Future<void> saveDraftSegments({
    required String draftId,
    required String sourcePath,
    required int sourceBytes,
    required List<AudioSegment> segments,
  }) async {
    await root.create(recursive: true);
    final value = {
      'sourcePath': sourcePath,
      'sourceBytes': sourceBytes,
      'segments': segments
          .map(
            (segment) => {
              'path': segment.path,
              'startSeconds': segment.startSeconds,
              'durationSeconds': segment.durationSeconds,
              'bytes': segment.bytes,
            },
          )
          .toList(),
    };
    final path = '${root.path}/$draftId.segments.json';
    final temporary = File('$path.tmp');
    await temporary.writeAsString(jsonEncode(value), flush: true);
    await temporary.rename(path);
  }

  Future<void> removeDraftSegments(String draftId) async {
    if (!RegExp(r'^[0-9a-f-]{36}$', caseSensitive: false).hasMatch(draftId)) {
      throw ArgumentError('Invalid draft identifier');
    }
    if (!await root.exists()) return;
    await for (final entity in root.list(followLinks: false)) {
      final name = entity.uri.pathSegments.isEmpty
          ? ''
          : entity.uri.pathSegments.last;
      if (name == '$draftId.segments.json' ||
          name == '$draftId.segments.json.tmp' ||
          name.startsWith('$draftId-segment-')) {
        await entity.delete();
      }
    }
  }

  Future<RecordingDraft> copyImport(PickedAudio picked) async {
    final extension = picked.name.split('.').last.toLowerCase();
    final format = ['opus', 'oga'].contains(extension) ? 'ogg' : extension;
    if (!['mp3', 'wav', 'm4a', 'ogg'].contains(format)) {
      throw const CompanionFailure('INVALID_AUDIO');
    }
    final source = File(picked.path);
    final length = await source.length();
    if (length == 0 || length > 50000000) {
      throw const CompanionFailure('INVALID_AUDIO');
    }
    final path = await createPath(format);
    try {
      await source.copy(path);
      final copied = await File(path).length();
      if (copied != length) throw const CompanionFailure('INVALID_AUDIO');
      return RecordingDraft(
        id: const Uuid().v4(),
        path: path,
        name: picked.name,
        format: format,
        bytes: copied,
      );
    } catch (_) {
      await remove(path);
      rethrow;
    }
  }

  Future<void> remove(String path) async {
    final file = File(path);
    if (file.parent.absolute.path != root.absolute.path) {
      throw ArgumentError('Audio is outside the temporary directory');
    }
    if (await file.exists()) {
      try {
        await file.delete();
      } on FileSystemException {
        // A concurrent idempotent cleanup may have removed it after exists().
        if (await file.exists()) rethrow;
      }
    }
  }

  Future<void> clearOrphans() async {
    await root.create(recursive: true);
    await for (final entity in root.list(followLinks: false)) {
      if (entity is File || entity is Link) await entity.delete();
    }
  }
}
