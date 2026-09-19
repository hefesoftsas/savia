# Insurance customer portal

Authenticated customer policy consultation, request and claim-notice intake, response tracking, and native attachments. Register `manifest`, `requirement`, and `screens` exports.

Provision exact per-customer native ACL grants before use. The UI fails closed without `PluginApi.access.effective()` or if broader/missing grants are detected. There is no public token bypass and no browser-based authorization filter. Native backend ACL remains the security boundary. `PluginApi.files` enables native request attachments.

Read [the provisioning and operational guide](../../docs/insurance-customer-portal.md). Portal intake is separate from internal service/claim processing; advisors triage it with native collection tools. No external claim submission is performed.
