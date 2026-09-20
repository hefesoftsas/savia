# Core localization

## Approved intent

Make the built-in core interface usable in Spanish, English, and Portuguese.
Language switching must update interface copy and locale-sensitive display without
rewriting user content, identifiers, currency codes, or stored date/number values.

## Design

Keep the existing react-admin/Polyglot provider and locale preference. Add typed,
module-owned dictionaries for core UI copy. Components subscribe through the
existing locale context; pure formatters accept an explicit locale. Translate
accessible names, empty states, actions, validation messages, and option captions
as well as visible headings. Do not translate machine option values.

User field labels already have an ES/EN/PT metadata mechanism; preserve it and its
fallback to the original label. User-created options and records are not system
copy and must never be passed through the system dictionary by value.

## Verification and limits

Check dictionary key parity, nonempty values, and interpolation parity before
merging. Scan covered UI sources for untranslated JSX text and accessible/string
attributes. Exercise real locale switching, forms, permission controls, date and
number formatting. Document the precise scan scope and any exclusions; source
scanning does not prove semantic translation quality or third-party/server copy.
