import { HTTPException } from "hono/http-exception";
import type { CrmProviderAdapter, NangoClient } from "./contracts";
import type { ActiveCrmConnection, CrmListQuery } from "./contracts";
import { CrmUnavailableError, CrmUpstreamError } from "./contracts";
import {
  createRemoteWorkspaceAdapter,
  type RemoteProviderId,
} from "./workspace-adapter";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}
function rejectUnsupported(
  input: Record<string, unknown>,
  supported: Record<string, string | undefined>,
): void {
  const unsupported = Object.keys(input).filter(
    (key) => input[key] !== undefined && !supported[key],
  );
  if (unsupported.length)
    throw new CrmUnavailableError(
      `The CRM provider does not support these fields: ${unsupported.join(", ")}`,
    );
}
function upstreamError(status: number): CrmUpstreamError {
  return new CrmUpstreamError(
    status === 401 ? "RECONNECT_REQUIRED" : "NANGO_REQUEST_FAILED",
    status === 401
      ? "The CRM connection must be reconnected"
      : status === 403
        ? "The CRM account denied this operation"
        : status === 429
          ? "The CRM rate limit was reached"
          : "The CRM provider request could not be completed",
    status,
  );
}
function native(
  provider: RemoteProviderId,
  resource: "contacts" | "companies" | "deals",
): Record<string, string> {
  if (provider === "salesforce")
    return resource === "contacts"
      ? {
          email: "Email",
          first: "FirstName",
          last: "LastName",
          company: "AccountId",
          phone: "Phone",
          address: "MailingStreet",
          city: "MailingCity",
          state: "MailingState",
          updated: "LastModifiedDate",
        }
      : resource === "companies"
        ? {
            name: "Name",
            domain: "Website",
            phone: "Phone",
            address: "BillingStreet",
            city: "BillingCity",
            state: "BillingState",
            updated: "LastModifiedDate",
          }
        : {
            name: "Name",
            amount: "Amount",
            stage: "StageName",
            company: "AccountId",
            updated: "LastModifiedDate",
          };
  if (provider === "zoho")
    return resource === "contacts"
      ? {
          email: "Email",
          first: "First_Name",
          last: "Last_Name",
          company: "Account_Name",
          phone: "Phone",
          address: "Mailing_Street",
          city: "Mailing_City",
          state: "Mailing_State",
          updated: "Modified_Time",
        }
      : resource === "companies"
        ? {
            name: "Account_Name",
            domain: "Website",
            phone: "Phone",
            address: "Billing_Street",
            city: "Billing_City",
            state: "Billing_State",
            updated: "Modified_Time",
          }
        : {
            name: "Deal_Name",
            amount: "Amount",
            stage: "Stage",
            company: "Account_Name",
            updated: "Modified_Time",
          };
  return resource === "contacts"
    ? {
        email: "email",
        first: "first_name",
        last: "last_name",
        company: "org_id",
        name: "name",
        phone: "phone",
        updated: "update_time",
      }
    : resource === "companies"
      ? { name: "name", address: "address", updated: "update_time" }
      : {
          name: "title",
          amount: "value",
          stage: "stage_id",
          company: "org_id",
          updated: "update_time",
        };
}

export function createRemoteCrmAdapter(
  provider: RemoteProviderId,
  nango: NangoClient,
): CrmProviderAdapter {
  const workspace = createRemoteWorkspaceAdapter(provider, nango);
  const assert = (connection: ActiveCrmConnection) => {
    if (connection.provider !== provider) throw new CrmUnavailableError();
  };
  const list = async (
    connection: ActiveCrmConnection,
    resource: "contacts" | "companies" | "deals",
    query: CrmListQuery,
  ) => {
    assert(connection);
    const names = native(provider, resource);
    const page = await workspace.list(connection, resource, {
      page: 1,
      perPage: query.limit,
      q: query.search,
      fields: Object.values(names),
    });
    return page.records;
  };
  const map = (
    resource: "contacts" | "companies" | "deals",
    source: Record<string, unknown>,
  ) => {
    const fields = native(provider, resource);
    if (resource === "contacts")
      return {
        id: text(source.id) ?? "",
        email: text(source[fields.email]),
        firstName: text(source[fields.first]),
        lastName: text(source[fields.last]),
        companyId: text(source[fields.company]),
        updatedAt: text(source[fields.updated]),
      };
    if (resource === "companies")
      return {
        id: text(source.id) ?? "",
        name: text(source[fields.name]),
        domain: text(source[fields.domain]),
        updatedAt: text(source[fields.updated]),
      };
    return {
      id: text(source.id) ?? "",
      name: text(source[fields.name]),
      amount: text(source[fields.amount]),
      stage: text(source[fields.stage]),
      updatedAt: text(source[fields.updated]),
    };
  };
  const contactData = (input: Record<string, unknown>) => {
    const fields = native(provider, "contacts");
    const result: Record<string, unknown> = {};
    const supported: Record<string, string | undefined> = {
      email: fields.email,
      firstName: fields.first,
      lastName: fields.last,
      companyId: fields.company,
      phone: fields.phone,
      address: fields.address,
      city: fields.city,
      state: fields.state,
    };
    rejectUnsupported(input, supported);
    for (const [key, name] of Object.entries(supported))
      if (name && input[key] !== undefined) result[name] = input[key];
    if (provider === "pipedrive" && (input.firstName || input.lastName)) {
      result.name = [input.firstName, input.lastName]
        .filter((part) => typeof part === "string" && part.trim())
        .join(" ");
      delete result[fields.first];
      delete result[fields.last];
    }
    return result;
  };
  const companyData = (input: Record<string, unknown>) => {
    const fields = native(provider, "companies");
    const result: Record<string, unknown> = {};
    const supported: Record<string, string | undefined> = {
      name: fields.name,
      domain: fields.domain,
      phone: fields.phone,
      address: fields.address,
      city: fields.city,
      state: fields.state,
    };
    rejectUnsupported(input, supported);
    for (const [key, name] of Object.entries(supported))
      if (name && input[key] !== undefined) result[name] = input[key];
    return result;
  };
  return {
    async validate(connection) {
      assert(connection);
      let requestPath: string;
      if (provider === "salesforce")
        requestPath =
          "/services/data/v60.0/query?q=SELECT%20Id%2CName%20FROM%20Organization%20LIMIT%201";
      else if (provider === "zoho") requestPath = "/crm/v2/org";
      else requestPath = "/v1/users/me";
      const response = await nango.proxy({
        method: "GET",
        path: requestPath,
        connection,
      });
      if (!response.ok) throw upstreamError(response.status);
      const payload = record(await response.json().catch(() => undefined));
      const item =
        provider === "salesforce"
          ? record(
              Array.isArray(payload.records) ? payload.records[0] : undefined,
            )
          : provider === "zoho"
            ? record(Array.isArray(payload.org) ? payload.org[0] : undefined)
            : record(payload.data);
      const accountId =
        provider === "pipedrive"
          ? text(item.company_id)
          : text(item.zgid ?? item.Id ?? item.id ?? item.org_id);
      const accountLabel = text(item.Name ?? item.company_name ?? item.name);
      if (!accountId) throw new CrmUpstreamError();
      return {
        externalAccountId: accountId,
        externalAccountLabel: accountLabel,
        scopes: connection.scopes,
      };
    },
    async listContacts(connection, query) {
      return (await list(connection, "contacts", query)).map(
        (entry) => map("contacts", entry) as never,
      );
    },
    async findContactByEmail(connection, email) {
      assert(connection);
      let entries: Record<string, unknown>[];
      if (provider === "salesforce") {
        const escaped = email.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const q = `SELECT Id,${Object.values(native(provider, "contacts")).join(",")} FROM Contact WHERE Email = '${escaped}' LIMIT 100`;
        const response = await nango.proxy({
          method: "GET",
          connection,
          path: `/services/data/v60.0/query?${new URLSearchParams({ q })}`,
        });
        if (!response.ok) throw upstreamError(response.status);
        const payload = record(await response.json().catch(() => undefined));
        if (!Array.isArray(payload.records)) throw new CrmUpstreamError();
        entries = payload.records.map((entry) => ({
          ...record(entry),
          id: record(entry).Id,
        }));
      } else
        entries = await list(connection, "contacts", {
          limit: 100,
          search: email,
        });
      return entries
        .filter((entry) =>
          [
            entry[native(provider, "contacts").email],
            ...(Array.isArray(entry._crmEmailValues)
              ? entry._crmEmailValues
              : []),
          ].some((value) => text(value)?.toLowerCase() === email.toLowerCase()),
        )
        .map((entry) => map("contacts", entry) as never);
    },
    async createContact(connection, input) {
      const result = await workspace.create(
        connection,
        "contacts",
        contactData(input),
      );
      return map("contacts", result) as never;
    },
    async updateContact(connection, id, input) {
      assert(connection);
      let merged = { ...input };
      if (
        provider === "pipedrive" &&
        (input.firstName !== undefined) !== (input.lastName !== undefined)
      ) {
        const current = await workspace.get(connection, "contacts", id, [
          "name",
          "first_name",
          "last_name",
        ]);
        const missing =
          input.firstName === undefined ? "first_name" : "last_name";
        if (typeof current[missing] !== "string")
          throw new HTTPException(422, {
            message:
              "Provide both first and last name to update this Pipedrive contact safely",
          });
        merged = {
          ...input,
          ...(missing === "first_name"
            ? { firstName: String(current[missing]) }
            : { lastName: String(current[missing]) }),
        };
      }
      const result = await workspace.update(
        connection,
        "contacts",
        id,
        contactData(merged),
      );
      return map("contacts", result) as never;
    },
    async listCompanies(connection, query) {
      return (await list(connection, "companies", query)).map(
        (entry) => map("companies", entry) as never,
      );
    },
    async findCompanyByName(connection, name) {
      return (await list(connection, "companies", { limit: 100, search: name }))
        .filter(
          (entry) =>
            text(entry[native(provider, "companies").name])?.toLowerCase() ===
            name.toLowerCase(),
        )
        .map((entry) => map("companies", entry) as never);
    },
    async createCompany(connection, input) {
      const result = await workspace.create(
        connection,
        "companies",
        companyData(input),
      );
      return map("companies", result) as never;
    },
    async updateCompany(connection, id, input) {
      const result = await workspace.update(
        connection,
        "companies",
        id,
        companyData(input),
      );
      return map("companies", result) as never;
    },
    async listDeals(connection, query) {
      return (await list(connection, "deals", query)).map(
        (entry) => map("deals", entry) as never,
      );
    },
  };
}
