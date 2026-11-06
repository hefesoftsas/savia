# Documents and signatures

The optional `insurance.document-generation` extension provides reusable text
templates, persisted generated HTML artifacts, and signature requests through an
operator-configured integration. It does not imply a built-in signature provider
or a legal determination about any returned evidence.

## Templates and generated records

Create a template with a name and content. Variables use `{{variable_name}}` and
appear as individually labelled inputs. Template names and values are escaped in
the generated HTML; templates cannot execute scripts. Preview uses plain text.
Saving a selected template uses its record version so concurrent edits fail
instead of silently replacing another user's changes.

Generating a document first creates an authorized native record containing a
fixed copy of the rendered content in draft state. It then uploads `documento.html`
through the authenticated file API and marks the record generated only after
upload succeeds. If upload fails, the draft remains recoverable: reload records,
select it, and retry its attachment. If attachment succeeds but the record update
fails, inspect the associated files before retrying, as an additional file may be
created. There is no browser persistence.

Download retrieves the stored artifact through the authenticated host file API.
Print opens a sandboxed local frame without script permission and invokes the
browser print dialog, which can save a PDF. HTML is the stored canonical artifact;
PDF generation follows the user's browser print settings.

## Signature integration

Configure the encrypted endpoint/token connection and deployment origin allowlist
as described in [Insurance integrations](insurance-integrations.md). The adapter
must implement `request-signature` and `signature-status`, authorize the tenant and
principal, and resolve the supplied native document/file IDs through an authorized
server-side mechanism. Files are not published as unauthenticated URLs.

A request includes the document ID, file ID, recipient, and a stable operation key
based on the document record. The signer is persisted with optimistic version
checking before any request. A different signer requires a new document, preventing
an existing idempotency key from being reused for a different recipient. The
adapter must durably deduplicate signature requests. A status query includes the
original operation key and known reference; an unknown network outcome requires
reconciliation before retrying the same request.

The UI marks evidence received only when a delivered receipt includes both a
parseable `signedAt` timestamp and a safe HTTPS `evidenceUrl`. Accepted, pending,
or delivered receipts without both fields remain requested. Users must inspect
the evidence and provider's signature assurance; a delivery receipt alone is not
a signed document. Raw credentials and arbitrary provider response bodies are not
persisted. History remains in backend action runs.

If the host file API is unavailable, template editing remains available while
document generation is explicitly disabled.

## Canonical generated artifact

Generation saves the uploaded file ID and version with the generated status in one version-checked record update. Signature dispatch re-reads the document and resolves that exact file under the document's native attachment list; a missing file or changed file version blocks dispatch. It never uses whichever attachment happens to appear first. The adapter receives the canonical file ID and version and must verify both before consuming file content. Older generated records without an artifact pin must be regenerated as new documents before signing.

An upload followed by a failed record update leaves an unpinned attachment. Select the remaining draft and retry to upload and pin a new canonical artifact; inspect and remove the orphan separately with authorized native file tools. Draft retry does not adopt an arbitrary existing attachment. Switching document selection cancels stale attachment-list results.
