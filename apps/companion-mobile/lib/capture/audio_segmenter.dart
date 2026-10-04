import 'package:flutter/services.dart';

const mobileSessionSegmentSeconds = 30;
const mobileSessionMaxSegments = 120;
const mobileSessionMaxSegmentBytes = 512 * 1024;

class AudioSegment {
  const AudioSegment({
    required this.path,
    required this.startSeconds,
    required this.durationSeconds,
    required this.bytes,
  });

  final String path;
  final double startSeconds;
  final double durationSeconds;
  final int bytes;

  factory AudioSegment.fromNative(Object? value) {
    if (value is! Map ||
        value['path'] is! String ||
        value['startSeconds'] is! num ||
        value['durationSeconds'] is! num ||
        value['bytes'] is! int) {
      throw const FormatException('Invalid native audio segment.');
    }
    final segment = AudioSegment(
      path: value['path'] as String,
      startSeconds: (value['startSeconds'] as num).toDouble(),
      durationSeconds: (value['durationSeconds'] as num).toDouble(),
      bytes: value['bytes'] as int,
    );
    if (segment.path.isEmpty ||
        segment.startSeconds < 0 ||
        segment.durationSeconds <= 0 ||
        segment.durationSeconds > mobileSessionSegmentSeconds + 0.1 ||
        segment.bytes < 1 ||
        segment.bytes > mobileSessionMaxSegmentBytes) {
      throw const FormatException('Native audio segment exceeds its limits.');
    }
    return segment;
  }
}

abstract interface class NativeAudioSegmenter {
  Future<List<AudioSegment>> segment(
    String sourcePath,
    String outputDirectory, {
    required String artifactId,
  });
}

class MethodChannelAudioSegmenter implements NativeAudioSegmenter {
  const MethodChannelAudioSegmenter({
    this.channel = const MethodChannel('savia.companion/audio_segments'),
  });

  final MethodChannel channel;

  @override
  Future<List<AudioSegment>> segment(
    String sourcePath,
    String outputDirectory, {
    required String artifactId,
  }) async {
    if (sourcePath.isEmpty ||
        outputDirectory.isEmpty ||
        !RegExp(
          r'^[0-9a-f-]{36}$',
          caseSensitive: false,
        ).hasMatch(artifactId)) {
      throw const FormatException('Audio file is unavailable.');
    }
    final result = await channel.invokeMethod<Object?>('segmentAacFile', {
      'sourcePath': sourcePath,
      'outputDirectory': outputDirectory,
      'artifactId': artifactId,
      'segmentSeconds': mobileSessionSegmentSeconds,
      'maxSegments': mobileSessionMaxSegments,
    });
    if (result is! List ||
        result.isEmpty ||
        result.length > mobileSessionMaxSegments) {
      throw const FormatException('Invalid native segmentation result.');
    }
    final segments = result.map(AudioSegment.fromNative).toList();
    var lastEnd = 0.0;
    for (var index = 0; index < segments.length; index++) {
      final segment = segments[index];
      if (segment.startSeconds > 3600 ||
          segment.startSeconds + segment.durationSeconds > 3600.1 ||
          (index == 0 && segment.startSeconds > 0.1) ||
          segment.startSeconds < lastEnd - 0.1) {
        throw const FormatException('Native audio timeline is invalid.');
      }
      lastEnd = segment.startSeconds + segment.durationSeconds;
    }
    return segments;
  }
}
