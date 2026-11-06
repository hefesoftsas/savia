# Savia Flows live collection demonstration

Date: 2026-10-12. Local Admin at `http://127.0.0.1:5173`, Core at 8787,
Auth at 8788, and Flows Miniflare at 8796. The complete Savia application was
opened in the visible in-app browser. Authentication used the normal OAuth
and MFA paths of a fresh local test administrator. No external credentials,
delivery service or paid provider was activated.

## Demonstration

Two local collections were created through the normal Studio API in the
platform workspace: `flow_demo_requests` (Solicitudes Flows) and
`flow_demo_results` (Resultados Flows). A request was initially created with
`status = Pendiente`. At that point there were zero results and zero executions.

The durable graph **Procesar solicitud al cambiar su estado** has four nodes:
Savia Collection Event → JSON Extract Object → JSON Template → Savia Create
Record. Its enabled subscription watches updated request records, requires a
change to `status`, and requires the after value to equal `Listo`.

The source record was opened and edited in Savia's actual collection interface.
The **Guardar registro** action changed `Pendiente` to `Listo`; no manual Flow
execution action was used. Backend evidence then confirmed:

- Request `417c23b6-20f3-4e25-8e7f-6d1affb8c0ac` has `status = Listo` and version 2.
- Workflow `01a13129-66fd-71c4-b972-00685ac9b3b8` has exactly one completed run,
  `savia-e261748030d07ba6b6f646c12970c49563bb1a59`.
- All four node executions are completed.
- Result `0117efa2-4dc3-42c4-a8f5-80bfc77b6c9c` has title
  `Procesado: Solicitud de demostración`, status `Completado`, and count 1.

The result was displayed in Savia's Results collection after its local replica
synchronized. The completed execution and its detail graph were opened within
the embedded Flows module. Restarting only the local Flows process preserved
the completed execution and all four step details. The final visible tab was
left on the Flows executions screen with the **Completed** row.

## Issues exposed by the complete application

The previous browser fixture did not cover these two integration boundaries:

1. Vite's default proxy rewrote the Host header from Admin's port to Core's
   port. The strict socket-ticket CSRF check rejected the request, and ticket
   URLs would have used the API origin. The proxy now preserves the public Host,
   just as its isolated-preview configuration already did. A normal request
   now returns 201 with a `ws://127.0.0.1:5173` URL; a foreign Origin still
   returns 403 `CSRF_REJECTED`. CSRF validation was retained.
2. Collection admission uses deterministic `savia-` plus 40 hex characters to
   deduplicate events, while execution details accepted only UUIDs. Execution
   validation now accepts both supported identifier formats. The existing
   Miniflare collection integration was extended to open details for both
   Worker and durable collection executions; it first failed with HTTP 400
   and passed after the fix.

Focused Admin gateway/bridge tests passed (33 tests), Flows API type checking
passed, and the extended collection integration passed. The API dry-run bundle,
scoped formatting and indexed/working-tree diff checks passed. Source verification
still reports 1,897 imported files and 526 unchanged node implementations.
The concurrent local suite passed 12 tests; the editor-authorization test hit its
30-second deadline while the full development stack was also running. Its
isolated rerun passed in 3.7 seconds, including revocation of the next editor
command. No timeout was increased and no test was skipped to obtain that result.

Local proof artifacts: `/tmp/savia-flows-demo-proof.json`,
`/tmp/savia-flows-collection-result.png`, and
`/tmp/savia-flows-live-execution.png`. Test authentication material remains in
a mode-0600 temporary file and is not included in this report.
