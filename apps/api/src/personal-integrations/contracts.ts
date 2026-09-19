export const personalIntegrationProviderIds = [
  "google_drive",
  "gmail",
  "google_calendar",
  "outlook",
  "onedrive_personal",
  "onedrive_business",
] as const;

export const personalIntegrationConnectionStatuses = [
  "pending",
  "connected",
  "reconnect_required",
  "disconnected",
  "failed",
] as const;

export type PersonalIntegrationProviderId =
  (typeof personalIntegrationProviderIds)[number];
export type PersonalIntegrationConnectionStatus =
  (typeof personalIntegrationConnectionStatuses)[number];
export type PersonalIntegrationProviderAvailability =
  | "enabled"
  | "unavailable";

export type PersonalIntegrationProviderDefinition = {
  id: PersonalIntegrationProviderId;
  displayName: string;
  availability: PersonalIntegrationProviderAvailability;
  capabilities: readonly string[];
  integrationId?: string;
};

export type PersonalIntegrationConnection = {
  id: string;
  provider: PersonalIntegrationProviderId;
  status: PersonalIntegrationConnectionStatus;
  externalAccountLabel: string | null;
  scopes: string[];
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivePersonalIntegrationConnection =
  PersonalIntegrationConnection & {
    principalId: string;
    nangoConnectionId: string;
    nangoIntegrationId: string;
    externalAccountId: string | null;
  };

export type PersonalNangoConnectionSummary = {
  connectionId: string;
  providerConfigKey: string;
  tags: Record<string, string>;
  metadata: Record<string, string | string[]>;
};

export type PersonalIntegrationNangoClient = {
  createConnectSession(input: {
    actor: AppActor;
    provider: PersonalIntegrationProviderId;
    integrationId: string;
  }): Promise<{
    token: string;
    expiresAt: string;
    connectUrl: string;
    apiUrl: string;
  }>;
  createReconnectSession(input: {
    connectionId: string;
    integrationId: string;
  }): Promise<{
    token: string;
    expiresAt: string;
    connectUrl: string;
    apiUrl: string;
  }>;
  getConnection(
    connectionId: string,
    integrationId: string,
  ): Promise<PersonalNangoConnectionSummary>;
  deleteConnection(connectionId: string, integrationId: string): Promise<void>;
  proxy(request: {
    method: "GET" | "POST" | "PUT";
    path: string;
    connection: ActivePersonalIntegrationConnection;
    body?: unknown;
    rawBody?: string;
    contentType?: string;
    upstreamHeaders?: Partial<Record<"if-match" | "prefer", string>>;
  }): Promise<Response>;
};

export type PersonalIntegrationCompletion = {
  principalId: string;
  provider: PersonalIntegrationProviderId;
  nangoConnectionId: string;
  nangoIntegrationId: string;
  status: Exclude<PersonalIntegrationConnectionStatus, "disconnected">;
  externalAccountLabel?: string | null;
  externalAccountId?: string | null;
  scopes?: readonly string[];
  lastValidatedAt?: string | null;
};

export type PersonalIntegrationRepository = {
  listConnections(principalId: string): Promise<PersonalIntegrationConnection[]>;
  findActiveConnection(
    principalId: string,
    provider: PersonalIntegrationProviderId,
  ): Promise<ActivePersonalIntegrationConnection | undefined>;
  saveConnection(
    completion: PersonalIntegrationCompletion,
  ): Promise<ActivePersonalIntegrationConnection>;
  markDisconnected(
    principalId: string,
    provider: PersonalIntegrationProviderId,
    now?: string,
  ): Promise<boolean>;
  markReconnectRequired(connectionId: string, now?: string): Promise<boolean>;
  appendAuditEvent(input: {
    connection: ActivePersonalIntegrationConnection;
    eventType: "send-email" | "create-event" | "upload-file";
    outcome: "succeeded" | "failed";
    errorCode?: string;
  }): Promise<void>;
};

export class PersonalIntegrationUnavailableError extends Error {
  readonly code = "PERSONAL_INTEGRATION_UNAVAILABLE" as const;

  constructor(message = "The requested personal integration is unavailable") {
    super(message);
    this.name = "PersonalIntegrationUnavailableError";
  }
}

export class PersonalIntegrationUpstreamError extends Error {
  readonly code = "PERSONAL_INTEGRATION_REQUEST_FAILED" as const;

  constructor(message = "The personal integration request could not be completed") {
    super(message);
    this.name = "PersonalIntegrationUpstreamError";
  }
}

export class PersonalIntegrationAccessError extends Error {
  readonly code = "PERSONAL_INTEGRATION_ACCESS_DENIED" as const;

  constructor(message = "The personal integration does not belong to this user") {
    super(message);
    this.name = "PersonalIntegrationAccessError";
  }
}

export class PersonalIntegrationInputError extends Error {
  readonly code = "PERSONAL_INTEGRATION_ACTION_INVALID" as const;

  constructor(message = "The personal integration action is invalid") {
    super(message);
    this.name = "PersonalIntegrationInputError";
  }
}

export function isPersonalIntegrationProviderId(
  value: string,
): value is PersonalIntegrationProviderId {
  return (personalIntegrationProviderIds as readonly string[]).includes(value);
}
import type { AppActor } from "../auth/types";
