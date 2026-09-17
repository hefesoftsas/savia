import { createHash } from "node:crypto";
import { FastMCP } from "@prefecthq/fastmcp-ts/server";
import { z } from "zod";
import { registerTrustedAssistantExtensions } from "./extensions/registry";
import { readDelegatedRequestCredentials } from "./request-credentials";
import { SaviaApiClient } from "./savia-api";

const nonEmptyString = z.string().trim().min(1);

export type SaviaMcpServerOptions = {
  apiUrl?: string;
  apiFetch?: typeof fetch;
  mcpSharedSecret?: string;
};

type DelegatedClaims = { delegatedAuthorization?: unknown };

function getDelegatedClient(
  server: FastMCP,
  apiUrl: string,
  apiFetch?: typeof fetch,
): SaviaApiClient {
  const auth = server.getContext().auth as any;
  const claims = auth?.claims as DelegatedClaims | undefined;
  const authorization =
    claims?.delegatedAuthorization ??
    auth?.extra?.delegatedAuthorization ??
    auth?.delegatedAuthorization;
  if (
    typeof authorization !== "string" ||
    !/^Bearer\s+\S+$/i.test(authorization)
  ) {
    throw new Error("A delegated Savia user authorization is required");
  }
  return new SaviaApiClient(
    apiUrl,
    authorization.replace(/^Bearer\s+/i, ""),
    apiFetch,
  );
}

export function createSaviaMcpServer(
  clientOrOptions:
    SaviaApiClient | SaviaMcpServerOptions = new SaviaApiClient(),
): FastMCP {
  const options =
    clientOrOptions instanceof SaviaApiClient ? undefined : clientOrOptions;
  const configuredClient =
    clientOrOptions instanceof SaviaApiClient
      ? clientOrOptions
      : new SaviaApiClient(options?.apiUrl, undefined, options?.apiFetch);
  const apiUrl =
    options?.apiUrl ?? process.env.SAVIA_API_URL ?? "http://127.0.0.1:8787";
  const mcpSharedSecret = options?.mcpSharedSecret;
  const server = new FastMCP({
    name: "savia-domain-api",
    version: "0.1.0",
    auth: mcpSharedSecret
      ? {
          verifyRequest: async (request) => {
            const { authorization } = readDelegatedRequestCredentials(
              request.headers,
              mcpSharedSecret,
            );
            return {
              token: createHash("sha256").update(authorization).digest("hex"),
              scopes: [],
              claims: { delegatedAuthorization: authorization },
            };
          },
        }
      : undefined,
    http: mcpSharedSecret
      ? {
          redactHeaders: ["x-savia-mcp-secret", "x-savia-user-authorization"],
        }
      : undefined,
  });
  const clientForRequest = () =>
    mcpSharedSecret
      ? getDelegatedClient(server, apiUrl, options?.apiFetch)
      : configuredClient;

  server.tool(
    {
      name: "savia_execute_command",
      description:
        "Execute a documented domain command. Use this for writes rather than direct table-style CRUD.",
      input: z.object({
        domain: nonEmptyString.describe("Savia domain slug"),
        command: nonEmptyString.describe(
          "Command name documented by savia_list_domains",
        ),
        input: z.record(z.string(), z.unknown()).describe("Command payload"),
      }),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["domain", "command", "input"],
        properties: {
          domain: { type: "string", minLength: 1 },
          command: { type: "string", minLength: 1 },
          input: { type: "object", additionalProperties: true },
        },
      },
    },
    async ({ domain, command, input }) =>
      clientForRequest().executeCommand(domain, command, input),
  );

  server.tool(
    {
      name: "savia_execute_personal_action",
      description:
        "Execute one personal integration action that Savia Assistant already prepared and the account owner explicitly confirmed. The stored action is resolved server-side; never supply message or event content here.",
      input: z.object({
        actionId: nonEmptyString.describe(
          "The explicitly confirmed Savia Assistant action identifier",
        ),
      }),
    },
    async ({ actionId }) => clientForRequest().executePersonalAction(actionId),
  );

  server.tool(
    {
      name: "savia_get_crm_sync_status",
      description:
        "Read recent automatic CRM synchronization status, optionally for one Savia customer.",
      annotations: { readOnlyHint: true },
      input: z.object({ customerId: z.number().int().positive().optional() }),
    },
    async ({ customerId }) => clientForRequest().getCrmSyncStatus(customerId),
  );

  server.tool(
    {
      name: "savia_get_document",
      description: "Get one document from a public Savia domain collection.",
      annotations: { readOnlyHint: true },
      input: z.object({
        domain: nonEmptyString.describe("Savia domain slug"),
        collection: nonEmptyString.describe("Public collection name"),
        id: nonEmptyString.describe("Document identifier"),
      }),
    },
    async ({ domain, collection, id }) =>
      clientForRequest().getDocument(domain, collection, id),
  );

  server.tool(
    {
      name: "savia_list_documents",
      description: "List documents from a public Savia domain collection.",
      annotations: { readOnlyHint: true },
      input: z.object({
        domain: nonEmptyString.describe("Savia domain slug"),
        collection: nonEmptyString.describe("Public collection name"),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    },
    async ({ domain, collection, limit, offset }) =>
      clientForRequest().listDocuments(domain, collection, limit, offset),
  );

  server.tool(
    {
      name: "savia_list_domains",
      description:
        "List Savia domains, their public collections, and the supported domain commands. Call this before choosing a command.",
      annotations: { readOnlyHint: true },
      input: z.object({}),
    },
    async () => ({ domains: await clientForRequest().listDomains() }),
  );

  server.tool(
    {
      name: "savia_search_personal_files",
      description:
        "Search file metadata in the caller's own connected Google Drive or OneDrive account. This never returns OAuth credentials or file contents.",
      annotations: { readOnlyHint: true },
      input: z.object({
        provider: z.enum([
          "google_drive",
          "onedrive_personal",
          "onedrive_business",
        ]),
        query: nonEmptyString.max(100).describe("File-name search term"),
      }),
    },
    async ({ provider, query }) =>
      clientForRequest().searchPersonalFiles(provider, query),
  );

  server.tool(
    {
      name: "savia_search_personal_messages",
      description:
        "Search message metadata in the caller's own connected Gmail or Outlook account. This never returns OAuth credentials or message bodies.",
      annotations: { readOnlyHint: true },
      input: z.object({
        provider: z.enum(["gmail", "outlook"]),
        query: nonEmptyString.max(100).describe("Mailbox search term"),
      }),
    },
    async ({ provider, query }) =>
      clientForRequest().searchPersonalMessages(provider, query),
  );

  server.tool(
    {
      name: "savia_list_personal_events",
      description:
        "List upcoming event metadata in the caller's own connected Google Calendar or Outlook calendar. This never returns OAuth credentials.",
      annotations: { readOnlyHint: true },
      input: z.object({ provider: z.enum(["google_calendar", "outlook"]) }),
    },
    async ({ provider }) => clientForRequest().listPersonalEvents(provider),
  );

  server.tool(
    {
      name: "savia_lookup_dane_city",
      description:
        "Resolve a Colombian city name to its official five-digit DANE municipality code through Savia Request. Use instead of asking the user for codes. If ambiguous ask only for the department.",
      input: z.object({
        city: z.string().trim().min(2).max(100),
        department: z.string().trim().max(100).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ city, department }) =>
      clientForRequest().lookupDaneCity(city, department),
  );
  server.tool(
    {
      name: "savia_lookup_quote_vehicle",
      description:
        "Read vehicle details by plate using the configured quoter lookup service (Fasecolda, year, insured value when returned). This does not request insurer quotations. Use when the user gives a plate rather than asking them for technical vehicle codes.",
      input: z.object({ plate: z.string().trim().min(5).max(8) }),
      annotations: { readOnlyHint: true },
    },
    async ({ plate }) => clientForRequest().lookupQuoteVehicle(plate),
  );

  server.tool(
    {
      name: "savia_get_quote_form",
      description:
        "Read the exact vehicle, applicant and contact fields required by the live step-by-step auto insurance quoter and its enabled products. Use before collecting data for a new quote. Never invent missing fields.",
      input: z.object({}),
    },
    async () => clientForRequest().getInsuranceQuoteForm(),
  );

  server.tool(
    {
      name: "savia_get_quote_summary",
      description:
        "Read a compact summary of the latest saved insurance quote (or an exact reference), counts and lowest actual premiums in one call. Prefer this for quote status or comparisons instead of discovering collections and listing all detail rows. Explicitly reports ties and missing coverage; never executes insurers.",
      annotations: { readOnlyHint: true },
      input: z.object({ reference: nonEmptyString.max(160).optional() }),
    },
    async ({ reference }) => clientForRequest().getQuoteSummary(reference),
  );

  const crmObject = nonEmptyString
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
    .describe(
      "Exact installed object name returned by savia_list_crm_collections",
    );
  server.tool(
    {
      name: "savia_list_crm_collections",
      description:
        "Discover available CRM collections (customers, policies, quotes, and custom collections), their labels, descriptions, record counts, and field schemas with types and dropdown options.",
      annotations: { readOnlyHint: true },
      input: z.object({
        all: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Include all collections (local collections, custom screens, and CRM providers). Defaults to true.",
          ),
      }),
    },
    async ({ all }) =>
      clientForRequest().listCrmCollections({ all: all ?? true }),
  );
  server.tool(
    {
      name: "savia_list_crm_records",
      description:
        "Query and list records in a CRM collection. Supports field sorting, pagination, free-text search, and structured field filters (eq, ne, contains, gt, in, etc.).",
      annotations: { readOnlyHint: true },
      input: z.object({
        object: crmObject,
        page: z.number().int().min(1).default(1),
        perPage: z.number().int().min(1).max(100).default(25),
        query: nonEmptyString
          .max(500)
          .optional()
          .describe("Free-text search across all searchable fields"),
        sort: nonEmptyString.optional().describe("Field name to sort by"),
        order: z
          .enum(["ASC", "DESC"])
          .default("DESC")
          .optional()
          .describe("Sort direction: ASC or DESC"),
        filters: z
          .object({
            logic: z.enum(["and", "or"]).default("and"),
            conditions: z
              .array(
                z.object({
                  field: z
                    .string()
                    .describe("Field name defined in the collection"),
                  op: z
                    .enum([
                      "eq",
                      "ne",
                      "gt",
                      "gte",
                      "lt",
                      "lte",
                      "contains",
                      "startsWith",
                      "endsWith",
                      "empty",
                      "in",
                    ])
                    .describe("Comparison operator"),
                  value: z.unknown().optional().describe("Value to match"),
                }),
              )
              .max(20),
          })
          .optional()
          .describe(
            "Structured field conditions, e.g. { logic: 'and', conditions: [{ field: 'status', op: 'eq', value: 'active' }] }",
          ),
      }),
    },
    async ({ object, page, perPage, query, sort, order, filters }) =>
      clientForRequest().listCrmRecords(object, {
        page,
        perPage,
        query,
        sort,
        order,
        filters,
      }),
  );
  server.tool(
    {
      name: "savia_aggregate_crm_records",
      description:
        "Compute metrics, counts, and statistical summaries on a CRM collection. Groups records by a field (e.g. city, status, category) and computes counts and metric sums (e.g. total premium or amount), or counts matching records with optional filters.",
      annotations: { readOnlyHint: true },
      input: z.object({
        object: crmObject,
        groupBy: nonEmptyString
          .optional()
          .describe(
            "Field name to group by (e.g. city, status, department, category)",
          ),
        amountField: nonEmptyString
          .optional()
          .describe(
            "Optional numeric field name to sum (e.g. premium, amount, total)",
          ),
        filters: z
          .object({
            logic: z.enum(["and", "or"]).default("and"),
            conditions: z
              .array(
                z.object({
                  field: z.string().describe("Field name to filter on"),
                  op: z
                    .enum([
                      "eq",
                      "ne",
                      "gt",
                      "gte",
                      "lt",
                      "lte",
                      "contains",
                      "startsWith",
                      "endsWith",
                      "empty",
                      "in",
                    ])
                    .describe("Comparison operator"),
                  value: z.unknown().optional().describe("Value to match"),
                }),
              )
              .max(20),
          })
          .optional()
          .describe("Optional filter conditions before aggregating"),
      }),
    },
    async ({ object, groupBy, amountField, filters }) =>
      clientForRequest().aggregateCrmRecords(object, {
        groupBy,
        amountField,
        filters,
      }),
  );
  server.tool(
    {
      name: "savia_get_crm_record",
      description: "Read one live record by ID from a CRM collection.",
      annotations: { readOnlyHint: true },
      input: z.object({ object: crmObject, id: nonEmptyString }),
    },
    async ({ object, id }) => clientForRequest().getCrmRecord(object, id, true),
  );
  server.tool(
    {
      name: "savia_create_crm_record",
      description:
        "Create a record in an installed CRM provider collection using its discovered fields. This writes to the connected CRM. Requires caller authorization and provider create capability.",
      input: z.object({
        object: crmObject,
        data: z.record(z.string(), z.unknown()),
      }),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["object", "data"],
        properties: {
          object: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
          data: { type: "object", additionalProperties: true },
        },
      },
    },
    async ({ object, data }) =>
      clientForRequest().createCrmRecord(object, data, true),
  );
  server.tool(
    {
      name: "savia_update_crm_record",
      description:
        "Update specified fields of an installed CRM provider record. This writes to the connected CRM. Read the record first and include its _version when present; provider update capability is enforced.",
      input: z.object({
        object: crmObject,
        id: nonEmptyString,
        data: z.record(z.string(), z.unknown()),
      }),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["object", "id", "data"],
        properties: {
          object: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
          id: { type: "string", minLength: 1 },
          data: { type: "object", additionalProperties: true },
        },
      },
    },
    async ({ object, id, data }) =>
      clientForRequest().updateCrmRecord(object, id, data, true),
  );
  server.tool(
    {
      name: "savia_delete_crm_record",
      description:
        "Delete a record by ID from a CRM collection. This permanently removes or archives the record.",
      input: z.object({
        object: crmObject,
        id: nonEmptyString,
        version: z.number().int().positive().optional(),
      }),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["object", "id"],
        properties: {
          object: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
          id: { type: "string", minLength: 1 },
          version: { type: "integer", minimum: 1 },
        },
      },
    },
    async ({ object, id, version }) =>
      clientForRequest().deleteCrmRecord(object, id, version, true),
  );
  server.tool(
    {
      name: "savia_get_crm_record_links",
      description:
        "Read configured relations and linked records for an installed CRM collection record.",
      annotations: { readOnlyHint: true },
      input: z.object({ object: crmObject, id: nonEmptyString }),
    },
    async ({ object, id }) => clientForRequest().getCrmRecordLinks(object, id),
  );

  server.resource(
    {
      uri: "savia://domains",
      name: "savia_domains",
      description: "Live catalog of Savia domains, collections, and commands.",
      mimeType: "application/json",
    },
    async () => JSON.stringify(await clientForRequest().listDomains()),
  );

  server.prompt(
    {
      name: "savia_operate_domain",
      description:
        "Establish a safe workflow for reading and changing a Savia domain through its public commands.",
      arguments: [
        { name: "domain", required: false },
        { name: "goal", required: false },
      ],
    },
    ({ domain, goal } = {}) =>
      [
        "Operate Savia through its documented domain API only.",
        "First call savia_list_domains (or read savia://domains) to select a valid domain, collection, or command.",
        "Use savia_list_documents and savia_get_document for reads.",
        "Use the savia_search_personal_* tools only for the caller's connected personal Google or Microsoft account; they return metadata only.",
        "Use savia_execute_command for domain writes; for installed CRM providers discover savia_list_crm_collections, then use the dedicated CRM record tools with the returned object names and capabilities. Never invent collections or bypass business rules.",
        domain ? `Selected domain: ${domain}.` : undefined,
        goal ? `Requested outcome: ${goal}.` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
  );

  registerTrustedAssistantExtensions(server, clientForRequest);

  return server;
}
