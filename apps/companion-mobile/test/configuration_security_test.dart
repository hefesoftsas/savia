import 'dart:io';

import 'package:companion_mobile/config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'mobile configuration contains public identity only and pins preview',
    () {
      final config = MobileConfig.preview(clientId: 'public-client');
      expect(config.apiOrigin.host, 'savia-preview.hefesoft.com');
      final main = File('lib/main.dart').readAsStringSync();
      final definitions = RegExp(r"String.fromEnvironment\('([^']+)'")
          .allMatches(main)
          .map((m) => m[1])
          .toList();
      expect(definitions, ['SAVIA_MOBILE_CLIENT_ID']);
      expect(
        config.scopes.any((scope) => scope.startsWith('savia.api.')),
        false,
      );
    },
  );
  test('Android forbids backup and cleartext; iOS has no background capture entitlement', () {
    final android = File('android/app/src/main/AndroidManifest.xml')
        .readAsStringSync();
    expect(android, contains('android:allowBackup="false"'));
    expect(android, contains('android:usesCleartextTraffic="false"'));
    expect(android, isNot(contains('FOREGROUND_SERVICE')));
    expect(android, isNot(contains('android:taskAffinity=""')));
    expect(
      File('ios/Runner/Info.plist').readAsStringSync(),
      isNot(contains('UIBackgroundModes')),
    );
  });
}
