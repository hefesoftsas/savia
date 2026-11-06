import 'package:flutter/foundation.dart';

import '../config.dart';
import 'oauth_adapter.dart';
import 'secure_session_store.dart';

typedef SessionDiscovery = Future<CompanionSession> Function(
  String accessToken,
);

class Workspace {
  const Workspace({required this.id, required this.name, required this.slug});

  final int id;
  final String name;
  final String slug;

  @override
  bool operator ==(Object other) =>
      other is Workspace &&
      other.id == id &&
      other.name == name &&
      other.slug == slug;

  @override
  int get hashCode => Object.hash(id, name, slug);
}

class CompanionSession {
  const CompanionSession({
    required this.subject,
    required this.displayName,
    required this.workspaces,
    required this.grantedRecordingScopes,
  });

  final String subject;
  final String displayName;
  final List<Workspace> workspaces;
  final Set<String> grantedRecordingScopes;
}

class SignOutOutcome {
  const SignOutOutcome({
    required this.revocationWarning,
    required this.localClearSucceeded,
  });

  final bool revocationWarning;
  final bool localClearSucceeded;
}

class SessionRequired implements Exception {
  const SessionRequired();

  @override
  String toString() => 'SessionRequired: Sign in again to continue.';
}

class SessionFailure implements Exception {
  const SessionFailure(this.message);

  final String message;

  @override
  String toString() => 'SessionFailure: $message';
}

/// Coordinates an in-memory access token with a refresh-only secure store.
/// Every asynchronous session operation carries a generation so work started
/// before sign-out or a workspace switch cannot restore stale state.
class SessionController extends ChangeNotifier {
  SessionController({
    required this.config,
    required this.oauth,
    required this.store,
    required this.discover,
    DateTime Function()? now,
    this.refreshLeeway = const Duration(seconds: 60),
  }) : _now = now ?? DateTime.now;

  final MobileConfig config;
  final OAuthAdapter oauth;
  final SecureSessionStore store;
  final SessionDiscovery discover;
  final DateTime Function() _now;
  final Duration refreshLeeway;

  int _generation = 0;
  int _credentialGeneration = 0;
  int get generation => _generation;

  CompanionSession? _session;
  CompanionSession? get session => _session;

  Workspace? _selectedWorkspace;
  Workspace? get selectedWorkspace => _selectedWorkspace;

  String? _accessToken;
  DateTime? _expiresAt;
  String? _refreshToken;
  Future<String>? _refreshInFlight;
  Future<void>? _restoreInFlight;
  bool _canRestore = false;
  bool get canRestore => _canRestore;
  Future<void> _storageTail = Future<void>.value();

  Future<void> signIn() async {
    _restoreInFlight = null;
    _generation++;
    final operationGeneration = ++_credentialGeneration;
    _clearMemory();
    notifyListeners();
    TokenSet? result;
    try {
      result = await oauth.authorize();
    } on OAuthFailure {
      rethrow;
    } catch (_) {
      throw const OAuthFailure('Sign in could not be completed.');
    }
    if (result == null || operationGeneration != _credentialGeneration) return;
    final refreshToken = result.refreshToken;
    if (result.accessToken.isEmpty ||
        refreshToken == null ||
        refreshToken.isEmpty) {
      throw const SessionFailure(
        'The identity provider did not grant an offline session.',
      );
    }

    _refreshToken = refreshToken;
    _canRestore = true;
    try {
      await _queueStore(() {
        if (operationGeneration != _credentialGeneration) {
          return Future<void>.value();
        }
        return store.write(
          StoredSession(
            refreshToken: refreshToken,
            issuer: config.issuer.toString(),
            clientId: config.clientId,
          ),
        );
      });
    } catch (_) {
      throw const SessionFailure('Session could not be saved securely.');
    }
    if (operationGeneration != _credentialGeneration) return;
    final discovered = await _discoverSafely(result.accessToken);
    if (operationGeneration != _credentialGeneration) return;
    _accessToken = result.accessToken;
    _expiresAt = result.expiresAt;
    _refreshToken = refreshToken;
    _canRestore = true;
    _session = discovered;
    notifyListeners();
  }

  Future<void> restore() {
    if (_session != null) return accessToken().then((_) {});
    final existing = _restoreInFlight;
    if (existing != null) return existing;
    final operation = _restoreSavedSession();
    late final Future<void> pending;
    pending = operation.whenComplete(() {
      if (identical(_restoreInFlight, pending)) _restoreInFlight = null;
    });
    _restoreInFlight = pending;
    return pending;
  }

  Future<void> _restoreSavedSession() async {
    // Prefer a rotation retained in memory when a secure-storage write failed.
    final retainedRefresh = _refreshToken;
    _generation++;
    final operationGeneration = ++_credentialGeneration;
    _clearMemory();
    notifyListeners();
    StoredSession? stored;
    try {
      stored = retainedRefresh == null
          ? await store.read()
          : StoredSession(
              refreshToken: retainedRefresh,
              issuer: config.issuer.toString(),
              clientId: config.clientId,
            );
    } catch (_) {
      if (operationGeneration == _credentialGeneration) _canRestore = true;
      throw const SessionFailure('Saved session could not be read.');
    }
    if (operationGeneration != _credentialGeneration) return;
    if (stored == null) return;
    if (stored.issuer != config.issuer.toString() ||
        stored.clientId != config.clientId) {
      try {
        await _queueStore(store.clear);
      } catch (_) {
        throw const SessionFailure(
          'Saved session could not be cleared securely.',
        );
      }
      return;
    }
    _refreshToken = stored.refreshToken;
    _canRestore = true;
    try {
      final tokenSet = await oauth.refresh(stored.refreshToken);
      if (operationGeneration != _credentialGeneration) return;
      if (tokenSet.accessToken.isEmpty) {
        throw const SessionFailure(
          'Session renewal is temporarily unavailable.',
        );
      }
      final rotatedRefresh = tokenSet.refreshToken ?? stored.refreshToken;
      _refreshToken = rotatedRefresh;
      // Persist rotation before discovery: a network failure must never leave
      // the revoked predecessor as the only credential available on restart.
      await _queueStore(() {
        if (operationGeneration != _credentialGeneration) {
          return Future<void>.value();
        }
        return store.write(
          StoredSession(
            refreshToken: rotatedRefresh,
            issuer: config.issuer.toString(),
            clientId: config.clientId,
          ),
        );
      });
      if (operationGeneration != _credentialGeneration) return;
      final discovered = await _discoverSafely(tokenSet.accessToken);
      if (operationGeneration != _credentialGeneration) return;
      _accessToken = tokenSet.accessToken;
      _expiresAt = tokenSet.expiresAt;
      _session = discovered;
      notifyListeners();
    } on OAuthFailure catch (error) {
      if (error.requiresSignIn) {
        await _invalidateSession(operationGeneration);
        throw const SessionRequired();
      }
      throw const SessionFailure('Session renewal is temporarily unavailable.');
    } catch (_) {
      throw const SessionFailure('Session renewal is temporarily unavailable.');
    }
  }

  Future<void> _invalidateSession(int operationGeneration) async {
    if (operationGeneration != _credentialGeneration) return;
    _generation++;
    _credentialGeneration++;
    _clearMemory();
    notifyListeners();
    await _clearStoreSafely();
  }

  Future<String> accessToken() async {
    final token = _accessToken;
    final expiry = _expiresAt;
    if (token == null || _session == null) throw const SessionRequired();
    if (expiry == null || expiry.isAfter(_now().add(refreshLeeway))) {
      return token;
    }
    final existing = _refreshInFlight;
    if (existing != null) return existing;
    final refresh = _refreshCurrentSession();
    _refreshInFlight = refresh;
    try {
      return await refresh;
    } finally {
      if (identical(_refreshInFlight, refresh)) _refreshInFlight = null;
    }
  }

  Future<String> _refreshCurrentSession() async {
    final operationGeneration = _credentialGeneration;
    final oldRefreshToken = _refreshToken;
    if (oldRefreshToken == null) throw const SessionRequired();
    try {
      final tokenSet = await oauth.refresh(oldRefreshToken);
      if (operationGeneration != _credentialGeneration || _session == null) {
        throw const SessionRequired();
      }
      if (tokenSet.accessToken.isEmpty) {
        throw const SessionFailure(
          'Session renewal is temporarily unavailable.',
        );
      }
      final rotatedRefresh = tokenSet.refreshToken ?? oldRefreshToken;
      _refreshToken = rotatedRefresh;
      await _queueStore(() {
        if (operationGeneration != _credentialGeneration) {
          return Future<void>.value();
        }
        return store.write(
          StoredSession(
            refreshToken: rotatedRefresh,
            issuer: config.issuer.toString(),
            clientId: config.clientId,
          ),
        );
      });
      if (operationGeneration != _credentialGeneration || _session == null) {
        throw const SessionRequired();
      }
      _accessToken = tokenSet.accessToken;
      _expiresAt = tokenSet.expiresAt;
      _refreshToken = rotatedRefresh;
      notifyListeners();
      return tokenSet.accessToken;
    } on SessionRequired {
      rethrow;
    } on OAuthFailure catch (error) {
      if (error.requiresSignIn) {
        await _invalidateSession(operationGeneration);
        throw const SessionRequired();
      }
      throw const SessionFailure('Session renewal is temporarily unavailable.');
    } catch (_) {
      throw const SessionFailure('Session renewal is temporarily unavailable.');
    }
  }

  Future<void> setWorkspace(Workspace workspace) async {
    if (_session == null || !_session!.workspaces.contains(workspace)) {
      throw const SessionFailure(
        'Choose a workspace available to this account.',
      );
    }
    if (_selectedWorkspace == workspace) return;
    _selectedWorkspace = workspace;
    _generation++;
    notifyListeners();
  }

  Future<SignOutOutcome> signOut() async {
    _restoreInFlight = null;
    final refreshToken = _refreshToken;
    _generation++;
    _credentialGeneration++;
    _clearMemory();
    notifyListeners();
    var revocationWarning = false;
    var localClearSucceeded = true;
    try {
      await _queueStore(store.clear);
    } catch (_) {
      localClearSucceeded = false;
      revocationWarning = true;
    }
    if (refreshToken != null) {
      try {
        await oauth.revoke(refreshToken);
      } catch (_) {
        revocationWarning = true;
      }
    }
    return SignOutOutcome(
      revocationWarning: revocationWarning,
      localClearSucceeded: localClearSucceeded,
    );
  }

  Future<CompanionSession> _discoverSafely(String token) async {
    try {
      return await discover(token);
    } catch (_) {
      throw const SessionFailure('Savia account details are unavailable.');
    }
  }

  Future<void> _queueStore(Future<void> Function() action) {
    final operation = _storageTail.then((_) => action());
    _storageTail = operation.catchError((Object _) {});
    return operation;
  }

  Future<void> _clearStoreSafely() async {
    try {
      await _queueStore(store.clear);
    } catch (_) {
      // Keep credential storage failures out of session diagnostics.
    }
  }

  void _clearMemory() {
    _canRestore = false;
    _session = null;
    _selectedWorkspace = null;
    _accessToken = null;
    _expiresAt = null;
    _refreshToken = null;
    _refreshInFlight = null;
  }

  @override
  void dispose() {
    _restoreInFlight = null;
    _generation++;
    _credentialGeneration++;
    _clearMemory();
    super.dispose();
  }
}
