import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:companion_mobile/capture/document_import.dart';
import 'package:companion_mobile/config.dart';
import 'package:companion_mobile/mobile_runtime.dart';

/// Opt-in device smoke: a human completes system-browser authentication.
/// This suite never takes account credentials or provider keys as build input.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const enabled = bool.fromEnvironment('SAVIA_RUN_PREVIEW_SMOKE');
  const paid = bool.fromEnvironment('SAVIA_ALLOW_PAID_PROCESSING');
  const clientId = String.fromEnvironment('SAVIA_MOBILE_CLIENT_ID');
  const fixturePath = String.fromEnvironment('SAVIA_SYNTHETIC_AUDIO_PATH');
  const workspaceId = int.fromEnvironment('SAVIA_SMOKE_WORKSPACE_ID');
  testWidgets(
    'preview login, one synthetic upload, session restore, saved notes and grounded answer',
    (tester) async {
      expect(
        clientId,
        isNotEmpty,
        reason: 'Register the public preview client first.',
      );
      expect(
        fixturePath,
        isNotEmpty,
        reason: 'Provide app-readable synthetic spoken audio: The project code is Cedar.',
      );
      expect(workspaceId, greaterThan(0));
      final config = MobileConfig.preview(clientId: clientId);
      final services = await MobileServices.create(config);
      await tester.runAsync(() async {
        await services.session.signIn();
        final workspace = services.session.session!.workspaces.singleWhere(
          (w) => w.id == workspaceId,
        );
        await services.session.setWorkspace(workspace);
        final source = File(fixturePath);
        final draft = await services.files.copyImport(
          PickedAudio(path: source.path, name: source.uri.pathSegments.last),
        );
        final recording = await services.api.upload(draft);
        expect(recording.id, draft.id);
        await services.files.remove(draft.path);
        // Recreate all in-memory state, then retrieve from the authoritative backend.
        final restored = await MobileServices.create(config);
        await restored.session.restore();
        await restored.session.setWorkspace(workspace);
        final library = await restored.api.list();
        expect(library.recordings.any((r) => r.id == recording.id), true);
        final downloaded = await restored.files.createPath(
          recording.format.name,
        );
        await restored.api.audio(
          recording.id,
          downloaded,
          cancellation: CancelToken(),
        );
        expect(await File(downloaded).length(), recording.bytes);
        await restored.files.remove(downloaded);
        if (paid) {
          final notes = await restored.api.generate(
            recording.id,
            consent: true,
          );
          expect(notes.transcript?.text, isNotEmpty);
          expect(notes.summary, isNotNull);
          final saved = await restored.api.notes(recording.id);
          expect(saved.transcript!.text, notes.transcript!.text);
          final answer = await restored.api.answer(
            recording.id,
            'What is the project code?',
            consent: true,
          );
          expect(answer.insufficientEvidence, false);
          expect(answer.answer.toLowerCase(), contains('cedar'));
          final unsupported = await restored.api.answer(
            recording.id,
            'What is the bank account number?',
            consent: true,
          );
          expect(unsupported.insufficientEvidence, true);
        }
        await restored.session.signOut();
        await services.capture.native.dispose();
        await restored.capture.native.dispose();
      });
    },
    skip: !enabled,
    timeout: const Timeout(Duration(minutes: 10)),
  );
}
