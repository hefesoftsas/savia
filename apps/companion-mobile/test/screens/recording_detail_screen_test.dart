import 'package:companion_mobile/app.dart';
import 'package:companion_mobile/config.dart';
import 'package:companion_mobile/screens/failure_notice.dart';
import 'package:companion_mobile/screens/connect_screen.dart';
import 'package:companion_mobile/recordings/models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('provider failure changes language without another request', (
    tester,
  ) async {
    final config = MobileConfig.preview(clientId: '');
    const notice = Scaffold(
      body: FailureNotice(
        CompanionFailure(
          'PROVIDER_FAILURE',
          providerStage: 'summary',
          providerStatus: 502,
        ),
      ),
    );
    await tester.pumpWidget(
      CompanionApp(config: config, locale: const Locale('es'), home: notice),
    );
    expect(find.textContaining('El proveedor de IA'), findsOneWidget);
    await tester.pumpWidget(
      CompanionApp(config: config, locale: const Locale('pt'), home: notice),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('O provedor de IA'), findsOneWidget);
    await tester.pumpWidget(
      CompanionApp(config: config, locale: const Locale('en'), home: notice),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('The AI provider'), findsOneWidget);
  });
  testWidgets('connection screen supports large text on narrow phones', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final config = MobileConfig.preview(clientId: '');
    await tester.pumpWidget(
      CompanionApp(
        config: config,
        locale: const Locale('es'),
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2)),
          child: ConnectScreen(config: config),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(find.text('Conectar con Savia'), 300);
    expect(find.text('Conectar con Savia'), findsOneWidget);
  });
}
