import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../recordings/models.dart';

class FailureNotice extends StatelessWidget {
  const FailureNotice(this.failure, {super.key});
  final CompanionFailure failure;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    final message = switch (failure.code) {
      'MICROPHONE_PERMISSION' => l.errorPermission,
      'SESSION_REQUIRED' => l.errorAuth,
      'INVALID_AUDIO' ||
      'RECORDING_TOO_LARGE' ||
      'UNSUPPORTED_FORMAT' => l.errorFormat,
      'UNSUPPORTED_CODEC' => l.errorCodec,
      _ when failure.status == 401 => l.errorAuth,
      _ when failure.status == 403 => l.errorScope,
      _ when failure.providerStage != null => l.errorProvider,
      _ => l.errorGeneric,
    };
    final stage = switch (failure.providerStage) {
      'transcription' => l.transcript,
      'summary' => l.summary,
      'question' => l.question,
      _ => null,
    };
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(
          '$message${stage == null ? '' : ' · $stage'}${failure.providerStatus == null ? '' : ' (HTTP ${failure.providerStatus})'}',
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      ),
    );
  }
}
