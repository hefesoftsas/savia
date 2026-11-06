import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../capture/capture_controller.dart';
import '../l10n/app_localizations.dart';
import 'failure_notice.dart';

String formatCaptureDuration(Duration duration) {
  final hours = duration.inHours;
  final minutes = duration.inMinutes.remainder(60);
  final seconds = duration.inSeconds.remainder(60);
  return '${hours.toString().padLeft(2, '0')}:${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
}

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
  bool _draftNameValid = true;
  String? _draftId;
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
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 720),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      l.capture,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 8),
                    Text(l.limit, style: Theme.of(context).textTheme.bodyLarge),
                    const SizedBox(height: 28),
                    if (c.phase == CapturePhase.recording) ...[
                      _CaptureSurface(
                        child: Column(
                          children: [
                            Semantics(
                              label: l.recordingNow,
                              liveRegion: true,
                              child: const Icon(
                                Icons.mic,
                                color: Color(0xffa53839),
                                size: 48,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              formatCaptureDuration(c.elapsed),
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.headlineMedium,
                            ),
                            const SizedBox(height: 20),
                            FilledButton.icon(
                              onPressed: c.busy ? null : c.stop,
                              icon: const Icon(Icons.stop),
                              label: Text(l.stop),
                            ),
                          ],
                        ),
                      ),
                    ] else if (c.draft == null) ...[
                      _CaptureSurface(
                        child: Column(
                          children: [
                            Icon(
                              Icons.mic_none,
                              size: 40,
                              color: Theme.of(context).colorScheme.primary,
                            ),
                            const SizedBox(height: 16),
                            FilledButton.icon(
                              onPressed: c.busy || !widget.canUpload
                                  ? null
                                  : c.start,
                              icon: const Icon(Icons.mic),
                              label: Text(l.record),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      OutlinedButton.icon(
                        onPressed: c.busy || !widget.canUpload
                            ? null
                            : c.importAudio,
                        icon: const Icon(Icons.audio_file),
                        label: Text(l.importAudio),
                      ),
                    ] else ...[
                      Builder(
                        builder: (context) {
                          final draft = c.draft;
                          if (draft == null) return const SizedBox.shrink();
                          final draftId = draft.id;
                          if (_draftId != draftId) {
                            _draftId = draftId;
                            _draftNameValid = true;
                          }
                          return _DraftEditor(
                            key: ValueKey(draftId),
                            controller: c,
                            onValidityChanged: (valid) {
                              if (valid != _draftNameValid && mounted) {
                                setState(() => _draftNameValid = valid);
                              }
                            },
                          );
                        },
                      ),
                      const SizedBox(height: 16),
                      _DraftNotice(
                        notice: l.draftNotice,
                        unknownOutcome: c.phase == CapturePhase.unknownOutcome
                            ? l.unknown
                            : null,
                      ),
                      const SizedBox(height: 16),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: consent,
                        onChanged: c.busy
                            ? null
                            : (value) =>
                                  setState(() => consent = value ?? false),
                        title: Text(l.uploadConsent),
                      ),
                      if (c.phase == CapturePhase.uploading)
                        LinearProgressIndicator(value: c.progress),
                      const SizedBox(height: 12),
                      FilledButton.icon(
                        onPressed:
                            c.busy ||
                                !consent ||
                                !widget.canUpload ||
                                !_draftNameValid
                            ? null
                            : () async {
                                await c.upload(consent: consent);
                                if (c.draft == null) {
                                  if (mounted) {
                                    setState(() {
                                      consent = false;
                                      _draftNameValid = true;
                                      _draftId = null;
                                    });
                                  }
                                  widget.onUploaded();
                                }
                              },
                        icon: const Icon(Icons.cloud_upload_outlined),
                        label: Text(
                          c.phase == CapturePhase.unknownOutcome
                              ? l.retry
                              : l.upload,
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
                                        onPressed: () =>
                                            Navigator.pop(ctx, false),
                                        child: Text(l.cancel),
                                      ),
                                      FilledButton(
                                        onPressed: () =>
                                            Navigator.pop(ctx, true),
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
                      const Padding(
                        padding: EdgeInsets.only(top: 16),
                        child: LinearProgressIndicator(),
                      ),
                    if (c.failure != null) ...[
                      const SizedBox(height: 16),
                      FailureNotice(c.failure!),
                    ],
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _CaptureSurface extends StatelessWidget {
  const _CaptureSurface({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(16),
    ),
    child: Padding(padding: const EdgeInsets.all(24), child: child),
  );
}

class _DraftEditor extends StatefulWidget {
  const _DraftEditor({
    super.key,
    required this.controller,
    required this.onValidityChanged,
  });
  final CaptureController controller;
  final ValueChanged<bool> onValidityChanged;

  @override
  State<_DraftEditor> createState() => _DraftEditorState();
}

class _DraftEditorState extends State<_DraftEditor> {
  late final TextEditingController _name;

  @override
  void initState() {
    super.initState();
    final draft = widget.controller.draft;
    final name = draft == null || draft.isCapture
        ? draft?.name ?? ''
        : draft.name.replaceFirst(
            RegExp(r'\.(mp3|wav|m4a|ogg|opus|oga)$', caseSensitive: false),
            '',
          );
    _name = TextEditingController(text: name);
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    final c = widget.controller;
    final draft = c.draft!;
    final nameLimit = draft.isCapture ? 255 : 255 - draft.format.length - 1;
    final trimmed = _name.text.trim();
    final invalid = trimmed.isEmpty || trimmed.length > nameLimit;
    final size =
        '${NumberFormat('0.00', l.localeName).format(draft.bytes / 1000000)} MB';
    final duration = draft.durationSeconds == null
        ? null
        : formatCaptureDuration(
            Duration(seconds: draft.durationSeconds!.round()),
          );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _name,
              decoration: InputDecoration(
                labelText: l.sessionNameLabel,
                hintText: l.sessionNameHint,
                errorText: invalid ? l.sessionNameInvalid : null,
                border: const OutlineInputBorder(),
              ),
              maxLength: nameLimit,
              enabled: !c.busy && c.phase != CapturePhase.unknownOutcome,
              textInputAction: TextInputAction.done,
              onChanged: (value) {
                final next = value.trim();
                final valid = next.isNotEmpty && next.length <= nameLimit;
                widget.onValidityChanged(valid);
                if (valid) c.renameDraft(value);
                setState(() {});
              },
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 16,
              runSpacing: 4,
              children: [
                _MetadataItem(icon: Icons.audio_file_outlined, value: size),
                if (duration != null)
                  _MetadataItem(icon: Icons.schedule, value: duration),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MetadataItem extends StatelessWidget {
  const _MetadataItem({required this.icon, required this.value});
  final IconData icon;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 18),
      const SizedBox(width: 6),
      Text(value, style: Theme.of(context).textTheme.bodyMedium),
    ],
  );
}

class _DraftNotice extends StatelessWidget {
  const _DraftNotice({required this.notice, this.unknownOutcome});
  final String notice;
  final String? unknownOutcome;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(notice, style: Theme.of(context).textTheme.bodyMedium),
          if (unknownOutcome != null) ...[
            const SizedBox(height: 8),
            Text(
              unknownOutcome!,
              style: Theme.of(context).textTheme.bodyMedium
                  ?.copyWith(color: colors.error),
            ),
          ],
        ],
      ),
    );
  }
}
