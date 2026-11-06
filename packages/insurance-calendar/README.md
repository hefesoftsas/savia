# Insurance calendar

The calendar uses local date/time controls and a selected IANA timezone (Bogotá by
default). The browser timezone does not determine the stored instant. Saving and
provider synchronization retain explicit UTC instants, and changing the display
zone preserves those instants.

`localToInstant` derives candidate offsets from `Intl.DateTimeFormat`, checks the
resulting wall time, and rejects nonexistent or repeated local times around DST
transitions with a recovery message. It does not silently choose one side of an
ambiguous hour. Existing explicitly stored instants render in their saved timezone
and remain unchanged when the user edits other event fields. ICS uses UTC.

Focused tests cover Bogotá conversion, a quarter-hour offset zone, invalid dates,
and both New York DST transitions, alongside persisted revision retry keys.
