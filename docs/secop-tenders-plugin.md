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

Only selected opportunities are copied into the local collection, including a
bounded source snapshot. All durable follow-up data uses the backend collections
API. Reloading does not depend on browser storage. Removing or disabling the
plugin keeps existing opportunity records. Search does not submit offers or
change procurement data at SECOP. Follow-up dates are recorded dates; this
version does not send scheduled reminders or automatically refresh source facts.

## Install

1. Deploy the host's read-only MCP sources and `mcp` plugin-action support, applying
   migration `0048_mcp_collection_sources.sql` before the API.
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
native record-version support. It declares one fixed read action and does not
contain a source URL, API key, OAuth token or secret. The action's source ID and
mapping are metadata; user input cannot select a different endpoint or tool.

## Preview

Use the documented [branch-preview workflow](runbooks/preview-environments.md) for
unreleased host changes. A branch preview has isolated databases, credentials and
its own Platform workspace. Do not directly replace the shared preview gateway
from an unrelated checkout. Preview installation and live verification must be
reported separately from unit tests and ZIP packaging.
