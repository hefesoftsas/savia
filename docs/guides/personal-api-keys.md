# Personal API keys

Open **My account → API keys** to connect a personal desktop application to Savia.
Choose a name, an eligible workspace, permissions and a lifetime of 7, 30 or 90
days. The default is 30 days with recording read and upload permissions.

The secret appears once. Copy it into Companion's **Savia API key or access token**
field, then close the reveal panel. Savia stores only its digest; a lost secret
cannot be recovered. Create a replacement and revoke the old key to rotate it.
The list shows metadata, expiry and last successful use. Revocation takes effect
on the next request. Removing the user's active membership also disables access.

## Recording permissions

- `recordings:read`: list your permitted recordings and read audio and saved notes.
- `recordings:upload`: upload native samples or local audio files.
- `recordings:process`: transcribe, summarize and ask questions about a saved recording. Processing
  requires explicit consent and can generate provider charges.
- `recordings:delete`: remove a recording and its saved notes.

A key is personal, bound to one workspace and one deployment. Preview keys do not
work in production. It cannot administer accounts or keys, call unrelated APIs,
import audio from connected drives, or access another user's audio. There are no
wildcard permissions or service accounts in this version. A user can hold up to
20 active keys per deployment.

Older recordings without workspace metadata remain available to their owner in
the web app. Keys cannot access them; Savia does not guess their workspace.
Recordings uploaded with a key receive the key's workspace automatically.
Processing with a key uses that workspace's provider configuration, independently
of the workspace selected in the owner's browser.

## Companion

Use the same HTTPS origin for the API and application addresses when connecting
through the Savia gateway. For preview, use `https://savia-preview.hefesoft.com`.
Connect with read and upload permissions, record a sample, then explicitly upload
it. Open Savia with the same account to review and process it. Companion keeps its
credential in memory; closing the app requires reconnecting. The current native
capture duration and platform limitations in the Companion guide still apply.

The generated OpenAPI reference includes key management schemas. Secrets must
never be placed in URLs, frontend configuration, logs or screenshots.

## Questions about recordings

After generating a transcript, open the recording and enter a question. Each
question requires consent to send the saved transcript and question to OpenRouter.
Answers use the configured summary model and only the selected transcript. An
insufficient-evidence outcome means the recording does not support an answer.
Verify AI answers against the original audio; they can still be mistaken. Answers
are temporary, disappear when changing recordings, and create no business records.
No automatic retries are performed.

## Deployment binding

The backend derives the key deployment identifier from its configured canonical
`SAVIA_PUBLIC_ORIGIN`. Preview and production must have distinct origins. Without
that setting, remote key management and authentication are unavailable; explicit
loopback development origins remain supported. Changing the canonical origin
requires issuing replacement keys. Request Host values never select a remote
key deployment.
