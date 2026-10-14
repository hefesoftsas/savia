import { describe, expect, it } from "vitest";
import {
  canConfigureSaviaHttpAuthority,
  resolveSaviaHttpExecutionPrincipal,
} from "./savia-http-authority";

const workflow = {
  id: "workflow-1",
  organizationId: "tenant-1",
  nodes: [{ id: "native", type: "savia-create-record" }],
};

describe("Savia HTTP execution authority", () => {
  it("requires an active bound principal for graphs containing Savia nodes", () => {
    expect(
      resolveSaviaHttpExecutionPrincipal(workflow, undefined),
    ).toMatchObject({
      kind: "denied",
      status: 409,
    });
    expect(
      resolveSaviaHttpExecutionPrincipal(workflow, {
        workflowId: workflow.id,
        organizationId: workflow.organizationId,
        principalId: "manager-1",
        active: true,
      }),
    ).toEqual({ kind: "bound", userId: "manager-1" });
  });

  it("preserves api_key for legacy math-only workflows but fails closed on an existing inactive authority", () => {
    const legacy = { ...workflow, nodes: [{ id: "sum", type: "math-add" }] };
    expect(resolveSaviaHttpExecutionPrincipal(legacy, undefined)).toEqual({
      kind: "legacy",
      userId: "api_key",
    });
    expect(
      resolveSaviaHttpExecutionPrincipal(legacy, {
        workflowId: workflow.id,
        organizationId: workflow.organizationId,
        principalId: "manager-1",
        active: false,
      }),
    ).toMatchObject({ kind: "denied", status: 409 });
  });

  it("rejects authority records bound to another workflow or tenant", () => {
    const authority = {
      workflowId: "other-workflow",
      organizationId: workflow.organizationId,
      principalId: "manager-1",
      active: true,
    };
    expect(
      resolveSaviaHttpExecutionPrincipal(workflow, authority),
    ).toMatchObject({ kind: "denied", status: 409 });
  });

  it("allows only human organization managers to configure the authority", () => {
    expect(canConfigureSaviaHttpAuthority("admin", false)).toBe(true);
    expect(canConfigureSaviaHttpAuthority("owner", false)).toBe(true);
    expect(canConfigureSaviaHttpAuthority("member", false)).toBe(false);
    expect(canConfigureSaviaHttpAuthority("admin", true)).toBe(false);
  });
});
