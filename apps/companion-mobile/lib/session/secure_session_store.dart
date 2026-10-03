import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StoredSession {
  const StoredSession({
    required this.refreshToken,
    required this.issuer,
    required this.clientId,
  });

  final String refreshToken;
  final String issuer;
  final String clientId;

  Map<String, Object?> toJson() => {
    'refreshToken': refreshToken,
    'issuer': issuer,
    'clientId': clientId,
  };

  static StoredSession? fromJson(Object? value) {
    if (value is! Map<String, dynamic>) return null;
    final refreshToken = value['refreshToken'];
    final issuer = value['issuer'];
    final clientId = value['clientId'];
    if (refreshToken is! String ||
        refreshToken.isEmpty ||
        issuer is! String ||
        clientId is! String ||
        clientId.isEmpty) {
      return null;
    }
    return StoredSession(
      refreshToken: refreshToken,
      issuer: issuer,
      clientId: clientId,
    );
  }

  @override
  String toString() => 'StoredSession(issuer: $issuer, clientId: $clientId)';
}

abstract interface class SecureSessionStore {
  Future<StoredSession?> read();
  Future<void> write(StoredSession session);
  Future<void> clear();
}

/// Stores only the rotated refresh credential and issuer/client binding in
/// native secure storage. Access tokens and workspace choice stay in memory.
class DeviceSecureSessionStore implements SecureSessionStore {
  DeviceSecureSessionStore({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(migrateWithBackup: false),
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.unlocked_this_device,
              synchronizable: false,
            ),
          );

  static const _key = 'companion.mobile.session.v1';
  final FlutterSecureStorage _storage;

  @override
  Future<StoredSession?> read() async {
    final serialized = await _storage.read(key: _key);
    if (serialized == null) return null;
    try {
      return StoredSession.fromJson(jsonDecode(serialized));
    } on FormatException {
      return null;
    }
  }

  @override
  Future<void> write(StoredSession session) =>
      _storage.write(key: _key, value: jsonEncode(session.toJson()));

  @override
  Future<void> clear() => _storage.delete(key: _key);
}
