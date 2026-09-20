# Core localization

Owner: Core UI team. Reviewed: 2026-09-19.

Savia supports Spanish (`es`, default), English (`en`) and Portuguese (`pt`) in
its built-in administration and low-code UI. The selected locale controls system
copy, accessibility labels, validation and presentation of record values.
Changing languages preserves mounted forms and unsaved edits.

## Coverage

Module catalogs cover permissions, roles, accounts, users, tenants, branding,
credentials, assistant settings, public forms, collection and field designers,
record lists and details, relationships, imports, workflows and integration
configuration. Shared navigation, dialogs, pagination and basic form controls
also use the selected language. Public forms have an independent language
selector and do not initialize the authenticated administration application.

The existing react-admin catalogs remain the source for standard admin actions.
New module catalogs live in `apps/admin/src/i18n/locales/`. Each message contains
Spanish, English and Portuguese entries in that order. `useMessages(catalog)`
provides typed lookup and `%{name}` interpolation. React renders the result as
text; interpolation does not interpret HTML or recursively replace values.

## Record labels and values

Fields and static options can define `labels.es`, `labels.en` and `labels.pt`.
The designer exposes these translations separately from the default label.
Missing translations fall back to the existing label. Translating an option
never changes its stored value. Custom view aliases and authored content are
preserved; they are not looked up in a global text replacement dictionary.

Formatting uses `es-CO`, `en-US` and `pt-BR`. Currency codes and precision come
from the field configuration. Dates, booleans and numeric displays follow the
active locale while serialized values remain unchanged. Native date/time picker
chrome may follow the browser or operating system language.

Currency editing accepts the selected locale's decimal and grouping separators.
It rejects malformed grouping rather than guessing a different numeric value.
An input focused before a language change finishes parsing with its original
editing locale, then displays the committed value in the new locale.

Shared record validation accepts an optional locale. UI callers supply it;
legacy API callers that omit it retain their previous messages. No storage
migration is required. This change uses the existing preference store and does
not introduce a new browser persistence layer.

## Contribution and regression contract

Add product copy to the owning catalog and call its translator in the component.
Use locale-aware formatters for values and stable identifiers for state and API
payloads. Never translate enum values, currency codes, JSON keys, provider IDs,
user-entered text or record values. Components consuming translations must
include their translator or locale in affected memo/effect dependencies.

The existing admin test lane runs `i18n/coverage.test.ts`. It checks that every
module message has three nonempty translations with matching interpolation
tokens. Its TypeScript AST scan rejects literal visible JSX text, accessibility
and presentation attributes, and direct conditional/template copy in the
explicit core directories listed in that test. Reviewed technical examples,
brands and translation keys have exact file/text exceptions with reasons in
`source-exceptions.json`.

This is a scoped regression contract, not proof of translation quality or a scan
of arbitrary runtime data. Dynamic object maps and server/provider error text
need normal review. Integration responses, custom HTML/React, extension screens,
JSON-schema diagnostics and user-authored content are not automatically
translated. Their owners must provide localized content when needed.

Tests also verify locale switching without remounting the real admin context,
field/option labels, validation, interpolation, currency parsing and preservation
of focused drafts. Browser verification should exercise all three languages,
small screens and saving an unchanged numeric value after a language switch.
