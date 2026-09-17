export type CrmTransport = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export type CrmRuntime = {
  embedded: boolean;
  apiBasePath?: string;
  domainId?: string;
  businessSetupEnabled?: boolean;
  transport?: CrmTransport;
  requestTransport?: CrmTransport;
  navigate?: (query: string, replace?: boolean) => void;
};

let runtime: CrmRuntime = { embedded: false };

export function setCrmRuntime(next: CrmRuntime) {
  runtime = next;
}

export function getCrmRuntime(): CrmRuntime {
  return runtime;
}
