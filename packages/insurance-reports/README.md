# Management reports and customer 360

Optional `insurance.reports` plugin. Reads the authorized installed worklists,
computes receivables in cents, retention from resolved renewal cases, sales wins
and collection-specific overdue commitments. A customer selector combines records
linked through native `customer_id` or policy `cliente` identifiers. Names are not
used as join keys.

The cut-off date classifies current deadlines; this is not a historical accounting
snapshot. Missing collections are omitted, failed reads are shown explicitly and
block export. Pagination is checked for repeated IDs and changing totals, with a
10,000-record bound per collection. Export escapes spreadsheet formulas.
