# Verified web extensions in the plugin editor

The user approved extending the existing Savia plugin editor with verified VS Code web extensions, an installation/activation panel, and backend-connected project files. Keep preview compilation, source archives, immutable publication, search, and file navigation working.

## Runtime

Run a dedicated `monaco-vscode-api` editor in an iframe document bundled with the admin application. This isolates its VS Code services from the existing standalone Monaco used elsewhere. The parent owns project state, authentication, saves, preview, and publication. The child receives text files and editor settings, retains models/view state while switching files, and reports edits through a checked message protocol. It must not request API credentials or persist project data in browser storage.

## Verified catalog

Initially ship two reviewed Savia web extensions using the actual VS Code API: `savia.formatter` (Prettier document formatting for TS/JS/JSON/CSS/HTML) and `savia.react-snippets` (React/TSX snippets). These are editor extensions, distinct from publishable Savia plugins. Do not imply arbitrary Marketplace or Node extension compatibility. Pin runtime and extension dependencies. Installation means enabling a bundled verified extension in this project; removal disables its registrations. Show supported scope in the panel.

## Persistence and files

Store `editorExtensions` beside files/history in the existing versioned project API, with a paired D1/Postgres migration. Reject unknown or duplicate IDs. Existing projects default to no optional extensions. Keep settings outside published ZIPs. Mirror text files into a project filesystem for the extension API; route document edits back through existing archive/config authoring state. Never execute plugin source as extension code.

## Acceptance

Enable formatting, format a TSX document, preserve the edit when switching files, save/reload the project and restore extension selection. Disable the extension and remove its provider. Offer React snippets only when enabled. Verify project search jumps, code editing, preview compilation, and publication eligibility. Preserve read-only locks and useful loading/error states. Check responsive navigation. Deploy to preview through normal reviewed CI.
