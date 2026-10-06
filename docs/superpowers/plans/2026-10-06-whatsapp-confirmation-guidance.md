# WhatsApp confirmation guidance and employee identity

Live evidence shows a contact wrote `Confirmar` without the server-issued text code. The pending action was never queued, but the message reached the model, which claimed a technical execution failure. Labeled assistant history also caused the virtual employee header to repeat.

Recognize confirmation intent before model completion. Preserve the requirement for the issued native button or contact-bound code: bare confirmations return clear server-authored instructions, valid text commands accept mixed case, and expired previews require renewal. Normalize only exact leading copies of the selected employee's identity in history and outgoing text/captions, then add one server-owned header. Preserve payload encryption, action authorization and confirmation-token redaction.

Reproduce both behaviors in tests, verify relevant WhatsApp suites and API types, review the combined changes, then deploy to preview through protected CI.
