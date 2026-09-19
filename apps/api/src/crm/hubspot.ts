import type {
  ActiveCrmConnection,
  CrmCompany,
  CrmCompanyWrite,
  CrmContact,
  CrmContactWrite,
  CrmDeal,
  CrmListQuery,
  CrmProviderAdapter,
  NangoClient,
  NangoProxyRequest,
} from "./contracts";
import { CrmUnavailableError, CrmUpstreamError } from "./contracts";

const contactProperties = [
  "email",
  "firstname",
  "lastname",
  "associatedcompanyid",
  "lastmodifieddate",
] as const;

const companyProperties = ["name", "domain", "hs_lastmodifieddate"] as const;
const dealProperties = [
  "dealname",
  "amount",
  "dealstage",
  "hs_lastmodifieddate",
] as const;

function requireHubSpot(connection: ActiveCrmConnection): void {
  if (connection.provider !== "hubspot")
    throw new CrmUnavailableError("The requested CRM operation is unavailable");
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function propertiesFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function contactFromHubSpot(value: unknown): CrmContact | undefined {
  const record = propertiesFrom(value);
  const id = readString(record.id);
  if (!id) return undefined;
  const properties = propertiesFrom(record.properties);
  return {
    id,
    email: readString(properties.email),
    firstName: readString(properties.firstname),
    lastName: readString(properties.lastname),
    companyId: readString(properties.associatedcompanyid),
    updatedAt:
      readString(properties.lastmodifieddate) ?? readString(record.updatedAt),
  };
}

function companyFromHubSpot(value: unknown): CrmCompany | undefined {
  const record = propertiesFrom(value);
  const id = readString(record.id);
  if (!id) return undefined;
  const properties = propertiesFrom(record.properties);
  return {
    id,
    name: readString(properties.name),
    domain: readString(properties.domain),
    updatedAt:
      readString(properties.hs_lastmodifieddate) ??
      readString(record.updatedAt),
  };
}

function dealFromHubSpot(value: unknown): CrmDeal | undefined {
  const record = propertiesFrom(value);
  const id = readString(record.id);
  if (!id) return undefined;
  const properties = propertiesFrom(record.properties);
  return {
    id,
    name: readString(properties.dealname),
    amount: readString(properties.amount),
    stage: readString(properties.dealstage),
    updatedAt:
      readString(properties.hs_lastmodifieddate) ??
      readString(record.updatedAt),
  };
}

function listFromHubSpot<T>(
  value: unknown,
  mapper: (entry: unknown) => T | undefined,
): T[] {
  const results = propertiesFrom(value).results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((entry) => {
    const item = mapper(entry);
    return item ? [item] : [];
  });
}

function listPath(
  object: "contacts" | "companies" | "deals",
  limit: number,
  properties: readonly string[],
): string {
  const parameters = new URLSearchParams({ limit: String(limit) });
  for (const property of properties) parameters.append("properties", property);
  return `/crm/v3/objects/${object}?${parameters.toString()}`;
}

function searchBody(
  propertyName: string,
  value: string,
  properties: readonly string[],
  limit: number,
  operator: "CONTAINS_TOKEN" | "EQ" = "CONTAINS_TOKEN",
): Record<string, unknown> {
  return {
    filterGroups: [
      {
        filters: [
          {
            propertyName,
            operator,
            value,
          },
        ],
      },
    ],
    properties,
    limit,
  };
}

function contactInputProperties(
  input: CrmContactWrite,
): Record<string, string> {
  return Object.fromEntries(
    [
      ["email", input.email],
      ["firstname", input.firstName],
      ["lastname", input.lastName],
      ["phone", input.phone],
      ["address", input.address],
      ["city", input.city],
      ["state", input.state],
    ].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function companyInputProperties(
  input: CrmCompanyWrite,
): Record<string, string> {
  return Object.fromEntries(
    [
      ["name", input.name],
      ["phone", input.phone],
      ["address", input.address],
      ["city", input.city],
      ["state", input.state],
    ].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function createContactBody(input: CrmContactWrite): Record<string, unknown> {
  const properties = contactInputProperties(input);
  if (!input.companyId) return { properties };
  return {
    properties,
    associations: [
      {
        to: { id: input.companyId },
        types: [
          {
            associationCategory: "HUBSPOT_DEFINED",
            associationTypeId: 1,
          },
        ],
      },
    ],
  };
}

async function responseJson(
  nango: NangoClient,
  request: NangoProxyRequest,
): Promise<unknown> {
  const response = await nango.proxy(request);
  if (response.status === 401 || response.status === 403)
    throw new CrmUpstreamError(
      "RECONNECT_REQUIRED",
      "The CRM connection requires reconnection",
      response.status,
    );
  if (!response.ok) throw new CrmUpstreamError("NANGO_REQUEST_FAILED", undefined, response.status);
  try {
    return await response.json();
  } catch {
    throw new CrmUpstreamError();
  }
}

export function createHubSpotAdapter(nango: NangoClient): CrmProviderAdapter {
  return {
    async validate(connection) {
      requireHubSpot(connection);
      const [account, nangoConnection] = await Promise.all([
        responseJson(nango, {
          method: "GET",
          path: "/account-info/v3/details",
          connection,
        }),
        nango.getConnection(
          connection.nangoConnectionId,
          connection.nangoIntegrationId,
        ),
      ]);
      const safeAccount = propertiesFrom(account);
      const accountName = readString(safeAccount.accountName);
      const portalId =
        typeof safeAccount.portalId === "number" ||
        typeof safeAccount.portalId === "string"
          ? String(safeAccount.portalId)
          : null;
      return {
        externalAccountId: portalId,
        externalAccountLabel:
          accountName ?? (portalId ? `HubSpot ${portalId}` : null),
        scopes: nangoConnection.scopes,
      };
    },

    async listContacts(connection, query) {
      requireHubSpot(connection);
      if (query.search) {
        const payload = await responseJson(nango, {
          method: "POST",
          path: "/crm/v3/objects/contacts/search",
          connection,
          body: searchBody(
            "email",
            query.search,
            contactProperties,
            query.limit,
          ),
        });
        return listFromHubSpot(payload, contactFromHubSpot);
      }
      const payload = await responseJson(nango, {
        method: "GET",
        path: listPath("contacts", query.limit, contactProperties),
        connection,
      });
      return listFromHubSpot(payload, contactFromHubSpot);
    },

    async findContactByEmail(connection, email) {
      requireHubSpot(connection);
      const payload = await responseJson(nango, {
        method: "POST",
        path: "/crm/v3/objects/contacts/search",
        connection,
        body: searchBody("email", email, contactProperties, 2, "EQ"),
      });
      return listFromHubSpot(payload, contactFromHubSpot);
    },

    async createContact(connection, input) {
      requireHubSpot(connection);
      const payload = await responseJson(nango, {
        method: "POST",
        path: "/crm/v3/objects/contacts",
        connection,
        body: createContactBody(input),
      });
      const contact = contactFromHubSpot(payload);
      if (!contact) throw new CrmUpstreamError();
      return contact;
    },

    async updateContact(connection, contactId, input) {
      requireHubSpot(connection);
      const payload = await responseJson(nango, {
        method: "PATCH",
        path: `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
        connection,
        body: { properties: contactInputProperties(input) },
      });
      const contact = contactFromHubSpot(payload);
      if (!contact) throw new CrmUpstreamError();
      return contact;
    },

    async listCompanies(connection, query) {
      requireHubSpot(connection);
      if (query.search) {
        const payload = await responseJson(nango, {
          method: "POST",
          path: "/crm/v3/objects/companies/search",
          connection,
          body: searchBody(
            "name",
            query.search,
            companyProperties,
            query.limit,
          ),
        });
        return listFromHubSpot(payload, companyFromHubSpot);
      }
      const payload = await responseJson(nango, {
        method: "GET",
        path: listPath("companies", query.limit, companyProperties),
        connection,
      });
      return listFromHubSpot(payload, companyFromHubSpot);
    },

    async findCompanyByName(connection, name) {
      requireHubSpot(connection);
      const payload = await responseJson(nango, {
        method: "POST",
        path: "/crm/v3/objects/companies/search",
        connection,
        body: searchBody("name", name, companyProperties, 2, "EQ"),
      });
      return listFromHubSpot(payload, companyFromHubSpot);
    },

    async createCompany(connection, input) {
      requireHubSpot(connection);
      const payload = await responseJson(nango, {
        method: "POST",
        path: "/crm/v3/objects/companies",
        connection,
        body: { properties: companyInputProperties(input) },
      });
      const company = companyFromHubSpot(payload);
      if (!company) throw new CrmUpstreamError();
      return company;
    },

    async updateCompany(connection, companyId, input) {
      requireHubSpot(connection);
      const payload = await responseJson(nango, {
        method: "PATCH",
        path: `/crm/v3/objects/companies/${encodeURIComponent(companyId)}`,
        connection,
        body: { properties: companyInputProperties(input) },
      });
      const company = companyFromHubSpot(payload);
      if (!company) throw new CrmUpstreamError();
      return company;
    },

    async listDeals(connection, query) {
      requireHubSpot(connection);
      if (query.search) {
        const payload = await responseJson(nango, {
          method: "POST",
          path: "/crm/v3/objects/deals/search",
          connection,
          body: searchBody(
            "dealname",
            query.search,
            dealProperties,
            query.limit,
          ),
        });
        return listFromHubSpot(payload, dealFromHubSpot);
      }
      const payload = await responseJson(nango, {
        method: "GET",
        path: listPath("deals", query.limit, dealProperties),
        connection,
      });
      return listFromHubSpot(payload, dealFromHubSpot);
    },
  };
}
