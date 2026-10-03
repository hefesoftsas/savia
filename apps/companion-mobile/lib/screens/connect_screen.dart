import 'package:flutter/material.dart';

import '../config.dart';
import '../l10n/app_localizations.dart';

class ConnectScreen extends StatelessWidget {
  const ConnectScreen({
    super.key,
    required this.config,
    this.onConnect,
    this.busy = false,
  });
  final MobileConfig config;
  final VoidCallback? onConnect;
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
              shrinkWrap: true,
              padding: const EdgeInsets.all(28),
              children: [
                const Icon(
                  Icons.graphic_eq,
                  size: 48,
                  color: Color(0xff176647),
                ),
                const SizedBox(height: 24),
                Text(
                  'Savia Companion',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 8),
                const Text('Preview'),
                const SizedBox(height: 32),
                Text(l.intro, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 16),
                Text(l.privacy),
                const SizedBox(height: 32),
                if (!config.isConfigured)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(l.setup),
                  ),
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
