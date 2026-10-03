import 'dart:async';

import 'package:companion_mobile/config.dart';
import 'package:companion_mobile/session/oauth_adapter.dart';
import 'package:companion_mobile/session/secure_session_store.dart';
import 'package:companion_mobile/session/session_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final config = MobileConfig.preview(clientId: 'mobile-public-client');
  final firstToken = TokenSet(
    accessToken: 'access-first-secret',
    expiresAt: DateTime.utc(2027),
    refreshToken: 'refresh-first-secret',
  );
  final refreshedToken = TokenSet(
    accessToken: 'access-second-secret',
    expiresAt: DateTime.utc(2027),
    refreshToken: 'refresh-rotated-secret',
  );
  final expiredToken = TokenSet(
    accessToken: 'access-expired-secret',
    expiresAt: DateTime.utc(2026, 10, 1),
    refreshToken: 'refresh-first-secret',
  );

  SessionController controller({
    FakeOAuthAdapter? oauth,
    FakeSecureSessionStore? store,
    Future<void> Function()? beforeDiscovery,
  }) {
    final adapter = oauth ?? (FakeOAuthAdapter()..authorizeResult = firstToken);
    final secureStore = store ?? FakeSecureSessionStore();
    return SessionController(
      config: config,
      oauth: adapter,
      store: secureStore,
      discover: (token) async {
        expect(token, isNotEmpty);
        await beforeDiscovery?.call();
        return const CompanionSession(
          subject: 'user-1',
          displayName: 'A Savia user',
          workspaces: [
            Workspace(id: 4, name: 'Operations', slug: 'ops'),
            Workspace(id: 5, name: 'Support', slug: 'support'),
          ],
          grantedRecordingScopes: {'recordings:read', 'recordings:upload'},
        );
      },
      now: () => DateTime.utc(2026, 10, 3),
      refreshLeeway: Duration.zero,
    );
  }

  test('cancelled browser login leaves the user signed out', () async {
    final oauth = FakeOAuthAdapter()..authorizeResult = null;
    final store = FakeSecureSessionStore();
    final session = controller(oauth: oauth, store: store);

    await session.signIn();

    expect(session.session, isNull);
    expect(oauth.refreshCalls, 0);
    expect(store.value, isNull);
  });

  test(
    'sign in persists only refresh credential and session identity',
    () async {
      final store = FakeSecureSessionStore();
      final session = controller(store: store);

      await session.signIn();

      expect(session.accessToken(), completion('access-first-secret'));
      expect(store.value?.refreshToken, 'refresh-first-secret');
      expect(store.value?.issuer, config.issuer.toString());
      expect(store.value?.clientId, config.clientId);
      expect(store.value.toString(), isNot(contains('access-first-secret')));
      expect(session.session?.displayName, 'A Savia user');
    },
  );

  test('concurrent callers share a single refresh request', () async {
    final oauth = FakeOAuthAdapter()..authorizeResult = expiredToken;
    final session = controller(oauth: oauth);
    await session.signIn();
    oauth.refreshCompleter = Completer<TokenSet>();

    final one = session.accessToken();
    final two = session.accessToken();
    await Future<void>.delayed(Duration.zero);
    expect(oauth.refreshCalls, 1);

    oauth.refreshCompleter!.complete(refreshedToken);
    expect(await Future.wait([one, two]), [
      'access-second-secret',
      'access-second-secret',
    ]);
    expect(oauth.refreshTokens, ['refresh-first-secret']);
  });

  test('workspace switch does not discard a refresh-token rotation', () async {
    final oauth = FakeOAuthAdapter()..authorizeResult = expiredToken;
    final store = FakeSecureSessionStore();
    final session = controller(oauth: oauth, store: store);
    await session.signIn();
    oauth.refreshCompleter = Completer<TokenSet>();

    final pendingToken = session.accessToken();
    await Future<void>.delayed(Duration.zero);
    await session.setWorkspace(
      const Workspace(id: 5, name: 'Support', slug: 'support'),
    );
    oauth.refreshCompleter!.complete(refreshedToken);

    expect(await pendingToken, 'access-second-secret');
    expect(store.value?.refreshToken, 'refresh-rotated-secret');
    expect(session.selectedWorkspace?.id, 5);
  });

  test('rotated refresh credential replaces the previous value', () async {
    final oauth = FakeOAuthAdapter()..authorizeResult = expiredToken;
    final store = FakeSecureSessionStore();
    final session = controller(oauth: oauth, store: store);
    await session.signIn();
    oauth.refreshResult = refreshedToken;

    await session.accessToken();

    expect(store.value?.refreshToken, 'refresh-rotated-secret');
    expect(store.value.toString(), isNot(contains('access-second-secret')));
  });

  test(
    'restore refreshes a stored grant and keeps access token out of storage',
    () async {
      final oauth = FakeOAuthAdapter()..refreshResult = refreshedToken;
      final store = FakeSecureSessionStore()
        ..value = StoredSession(
          refreshToken: 'refresh-before-restart',
          issuer: config.issuer.toString(),
          clientId: config.clientId,
        );
      final session = controller(oauth: oauth, store: store);

      await session.restore();

      expect(oauth.refreshTokens, ['refresh-before-restart']);
      expect(await session.accessToken(), 'access-second-secret');
      expect(store.value?.refreshToken, 'refresh-rotated-secret');
      expect(store.value.toString(), isNot(contains('access-second-secret')));
    },
  );

  test(
    'refresh failure clears local session and requires sign in again',
    () async {
      final oauth = FakeOAuthAdapter()..authorizeResult = expiredToken;
      final store = FakeSecureSessionStore();
      final session = controller(oauth: oauth, store: store);
      await session.signIn();
      oauth.refreshError = StateError('private provider response');

      await expectLater(session.accessToken(), throwsA(isA<SessionRequired>()));

      expect(session.session, isNull);
      expect(store.value, isNull);
    },
  );

  test(
    'sign out during refresh cannot restore credentials after completion',
    () async {
      final oauth = FakeOAuthAdapter()..authorizeResult = expiredToken;
      final store = FakeSecureSessionStore();
      final session = controller(oauth: oauth, store: store);
      await session.signIn();
      oauth.refreshCompleter = Completer<TokenSet>();

      final pending = session.accessToken();
      await Future<void>.delayed(Duration.zero);
      await session.signOut();
      oauth.refreshCompleter!.complete(refreshedToken);

      await expectLater(pending, throwsA(isA<SessionRequired>()));
      expect(session.session, isNull);
      expect(store.value, isNull);
    },
  );

  test(
    'workspace changes advance the generation and clear selection on sign out',
    () async {
      final session = controller();
      await session.signIn();
      final generation = session.generation;

      await session.setWorkspace(
        const Workspace(id: 4, name: 'Operations', slug: 'ops'),
      );

      expect(session.selectedWorkspace?.id, 4);
      expect(session.generation, generation + 1);
      await session.signOut();
      expect(session.selectedWorkspace, isNull);
    },
  );

  test(
    'sign out clears local credentials and reports failed server revocation',
    () async {
      final oauth = FakeOAuthAdapter()..authorizeResult = firstToken;
      final store = FakeSecureSessionStore();
      final session = controller(oauth: oauth, store: store);
      await session.signIn();
      oauth.revokeError = StateError('sensitive response');

      final outcome = await session.signOut();

      expect(outcome.revocationWarning, isTrue);
      expect(outcome.localClearSucceeded, isTrue);
      expect(store.value, isNull);
      expect(session.session, isNull);
    },
  );

  test('session error strings never include provider token details', () async {
    final oauth = FakeOAuthAdapter()
      ..authorizeError = StateError(firstToken.accessToken);
    final session = controller(oauth: oauth);

    Object? failure;
    try {
      await session.signIn();
    } catch (error) {
      failure = error;
    }
    expect(failure, isA<OAuthFailure>());
    expect(failure.toString(), isNot(contains(firstToken.accessToken)));
  });
}

class FakeOAuthAdapter implements OAuthAdapter {
  TokenSet? authorizeResult;
  Object? authorizeError;
  TokenSet? refreshResult;
  Object? refreshError;
  Object? revokeError;
  Completer<TokenSet>? refreshCompleter;
  int refreshCalls = 0;
  final List<String> refreshTokens = [];

  @override
  Future<TokenSet?> authorize() async {
    if (authorizeError case final error?) throw error;
    return authorizeResult;
  }

  @override
  Future<TokenSet> refresh(String refreshToken) async {
    refreshCalls++;
    refreshTokens.add(refreshToken);
    if (refreshError case final error?) throw error;
    if (refreshCompleter case final completer?) return completer.future;
    return refreshResult ?? refreshed;
  }

  @override
  Future<void> revoke(String refreshToken) async {
    if (revokeError case final error?) throw error;
  }
}

const refreshed = TokenSet(
  accessToken: 'access-second-secret',
  expiresAt: null,
  refreshToken: 'refresh-rotated-secret',
);

class FakeSecureSessionStore implements SecureSessionStore {
  StoredSession? value;
  @override
  Future<StoredSession?> read() async => value;
  @override
  Future<void> write(StoredSession session) async => value = session;
  @override
  Future<void> clear() async => value = null;
}
