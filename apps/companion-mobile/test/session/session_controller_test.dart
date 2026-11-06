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
    'temporary refresh failure preserves session and retries the saved grant',
    () async {
      final oauth = FakeOAuthAdapter()..authorizeResult = expiredToken;
      final store = FakeSecureSessionStore();
      final session = controller(oauth: oauth, store: store);
      await session.signIn();
      await session.setWorkspace(
        const Workspace(id: 4, name: 'Operations', slug: 'ops'),
      );
      final generation = session.generation;
      oauth.refreshError = StateError('private provider response');

      await expectLater(session.accessToken(), throwsA(isA<SessionFailure>()));

      expect(session.session, isNotNull);
      expect(session.generation, generation);
      expect(session.selectedWorkspace?.id, 4);
      expect(store.value?.refreshToken, 'refresh-first-secret');
      oauth.refreshError = null;
      expect(await session.accessToken(), 'access-second-secret');
    },
  );

  test('offline restore preserves the grant across an app restart', () async {
    final oauth = FakeOAuthAdapter()
      ..refreshError = TimeoutException('offline');
    final store = FakeSecureSessionStore()
      ..value = StoredSession(
        refreshToken: 'saved-grant',
        issuer: config.issuer.toString(),
        clientId: config.clientId,
      );
    final session = controller(oauth: oauth, store: store);
    await expectLater(session.restore(), throwsA(isA<SessionFailure>()));
    expect(store.value?.refreshToken, 'saved-grant');
    final restarted = controller(store: store);
    await restarted.restore();
    expect(await restarted.accessToken(), 'access-second-secret');
  });

  test(
    'rotation is saved before discovery so a server failure is recoverable',
    () async {
      final store = FakeSecureSessionStore()
        ..value = StoredSession(
          refreshToken: 'saved-grant',
          issuer: config.issuer.toString(),
          clientId: config.clientId,
        );
      final session = controller(
        store: store,
        beforeDiscovery: () async {
          throw StateError('server unavailable');
        },
      );
      await expectLater(session.restore(), throwsA(isA<SessionFailure>()));
      expect(store.value?.refreshToken, 'refresh-rotated-secret');
      final oauth = FakeOAuthAdapter();
      await controller(store: store, oauth: oauth).restore();
      expect(oauth.refreshTokens, ['refresh-rotated-secret']);
    },
  );

  test(
    'restore during an active refresh shares the request and keeps workspace',
    () async {
      final oauth = FakeOAuthAdapter()..authorizeResult = expiredToken;
      final session = controller(oauth: oauth);
      await session.signIn();
      await session.setWorkspace(
        const Workspace(id: 4, name: 'Operations', slug: 'ops'),
      );
      oauth.refreshCompleter = Completer<TokenSet>();
      final refresh = session.accessToken();
      final restore = session.restore();
      await Future<void>.delayed(Duration.zero);
      expect(oauth.refreshCalls, 1);
      oauth.refreshCompleter!.complete(refreshedToken);
      await Future.wait([refresh, restore]);
      expect(session.selectedWorkspace?.id, 4);
    },
  );

  test('confirmed invalid grant clears revoked credentials', () async {
    final oauth = FakeOAuthAdapter()..authorizeResult = expiredToken;
    final store = FakeSecureSessionStore();
    final session = controller(oauth: oauth, store: store);
    await session.signIn();
    oauth.refreshError = const OAuthFailure('Revoked', requiresSignIn: true);
    await expectLater(session.accessToken(), throwsA(isA<SessionRequired>()));
    expect(session.session, isNull);
    expect(session.canRestore, isFalse);
    expect(store.value, isNull);
  });

  test('concurrent restores share one rotating refresh grant', () async {
    final oauth = FakeOAuthAdapter()..refreshCompleter = Completer<TokenSet>();
    final store = FakeSecureSessionStore()
      ..value = StoredSession(
        refreshToken: 'saved',
        issuer: config.issuer.toString(),
        clientId: config.clientId,
      );
    final session = controller(oauth: oauth, store: store);
    final one = session.restore();
    final two = session.restore();
    await Future<void>.delayed(Duration.zero);
    expect(oauth.refreshCalls, 1);
    oauth.refreshCompleter!.complete(refreshedToken);
    await Future.wait([one, two]);
    expect(session.session, isNotNull);
    expect(store.value?.refreshToken, 'refresh-rotated-secret');
  });

  test(
    'a failed secure write retains the rotated grant for explicit recovery',
    () async {
      final oauth = FakeOAuthAdapter()..authorizeResult = expiredToken;
      final store = FakeSecureSessionStore();
      final session = controller(oauth: oauth, store: store);
      await session.signIn();
      store.writeError = StateError('locked storage');
      await expectLater(session.accessToken(), throwsA(isA<SessionFailure>()));
      expect(session.session, isNotNull);
      expect(session.canRestore, isTrue);
      store.writeError = null;
      await session.accessToken();
      expect(oauth.refreshTokens, [
        'refresh-first-secret',
        'refresh-rotated-secret',
      ]);
      expect(store.value?.refreshToken, 'refresh-rotated-secret');
    },
  );

  test(
    'confirmed invalid grant during restore requires new authorization',
    () async {
      final store = FakeSecureSessionStore()
        ..value = StoredSession(
          refreshToken: 'revoked',
          issuer: config.issuer.toString(),
          clientId: config.clientId,
        );
      final oauth = FakeOAuthAdapter()
        ..refreshError = const OAuthFailure('Revoked', requiresSignIn: true);
      final session = controller(oauth: oauth, store: store);
      await expectLater(session.restore(), throwsA(isA<SessionRequired>()));
      expect(session.canRestore, isFalse);
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
  Object? writeError;
  @override
  Future<StoredSession?> read() async => value;
  @override
  Future<void> write(StoredSession session) async {
    if (writeError case final error?) throw error;
    value = session;
  }

  @override
  Future<void> clear() async => value = null;
}
