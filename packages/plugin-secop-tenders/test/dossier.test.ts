import { renderTemplate } from "../../studio-shared/src/plugin-store";
import store from "../store.json";
import { describe, it, expect, vi } from "vitest";
import type { PluginApi } from "@savia/plugin-sdk";
import { DossierClient, safeDossierUploadUrl } from "../dossier";
describe("dossier connector client", () => {
  it("renders the actual HTTP dispatch body with the host template contract", () => {
    const action = store.actions.find((a) => a.id === "dossier-call")!;
    const input = { operation: "dossier", arguments: { id: "CO1.REQ.1" } };
    expect(renderTemplate(action.request!.body, { input })).toEqual(input);
  });
  it("uses the configured secret-backed HTTP connector and unwraps results", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ output: { data: { id: "job-1" } } });
    const api = { actions: { execute } } as unknown as PluginApi;
    expect(
      await new DossierClient(api, "connection-1").call("prepare", {
        processId: "CO1.REQ.1",
      }),
    ).toEqual({ id: "job-1" });
    expect(execute).toHaveBeenCalledWith("dossier-call", {
      connectionId: "connection-1",
      input: { operation: "prepare", arguments: { processId: "CO1.REQ.1" } },
    });
  });
  it("rejects malformed results and propagates safe service errors", async () => {
    const api = {
      actions: {
        execute: vi.fn().mockResolvedValue({
          output: { error: { code: "REVISION_CONFLICT" } },
        }),
      },
    } as unknown as PluginApi;
    await expect(new DossierClient(api, "c").call("chat", {})).rejects.toThrow(
      "REVISION_CONFLICT",
    );
  });
  it("accepts upload links only from the fixed service and protected upload path", () => {
    expect(
      safeDossierUploadUrl(
        "https://secop-live-worker.jose-douglas-dev.workers.dev/private/upload#ticket=opaque",
      ),
    ).not.toBeNull();
    expect(
      safeDossierUploadUrl("https://evil.test/private/upload#ticket=opaque"),
    ).toBeNull();
    expect(safeDossierUploadUrl("javascript:alert(1)")).toBeNull();
  });
});
