# @savia/plugin-sdk

Small helpers for plugins that run against Savia's existing `PluginApi`. The
contract types are re-exported from `@savia/studio-shared`; this package does
not implement a second host API.

```ts
import { definePlugin, type PluginApi } from "@savia/plugin-sdk";

const plugin = definePlugin({
  render(element: HTMLElement, savia: PluginApi) {
    element.textContent = savia.i18n?.locale ?? "es";
    return () => {
      element.textContent = "";
    };
  },
  renderPanel(element, savia) {
    // Reusable editor mount.
    return () => {
      element.replaceChildren();
    };
  },
});

export const { render, renderPanel } = plugin;
```

Each renderer manages mounts by element: reusing an element cleans up its prior
mount, and each returned cleanup is idempotent. `renderPanel` cleanup is
separate from the normal `render` cleanup.

The optional `@savia/plugin-sdk/react` entry exports `defineReactPlugin`,
`useCollection`, and `useRecord`. React and React DOM are peer dependencies of
that entry. Hooks expose `{ data, loading, error, refresh }`; they do not cache
responses or infer whether any mutation was persisted locally or on the server.

The `@savia/plugin-sdk/testing` entry exports `createMockPluginApi`. It supports
in-memory collection listing, record reads and writes, schema descriptions,
version conflicts, denied operations, and offline failures. Unsupported API
areas such as settings, actions, connections, and services reject with an
explicit error instead of returning pretend data.

```tsx
import { defineReactPlugin, useCollection } from "@savia/plugin-sdk/react";
import type { PluginApi } from "@savia/plugin-sdk";

function TasksScreen({ savia }: { savia: PluginApi }) {
  const tasks = useCollection<{ id: string; title: string }>(savia, "tasks", {
    perPage: 50,
  });
  if (tasks.loading) return <p>Loading…</p>;
  if (tasks.error) return <p>Could not load tasks.</p>;
  return (
    <ul>
      {tasks.data?.data.map((task) => (
        <li key={task.id}>{task.title}</li>
      ))}
    </ul>
  );
}

const plugin = defineReactPlugin(TasksScreen);
export const { render, renderPanel } = plugin;
```
