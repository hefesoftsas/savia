# Savia Companion downloads

The Integrations page lists the latest published Companion preview from the
public GitHub Releases API. Preview releases are created manually from the
repository's `main` branch by running the **Companion downloads** workflow in
GitHub Actions. A run publishes a new immutable `companion-preview-*` prerelease
only after Android, Windows x64 and macOS Apple silicon builds all succeed and
all three installers are present. A failed or incomplete run is not published.

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
unsigned and not notarized. Expect operating-system security warnings; use
organization-approved preview distribution and installation practices. Hardware and provider qualification remain separate release gates.

The desktop build targets Windows 11 x64 and macOS 14.2 or later on Apple silicon.
Native audio behavior, permissions, installer upgrades and signing have not been
qualified across supported hardware. See the [validation protocol](validation.md)
for the current product limits and device checks.
