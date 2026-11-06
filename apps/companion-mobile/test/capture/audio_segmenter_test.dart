import 'package:companion_mobile/capture/audio_segmenter.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('savia.companion/audio_segments');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test(
    'segments AAC through the native channel and validates ordered output',
    () async {
      MethodCall? received;
      messenger.setMockMethodCallHandler(channel, (call) async {
        received = call;
        return [
          {
            'path': '/private/segment-0.m4a',
            'startSeconds': 0,
            'durationSeconds': 30,
            'bytes': 120000,
          },
          {
            'path': '/private/segment-1.m4a',
            'startSeconds': 30,
            'durationSeconds': 14.4,
            'bytes': 60000,
          },
        ];
      });

      final segments = await const MethodChannelAudioSegmenter().segment(
        '/private/source.m4a',
        '/private',
        artifactId: '8b87d175-a584-4e3d-95cb-e96c84248e15',
      );

      expect(received?.method, 'segmentAacFile');
      expect(received?.arguments, {
        'sourcePath': '/private/source.m4a',
        'outputDirectory': '/private',
        'artifactId': '8b87d175-a584-4e3d-95cb-e96c84248e15',
        'segmentSeconds': 30,
        'maxSegments': 120,
      });
      expect(segments.map((segment) => segment.startSeconds), [0, 30]);
      expect(segments.map((segment) => segment.durationSeconds), [30, 14.4]);
      expect(segments.last.bytes, 60000);
    },
  );

  test(
    'rejects segment output beyond the one hour and 512 KiB limits',
    () async {
      messenger.setMockMethodCallHandler(
        channel,
        (call) async => [
          {
            'path': '/private/too-large.m4a',
            'startSeconds': 0,
            'durationSeconds': 30,
            'bytes': 512 * 1024 + 1,
          },
        ],
      );

      await expectLater(
        const MethodChannelAudioSegmenter().segment(
          '/private/in.m4a',
          '/private',
          artifactId: '8b87d175-a584-4e3d-95cb-e96c84248e15',
        ),
        throwsFormatException,
      );
    },
  );
}
