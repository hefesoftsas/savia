/// A single app-owned, temporary audio draft. The UUID is allocated when the
/// draft is created and stays stable across explicit upload retries.
class RecordingDraft {
  const RecordingDraft({
    required this.id,
    required this.path,
    required this.name,
    required this.format,
    required this.bytes,
    this.durationSeconds,
    this.isCapture = false,
  });

  final String id;
  final String path;
  final String name;
  final String format;
  final int bytes;
  final double? durationSeconds;
  final bool isCapture;
}
