import 'package:companion_mobile/config.dart';
import 'package:companion_mobile/session/oauth_adapter.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('crossingthestreams.io/flutter_appauth');
  final calls = <MethodCall>[];

  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return <String, Object?>{
            'accessToken': 'access-token',
            'refreshToken': 'refresh-token',
          };
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test(
    'includes the API resource in AppAuth authorization and refresh requests',
    () async {
      final config = MobileConfig.preview(clientId: 'public-client-id');
      final adapter = AppAuthOAuthAdapter(config: config);
      final resource = config.apiOrigin.toString();

      await adapter.authorize();
      await adapter.refresh('refresh-token');

      expect(calls.map((call) => call.method), [
        'authorizeAndExchangeCode',
        'token',
      ]);
      expect(calls[0].arguments['additionalParameters'], {
        'resource': resource,
      });
      expect(calls[1].arguments['additionalParameters'], {
        'resource': resource,
      });
      expect(calls[1].arguments['refreshToken'], 'refresh-token');
    },
  );
}
