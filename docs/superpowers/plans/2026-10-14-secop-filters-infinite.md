# SECOP filters and infinite loading implementation plan

**Goal:** Make SECOP search filters immediately available and append remote results as the user scrolls in the existing shared-preview workspace.

**Architecture:** Keep the change inside the optional procurement plugin. A tested search feed owns pagination, request ordering, deduplication and retry state. React observes the feed and an implicit-root intersection sentinel requests the next page. Existing MCP inputs and permissions remain sufficient.

**Scope:** Keywords plus SECOP status, entity, procurement method and department. Filters stay visible, allow provider values and reset results when submitted. Show applied criteria, cumulative count, clear search, accessible manual load more, retained results on page errors, and an explicit end state. Interest editing and automatic monitoring remain unchanged.

- [x] Add feed behavior tests first: filtered paging, concurrent load protection, stale responses, retries, duplicate rows and exhaustion.
- [x] Implement the feed and connect it to the search screen; add visible filter suggestions and automatic loading with manual fallback.
- [x] Update the guide, bump plugin version, run plugin tests and typecheck, and build the tenant ZIP.
- [x] Review the diff and update the installed plugin in shared Savia preview tenant 12; verify filters and appended results in the user's Chrome session.

## Verification evidence

- Package tests: 3 files, 21 tests passed; package typecheck and formatting passed.
- Tenant ZIP 1.2.0 uploaded and activated in shared preview workspace 12.
- Chrome: software + Publicado returned 20 rows; scrolling appended another 20.
- Adding Caldas restarted the list at 20 rows, all with department Caldas.
- Clearing the search emptied the input criteria.
- The installed screen uses host scrolling and a content-height iframe. The
  implicit observer root follows the top-level viewport, as defined by the
  [Intersection Observer specification](https://www.w3.org/TR/intersection-observer/).
  Live verification confirmed that a tall iframe did not trigger eager loading.
