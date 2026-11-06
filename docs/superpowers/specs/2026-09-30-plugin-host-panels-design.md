# Host-managed plugin editor panels

## Purpose and approved direction

Long plugin forms must use the application viewport rather than the bounds of
the list iframe. Savia owns an accessible outer panel; a second isolated iframe
from the same plugin renders only the existing editor. The list remains mounted
so filters, pagination and scroll survive. No parent DOM access is granted.

## Scope

The shared `insurance-workbench` editor is used by 11 current plugins:
activities, collections, commissions, claims, compliance, issuance,
endorsements, documents, opportunities, service and renewals. Migrate all of
these through the shared Workbench entry point, including their payment and
attachment modes. Inspect shipped plugin entry points and published ZIPs as
part of release validation; source changes alone do not update installed ZIPs.

Other plugin implementations can opt into the same protocol. Arbitrary
third-party dialogs cannot be automatically extracted from an iframe. Existing
plugins without the capability continue to use their existing rendering path.

## Contract and rendering

- Extend PluginApi with an optional, typed `ui` capability: `openPanel`, editor
  context, close request handling, editor state reporting, and completion.
- Opening supplies an allowlisted editor view, a display title and a bounded
  JSON payload containing a record identifier and initial mode. Do not send
  React nodes, executable code, arbitrary URLs or tenant credentials.
- The host derives plugin identity, shell URL and tenant scope from the verified
  requesting frame. It creates a separate frame session and panel identifier.
- Bootstrap the panel frame using a host handshake. Its context identifies the
  editor view; the plugin's existing registered screen and Workbench select the
  editor-only path, reusing their existing localized configuration and fields.
- Existing records load by identifier using the authenticated collection API.
  Create mode uses existing defaults. Preserve server validation, permissions,
  record versions, payment rules and attachment behavior.
- Resolve the originating open request with `saved` or `cancelled`. Refresh the
  list only after successful save, retaining filters, page and scroll. A loading
  or save error stays visible in the panel without discarding input.

## Ownership and safety

Validate every message against its exact source window, namespace, session and
panel identifier. API requests retain the current host authorization path and
tenant checks. Never accept a plugin-supplied shell URL or tenant override.
Allow at most one panel per owning screen and reject nested panel requests.
Ignore stale responses after replacement, closure or identity changes.

Opening leaves the list iframe mounted. Closing disposes only the panel frame.
Session clearing, tenant changes and owner unmount invalidate both communication
contexts and dispose the panel. Do not persist draft form data in browser storage.

## Interaction and appearance

Use the existing Savia dialog primitives and design tokens. Render the panel in
the host overlay layer above navigation and the floating assistant. Use a wide
desktop panel with comfortable form width and the entire viewport on mobile.
The editor has no nested drawer, backdrop or second close button.

Keep the host title and close action visible. Keep editor Save and Cancel actions
visible at the bottom of the panel iframe, with only the field area scrolling.
Use one column at narrow widths and two columns where field types and space
permit. Preserve readable labels, inline errors and current localization.

Focus enters the editor after loading and returns to the originating action on
close. Modal interaction must include the host controls and iframe boundary;
Escape is coordinated across both documents. The background is inert.
Dirty close requests from Escape, backdrop, Cancel or the host close button show
a discard confirmation. A save in progress blocks ordinary closure. Do not
discard input silently on a loading timeout or frame error. An unresponsive
frame offers an explicit close/retry path with a data-loss notice.

## Verification and release

Test protocol source/session validation, stale messages, nested-open rejection,
identity changes, loading errors, dirty confirmation and save/cancel outcomes.
Test create, edit, record conflict, payment and attachments using the shared
editor. Verify every affected plugin exposes its editor through the shared path.

Inspect desktop and mobile in the browser: full host overlay coverage, visible
actions, scrolling, assistant overlap, keyboard focus through the iframe, and
return to the unchanged list. Run relevant package tests and type checks, then
the repository-required CI. Update the plugin development guide with the public
capability and compatibility behavior. Build and publish the affected plugin
artifacts through the repository release workflow and verify their installed
versions in preview together with the host deployment.

## Acceptance

Creating or editing a record in any of the 11 plugins opens its existing form in
a host-sized panel. Fields and actions remain usable on mobile and desktop;
save updates the list, cancel preserves list context, dirty input is protected,
and iframe isolation and tenant authorization remain intact.
