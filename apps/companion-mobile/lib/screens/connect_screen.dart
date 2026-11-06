import 'package:flutter/material.dart';

import '../config.dart';
import '../l10n/app_localizations.dart';
import '../recordings/models.dart';
import 'failure_notice.dart';

class ConnectScreen extends StatelessWidget {
  const ConnectScreen({
    super.key,
    required this.config,
    this.onConnect,
    this.onRestore,
    this.failure,
    this.canRestore = false,
    this.busy = false,
  });
  final MobileConfig config;
  final VoidCallback? onConnect;
  final VoidCallback? onRestore;
  final CompanionFailure? failure;
  final bool canRestore;
  final bool busy;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                if (failure == null) ...[
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primaryContainer,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Icon(
                        Icons.graphic_eq,
                        size: 40,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  Text(
                    'Savia Companion',
                    style: MediaQuery.textScalerOf(context).scale(1) > 1.5
                        ? Theme.of(context).textTheme.headlineSmall
                        : Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        border: Border.all(
                          color: Theme.of(context).colorScheme.outlineVariant,
                        ),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 4,
                        ),
                        child: Text(
                          'Preview',
                          style: Theme.of(context).textTheme.labelMedium,
                        ),
                      ),
                    ),
                  ),
                ],
                if (failure != null) ...[
                  FailureNotice(
                    failure!,
                    actionLabel: canRestore ? l.sessionRestore : null,
                    onAction: canRestore && !busy ? onRestore : null,
                  ),
                  const SizedBox(height: 8),
                  if (canRestore)
                    FilledButton.tonal(
                      onPressed: busy ? null : onConnect,
                      child: Text(l.connect),
                    )
                  else
                    FilledButton(
                      onPressed: config.isConfigured && !busy
                          ? onConnect
                          : null,
                      child: Text(l.connect),
                    ),
                ],
                const SizedBox(height: 24),
                Text(l.intro, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 16),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.lock_outline,
                      size: 20,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        l.privacy,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 32),
                if (!config.isConfigured)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(l.setup),
                  ),
                if (failure == null)
                  FilledButton(
                    onPressed: config.isConfigured && !busy ? onConnect : null,
                    child: Text(l.connect),
                  ),
                if (busy)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: LinearProgressIndicator(),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
