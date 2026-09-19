# Low-code fields

The screen designer exposes the existing text, contact, address, map, numeric,
currency, option, boolean, date, attachment and presentation controls. It also
provides **Date and time** (`DateTime`) and **Time** (`Time`) in the field palette
and type selector. These controls use the same registry in ordinary forms and
related-record forms.

## Temporal values

- `DateControl` stores a calendar date as `YYYY-MM-DD`. Tables and details format
  it without converting it to the viewer's time zone or changing its day.
- `DateTime` edits a date and time in the browser's local time zone. The backend
  requires an ISO timestamp with an explicit offset and normalizes it to UTC.
  Tables, details and conversation summaries display it in the viewer's local
  time zone. Defaults entered in the designer follow the same conversion.
- `Time` stores a minute-precision wall-clock time as `HH:mm`, without a date or
  time zone. It is suitable for recurring opening times, not an instant in time.
- Existing fields configured with `config.dateTime: true` retain their editor
  and are validated and displayed as timestamps. Date-only values supplied to
  those fields must be corrected to an explicit timestamp.

Impossible calendar dates, timezone-free timestamps, and invalid times are
rejected by the shared validation used in the backend. Both dedicated temporal
field types can be selected for record history. No database migration is needed;
values continue to use the collection's JSON record storage.

## Display consistency

Tables, record details and conversation summaries share field formatting for
calendar dates, timestamps, currencies, option labels, boolean values and map
locations. Empty values display an em dash in tables and details, while
conversation summaries retain their incomplete-answer indicator. Zero and false
remain visible values. Existing relation and attachment controls retain their
specialized displays. Currency formatting uses the configured currency and
precision, defaulting to COP and two decimals.

These additions do not add rich-text editing or multiple-choice fields. Existing
HTML presentation blocks are not editable rich-text data fields.
