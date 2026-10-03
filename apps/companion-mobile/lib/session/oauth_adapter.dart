import 'package:dio/dio.dart';
import 'package:flutter_appauth/flutter_appauth.dart';

import '../config.dart';

/// Access credentials are memory-only; the refresh credential is persisted
/// separately by [SecureSessionStore].
class TokenSet {
  const TokenSet({
    required this.accessToken,
    required this.expiresAt,
    required this.refreshToken,
  });

  final String accessToken;
  final DateTime? expiresAt;
  final String? refreshToken;

  @override
  String toString() =>
      'TokenSet(expiry: $expiresAt, hasRefreshToken: ${refreshToken != null})';
}

abstract interface class OAuthAdapter {
  Future<TokenSet?> authorize();
  Future<TokenSet> refresh(String refreshToken);
  Future<void> revoke(String refreshToken);
}

/// AppAuth-backed system browser OAuth with PKCE and standards-based token
/// exchange. AppAuth owns state, nonce, verifier and callback validation.
class AppAuthOAuthAdapter implements OAuthAdapter {
  AppAuthOAuthAdapter({
    required this.config,
    FlutterAppAuth? appAuth,
    Dio? revocationClient,
  }) : _appAuth = appAuth ?? const FlutterAppAuth(),
       _revocationClient =
           revocationClient ??
           Dio(BaseOptions(connectTimeout: const Duration(seconds: 10)));

  final MobileConfig config;
  final FlutterAppAuth _appAuth;
  final Dio _revocationClient;

  @override
  Future<TokenSet?> authorize() async {
    _validateConfiguration();
    try {
      final response = await _appAuth.authorizeAndExchangeCode(
        AuthorizationTokenRequest(
          config.clientId,
          config.redirectUri.toString(),
          issuer: config.issuer.toString(),
          scopes: config.scopes,
          additionalParameters: {'resource': config.apiOrigin.toString()},
          externalUserAgent: ExternalUserAgent.asWebAuthenticationSession,
        ),
      );
      return _toTokenSet(response);
    } on FlutterAppAuthUserCancelledException {
      return null;
    } catch (_) {
      throw const OAuthFailure('Sign in could not be completed.');
    }
  }

  @override
  Future<TokenSet> refresh(String refreshToken) async {
    _validateConfiguration();
    try {
      final response = await _appAuth.token(
        TokenRequest(
          config.clientId,
          config.redirectUri.toString(),
          issuer: config.issuer.toString(),
          scopes: config.scopes,
          refreshToken: refreshToken,
          additionalParameters: {'resource': config.apiOrigin.toString()},
        ),
      );
      return _toTokenSet(response);
    } catch (_) {
      throw const OAuthFailure('Your session expired. Sign in again.');
    }
  }

  @override
  Future<void> revoke(String refreshToken) async {
    _validateConfiguration();
    final issuerPath = config.issuer.path.replaceFirst(RegExp(r'/$'), '');
    final endpoint = config.issuer.replace(path: '$issuerPath/oauth2/revoke');
    if (endpoint.origin != config.apiOrigin.origin ||
        endpoint.scheme != 'https') {
      throw const OAuthFailure('Session revocation is unavailable.');
    }
    try {
      await _revocationClient.post<void>(
        endpoint.toString(),
        data: <String, String>{
          'token': refreshToken,
          'token_type_hint': 'refresh_token',
          'client_id': config.clientId,
        },
        options: Options(
          sendTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
          contentType: Headers.formUrlEncodedContentType,
          followRedirects: false,
          maxRedirects: 0,
          validateStatus: (status) =>
              status != null && status >= 200 && status < 300,
        ),
      );
    } catch (_) {
      throw const OAuthFailure('The server could not revoke your session.');
    }
  }

  void _validateConfiguration() {
    final issuer = config.issuer;
    final redirect = config.redirectUri;
    if (!config.isConfigured ||
        issuer.scheme != 'https' ||
        issuer.origin != config.apiOrigin.origin ||
        redirect.scheme != 'com.hefesoft.savia.companion.preview' ||
        redirect.host.isNotEmpty ||
        redirect.path != '/oauth/callback' ||
        redirect.hasQuery ||
        redirect.hasFragment) {
      throw const OAuthFailure('Mobile sign in is not configured safely.');
    }
  }

  TokenSet _toTokenSet(TokenResponse response) {
    final accessToken = response.accessToken;
    if (accessToken == null || accessToken.isEmpty) {
      throw const OAuthFailure(
        'The identity provider returned an invalid session.',
      );
    }
    return TokenSet(
      accessToken: accessToken,
      expiresAt: response.accessTokenExpirationDateTime,
      refreshToken: response.refreshToken,
    );
  }
}

class OAuthFailure implements Exception {
  const OAuthFailure(this.message);

  final String message;

  @override
  String toString() => 'OAuthFailure: $message';
}
