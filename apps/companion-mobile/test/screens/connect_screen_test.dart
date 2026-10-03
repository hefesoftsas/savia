import 'package:companion_mobile/app.dart';
import 'package:companion_mobile/config.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'missing public client keeps Preview visible and login disabled',
    (tester) async {
      await tester.pumpWidget(
        CompanionApp(config: MobileConfig.preview(clientId: '')),
      );
      expect(find.text('Preview'), findsOneWidget);
      expect(find.textContaining('client ID'), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
    },
  );
}
