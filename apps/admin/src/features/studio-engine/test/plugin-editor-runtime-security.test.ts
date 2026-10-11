import { describe, expect, it } from "vitest";
import {
  acceptEditorEnvelope,
  isIsolatedEditorRuntime,
  resolvePluginEditorRuntimeUrl,
} from "../plugin-editor-session";

describe("isolated editor session", () => {
  it("cannot activate arbitrary packages in the application build even under a forged cross-origin parent", () => {
    expect(
      isIsolatedEditorRuntime(
        false,
        "https://savia-team.savia-preview.hefesoft.com",
        "https://attacker.example",
      ),
    ).toBe(false);
    expect(
      isIsolatedEditorRuntime(
        true,
        "https://editor.account.workers.dev",
        "https://savia-team.savia-preview.hefesoft.com",
      ),
    ).toBe(true);
    expect(
      isIsolatedEditorRuntime(
        true,
        "https://savia-preview.hefesoft.com",
        "https://savia-team.savia-preview.hefesoft.com",
      ),
    ).toBe(false);
  });
  it("rejects Savia cookie origins, credentials and non-HTTPS runtime URLs", () => {
    const parent = "https://savia-team.savia-preview.hefesoft.com";
    for (const url of [
      parent,
      "https://editor.savia-preview.hefesoft.com",
      "http://example.com",
      "https://user:pass@example.com",
    ])
      expect(resolvePluginEditorRuntimeUrl(url, parent)).toBeNull();
    expect(
      resolvePluginEditorRuntimeUrl(
        "https://savia-editor.example.workers.dev/plugin-editor",
        parent,
      )?.origin,
    ).toBe("https://savia-editor.example.workers.dev");
    expect(resolvePluginEditorRuntimeUrl(undefined, parent)).toBeNull();
  });
  it("requires origin, source, project and nonce for every envelope", () => {
    const source = {};
    const session = {
      nonce: "secret",
      projectId: "project",
      parentOrigin: "https://savia.example.com",
    };
    const event = {
      source,
      origin: "https://editor.example.net",
      data: { session, message: { type: "savia-editor-ready" } },
    };
    expect(acceptEditorEnvelope(event, source, event.origin, session)).toEqual(
      event.data.message,
    );
    expect(
      acceptEditorEnvelope(
        { ...event, origin: "https://evil.example" },
        source,
        event.origin,
        session,
      ),
    ).toBeNull();
    expect(
      acceptEditorEnvelope(
        { ...event, source: {} },
        source,
        event.origin,
        session,
      ),
    ).toBeNull();
    expect(
      acceptEditorEnvelope(event, source, event.origin, {
        ...session,
        nonce: "stale",
      }),
    ).toBeNull();
    expect(
      acceptEditorEnvelope(event, source, event.origin, {
        ...session,
        projectId: "other",
      }),
    ).toBeNull();
  });
});
