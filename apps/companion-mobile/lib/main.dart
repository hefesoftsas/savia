import 'package:flutter/material.dart';

import 'app.dart';
import 'config.dart';
import 'mobile_runtime.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final config = MobileConfig.preview(
    clientId: const String.fromEnvironment('SAVIA_MOBILE_CLIENT_ID'),
  );
  runApp(
    CompanionApp(
      config: config,
      home: config.isConfigured ? CompanionBootstrap(config: config) : null,
    ),
  );
}
