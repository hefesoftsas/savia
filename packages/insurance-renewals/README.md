# insurance-renewals

Optional trusted Savia extension. See [the operations guide](../../docs/insurance-operations.md)
for installation, workflows, persistence, limits and release packaging.

## Recurring policy terms and historical preview

Prepare the **Póliza → renovación** automation before historical recovery. Its unique `term_key` combines the native policy id and expiration date, so a later term creates a separate case and repeated events never replace manual work. The worklist's preview scans native policies and customers in the current workspace, skips ineligible and existing terms (including legacy linked cases), and shows contact dates before the user creates records. Execution rechecks source versions and stops on changes or uniqueness conflicts; regenerate the preview after a partial run. Advance days are explicit (0–365; default 30). Automatic follow-up uses a durable delay 30 days before expiry and rechecks that the case is still open.

Migration preserves legacy `source_policy_id` constraints. New cases use `term_policy_id`; preview and automation recognize matching legacy cases so adopting the new template does not recreate the current term.
