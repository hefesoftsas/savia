import 'package:flutter/material.dart';
import 'package:dio/dio.dart';

import '../l10n/app_localizations.dart';
import '../recordings/recording_sessions_controller.dart';
import '../recordings/models.dart';
import '../recordings/session_models.dart';
import '../playback/playback_controller.dart';
import 'failure_notice.dart';

class RecordingSessionDetailScreen extends StatefulWidget {
  const RecordingSessionDetailScreen({
    super.key,
    required this.controller,
    required this.playback,
    required this.downloadChunk,
    required this.canProcess,
    required this.canRename,
    required this.onClose,
  });
  final RecordingSessionsController controller;
  final PlaybackController playback;
  final Future<void> Function(
    String sessionId,
    String source,
    int sequence,
    String path,
    CancelToken cancellation,
  )
  downloadChunk;
  final bool canProcess;
  final bool canRename;
  final VoidCallback onClose;

  @override
  State<RecordingSessionDetailScreen> createState() =>
      _RecordingSessionDetailScreenState();
}

class _RecordingSessionDetailScreenState
    extends State<RecordingSessionDetailScreen> {
  bool processConsent = false;
  bool retryConsent = false;
  bool questionConsent = false;
  final question = TextEditingController();

  @override
  void dispose() {
    question.dispose();
    super.dispose();
  }

  Future<void> _showRenameDialog(BuildContext context) async {
    final c = widget.controller;
    final session = c.selectedSession;
    if (session == null) return;
    final l = AppLocalizations.of(context)!;
    final name = TextEditingController(text: session.name);
    try {
      final saved = await showDialog<bool>(
        context: context,
        builder: (ctx) => StatefulBuilder(
          builder: (ctx, setDialogState) {
            final trimmed = name.text.trim();
            final invalid = trimmed.isEmpty || trimmed.length > 255;
            return AlertDialog(
              title: Text(l.sessionRename),
              content: TextField(
                controller: name,
                autofocus: true,
                maxLength: 255,
                decoration: InputDecoration(
                  labelText: l.sessionNameLabel,
                  hintText: l.sessionNameHint,
                  errorText: invalid ? l.sessionNameInvalid : null,
                  border: const OutlineInputBorder(),
                ),
                textInputAction: TextInputAction.done,
                onChanged: (_) => setDialogState(() {}),
                onSubmitted: (_) {
                  if (!invalid) Navigator.pop(ctx, true);
                },
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: Text(l.cancel),
                ),
                FilledButton(
                  onPressed: invalid ? null : () => Navigator.pop(ctx, true),
                  child: Text(l.save),
                ),
              ],
            );
          },
        ),
      );
      if (saved == true && mounted) {
        await c.rename(name: name.text);
      }
    } finally {
      name.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: Listenable.merge([widget.controller, widget.playback]),
      builder: (context, _) {
        final c = widget.controller;
        final session = c.selectedSession;
        if (c.detailLoading || (session == null && c.failure == null)) {
          return const Center(child: CircularProgressIndicator());
        }
        if (session == null) {
          return ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: IconButton(
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.arrow_back),
                ),
              ),
              if (c.failure != null) FailureNotice(c.failure!),
              FilledButton(
                onPressed: c.selectedId == null
                    ? null
                    : () => c.select(c.selectedId!),
                child: Text(l.refresh),
              ),
            ],
          );
        }
        final job = session.job;
        final isWorking = switch (job.status) {
          SessionJobStatus.queued ||
          SessionJobStatus.transcribing ||
          SessionJobStatus.summarizing => true,
          _ => false,
        };
        final needsConsent =
            job.status == SessionJobStatus.idle ||
            job.status == SessionJobStatus.needsAttention ||
            job.status == SessionJobStatus.cancelled ||
            job.status == SessionJobStatus.failed;
        final ambiguousRetry =
            job.status == SessionJobStatus.needsAttention ||
            job.status == SessionJobStatus.cancelled;
        final status = switch (job.status) {
          SessionJobStatus.idle => l.sessionReady,
          SessionJobStatus.queued => l.sessionQueued,
          SessionJobStatus.transcribing => l.sessionTranscribing,
          SessionJobStatus.summarizing => l.sessionSummarizing,
          SessionJobStatus.complete => l.sessionComplete,
          SessionJobStatus.needsAttention ||
          SessionJobStatus.cancelled => l.sessionNeedsAttention,
          SessionJobStatus.failed => l.sessionFailed,
        };
        return ListView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
          children: [
            Row(
              children: [
                IconButton(
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.arrow_back),
                ),
                Expanded(
                  child: Text(
                    session.name,
                    style: Theme.of(context).textTheme.headlineSmall,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (widget.canRename)
                  IconButton(
                    tooltip: l.sessionRename,
                    onPressed: c.detailLoading || c.renaming
                        ? null
                        : () => _showRenameDialog(context),
                    icon: const Icon(Icons.edit),
                  ),
                IconButton(
                  tooltip: l.refresh,
                  onPressed: c.detailLoading ? null : c.refreshSelected,
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            if (c.renaming) ...[
              const SizedBox(height: 8),
              const LinearProgressIndicator(),
            ],
            Text(
              '${session.state == RecordingSessionState.uploading ? l.sessionUploading : status}${session.durationSeconds == null ? '' : ' · ${l.sessionDuration((session.durationSeconds! / 60).ceil())}'}',
            ),
            if (isWorking) ...[
              const SizedBox(height: 16),
              LinearProgressIndicator(
                value: job.totalChunks == 0
                    ? null
                    : job.completedChunks / job.totalChunks,
              ),
              const SizedBox(height: 8),
              Text(
                l.sessionChunkProgress(job.completedChunks, job.totalChunks),
              ),
            ],
            if (c.failure != null) ...[
              const SizedBox(height: 12),
              FailureNotice(c.failure!),
            ],
            if (needsConsent &&
                session.state == RecordingSessionState.ready &&
                widget.canProcess) ...[
              const SizedBox(height: 20),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: processConsent,
                onChanged: !widget.canProcess
                    ? null
                    : (value) =>
                          setState(() => processConsent = value ?? false),
                title: Text(l.processConsent),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              if (ambiguousRetry)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: retryConsent,
                  onChanged: (value) =>
                      setState(() => retryConsent = value ?? false),
                  title: Text(l.sessionRetryConsent),
                  controlAffinity: ListTileControlAffinity.leading,
                ),
              FilledButton.icon(
                onPressed:
                    processConsent &&
                        (!ambiguousRetry || retryConsent) &&
                        !c.processing
                    ? () {
                        setState(() {
                          processConsent = false;
                          retryConsent = false;
                        });
                        c.process(
                          consent: true,
                          retryAmbiguous: ambiguousRetry,
                        );
                      }
                    : null,
                icon: const Icon(Icons.auto_awesome),
                label: Text(
                  job.status == SessionJobStatus.needsAttention ||
                          job.status == SessionJobStatus.cancelled ||
                          job.status == SessionJobStatus.failed
                      ? l.sessionRetry
                      : l.generate,
                ),
              ),
            ],
            if (isWorking)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: c.processing ? null : c.cancelProcessing,
                  icon: const Icon(Icons.stop_circle_outlined),
                  label: Text(l.sessionCancel),
                ),
              ),
            if (job.summary != null) ...[
              const SizedBox(height: 24),
              _heading(context, l.summary),
              Text(job.summary!.summary),
              if (job.summary!.decisions.isNotEmpty) ...[
                const SizedBox(height: 16),
                _heading(context, l.decisions),
                for (final item in job.summary!.decisions) _bullet(item),
              ],
              if (job.summary!.actions.isNotEmpty) ...[
                const SizedBox(height: 16),
                _heading(context, l.actions),
                for (final item in job.summary!.actions)
                  _bullet(
                    '${item.description}${item.owner == null ? '' : ' · ${item.owner}'}${item.dueDate == null ? '' : ' · ${item.dueDate}'}',
                  ),
              ],
              if (job.summary!.openQuestions.isNotEmpty) ...[
                const SizedBox(height: 16),
                _heading(context, l.openQuestions),
                for (final item in job.summary!.openQuestions) _bullet(item),
              ],
            ],
            if (session.chunks.isNotEmpty) ...[
              const SizedBox(height: 24),
              _heading(context, l.sessionAudio),
              for (final chunk
                  in (session.chunks.toList()..sort(_compareChunks)))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: IconButton(
                    tooltip:
                        widget.playback.cacheKey == _audioKey(session, chunk) &&
                            widget.playback.playing
                        ? l.pause
                        : l.play,
                    onPressed: widget.playback.loading
                        ? null
                        : () => widget.playback.toggleAudio(
                            cacheKey: _audioKey(session, chunk),
                            extension: chunk.format,
                            download: (path, cancellation) =>
                                widget.downloadChunk(
                                  session.id,
                                  chunk.source,
                                  chunk.sequence,
                                  path,
                                  cancellation,
                                ),
                          ),
                    icon: Icon(
                      widget.playback.cacheKey == _audioKey(session, chunk) &&
                              widget.playback.playing
                          ? Icons.pause
                          : Icons.play_arrow,
                    ),
                  ),
                  title: Text(
                    '${_sourceName(l, chunk.source)} · ${l.sessionPart(chunk.sequence + 1)}',
                  ),
                  subtitle: Text(
                    '${_timestamp(l, chunk.startSeconds)} · ${l.duration(chunk.durationSeconds.ceil())}',
                  ),
                ),
              if (widget.playback.loading) const LinearProgressIndicator(),
              if (widget.playback.failure != null)
                FailureNotice(widget.playback.failure!),
            ],
            if (job.transcripts.isNotEmpty) ...[
              const SizedBox(height: 24),
              _heading(context, l.transcript),
              for (final entry in _orderedTranscripts(session))
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${_sourceName(l, entry.key.split(':').first)} · ${l.sessionPart(int.parse(entry.key.split(':').last) + 1)}',
                          style: Theme.of(context).textTheme.labelLarge,
                        ),
                        const SizedBox(height: 8),
                        Text(entry.value.text),
                      ],
                    ),
                  ),
                ),
            ],
            if (job.transcripts.isNotEmpty) ...[
              const SizedBox(height: 24),
              _heading(context, l.question),
              TextField(
                controller: question,
                maxLength: 2000,
                minLines: 2,
                maxLines: 5,
                decoration: InputDecoration(
                  hintText: l.sessionQuestionHint,
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: questionConsent,
                onChanged: !widget.canProcess
                    ? null
                    : (value) =>
                          setState(() => questionConsent = value ?? false),
                title: Text(l.processConsent),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              if (!widget.canProcess) Text(l.errorScope),
              FilledButton(
                onPressed: questionConsent && widget.canProcess && !c.asking
                    ? () {
                        setState(() => questionConsent = false);
                        c.ask(question.text, consent: true);
                      }
                    : null,
                child: Text(c.asking ? l.sessionAsking : l.ask),
              ),
              if (c.lastAnswer case final answer?) ...[
                const SizedBox(height: 16),
                if (answer.insufficientEvidence) Text(l.insufficient),
                Text(answer.answer),
                if (answer.partial) Text(l.sessionPartialAnswer),
                if (answer.evidence.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  _heading(context, l.sessionEvidence),
                  for (final evidence in answer.evidence)
                    _bullet(
                      '${_sourceName(l, evidence.source)} · ${l.sessionPart(evidence.sequence + 1)} · ${_timestamp(l, evidence.startSeconds)}',
                    ),
                ],
              ],
            ],
          ],
        );
      },
    );
  }

  List<MapEntry<String, RecordingTranscript>> _orderedTranscripts(
    RecordingSession session,
  ) {
    final chunks = session.chunks.toList()..sort(_compareChunks);
    final order = {
      for (var index = 0; index < chunks.length; index++)
        '${chunks[index].source}:${chunks[index].sequence}': index,
    };
    final entries = session.job.transcripts.entries.toList();
    entries.sort((a, b) {
      final ai = order[a.key];
      final bi = order[b.key];
      if (ai != null && bi != null) return ai.compareTo(bi);
      final ap = a.key.split(':');
      final bp = b.key.split(':');
      final sourceOrder = ap.first.compareTo(bp.first);
      return sourceOrder != 0
          ? sourceOrder
          : int.parse(ap.last).compareTo(int.parse(bp.last));
    });
    return entries;
  }

  int _compareChunks(RecordingSessionChunk a, RecordingSessionChunk b) {
    final start = a.startSeconds.compareTo(b.startSeconds);
    if (start != 0) return start;
    final source = a.source.compareTo(b.source);
    return source != 0 ? source : a.sequence.compareTo(b.sequence);
  }

  String _audioKey(RecordingSession session, RecordingSessionChunk chunk) =>
      'session:${session.id}:${chunk.source}:${chunk.sequence}';

  String _sourceName(AppLocalizations l, String source) => switch (source) {
    'microphone' => l.sessionSourceMicrophone,
    'system' => l.sessionSourceSystem,
    _ => source,
  };

  String _timestamp(AppLocalizations l, double seconds) {
    final whole = seconds.floor();
    return l.sessionTimestamp(whole ~/ 60, whole % 60);
  }

  Widget _heading(BuildContext context, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(value, style: Theme.of(context).textTheme.titleMedium),
  );

  Widget _bullet(String value) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('•  '),
        Expanded(child: Text(value)),
      ],
    ),
  );
}
