# Savia Flows

Savia's visual automation module, based on Dafthunk commit
`66be3083dc6c5349e150de5c9631477942399896`. The editor, API, runtime,
templates, resource management and tests live in this separate monorepo project.
Savia supplies the session, tenant, permissions and visual theme.

The first edition runs entirely in local Miniflare. It does not provision
Cloudflare resources, deploy Workers, connect provider accounts or call billable
services. Worker egress is denied, including loopback fetches. JavaScript runs
in a fresh bounded QuickJS guest through the private local executor Worker; the
guest has no network access or application bindings.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **Savia Flows** in the Savia sidebar and select a tenant. The private
module Worker listens on `127.0.0.1:8796`; it requires Savia's signed backend
context for management requests. The application is served at `/flows-ui/`.

```sh
pnpm flows:build       # local API dry-run bundle and editor build
pnpm flows:dev         # local Miniflare, migrations and scheduler
pnpm flows:test        # runtime, API, editor and local persistence suites
pnpm flows:typecheck
pnpm flows:verify      # pinned node catalog and MIT notice integrity
```

Local data and automatically generated local keys are under `.wrangler/`.
Keep `local-secrets.json` together with the corresponding local state when
backing it up: it contains the encryption and form-signing keys. Neither file
is committed. `pnpm dev` connects the module through the local dev registry;
`SAVIA_FLOWS_ENABLED=0` omits the module from that stack.

See [the module guide](../../docs/guides/savia-flows.md) for capabilities,
permissions, local operations and verification limits. Source provenance and
the complete imported inventory are in [UPSTREAM.json](UPSTREAM.json) and
[parity.json](parity.json). The original MIT notice is preserved in
[LICENSE.dafthunk](LICENSE.dafthunk). [README.upstream.md](README.upstream.md)
is retained historical source documentation; use this README for Savia setup.
