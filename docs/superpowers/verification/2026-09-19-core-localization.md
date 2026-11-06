# Core localization verification

Date: 2026-09-19. Branch: `codex/core-localization`.

## Reviewed requirements

- ES/EN/PT catalogs for the built-in core screens and shared UI controls.
- Localized field and option labels without changing stable values.
- Locale-aware formatting and built-in record validation.
- Language switching preserves unsaved forms, including focused currency input.
- Automated catalog and scoped source coverage checks in the admin test lane.
- Contributor and coverage documentation in `docs/localization.md`.

## Browser verification

A temporary local fixture rendered the actual DynamicForm with Currency,
MultiSelect, Rating and RichText fields. ES, EN and PT were inspected on desktop
and at 390 by 844 pixels. Controls remained usable without horizontal overflow.
Changing EN to PT preserved a typed draft and converted the amount display from
`2,345.67` to `2.345,67`; submitting preserved numeric `2345.67`, stable option
`ready`, rating `3` and user-authored text. The fixture and its server were removed.

## Regression evidence

- Full repository typecheck passed; final admin typecheck passed after shared UI changes.
- Localization primitives, catalog/source coverage, real CoreAdminContext mount
  preservation and locale parser: 23 tests passed before the final UI additions.
- Final currency/field regressions and widened source coverage: 7 tests passed.
- Shared dialog/pagination switching and widened source coverage: 4 tests passed.
- Shared metadata/record validation: 13 tests passed.
- Contract lane: 58 tests passed.
- Admin full run: 974 passed, 7 failed across three files under resource pressure.
  All three files passed on a serial rerun (50 tests), with unchanged timeouts.
  The previous run's seven locale-context/mock failures were corrected and also
  passed on focused reruns. Final coverage spans 182 files and 981 tests.
- Workspace lane: 756 passed, 37 skipped; command exited successfully.
- API full serial run: 475 passed, one 15-second timeout importing the real API
  shell in public forms. The isolated public-forms file then passed all 18 tests in 7.37 seconds,
  with the original 15-second timeout unchanged.

Independent review found and fixed hook placement, memo dependencies, stale
lookup warnings, accidental translation of locale identifiers and unsafe currency
symbol lookup. A new regression reproduced the nonstandard-currency crash before
the fallback fix and passed afterward.

The Impeccable detector found no issues in the shared dialog, pagination, sidebar
or option translation editor. Its only finding in the currency controls was an
existing 11px badge font size, unchanged from HEAD. No unrelated redesign was made.

## Limits

Coverage is scoped as described in `docs/localization.md`. External error text,
custom content and extension-owned UI require their own localization. Native
browser date/time controls can follow the operating system locale.
