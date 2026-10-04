import type { WorkspaceResource } from "./workspace-adapter";
export const pipedriveModule = {
  provider: "pipedrive" as const,
  resources: ["contacts", "companies", "deals"] as WorkspaceResource[],
  labels: { contacts: "Persons", companies: "Organizations", deals: "Deals" },
  names: { contacts: "persons", companies: "organizations", deals: "deals" },
  apiRoot: "/v1",
  idPattern: /^[0-9]+$/,
};
