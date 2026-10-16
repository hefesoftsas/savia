# Assistant source and task actions

Approved scope: open an original cited PDF at its cited page and explicitly create a requirement task with an assignee and due date; release to Preview.

## Design

The generic host accepts optional provider source actions and task suggestions. Source links are resolved on demand by the authenticated SECOP provider, which authorizes the conversation and document against the bound owner and dossier and issues an expiring PDF ticket. The host validates HTTPS and opens the returned PDF fragment in a separate tab. No credential enters the browser.

Task suggestions are deterministic entries from the saved requirement ledger, not inferred company failures. A searchable requirement selector and explicit editable form collect title, responsible person and date. A generic host capability writes to the launcher's task collection through existing tenant-authenticated collection CRUD. Stable context/requirement keys prevent duplicates across retries and answer versions. The SECOP plugin declares and exposes its own task collection; no workflow-task schema or sector code enters platform core. No browser persistence is added.

## Implementation and checks

1. SECOP: test source resolution, owner/dossier isolation, tamper/expiry, PDF response and page; implement ticket route and structured requirement suggestions. Run backend tests/typecheck/bundle.
2. Shared/host: test validation of bounded suggestions/source responses and rejection of unsafe URLs. Add open-source request, optional task target and session-bound task creation; test task validation/deduplication/ACL transport errors.
3. UI/plugin: keep copy action left; add source action by citations and task action by assistant answers. Form validates responsible/date and never saves automatically. Test source retry, task selection/edit/save/errors and context changes. Plugin adds native records collection and localized fields.
4. Review combined changes, run focused tests/typechecks, publish SECOP and Savia Preview via existing release gates. Verify desktop/mobile source opening and explicit task form with Preview data; record any login or release blockers honestly.
