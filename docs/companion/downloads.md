# Savia Companion downloads

The Integrations page lists the latest published Companion preview from the
same-origin `/companion-downloads.json` endpoint. Savia fetches the public
GitHub Releases catalog on the server and caches it for ten minutes, so browser
visits do not consume users' shared GitHub API quota. Concurrent refreshes share
one in-flight request. Upstream redirects are rejected using the Workers-compatible
manual redirect mode; request credentials are never forwarded to GitHub. Preview
releases are created manually from the repository's `main` branch by running the **Companion downloads** workflow in
GitHub Actions. A run publishes a new immutable `companion-preview-*` prerelease
only after Android, Windows x64 and macOS Apple silicon builds all succeed and
all three installers are present. A failed or incomplete run is not published.

Native desktop bundles include platform icon assets generated from
`apps/admin/public/savia-icon-512-v3.png` with `tauri icon`: ICO for Windows,
ICNS for macOS, and PNG sizes for the application bundle.

The workflow requires the repository Actions variable
`SAVIA_MOBILE_CLIENT_ID`. Set it to the OAuth client ID used by the mobile app;
the workflow stops before compiling Android if the variable is missing. It is
not a secret and must not contain a client secret. Without this variable, the
Android job fails and no release is published. No provider API keys or other
runtime credentials are embedded in these downloads.

These are publicly downloadable preview artifacts, not qualified production releases. The
Android APK uses a generated debug signing key. Each workflow runner may use a
different key, so upgrades between previews are not guaranteed. A persistent
release signing key is required before offering a stable update channel. The Windows installer is unsigned. The macOS Apple silicon DMG is
signed and notarized only when Apple Developer ID secrets are configured; otherwise it is
unsigned and not notarized. Expect operating-system security warnings; use
organization-approved preview distribution and installation practices. Hardware and provider qualification remain separate release gates.

## macOS Gatekeeper and installer size

An unsigned preview DMG downloaded from the internet carries the quarantine
attribute, so macOS 14.2+ on Apple silicon reports
“Savia Companion is damaged and can’t be opened” instead of a normal
“unknown developer” warning. That message does not mean the DMG is corrupt.

Supported preview workaround:

1. Open the DMG and copy `Savia Companion` to `Applications`.
2. Control-click the app in `Applications`, choose `Open`, and confirm; or
   remove the quarantine flag and reopen it:

   ```sh
   xattr -cr "/Applications/Savia Companion.app"
   ```

To ship without this workaround, configure these repository secrets so the
**Companion downloads** workflow can sign and notarize the macOS job with
Tauri: `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`.
When `APPLE_SIGNING_IDENTITY` is absent the workflow still publishes the
unsigned preview and logs that Gatekeeper warnings are expected.

The macOS app declares the microphone entitlement in
`apps/companion/src-tauri/entitlements.plist`
(`com.apple.security.device.audio-input`), wired through
`bundle.macOS.entitlements` in `tauri.conf.json`.

Desktop installers are intentionally small (a few MB, for example about
3.4 MB for the macOS DMG and 2.6 MB for the Windows installer) because the
Tauri shell uses the system WebView and the release profile enables LTO plus
symbol stripping. The workflow rejects a DMG smaller than 1 MiB as a broken
frontend bundle, but a 3–5 MB DMG alone is not evidence of corruption.

The desktop build targets Windows 11 x64 and macOS 14.2 or later on Apple silicon.
Native audio behavior, permissions, installer upgrades and signing have not been
qualified across supported hardware. See the [validation protocol](validation.md)
for the current product limits and device checks.
