import 'dart:io';

import '../capture/capture_controller_test.dart' show FakeCapture, FakeImport;

import 'package:companion_mobile/capture/capture_controller.dart';
import 'package:companion_mobile/screens/capture_screen.dart';
import 'package:companion_mobile/screens/connect_screen.dart';

import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:companion_mobile/app.dart';
import 'package:companion_mobile/config.dart';
import 'package:companion_mobile/capture/temp_files.dart';
import 'package:companion_mobile/playback/audio_player_adapter.dart';
import 'package:companion_mobile/playback/playback_controller.dart';
import 'package:companion_mobile/recordings/models.dart';
import 'package:companion_mobile/recordings/recordings_controller.dart';
import 'package:companion_mobile/recordings/recording_sessions_controller.dart';
import 'package:companion_mobile/recordings/session_models.dart';
import 'package:companion_mobile/screens/library_screen.dart';
import 'package:companion_mobile/screens/recording_detail_screen.dart';

class SilentPlayer implements AudioPlayerAdapter {
  @override
  Future<void> openFile(String path) async {}
  @override
  Future<void> play() async {}
  @override
  Future<void> pause() async {}
  @override
  Future<void> stop() async {}
  @override
  Future<void> dispose() async {}
}

Future<void> main() async {
  TestWidgetsFlutterBinding.ensureInitialized();
  if (const bool.fromEnvironment('SAVIA_VISUAL_REVIEW')) {
    final sdk = Platform.environment['FLUTTER_ROOT']!;
    final font = FontLoader('Roboto')
      ..addFont(
        File('$sdk/bin/cache/artifacts/material_fonts/Roboto-Regular.ttf')
            .readAsBytes()
            .then((bytes) => ByteData.view(bytes.buffer)),
      );
    await font.load();
    final icons = FontLoader('MaterialIcons')
      ..addFont(
        File(
          '$sdk/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
        ).readAsBytes().then((bytes) => ByteData.view(bytes.buffer)),
      );
    await icons.load();
  }
  testWidgets(
    'saved transcript enables questions only after explicit provider consent',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      const notes = RecordingNotes(
        transcript: RecordingTranscript(
          text: 'Synthetic fixture: The project code is Cedar.',
          source: 'upload',
          model: 'fixture',
          durationSeconds: 13,
        ),
        summary: null,
      );
      final recording = Recording(
        id: 'fixture',
        name: 'Synthetic preview audio',
        source: 'upload',
        format: AudioFormat.wav,
        bytes: 410000,
        durationSeconds: 13,
        createdAt: DateTime.utc(2026, 10, 3, 10),
        sha256: 'a' * 64,
      );
      var calls = 0;
      final controller = RecordingsController(
        list: ({cursor}) async =>
            RecordingPage(recordings: [recording], cursor: null),
        notes: (_) async => notes,
        generate: (_) async => notes,
        answer: (_, _) async {
          calls++;
          return const RecordingAnswer(
            answer: 'Cedar',
            insufficientEvidence: false,
          );
        },
      );
      final sessions = RecordingSessionsController(
        list: ({cursor}) async =>
            const RecordingSessionPage(sessions: [], cursor: null),
        get: (_) async => throw UnimplementedError(),
        process: (_, {required consent, required retryAmbiguous}) async =>
            throw UnimplementedError(),
        cancel: (_) async => throw UnimplementedError(),
        answer: (_, _, {required consent}) async => throw UnimplementedError(),
      );
      await controller.select(recording.id);
      final playback = PlaybackController(
        player: SilentPlayer(),
        files: TempFiles(Directory.systemTemp),
        download: (_, _, _) async {},
      );
      final key = GlobalKey();
      final config = MobileConfig.preview(clientId: 'fixture');
      await tester.pumpWidget(
        CompanionApp(
          config: config,
          home: RepaintBoundary(
            key: key,
            child: Scaffold(
              body: RecordingDetailScreen(
                recording: recording,
                controller: controller,
                playback: playback,
                canProcess: true,
                onClose: () {},
              ),
            ),
          ),
        ),
      );
      await tester.enterText(
        find.byType(TextField),
        'What is the project code?',
      );
      await tester.scrollUntilVisible(
        find.text('Ask'),
        150,
        scrollable: find.byType(Scrollable).first,
      );
      final ask = find
          .ancestor(
            of: find.text('Ask'),
            matching: find.byWidgetPredicate((w) => w is FilledButton),
          )
          .first;
      expect(tester.widget<FilledButton>(ask).onPressed, isNull);
      await tester.scrollUntilVisible(
        find.byType(CheckboxListTile),
        -150,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byType(CheckboxListTile));
      await tester.pump();
      await tester.ensureVisible(ask);
      await tester.tap(ask);
      await tester.pumpAndSettle();
      expect(calls, 1);
      expect(find.text('Cedar'), findsOneWidget);
      if (const bool.fromEnvironment('SAVIA_VISUAL_REVIEW')) {
        await tester.runAsync(() async {
          final boundary =
              key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
          final image = await boundary.toImage(pixelRatio: 1);
          final data = await image.toByteData(format: ui.ImageByteFormat.png);
          await Directory('build/visual-review').create(recursive: true);
          await File('build/visual-review/detail.png')
              .writeAsBytes(data!.buffer.asUint8List());
        });
      }
      await controller.reload();
      await tester.pumpWidget(
        CompanionApp(
          config: config,
          home: RepaintBoundary(
            key: key,
            child: Scaffold(
              body: LibraryScreen(
                controller: controller,
                sessions: sessions,
                onSelect: (_) {},
                onSelectSession: (_) {},
                onRefresh: controller.reload,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Synthetic preview audio'), findsOneWidget);
      if (const bool.fromEnvironment('SAVIA_VISUAL_REVIEW')) {
        await tester.runAsync(() async {
          final boundary =
              key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
          final image = await boundary.toImage(pixelRatio: 1);
          final data = await image.toByteData(format: ui.ImageByteFormat.png);
          await File('build/visual-review/library.png')
              .writeAsBytes(data!.buffer.asUint8List());
        });
      }
      for (final locale in ['en', 'es', 'pt']) {
        await tester.pumpWidget(
          CompanionApp(
            config: config,
            locale: Locale(locale),
            home: Scaffold(
              body: LibraryScreen(
                controller: controller,
                sessions: sessions,
                onSelect: (_) {},
                onSelectSession: (_) {},
                onRefresh: controller.reload,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.textContaining(locale == 'en' ? '0.41 MB' : '0,41 MB'),
          findsOneWidget,
        );
      }
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'capture and connection layouts adapt to narrow and wide screens',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final capture = CaptureController(
        native: FakeCapture(),
        importer: FakeImport(),
        files: TempFiles(Directory.systemTemp),
        uploader: (_, _, _) async {},
      );
      final config = MobileConfig.preview(clientId: 'fixture');
      for (final width in [320.0, 768.0]) {
        tester.view.physicalSize = Size(width, 900);
        for (final name in ['connect', 'capture']) {
          final key = GlobalKey();
          await tester.pumpWidget(
            CompanionApp(
              config: config,
              locale: const Locale('es'),
              home: RepaintBoundary(
                key: key,
                child: MediaQuery(
                  data: MediaQueryData(
                    textScaler: TextScaler.linear(width == 320 ? 2 : 1),
                  ),
                  child: name == 'connect'
                      ? ConnectScreen(config: config)
                      : Scaffold(
                          body: Center(
                            child: ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 720),
                              child: CaptureScreen(
                                controller: capture,
                                canUpload: true,
                                onUploaded: () {},
                              ),
                            ),
                          ),
                        ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          if (const bool.fromEnvironment('SAVIA_VISUAL_REVIEW')) {
            await tester.runAsync(() async {
              final boundary =
                  key.currentContext!.findRenderObject()!
                      as RenderRepaintBoundary;
              final image = await boundary.toImage(pixelRatio: 1);
              final data = await image.toByteData(
                format: ui.ImageByteFormat.png,
              );
              await Directory('build/visual-review').create(recursive: true);
              await File('build/visual-review/$name-${width.toInt()}.png')
                  .writeAsBytes(data!.buffer.asUint8List());
            });
          }
        }
      }
      await tester.pumpWidget(const SizedBox());
      await tester.runAsync(capture.shutdown);
      capture.dispose();
    },
  );
}
