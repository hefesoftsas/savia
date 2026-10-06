import { describe, expect, it, vi } from "vitest";
import {
  createPluginAuthoringService,
  type AuthoringStreamEvent,
} from "../src/assistant/plugin-authoring";

const files = {
  "entry.tsx": "export function render(element, savia) { return () => {}; }",
  "savia-extension.json": JSON.stringify({
    format: "savia.extension",
    formatVersion: 1,
    id: "custom.demo",
    version: "1.0.0",
    label: "Demo",
    description: "Demo extension",
    requires: [],
    apiVersion: 1,
  }),
  "store.json": JSON.stringify({
    format: "savia.store",
    formatVersion: 1,
    actions: [],
    connectors: [],
    collections: [],
    bundles: [],
    widgets: [],
    screens: [],
  }),
  "preview.json": JSON.stringify({ collections: {}, settings: {} }),
};

function configuration() {
  return {
    assertTenantAdministrator: vi.fn(async () => undefined),
    effectiveConfigurationForTenant: vi.fn(async () => ({
      apiKey: "server-only-key",
      model: "selected/model",
    })),
    effectiveConfigurationForPlatformTenant: vi.fn(async () => ({
      apiKey: "server-only-key",
      model: "selected/model",
    })),
  };
}

function fakeStream(
  partials: unknown[],
  object: unknown,
  usage = { inputTokens: 12, outputTokens: 34 },
) {
  return {
    partialObjectStream: (async function* () {
      for (const partial of partials) yield partial;
    })(),
    object: Promise.resolve(object),
    usage: Promise.resolve(usage),
  };
}

async function run(input: {
  streamObject: unknown;
  prompt?: string;
  filesInput?: typeof files;
}) {
  const service = createPluginAuthoringService(configuration() as never, {
    streamObject: input.streamObject as never,
  });
  const prepared = await service.prepareStream({
    principalId: "author-1",
    tenantId: 4,
    prompt: input.prompt ?? "Add a dashboard",
    files: input.filesInput ?? files,
  });
  const events: AuthoringStreamEvent[] = [];
  await service.runStream(prepared, (event) => {
    events.push(event);
  });
  return events;
}

describe("plugin authoring stream", () => {
  it("streams message deltas, usage, and the validated result", async () => {
    const events = await run({
      streamObject: () =>
        fakeStream([{ message: "Updat" }, { message: "Updated the board" }], {
          message: "Updated the board",
          files,
        }),
    });

    expect(events).toEqual([
      { type: "message", delta: "Updat" },
      { type: "message", delta: "ed the board" },
      { type: "usage", input: 12, output: 34 },
      { type: "result", message: "Updated the board", files },
    ]);
  });

  it("repairs invalid files with a second streamed round", async () => {
    const invalidFiles = {
      ...files,
      "entry.tsx": "console.log('missing render export');",
    };
    const calls: unknown[] = [];
    const events = await run({
      streamObject: (options: { prompt: string }) => {
        calls.push(options.prompt);
        return calls.length === 1
          ? fakeStream([{ message: "First" }], {
              message: "First",
              files: invalidFiles,
            })
          : fakeStream([{ message: "Fixed" }], { message: "Fixed", files });
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("entry.tsx");
    expect(events.at(-1)).toEqual({
      type: "result",
      message: "Fixed",
      files,
    });
  });

  it("emits validation diagnostics as an error event when repair still fails", async () => {
    const invalidFiles = {
      ...files,
      "entry.tsx": "console.log('missing render export');",
    };
    const events = await run({
      streamObject: () =>
        fakeStream([{ message: "Bad" }], {
          message: "Bad",
          files: invalidFiles,
        }),
    });

    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: "PLUGIN_AUTHORING_INVALID_OUTPUT",
      details: [expect.objectContaining({ file: "entry.tsx" })],
    });
  });

  it("rethrows provider failures before the first event for the route to translate", async () => {
    await expect(
      run({
        streamObject: () => {
          throw Object.assign(new Error("boom"), { statusCode: 500 });
        },
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_AUTHORING_UNAVAILABLE" });
  });

  it("emits an error event when the repair round fails after streaming started", async () => {
    const invalidFiles = {
      ...files,
      "entry.tsx": "console.log('missing render export');",
    };
    const streamObject = vi
      .fn()
      .mockReturnValueOnce(
        fakeStream([{ message: "First" }], {
          message: "First",
          files: invalidFiles,
        }),
      )
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("boom"), { statusCode: 500 });
      });
    const service = createPluginAuthoringService(configuration() as never, {
      streamObject: streamObject as never,
    });
    const prepared = await service.prepareStream({
      principalId: "author-1",
      tenantId: 4,
      prompt: "x",
      files,
    });
    const events: AuthoringStreamEvent[] = [];
    await service.runStream(prepared, (event) => {
      events.push(event);
    });
    expect(events[0]).toEqual({ type: "message", delta: "First" });
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: "PLUGIN_AUTHORING_UNAVAILABLE",
    });
  });
});
