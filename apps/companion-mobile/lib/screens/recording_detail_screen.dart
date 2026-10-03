import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../recordings/models.dart';
import '../recordings/recordings_controller.dart';
import '../playback/playback_controller.dart';
import 'failure_notice.dart';

class RecordingDetailScreen extends StatefulWidget {
  const RecordingDetailScreen({
    super.key,
    required this.recording,
    required this.controller,
    required this.playback,
    required this.canProcess,
    required this.onClose,
  });
  final Recording recording;
  final RecordingsController controller;
  final PlaybackController playback;
  final bool canProcess;
  final VoidCallback onClose;
  @override
  State<RecordingDetailScreen> createState() => _RecordingDetailScreenState();
}

class _RecordingDetailScreenState extends State<RecordingDetailScreen> {
  bool consent = false;
  final question = TextEditingController();
  @override
  void dispose() {
    question.dispose();
    widget.playback.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: Listenable.merge([widget.controller, widget.playback]),
      builder: (context, _) {
        final c = widget.controller;
        final p = widget.playback;
        final transcript = c.savedNotes?.transcript;
        final summary = c.savedNotes?.summary;
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: widget.onClose,
                icon: const Icon(Icons.arrow_back),
                label: Text(l.library),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              widget.recording.name ?? l.record,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              onPressed: p.loading ? null : () => p.toggle(widget.recording),
              icon: Icon(p.playing ? Icons.pause : Icons.play_arrow),
              label: Text(p.playing ? l.pause : l.play),
            ),
            if (p.loading) const LinearProgressIndicator(),
            if (p.failure != null) FailureNotice(p.failure!),
            const SizedBox(height: 24),
            Text(l.notes, style: Theme.of(context).textTheme.titleLarge),
            if (c.detailLoading) const LinearProgressIndicator(),
            if (summary != null) ...[
              _Section(
                title: l.summary,
                child: SelectableText(summary.summary),
              ),
              if (summary.decisions.isNotEmpty)
                _Section(
                  title: l.decisions,
                  child: Text(summary.decisions.map((e) => '• $e').join('\n')),
                ),
              if (summary.actions.isNotEmpty)
                _Section(
                  title: l.actions,
                  child: Text(
                    summary.actions
                        .map(
                          (e) => [
                            e.description,
                            e.owner,
                            e.dueDate,
                          ].whereType<String>().join(' · '),
                        )
                        .join('\n\n'),
                  ),
                ),
              if (summary.openQuestions.isNotEmpty)
                _Section(
                  title: l.openQuestions,
                  child: Text(
                    summary.openQuestions.map((e) => '• $e').join('\n'),
                  ),
                ),
            ],
            if (transcript != null)
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: Text(l.transcript),
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: SelectableText(transcript.text),
                  ),
                ],
              ),
            const SizedBox(height: 16),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: consent,
              onChanged: c.processing || !widget.canProcess
                  ? null
                  : (v) => setState(() => consent = v ?? false),
              title: Text(l.processConsent),
            ),
            FilledButton(
              onPressed:
                  !consent ||
                      !widget.canProcess ||
                      c.processing ||
                      c.detailLoading
                  ? null
                  : () => c.generate(consent: consent),
              child: Text(l.generate),
            ),
            if (c.processing)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: LinearProgressIndicator(),
              ),
            if (c.failure != null) FailureNotice(c.failure!),
            const SizedBox(height: 32),
            Text(l.question, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            if (transcript == null) Text(l.needsTranscript),
            TextField(
              controller: question,
              enabled: transcript != null && !c.processing,
              maxLength: 2000,
              minLines: 2,
              maxLines: 5,
              decoration: InputDecoration(
                labelText: l.question,
                border: const OutlineInputBorder(),
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            FilledButton.tonal(
              onPressed:
                  !consent ||
                      !widget.canProcess ||
                      transcript == null ||
                      c.processing ||
                      question.text.trim().isEmpty
                  ? null
                  : () => c.ask(question.text, consent: consent),
              child: Text(l.ask),
            ),
            if (c.answer != null)
              Padding(
                padding: const EdgeInsets.only(top: 20),
                child: Semantics(
                  liveRegion: true,
                  child: SelectableText(
                    c.answer!.insufficientEvidence
                        ? l.insufficient
                        : c.answer!.answer,
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        child,
      ],
    ),
  );
}
