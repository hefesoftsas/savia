/// Public preview configuration. This flavor cannot select another server.
class MobileConfig {
  MobileConfig.preview({required this.clientId});
  final String clientId;
  Uri get apiOrigin => Uri.parse('https://savia-preview.hefesoft.com');
  Uri get issuer => apiOrigin.resolve('/api/auth');
  Uri get redirectUri =>
      Uri.parse('com.hefesoft.savia.companion.preview:/oauth/callback');
  List<String> get scopes => const [
    'openid',
    'profile',
    'offline_access',
    'recordings:read',
    'recordings:upload',
    'recordings:process',
  ];
  bool get isConfigured => clientId.trim().isNotEmpty;
}
