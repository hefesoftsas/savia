import 'package:companion_mobile/config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('preview keeps issuer, callback and least-privilege scopes fixed', () {
    final config = MobileConfig.preview(clientId: 'public-id');
    expect(config.apiOrigin.toString(), 'https://savia-preview.hefesoft.com');
    expect(
      config.issuer.toString(),
      'https://savia-preview.hefesoft.com/api/auth',
    );
    expect(
      config.redirectUri.toString(),
      'com.hefesoft.savia.companion.preview:/oauth/callback',
    );
    expect(config.scopes, [
      'openid',
      'profile',
      'offline_access',
      'recordings:read',
      'recordings:upload',
      'recordings:process',
    ]);
    expect(MobileConfig.preview(clientId: '').isConfigured, isFalse);
  });
}
