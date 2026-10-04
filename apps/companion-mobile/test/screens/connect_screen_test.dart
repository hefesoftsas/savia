import 'dart:async';
import 'dart:io';

import 'package:companion_mobile/app.dart';
import 'package:companion_mobile/config.dart';
import 'package:companion_mobile/capture/capture_controller.dart';
import 'package:companion_mobile/capture/document_import.dart';
import 'package:companion_mobile/capture/native_capture.dart';
import 'package:companion_mobile/capture/temp_files.dart';
import 'package:companion_mobile/mobile_runtime.dart';
import 'package:companion_mobile/recordings/models.dart';
import 'package:companion_mobile/recordings/recording_sessions_controller.dart';
import 'package:companion_mobile/recordings/recordings_api.dart';
import 'package:companion_mobile/recordings/recordings_controller.dart';
import 'package:companion_mobile/screens/failure_notice.dart';
import 'package:companion_mobile/session/oauth_adapter.dart';
import 'package:companion_mobile/session/secure_session_store.dart';
import 'package:companion_mobile/session/session_controller.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'missing public client keeps Preview visible and login disabled',
    (tester) async {
      await tester.pumpWidget(
        CompanionApp(config: MobileConfig.preview(clientId: '')),
      );
      expect(find.text('Preview'), findsOneWidget);
      expect(find.textContaining('client ID'), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
    },
  );

  testWidgets('mobile home keeps restore failure inside its narrow viewport', (
    tester,
  ) async {
    final config = MobileConfig.preview(clientId: 'client');
    tester.view.physicalSize = const Size(320, 520);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final services = _servicesWithTransientRestoreFailure(config);

    await tester.pumpWidget(
      CompanionApp(
        config: config,
        home: Builder(
          builder: (context) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(2)),
            child: MobileHome(config: config, services: services),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byType(FailureNotice), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(services.session.oauth, isA<_UnavailableOAuth>());
    expect((services.session.oauth as _UnavailableOAuth).refreshCalls, 2);
    expect(services.session.canRestore, isTrue);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
}

MobileServices _servicesWithTransientRestoreFailure(MobileConfig config) {
  final store = _TestSessionStore()
    ..value = StoredSession(
      refreshToken: 'saved-refresh-token',
      issuer: config.issuer.toString(),
      clientId: config.clientId,
    );
  final session = SessionController(
    config: config,
    oauth: _UnavailableOAuth(),
    store: store,
    discover: (_) async => throw StateError('not reached'),
  );
  final api = RecordingsApi(
    dio: Dio(),
    apiOrigin: config.apiOrigin,
    tokenProvider: () async => '',
    workspaceIdProvider: () => null,
  );
  final files = TempFiles(Directory.systemTemp);
  final capture = CaptureController(
    native: _NoopCapture(),
    importer: _NoopImport(),
    files: files,
    uploader: (_, _, _) async {},
  );
  return MobileServices(
    session: session,
    api: api,
    capture: capture,
    recordings: RecordingsController(
      list: ({cursor}) async =>
          const RecordingPage(recordings: [], cursor: null),
      notes: (_) async => throw StateError('not reached'),
      generate: (_) async => throw StateError('not reached'),
      answer: (_, _) async => throw StateError('not reached'),
    ),
    sessions: RecordingSessionsController(
      list: ({cursor}) async => throw StateError('not reached'),
      get: (_) async => throw StateError('not reached'),
      process: (_, {required consent, required retryAmbiguous}) async =>
          throw StateError('not reached'),
      cancel: (_) async => throw StateError('not reached'),
      answer: (_, _, {required consent}) async =>
          throw StateError('not reached'),
    ),
    files: files,
  );
}

class _TestSessionStore implements SecureSessionStore {
  StoredSession? value;
  @override
  Future<StoredSession?> read() async => value;
  @override
  Future<void> write(StoredSession session) async => value = session;
  @override
  Future<void> clear() async => value = null;
}

class _UnavailableOAuth implements OAuthAdapter {
  int refreshCalls = 0;
  @override
  Future<TokenSet?> authorize() async => null;
  @override
  Future<TokenSet> refresh(String refreshToken) async => _failRefresh();
  Future<TokenSet> _failRefresh() async {
    refreshCalls++;
    throw TimeoutException('offline');
  }

  @override
  Future<void> revoke(String refreshToken) async {}
}

class _NoopCapture implements NativeCapture {
  @override
  Stream<void> get interruptions => const Stream.empty();
  @override
  Future<void> start(String path) async {}
  @override
  Future<String?> stop() async => null;
  @override
  Future<void> cancel() async {}
  @override
  Future<void> dispose() async {}
}

class _NoopImport implements DocumentImport {
  @override
  Future<PickedAudio?> pick() async => null;
  @override
  Future<void> clearPickerCache() async {}
}
