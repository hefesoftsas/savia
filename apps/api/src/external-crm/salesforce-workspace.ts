import type { WorkspaceResource } from "./workspace-adapter";
export const salesforceModule = {
  provider: "salesforce" as const,
  resources: ["contacts", "companies", "deals"] as WorkspaceResource[],
  labels: {
    contacts: "Contacts",
    companies: "Accounts",
    deals: "Opportunities",
  },
  names: { contacts: "Contact", companies: "Account", deals: "Opportunity" },
  apiRoot: "/services/data/v60.0",
  idPattern: /^(?:[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/,
};
