# Data quality and reporting

Owner: Savia maintainers. Last reviewed: 2026-09-19.

Install **Importación y calidad** to preview CSV imports against a native
collection's current metadata. Use exact field names as headers and choose an
existing unique field. The preview lists invalid rows and existing keys. Correct
invalid rows before importing. Each successful row is durable independently;
revalidate after a partial failure to skip records already created. The plugin
never silently merges duplicates, replaces records or clears a failed batch.

The duplicate review normalizes case and whitespace for human inspection. Import
identity uses the actual unique field value and the server's uniqueness rules.
Imports support scalar text, numeric, date and dropdown fields; configure complex
relations using the collection editor. Files are limited to 2 MB and 1,000 rows.

Install **Reportes y cliente 360** to view authorized current operational data.
Select a client to follow native linked policy and case records. The date selects
the overdue cut-off, not a historical snapshot. Missing and failed source data are
visible; a failed source blocks export rather than emitting an apparently complete
report. These reports are not an accounting ledger or regulatory submission.
