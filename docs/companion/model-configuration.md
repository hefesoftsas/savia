# Meeting model configuration

Platform administrators manage defaults in **Keys and services → Platform
credentials → Meeting recordings**. Tenant administrators manage their tenant's
OpenRouter key, assistant model, transcription model and summary model in
**Keys and services → Services → Workspace credentials → OpenRouter**.
Select the workspace before editing. Administrators can manage only tenants
where they hold an active `tenant_admin` or `agency_admin` membership;
platform administrators retain access to platform defaults and all tenants.

The three model fields use the same searchable OpenRouter catalog, with names,
capabilities and estimated token prices. Transcription suggestions accept audio
input and produce text; summary suggestions produce text. Assistant suggestions
support tools. Audio models do not need tool support. The catalog uses the saved
key for the selected tenant, falling back to the shared key when inherited.
If the catalog cannot load, the panel reports it and retains saved model IDs.
Model IDs are syntax-validated; provider availability and format support can
still vary by model.

- **Transcription model** uses OpenRouter's `chat/completions` API with an
  `input_audio` message. A tenant override takes priority over the global choice,
  then the deployment default (`google/gemini-2.5-flash` unless configured otherwise).
- **Summary model** uses OpenRouter text generation. A tenant override takes
  priority over a global summary choice, then the tenant's effective assistant
  model.
- Blank model fields inherit these defaults. Tenant **Save** persists the key and
  all three model choices. Platform **Save models** updates only the transcription
  and summary choices.

The assistant and recordings share the effective OpenRouter key for the tenant.
Keys remain encrypted on the server; the browser receives their configured or
inherited state and can replace or clear them. Stored keys are never returned.

Selections apply to subsequent requests, including processing saved recordings
in Savia. Completed notes remain cached; changing models does not regenerate
notes or initiate a provider request. A retained transcript is reused after a
summary failure, so changing the transcription model does not replace that
already saved transcript automatically.

Existing installations require `0014_assistant_meeting_models.sql` for SQLite/D1
or the corresponding PostgreSQL manifest migration. No additional schema change
is required for tenant overrides. This change does not enable Companion, publish
audio or start paid provider calls. Existing transcription overrides must name an
OpenRouter model supporting audio input through chat completions; select a
compatible model if an installation previously used a Whisper endpoint ID.
