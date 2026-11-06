# Savia Companion mobile

Flutter preview for Android and iOS. The app captures foreground microphone audio,
imports local audio, uploads private recordings, and reviews server-backed notes
and grounded answers. Existing Tauri Companion desktop remains separate.

## Toolchain

Flutter **3.47.6**, Dart **3.13.5**; the committed `.fvmrc` and `pubspec.lock` pin
the toolchain and dependencies. Android uses JDK 17, SDK 36 and minimum API 24.
iOS targets 15.0 or later and requires full Xcode, not only Command Line Tools.

```sh
flutter pub get --enforce-lockfile
flutter gen-l10n
flutter analyze
flutter test
flutter run --dart-define=SAVIA_MOBILE_CLIENT_ID=<registered-public-client-id>
flutter build apk --debug --dart-define=SAVIA_MOBILE_CLIENT_ID=<registered-public-client-id>
flutter build ios --simulator --no-codesign --dart-define=SAVIA_MOBILE_CLIENT_ID=<registered-public-client-id>
```

The client ID is public. There is no client secret or AI provider key in the app.
A build without the ID displays a setup message and disables login. It is useful
for compilation validation, but is not an authenticated preview release.

See [mobile setup and validation](../../docs/companion/mobile.md) for OAuth
registration, evidence, synthetic smoke controls and device qualification.
