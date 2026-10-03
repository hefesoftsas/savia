import 'package:flutter/material.dart';

import '../capture/capture_controller.dart';
import '../l10n/app_localizations.dart';
import 'failure_notice.dart';

class CaptureScreen extends StatefulWidget {
  const CaptureScreen({
    super.key,
    required this.controller,
    required this.canUpload,
    required this.onUploaded,
  });
  final CaptureController controller;
  final bool canUpload;
  final VoidCallback onUploaded;
  @override
  State<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends State<CaptureScreen> {
  bool consent = false;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final c = widget.controller;
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(l.capture, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 12),
            Text(l.limit),
            const SizedBox(height: 28),
            if (c.phase == CapturePhase.recording) ...[
              Semantics(
                label: l.recordingNow,
                liveRegion: true,
                child: const Icon(
                  Icons.mic,
                  color: Color(0xffa53839),
                  size: 56,
                ),
              ),
              Text(
                l.duration(c.elapsed.inSeconds),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: c.busy ? null : c.stop,
                icon: const Icon(Icons.stop),
                label: Text(l.stop),
              ),
            ] else if (c.draft == null) ...[
              FilledButton.icon(
                onPressed: c.busy || !widget.canUpload ? null : c.start,
                icon: const Icon(Icons.mic),
                label: Text(l.record),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: c.busy || !widget.canUpload ? null : c.importAudio,
                icon: const Icon(Icons.audio_file),
                label: Text(l.importAudio),
              ),
            ] else ...[
              Text(
                c.draft!.name,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text('${(c.draft!.bytes / 1000000).toStringAsFixed(2)} MB'),
              if (c.draft!.durationSeconds != null)
                Text(l.duration(c.draft!.durationSeconds!.round())),
              const SizedBox(height: 16),
              Text(l.draftNotice),
              if (c.phase == CapturePhase.unknownOutcome)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(l.unknown),
                ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: consent,
                onChanged: c.busy
                    ? null
                    : (value) => setState(() => consent = value ?? false),
                title: Text(l.uploadConsent),
              ),
              if (c.phase == CapturePhase.uploading)
                LinearProgressIndicator(value: c.progress),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: c.busy || !consent || !widget.canUpload
                    ? null
                    : () async {
                        await c.upload(consent: consent);
                        if (c.draft == null) {
                          if (mounted) setState(() => consent = false);
                          widget.onUploaded();
                        }
                      },
                icon: const Icon(Icons.cloud_upload_outlined),
                label: Text(
                  c.phase == CapturePhase.unknownOutcome ? l.retry : l.upload,
                ),
              ),
              TextButton(
                onPressed: c.busy
                    ? null
                    : () async {
                        final accepted = await showDialog<bool>(
                          context: context,
                          builder: (ctx) => AlertDialog(
                            title: Text(l.discardConfirm),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.pop(ctx, false),
                                child: Text(l.cancel),
                              ),
                              FilledButton(
                                onPressed: () => Navigator.pop(ctx, true),
                                child: Text(l.discard),
                              ),
                            ],
                          ),
                        );
                        if (accepted == true) {
                          await c.discard();
                          if (mounted) setState(() => consent = false);
                        }
                      },
                child: Text(l.discard),
              ),
            ],
            if (c.busy && c.phase != CapturePhase.uploading)
              const LinearProgressIndicator(),
            if (c.failure != null) FailureNotice(c.failure!),
          ],
        );
      },
    );
  }
}
