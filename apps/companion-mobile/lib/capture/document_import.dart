import 'package:file_picker/file_picker.dart';

class PickedAudio {
  const PickedAudio({required this.path, required this.name});
  final String path, name;
}

abstract interface class DocumentImport {
  Future<PickedAudio?> pick();
  Future<void> clearPickerCache();
}

class SystemDocumentImport implements DocumentImport {
  @override
  Future<PickedAudio?> pick() async {
    final file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: ['mp3', 'wav', 'm4a', 'ogg', 'opus', 'oga'],
    );
    if (file == null || file.path == null) return null;
    return PickedAudio(path: file.path!, name: file.name);
  }

  @override
  Future<void> clearPickerCache() => FilePicker.clearTemporaryFiles();
}
