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

  for (final code in [
    'invalid_grant',
    'network_error',
    'temporarily_unavailable',
    'invalid_client',
  ]) {
    test('refresh classifies $code without leaking provider details', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            throw PlatformException(
              code: 'token_failed',
              message: 'private provider details',
              details: {'error': code, 'error_description': 'secret-value'},
            );
          });
      final adapter = AppAuthOAuthAdapter(
        config: MobileConfig.preview(clientId: 'public-client-id'),
      );
      await expectLater(
        adapter.refresh('refresh-token'),
        throwsA(
          isA<OAuthFailure>()
              .having(
                (error) => error.requiresSignIn,
                'requires sign in',
                code == 'invalid_grant',
              )
              .having(
                (error) => error.toString(),
                'safe message',
                isNot(contains('secret-value')),
              ),
        ),
      );
    });
  }

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
