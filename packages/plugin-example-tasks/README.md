# Example Tasks

Run from the repository root:

```sh
pnpm install
pnpm dev
# In a second terminal:
pnpm plugin:dev packages/plugin-example-tasks --tenant 0
pnpm --filter @savia/plugin-example-tasks test
pnpm --filter @savia/plugin-example-tasks typecheck
```

The development command targets local tenants only, installs immutable build versions,
and refreshes the plugin inside Savia after successful builds, preserving the current route. Unsaved plugin forms reset when the plugin remounts.
Production packaging: `pnpm store:pack packages/plugin-example-tasks`.
See [Plugin development](../../docs/guides/plugin-development.md).
