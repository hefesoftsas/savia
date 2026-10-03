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
                contentPadding: const EdgeInsets.symmetric(vertical: 8),
                leading: const Icon(Icons.graphic_eq),
                title: Text(recording.name ?? l.record),
                subtitle: Text(
                  '${DateFormat.yMMMd(Localizations.localeOf(context).languageCode).add_Hm().format(recording.createdAt.toLocal())} · ${(recording.bytes / 1000000).toStringAsFixed(2)} MB',
                ),
                trailing: const Icon(Icons.chevron_right),
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
