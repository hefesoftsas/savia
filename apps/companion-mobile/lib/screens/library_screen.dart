import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../recordings/recordings_controller.dart';
import '../recordings/models.dart';
import 'failure_notice.dart';

class LibraryScreen extends StatelessWidget {
  const LibraryScreen({
    super.key,
    required this.controller,
    required this.onSelect,
    required this.onRefresh,
  });
  final RecordingsController controller;
  final ValueChanged<Recording> onSelect;
  final Future<void> Function() onRefresh;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: controller,
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
            if (controller.loading) const LinearProgressIndicator(),
            if (controller.failure != null) FailureNotice(controller.failure!),
            if (!controller.loading && controller.recordings.isEmpty)
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
            if (controller.cursor != null)
              TextButton(
                onPressed: controller.loading
                    ? null
                    : () => controller.reload(more: true),
                child: Text(l.more),
              ),
          ],
        ),
      ),
    );
  }
}
