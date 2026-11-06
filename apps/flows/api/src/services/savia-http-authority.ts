import type { Node } from "@savia/flows-types";

export interface SaviaHttpExecutionAuthority {
  workflowId: string;
  organizationId: string;
  principalId: string;
  active: boolean;
}

export type SaviaHttpPrincipalResolution =
  | { kind: "legacy"; userId: "api_key" }
  | { kind: "bound"; userId: string }
  | { kind: "denied"; status: 409; message: string };

export function hasSaviaCollectionNode(
  nodes: readonly Pick<Node, "type">[],
): boolean {
  return nodes.some((node) => node.type.startsWith("savia-"));
}

export function resolveSaviaHttpExecutionPrincipal(
  workflow: {
    id: string;
    organizationId: string;
    nodes: readonly Pick<Node, "type">[];
  },
  authority: SaviaHttpExecutionAuthority | undefined,
): SaviaHttpPrincipalResolution {
  if (!authority) {
    return hasSaviaCollectionNode(workflow.nodes)
      ? {
          kind: "denied",
          status: 409,
          message:
            "Enable this HTTP workflow from Savia before calling native collection nodes.",
        }
      : { kind: "legacy", userId: "api_key" };
  }

  if (
    !authority.active ||
    authority.workflowId !== workflow.id ||
    authority.organizationId !== workflow.organizationId ||
    !authority.principalId
  ) {
    return {
      kind: "denied",
      status: 409,
      message:
        "The Savia execution authority is inactive or invalid. Re-enable this workflow from Savia.",
    };
  }
  return { kind: "bound", userId: authority.principalId };
}

export function canConfigureSaviaHttpAuthority(
  role: string | undefined,
  isApiKey: boolean,
): boolean {
  return !isApiKey && (role === "admin" || role === "owner");
}
