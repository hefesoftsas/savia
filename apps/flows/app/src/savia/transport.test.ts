import { describe, expect, it } from "vitest";
import {
  isSafeSaviaFlowsSocketUrl,
  isStandalonePublicForm,
  parsePublicSaviaFlowsRequest,
} from "./transport";

describe("Savia Flows public capability requests", () => {
  it("enables standalone transport only for the three public form routes", () => {
    expect(isStandalonePublicForm("/flows-ui/form/signed.token")).toBe(true);
    expect(isStandalonePublicForm("/flows-ui/forms/workflow-1")).toBe(true);
    expect(isStandalonePublicForm("/flows-ui/feedback/signed.token")).toBe(
      true,
    );
    expect(isStandalonePublicForm("/flows-ui/org/tenant:1/workflows")).toBe(
      false,
    );
    expect(isStandalonePublicForm("/flows-ui/forms/workflow-1/nested")).toBe(
      false,
    );
  });

  it("maps only exact public marker capabilities to same-origin gateway URLs", () => {
    expect(
      parsePublicSaviaFlowsRequest(
        "/__savia_flows_api/forms/signed.token?locale=es",
        "http://savia.test",
      ),
    ).toEqual({
      url: "http://savia.test/api/public/savia-flows/forms/signed.token?locale=es",
      authorizationAllowed: false,
    });
    expect(
      parsePublicSaviaFlowsRequest(
        "/__savia_flows_api/queues/queue-1",
        "https://savia.test",
      ),
    ).toMatchObject({ authorizationAllowed: true });
    expect(
      parsePublicSaviaFlowsRequest(
        "/api/public/savia-flows/http/workflow-1",
        "https://savia.test",
      ),
    ).toMatchObject({
      url: "https://savia.test/api/public/savia-flows/http/workflow-1",
      authorizationAllowed: true,
    });
  });

  it("rejects private endpoints, nested suffixes, traversal, and foreign origins", () => {
    for (const path of [
      "/__savia_flows_api/tenant:1/workflows",
      "/__savia_flows_api/forms/token/extra",
      "/__savia_flows_api/forms/%2e%2e%2Fadmin",
      "https://evil.test/api/public/savia-flows/forms/token",
    ])
      expect(
        parsePublicSaviaFlowsRequest(path, "https://savia.test"),
      ).toBeNull();
  });
});

describe("Savia Flows socket ticket URLs", () => {
  it("accepts a same-host WebSocket URL returned by the Savia host", () => {
    expect(
      isSafeSaviaFlowsSocketUrl(
        "ws://savia.test/api/public/savia-flows/ws?ticket=one-use",
        "http://savia.test",
      ),
    ).toBe(true);
    expect(
      isSafeSaviaFlowsSocketUrl(
        "wss://savia.test/api/public/savia-flows/ws?ticket=one-use",
        "https://savia.test",
      ),
    ).toBe(true);
  });

  it("rejects a different host, port, scheme, path, or query shape", () => {
    const origin = "https://savia.test";
    for (const url of [
      "wss://evil.test/api/public/savia-flows/ws?ticket=x",
      "wss://savia.test:8443/api/public/savia-flows/ws?ticket=x",
      "ws://savia.test/api/public/savia-flows/ws?ticket=x",
      "wss://savia.test/other?ticket=x",
      "wss://savia.test/api/public/savia-flows/ws?ticket=x&extra=y",
      "wss://savia.test/api/public/savia-flows/ws?ticket=x&ticket=y",
    ])
      expect(isSafeSaviaFlowsSocketUrl(url, origin)).toBe(false);
  });
});
