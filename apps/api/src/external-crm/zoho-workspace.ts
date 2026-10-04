import type { WorkspaceResource } from "./workspace-adapter";
export const zohoModule = {
  provider: "zoho" as const,
  resources: ["contacts", "companies", "deals"] as WorkspaceResource[],
  labels: { contacts: "Contacts", companies: "Accounts", deals: "Deals" },
  names: { contacts: "Contacts", companies: "Accounts", deals: "Deals" },
  apiRoot: "/crm/v2",
  idPattern: /^[0-9]+$/,
};
