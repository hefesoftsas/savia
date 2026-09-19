## Action payload validation

The shared gateway registers action-specific payload schemas in the extension runtime and validates them again before provider calls. Messages require a valid email, nonempty body, consent, and no suppression; calendar sync requires real ISO instants with an end after the start and a valid time zone; carrier requests require carrier/policy references; signature requests require document/file identifiers and a valid signer email. Adapter constructors can provide additional payload schemas. Invalid requests never contact the provider.
