import { z } from "@hono/zod-openapi";
import type { AppActor } from "../auth/types";

export const crmProviderIds = [
  "hubspot",
  "salesforce",
  "zoho",
  "pipedrive",
] as const;

export const crmConnectionStatuses = [
  "pending",
  "connected",
  "reconnect_required",
  "disconnected",
  "failed",
] as const;

export const crmProviderIdSchema = z.enum(crmProviderIds);
export const crmConnectionStatusSchema = z.enum(crmConnectionStatuses);

export type CrmProviderId = (typeof crmProviderIds)[number];
export type CrmConnectionStatus = (typeof crmConnectionStatuses)[number];

export const customerCrmObjectKinds = ["contact", "company"] as const;
export type CustomerCrmObjectKind = (typeof customerCrmObjectKinds)[number];

export const crmListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
});

export const crmContactWriteSchema = z
  .object({
    email: z.string().trim().email().max(254).optional(),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().min(1).max(100).optional(),
    address: z.string().trim().min(1).max(255).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    state: z.string().trim().min(1).max(100).optional(),
    companyId: z.string().trim().min(1).max(255).optional(),
  })
  .refine(
    (value) =>
      value.email !== undefined ||
      value.firstName !== undefined ||
      value.lastName !== undefined ||
      value.phone !== undefined ||
      value.address !== undefined ||
      value.city !== undefined ||
      value.state !== undefined ||
      value.companyId !== undefined,
    "At least one contact field is required",
  );

export type CrmListQuery = z.infer<typeof crmListQuerySchema>;
export type CrmContactWrite = z.infer<typeof crmContactWriteSchema>;

export const crmCompanyWriteSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(1).max(100).optional(),
  address: z.string().trim().min(1).max(255).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  state: z.string().trim().min(1).max(100).optional(),
});
export type CrmCompanyWrite = z.infer<typeof crmCompanyWriteSchema>;

export type CrmContact = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  companyId: string | null;
  updatedAt: string | null;
};

export type CrmCompany = {
  id: string;
  name: string | null;
  domain: string | null;
  updatedAt: string | null;
};

export type CrmDeal = {
  id: string;
  name: string | null;
  amount: string | null;
  stage: string | null;
  updatedAt: string | null;
};

export type CrmConnection = {
  id: string;
  agencyId: number;
  provider: CrmProviderId;
  status: CrmConnectionStatus;
  externalAccountLabel: string | null;
  scopes: string[];
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActiveCrmConnection = CrmConnection & {
  nangoConnectionId: string;
  nangoIntegrationId: string;
  externalAccountId: string | null;
};

export type CustomerCrmSyncRecord = {
  principalId: string;
  agencyId: number;
  customerProfileId: number;
  provider: CrmProviderId;
  objectKind: CustomerCrmObjectKind;
  externalObjectId: string;
  lastSyncedAt: string | null;
  lastFailureCode: string | null;
  lastFailureAt: string | null;
};

export type CustomerCrmSyncRecordInput = Pick<
  CustomerCrmSyncRecord,
  | "agencyId"
  | "principalId"
  | "customerProfileId"
  | "provider"
  | "objectKind"
  | "externalObjectId"
>;

export type NangoConnectionSummary = {
  connectionId: string;
  providerConfigKey: string;
  organizationId: string | null;
  metadata: Record<string, string | string[]>;
  scopes: string[];
  scopeSource: "credentials.raw" | "metadata" | "none";
};

export type NangoProxyRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  connection: ActiveCrmConnection;
  body?: unknown;
};

export type NangoClient = {
  createConnectSession(input: {
    actor: AppActor;
    agencyId: number;
    provider: CrmProviderId;
  }): Promise<{
    token: string;
    expiresAt: string;
    connectUrl: string;
    apiUrl: string;
  }>;
  getConnection(
    connectionId: string,
    integrationId: string,
  ): Promise<NangoConnectionSummary>;
  deleteConnection(connectionId: string, integrationId: string): Promise<void>;
  proxy(request: NangoProxyRequest): Promise<Response>;
};

export type CrmProviderAdapter = {
  validate(connection: ActiveCrmConnection): Promise<{
    externalAccountId: string | null;
    externalAccountLabel: string | null;
    scopes: string[];
  }>;
  listContacts(
    connection: ActiveCrmConnection,
    query: CrmListQuery,
  ): Promise<CrmContact[]>;
  findContactByEmail(
    connection: ActiveCrmConnection,
    email: string,
  ): Promise<CrmContact[]>;
  createContact(
    connection: ActiveCrmConnection,
    input: CrmContactWrite,
  ): Promise<CrmContact>;
  updateContact(
    connection: ActiveCrmConnection,
    contactId: string,
    input: CrmContactWrite,
  ): Promise<CrmContact>;
  listCompanies(
    connection: ActiveCrmConnection,
    query: CrmListQuery,
  ): Promise<CrmCompany[]>;
  findCompanyByName(
    connection: ActiveCrmConnection,
    name: string,
  ): Promise<CrmCompany[]>;
  createCompany(
    connection: ActiveCrmConnection,
    input: CrmCompanyWrite,
  ): Promise<CrmCompany>;
  updateCompany(
    connection: ActiveCrmConnection,
    companyId: string,
    input: CrmCompanyWrite,
  ): Promise<CrmCompany>;
  listDeals(
    connection: ActiveCrmConnection,
    query: CrmListQuery,
  ): Promise<CrmDeal[]>;
};

export type CrmProviderAvailability = "enabled" | "unavailable" | "coming_soon";

export type CrmProviderDefinition = {
  id: CrmProviderId;
  displayName: string;
  availability: CrmProviderAvailability;
  capabilities: readonly string[];
  integrationId?: string;
};

export type CrmConnectionCompletion = {
  agencyId: number;
  actor: AppActor;
  provider: CrmProviderId;
  nangoConnectionId: string;
  nangoIntegrationId: string;
  status: Exclude<CrmConnectionStatus, "disconnected">;
  externalAccountLabel?: string | null;
  externalAccountId?: string | null;
  scopes?: readonly string[];
  lastValidatedAt?: string | null;
};

export type CrmAuditEvent = {
  connectionId: string;
  agencyId: number;
  principalId: string;
  provider: CrmProviderId;
  eventType: string;
  outcome: "success" | "failure";
  errorCode?: string;
};

export type CrmRepository = {
  listConnections(
    agencyId: number,
    principalId: string,
  ): Promise<CrmConnection[]>;
  listConnectionsForPrincipal(
    principalId: string,
  ): Promise<CrmConnection[]>;
  findActiveConnection(
    agencyId: number,
    provider: CrmProviderId,
    principalId: string,
  ): Promise<ActiveCrmConnection | undefined>;
  findActiveConnectionForPrincipal(
    provider: CrmProviderId,
    principalId: string,
  ): Promise<ActiveCrmConnection | undefined>;
  resolveDefaultTenantId(): Promise<number | undefined>;
  saveConnection(
    completion: CrmConnectionCompletion,
  ): Promise<ActiveCrmConnection>;
  markDisconnected(
    agencyId: number,
    provider: CrmProviderId,
    principalId: string,
    now?: string,
  ): Promise<boolean>;
  markReconnectRequired(
    connectionId: string,
    principalId: string,
    now?: string,
  ): Promise<boolean>;
  appendAuditEvent(event: CrmAuditEvent): Promise<void>;
};

export type CustomerCrmSyncRepository = {
  find(
    agencyId: number,
    customerProfileId: number,
    provider: CrmProviderId,
    objectKind: CustomerCrmObjectKind,
    principalId: string,
  ): Promise<CustomerCrmSyncRecord | undefined>;
  listByCustomerIds(
    agencyId: number,
    customerProfileIds: number[],
    provider: CrmProviderId,
    principalId: string,
  ): Promise<CustomerCrmSyncRecord[]>;
  upsertSuccess(input: CustomerCrmSyncRecordInput): Promise<void>;
  recordFailure(
    input: Omit<CustomerCrmSyncRecordInput, "externalObjectId"> & {
      failureCode: string;
    },
  ): Promise<boolean>;
};

export type CustomerCrmPrimaryLink = {
  provider: CrmProviderId;
  objectKind: CustomerCrmObjectKind;
  url: string;
};

export type CustomerCrmSyncStatus =
  "created" | "updated" | "skipped" | "failed";

export type CustomerCrmSyncReason =
  | "AMBIGUOUS_COMPANY"
  | "AMBIGUOUS_CONTACT"
  | "CRM_CONNECTION_NOT_READY"
  | "CRM_RECONNECT_REQUIRED"
  | "CRM_UNAVAILABLE"
  | "CUSTOMER_NOT_FOUND"
  | "CUSTOMER_NOT_SYNCABLE"
  | "UPSTREAM_FAILURE";

export type CustomerCrmSyncItem = {
  customerId: number;
  provider: CrmProviderId;
  status: CustomerCrmSyncStatus;
  reason?: CustomerCrmSyncReason;
  primaryLink?: CustomerCrmPrimaryLink;
};

export type CustomerCrmSyncResponse = {
  items: CustomerCrmSyncItem[];
  summary: Record<CustomerCrmSyncStatus, number>;
};

export type CustomerCrmLink = CustomerCrmPrimaryLink & { customerId: number };

export class CrmUnavailableError extends Error {
  readonly code = "CRM_UNAVAILABLE" as const;

  constructor(message = "The requested CRM provider is unavailable") {
    super(message);
    this.name = "CrmUnavailableError";
  }
}

export class CrmUpstreamError extends Error {
  constructor(
    public readonly code:
      "NANGO_REQUEST_FAILED" | "RECONNECT_REQUIRED" = "NANGO_REQUEST_FAILED",
    message = "The CRM provider request could not be completed",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CrmUpstreamError";
  }
}

export class CrmConnectionNotFoundError extends Error {
  readonly code = "CRM_CONNECTION_NOT_FOUND" as const;

  constructor(message = "The requested CRM connection was not found") {
    super(message);
    this.name = "CrmConnectionNotFoundError";
  }
}

export class CrmConnectionAccessError extends Error {
  readonly code = "CRM_CONNECTION_ACCESS_DENIED" as const;

  constructor(message = "The actor cannot access this CRM connection") {
    super(message);
    this.name = "CrmConnectionAccessError";
  }
}

export function isCrmProviderId(value: string): value is CrmProviderId {
  return crmProviderIds.includes(value as CrmProviderId);
}

export function requireCrmProviderId(value: string): CrmProviderId {
  if (!isCrmProviderId(value))
    throw new CrmUnavailableError("The requested CRM provider is unavailable");
  return value;
}
