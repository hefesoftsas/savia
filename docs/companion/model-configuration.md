# Meeting model configuration

Platform administrators manage defaults in **Keys and services → Platform
credentials → Meeting recordings**. Tenant administrators manage their tenant's
OpenRouter key, assistant model, transcription model and summary model in
**Keys and services → Services → Workspace credentials → OpenRouter**.
Select the workspace before editing. Administrators can manage only tenants
where they hold an active `tenant_admin` or `agency_admin` membership;
platform administrators retain access to platform defaults and all tenants.

The three model fields use the same searchable OpenRouter catalog, with names,
capabilities and estimated token prices. Transcription suggestions include dedicated speech-to-text models
(such as Whisper when returned by OpenRouter) and chat models accepting audio
input and producing text; summary suggestions produce text. Assistant suggestions
support tools. Transcription models do not need tool support. The catalog requests
both `text` and `transcription` output modalities. The catalog uses the saved
key for the selected tenant, falling back to the shared key when inherited.
If the catalog cannot load, the panel reports it and retains saved model IDs.
Model IDs are syntax-validated; provider availability and format support can
still vary by model.

- **Transcription model** uses OpenRouter's `audio/transcriptions` API with JSON
  `input_audio` for dedicated speech-to-text models, or `chat/completions` with
  an `input_audio` message for chat models. The selected route is saved with the
  model; both routes use the same effective OpenRouter key. A tenant override takes priority over the global choice,
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
and `0031_assistant_transcription_endpoint.sql` for SQLite/D1,
or the corresponding PostgreSQL migrations. This change does not enable Companion, publish
audio or start paid provider calls. Existing Whisper model IDs use the dedicated route when no route was saved;
other legacy IDs retain chat completions. Select a model from the catalog to save
its advertised route. Catalog availability does not verify Spanish quality,
accepted codecs, or provider limits; those require a controlled provider test.
