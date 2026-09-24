import type { LocalWorkspace } from "@/local-data/workspaces";
export type StudioTransport = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export type StudioRuntime = {
  embedded: boolean;
  localWorkspace?: LocalWorkspace;
  apiBasePath?: string;
  domainId?: string;
  businessSetupEnabled?: boolean;
  transport?: StudioTransport;
  requestTransport?: StudioTransport;
  publicFormTransport?: StudioTransport;
  navigate?: (query: string, replace?: boolean) => void;
};

let runtime: StudioRuntime = { embedded: false };

export function setStudioRuntime(next: StudioRuntime) {
  runtime = next;
}

export function getStudioRuntime(): StudioRuntime {
  return runtime;
}
