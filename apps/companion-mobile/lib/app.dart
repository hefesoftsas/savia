import 'package:flutter/material.dart';

import 'config.dart';
import 'theme.dart';
import 'l10n/app_localizations.dart';
import 'screens/connect_screen.dart';

/// Inherits desktop Savia's emerald actions and neutral, legible surfaces.
/// The first screen explains private account connection; library actions follow login.
class CompanionApp extends StatelessWidget {
  const CompanionApp({super.key, required this.config, this.home, this.locale});
  final MobileConfig config;
  final Widget? home;
  final Locale? locale;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Savia Companion',
    debugShowCheckedModeBanner: false,
    locale: locale,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    theme: companionTheme(),
    home: home ?? ConnectScreen(config: config),
  );
}
