import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../recordings/recordings_controller.dart';
import '../recordings/models.dart';
import '../recordings/recording_sessions_controller.dart';
import '../recordings/session_models.dart';
import 'failure_notice.dart';

class LibraryScreen extends StatelessWidget {
  const LibraryScreen({
    super.key,
    required this.controller,
    required this.sessions,
    required this.onSelect,
    required this.onSelectSession,
    required this.onRefresh,
  });
  final RecordingsController controller;
  final RecordingSessionsController sessions;
  final ValueChanged<Recording> onSelect;
  final ValueChanged<String> onSelectSession;
  final Future<void> Function() onRefresh;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: Listenable.merge([controller, sessions]),
      builder: (context, _) => RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(24),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l.library,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                ),
                IconButton(
                  tooltip: l.refresh,
                  onPressed: controller.loading ? null : onRefresh,
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            const SizedBox(height: 20),
            if (controller.loading || sessions.loading)
              const LinearProgressIndicator(),
            if (controller.failure != null) FailureNotice(controller.failure!),
            if (sessions.failure != null) FailureNotice(sessions.failure!),
            if (!controller.loading &&
                !sessions.loading &&
                controller.recordings.isEmpty &&
                sessions.sessions.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 48),
                child: Column(
                  children: [
                    const Icon(Icons.audio_file_outlined, size: 48),
                    const SizedBox(height: 20),
                    Text(
                      l.empty,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    Text(l.emptyHelp, textAlign: TextAlign.center),
                  ],
                ),
              ),
            for (final recording in controller.recordings)
              ListTile(
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
                leading: Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    Icons.graphic_eq,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
                title: Text(
                  recording.name ?? l.record,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                subtitle: Text(
                  '${DateFormat.yMMMd(Localizations.localeOf(context).languageCode).add_Hm().format(recording.createdAt.toLocal())} · ${NumberFormat('0.00', l.localeName).format(recording.bytes / 1000000)} MB',
                ),
                subtitleTextStyle: Theme.of(context).textTheme.bodySmall
                    ?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      height: 1.6,
                    ),
                shape: Border(
                  bottom: BorderSide(
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                ),
                trailing: const Icon(Icons.chevron_right, size: 20),
                onTap: () => onSelect(recording),
              ),
            for (final session in sessions.sessions)
              _sessionTile(context, l, session),
            if (controller.cursor != null || sessions.cursor != null)
              TextButton(
                onPressed: controller.loading || sessions.loading
                    ? null
                    : () async {
                        await Future.wait([
                          if (controller.cursor != null)
                            controller.reload(more: true),
                          if (sessions.cursor != null)
                            sessions.reload(more: true),
                        ]);
                      },
                child: Text(l.more),
              ),
          ],
        ),
      ),
    );
  }

  Widget _sessionTile(
    BuildContext context,
    AppLocalizations l,
    RecordingSession session,
  ) {
    final status = switch (session.job.status) {
      SessionJobStatus.idle => l.sessionReady,
      SessionJobStatus.queued => l.sessionQueued,
      SessionJobStatus.transcribing => l.sessionTranscribing,
      SessionJobStatus.summarizing => l.sessionSummarizing,
      SessionJobStatus.complete => l.sessionComplete,
      SessionJobStatus.needsAttention ||
      SessionJobStatus.cancelled => l.sessionNeedsAttention,
      SessionJobStatus.failed => l.sessionFailed,
    };
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(vertical: 12),
      leading: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.secondaryContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(
          Icons.graphic_eq,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
      title: Text(session.name, style: Theme.of(context).textTheme.titleMedium),
      subtitle: Text(
        '${DateFormat.yMMMd(Localizations.localeOf(context).languageCode).add_Hm().format(session.createdAt.toLocal())} · ${session.durationSeconds == null ? l.sessionUploading : l.sessionDuration((session.durationSeconds! / 60).ceil())} · $status',
      ),
      subtitleTextStyle: Theme.of(context).textTheme.bodySmall?.copyWith(
        color: Theme.of(context).colorScheme.onSurfaceVariant,
        height: 1.6,
      ),
      shape: Border(
        bottom: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      trailing: const Icon(Icons.chevron_right, size: 20),
      onTap: () => onSelectSession(session.id),
    );
  }
}
