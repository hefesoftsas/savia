# Tenant-configured WhatsApp human support

Tenant administrators can configure an optional human support phone number or HTTPS link in the existing WhatsApp task-menu settings. Persist the field in the existing tenant-scoped channel configuration in D1. Empty values retain the generic advisor message; never invent contact information or claim a handoff occurred.

1. Extend the strict channel configuration contract with a validated optional support contact, preserving existing saved configurations.
2. Add the input to the current administrator settings UI and round-trip it through the existing API.
3. Include current tenant support contact as bounded data in assistant context and use it in generation recovery replies. Preserve reply authorization and durable dispatch checks.
4. Verify validation, tenant isolation, persistence, UI reload/save, and error replies. Update the WhatsApp runbook.
5. Review and deploy to preview through the protected CI workflow. Preserve the prior quote recovery deployment while this addition is prepared.
