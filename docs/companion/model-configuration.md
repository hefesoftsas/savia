# Meeting model configuration

Platform administrators configure meeting models in **Keys and services →
Platform credentials → Meeting recordings**, immediately below OpenRouter. The
same entry is available in the global AI configuration page.

- **Transcription model** accepts an OpenRouter audio transcription model ID in
  `provider/model` format. Leaving it blank uses the deployment transcription
  default (`openai/whisper-large-v3` unless configured otherwise).
- **Summary model** accepts an OpenRouter text model ID. Leaving it blank uses
  the effective assistant model, including the active tenant's assistant override.
- **Save models** changes only these two model choices. The assistant key and chat
  model remain unchanged. Model IDs persist in the backend and return after reload.
  OpenRouter credentials remain encrypted on the server and are reused through
  the existing effective assistant configuration.

Meeting model choices are platform-wide. Tenant assistant settings can override
credentials and the fallback assistant model; they cannot override the meeting
model choices. Model IDs are syntax-validated, but compatibility with the
transcription or structured summary endpoint must be checked with the provider.
The assistant's tools-compatible chat catalog is not presented as an STT catalog.

The selected models apply to subsequent transcription and summary requests,
including processing a saved recording in Savia. Existing completed notes remain
cached: changing a model does not regenerate them or trigger a provider request.
A retained transcript is reused after a summary failure, so changing the STT model
also does not replace that already saved transcript automatically.

Existing installations must apply the target database migration before running
the updated API: `0014_assistant_meeting_models.sql` for SQLite/D1 or
`0014_assistant_meeting_models.sql` in the PostgreSQL manifest. Follow the normal
deployment migration procedure for the target runtime. This change does
not enable Companion, grant access, publish audio or start paid provider calls.
