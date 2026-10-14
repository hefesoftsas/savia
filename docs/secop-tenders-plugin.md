# SECOP tenders and opportunity tracking

`packages/plugin-secop-tenders` is the optional `procurement.secop` plugin. It is
published as a tenant ZIP; procurement behavior does not become platform core.

## Search and follow up

Open **SECOP tenders** in the installed workspace. Search submits your criteria to
`buscar_licitaciones` through the configured MCP connection. Optional filters are
entity, department, SECOP status and procurement method. Search buttons and Enter
in search inputs dispatch through React handlers, so searches work inside the
plugin sandbox without allowing native form submissions. Pages come from the
remote limit/offset inputs. Values absent from SECOP are shown as unavailable.

Choose **Track** on a result to save that selected row. **My interests** lists
persisted opportunities, with tracking status, priority, owner, next follow-up date
and notes. The same Socrata `:id` can be saved only once per workspace. Saving an
already followed row does not overwrite its existing follow-up information.
Updates use Savia record versions; conflicting changes are reported for review.
The sandbox preserves safe error status and code fields, so a concurrent change
reloads the current interest even when host localization services are absent.

Only selected opportunities are copied into the local collection, including a
bounded source snapshot. All durable follow-up data uses the backend collections
API. Reloading does not depend on browser storage. Removing or disabling the
plugin keeps existing opportunity records. Search does not submit offers or
change procurement data at SECOP.

## Automatic monitoring

Newly saved interests have **Automatic monitoring** enabled. The service checks
SECOP about once an hour while the plugin is installed and enabled, using the immutable
creator's own SECOP Live OAuth connection. Existing saved interests with a
creator are enrolled automatically. Each interest shows its latest SECOP status,
closing date, check time and a safe connection or check error. Change the checkbox
and select **Save tracking** to pause or resume an individual interest. Interests
whose local tracking status is **Awarded** or **Discarded** pause automatically.

Status changes and closing reminders appear in Savia's in-app notifications.
Reminders are sent at 168, 72 and 24 hours before the current deadline; only the
nearest applicable reminder is sent if a check happens late. Changing a deadline
starts a new reminder cycle. Offset-less SECOP timestamps use America/Bogota;
date-only deadlines mean the end of that date. Missing, invalid or expired
deadlines do not produce closing reminders. The local tracking status, assignee and notes remain
separate from the facts refreshed from SECOP. No email or external message is
sent. If the source connection needs authorization, the interest shows a
connection error and its creator must reconnect it in **Sources and collections**.

## Install

1. Deploy the host's read-only MCP sources and `mcp` plugin-action support, applying
   migrations `0048_mcp_collection_sources.sql` and
   `0049_plugin_record_monitors.sql` before the API. Configure the API scheduler
   with a one-minute cron; the monitor itself checks each interest hourly.
2. In the target workspace, create the **SECOP Live** MCP source with identifier
   `secop_live`, and complete OAuth for the user who will run searches. See
   [MCP collection sources](mcp-collection-sources.md). Source credentials remain
   principal-bound; other users need their own authorized source.
3. Build `pnpm store:pack packages/plugin-secop-tenders` and upload the resulting
   `procurement.secop` ZIP through **My plugins**. Install and activate it in the
   intended workspace. Uploading alone does not activate the plugin.
4. Search a live tender, save it intentionally, reload **My interests**, change its
   tracking fields, save, and reopen to verify backend persistence.

The plugin provisions `procurement_opportunities` with a unique `source_id` and
native record-version support. It declares two fixed read actions and does not
contain a source URL, API key, OAuth token or secret. The action's source ID and
mapping are metadata; user input cannot select a different endpoint or tool.

## Shared preview delivery

The user-facing preview is `https://savia-preview.hefesoft.com`. Host changes
reach it through a pull request into `main`, successful Savia CI, and the
**Deploy Savia preview** workflow. Preserve the current shared preview resources
and encryption keys; never replace that deployment with an older branch build.
After deployment, upload and install `procurement.secop` in the requested
workspace (for example tenant `12`). Its user must create or reconnect their own
`secop_live` OAuth source there. Installing in an isolated Platform workspace does
not deliver the plugin to an existing shared-preview workspace.

## Branch verification

Use the documented [branch-preview workflow](runbooks/preview-environments.md) for
unreleased host changes. A branch preview has isolated databases, credentials and
its own Platform workspace. Do not directly replace the shared preview gateway
from an unrelated checkout. Preview installation and live verification must be
reported separately from unit tests and ZIP packaging.
