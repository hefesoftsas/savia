# OpenRouter model configuration

Platform administrators manage defaults in **Keys and services → Platform
credentials → Meeting recordings**. Tenant administrators manage their tenant's
OpenRouter key, assistant model, transcription model, summary model, image-generation model and text-to-speech model in
**Keys and services → Services → Workspace credentials → OpenRouter**.
Select the workspace before editing. Administrators can manage only tenants
where they hold an active `tenant_admin` or `agency_admin` membership;
platform administrators retain access to platform defaults and all tenants.

The model fields use the same searchable OpenRouter catalog, with names,
capabilities and estimated token prices. Transcription suggestions include dedicated speech-to-text models
(such as Whisper when returned by OpenRouter) and chat models accepting audio
input and producing text; summary suggestions produce text. Assistant suggestions
support tools. Transcription models do not need tool support. The catalog requests
`text`, `transcription`, `image`, and `speech` output modalities and preserves all returned
models before filtering suggestions; popularity does not exclude lower-ranked
transcription models. The catalog uses the saved
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
  all model choices. Platform **Save models** updates the transcription,
  summary, image-generation, and text-to-speech choices.

Image generation and text-to-speech have independent selectors in the existing
OpenRouter settings panel, both globally and for each tenant. Blank tenant fields
inherit the corresponding platform choice. Blank platform fields leave that
operation unconfigured; the assistant model is not silently used for generation.
Suggestions include only models advertising the corresponding output capability.
Image generation is distinct from understanding received images: vision continues
to use the assistant or employee model. Transcription remains the model for
understanding received audio.

The generation selectors suggest inexpensive compatible models using catalog
prices with explicit billing units. Unknown or invalid prices do not count as
zero, and prices with different units are not treated as directly comparable.
Refresh the catalog to update suggestions; a refresh never replaces a saved
administrator selection. Recommendations describe published base rates, not a
quote for a particular resolution, duration, provider, or quality setting.

Saving these two generation model choices persists configuration only. It does
not synthesize speech, generate images, or enable automatic generated-media
replies in WhatsApp. Those provider and delivery adapters need a separate runtime
integration.

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
and `0042_assistant_generation_models.sql` for the generation selectors,
or the corresponding PostgreSQL migrations. This change does not enable Companion, publish
audio or start paid provider calls. Existing Whisper model IDs use the dedicated route when no route was saved;
other legacy IDs retain chat completions. Select a model from the catalog to save
its advertised route. Catalog availability does not verify Spanish quality,
accepted codecs, or provider limits; those require a controlled provider test.

Catalog capabilities and billing units follow OpenRouter's
[image-generation discovery](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
and [text-to-speech discovery](https://openrouter.ai/docs/guides/overview/multimodal/tts)
documentation. Pricing suggestions are refreshed from provider metadata rather
than pinned to a particular model ID.
