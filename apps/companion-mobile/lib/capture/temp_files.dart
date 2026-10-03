import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../recordings/models.dart';
import 'draft.dart';
import 'document_import.dart';

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
