# Data quality and import

Optional `insurance.data-quality` plugin. Select a native collection and a unique
field, load a CSV (up to 2 MB / 1,000 rows), validate, review duplicates and import
new rows. Headers are exact collection field names. Existing unique keys are
skipped; values are never merged or overwritten automatically.

Each row uses the ordinary authorized record API and its server-side unique
constraint. Import is not a multi-record transaction: partial failures are shown
and the persisted batch history records counts. Revalidate before retrying so
already-created rows are skipped. Unknown fields, unsupported complex types,
malformed dates, invalid numbers and unsafe integer values are rejected. Backend
validation remains authoritative for permissions, uniqueness and field rules.
