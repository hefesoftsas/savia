import { z } from "@hono/zod-openapi";
import type { AppActor } from "../auth/types";

export const whatsappProviderId = "whatsapp" as const;

export type WhatsappProviderId = typeof whatsappProviderId;

export const whatsappConnectionStatuses = [
  "pending",
  "connected",
  "reconnect_required",
  "disconnected",
  "failed",
] as const;

export const whatsappConnectionStatusSchema = z.enum(
  whatsappConnectionStatuses,
);

export type WhatsappConnectionStatus =
  (typeof whatsappConnectionStatuses)[number];

export type WhatsappConnection = {
  id: string;
  agencyId: number;
  tenantId?: number;
  provider: WhatsappProviderId;
  status: WhatsappConnectionStatus;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  wabaId: string | null;
  externalAccountLabel: string | null;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActiveWhatsappConnection = WhatsappConnection & {
  nangoConnectionId: string;
  nangoIntegrationId: string;
};

export type WhatsappConnectionSummary = {
  connectionId: string;
  providerConfigKey: string;
  organizationId: string | null;
  agencyId: number | null;
  metadata: Record<string, string | string[]>;
};

export type WhatsappProxyRequest = {
  method: "GET" | "POST";
  path: string;
  connection: ActiveWhatsappConnection;
  body?: unknown;
};

export type WhatsappNangoClient = {
  createConnectSession(input: { actor: AppActor; agencyId: number }): Promise<{
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
  ): Promise<WhatsappConnectionSummary>;
  deleteConnection(connectionId: string, integrationId: string): Promise<void>;
  proxy(request: WhatsappProxyRequest): Promise<Response>;
};

export type WhatsappProviderDefinition = {
  id: WhatsappProviderId;
  displayName: string;
  availability: "enabled" | "unavailable";
  capabilities: readonly string[];
  integrationId?: string;
};

export type WhatsappConnectionCompletion = {
  agencyId: number;
  actor: AppActor;
  nangoConnectionId: string;
  nangoIntegrationId: string;
  status: Exclude<WhatsappConnectionStatus, "disconnected">;
  phoneNumberId?: string | null;
  displayPhoneNumber?: string | null;
  wabaId?: string | null;
  externalAccountLabel?: string | null;
  lastValidatedAt?: string | null;
};

export type WhatsappNumberUpdate = {
  agencyId: number;
  principalId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string | null;
  wabaId?: string | null;
  externalAccountLabel?: string | null;
  lastValidatedAt?: string | null;
};

export type WhatsappRepository = {
  listConnections(
    agencyId: number,
    principalId: string,
  ): Promise<WhatsappConnection[]>;
  findActiveConnection(
    agencyId: number,
    principalId: string,
  ): Promise<ActiveWhatsappConnection | undefined>;
  saveConnection(
    completion: WhatsappConnectionCompletion,
  ): Promise<ActiveWhatsappConnection>;
  markDisconnected(
    agencyId: number,
    principalId: string,
    now?: string,
  ): Promise<boolean>;
  markReconnectRequired(
    connectionId: string,
    principalId: string,
    now?: string,
  ): Promise<boolean>;
  updateNumber(
    update: WhatsappNumberUpdate,
  ): Promise<ActiveWhatsappConnection | undefined>;
};

export class WhatsappUnavailableError extends Error {
  readonly code = "WHATSAPP_UNAVAILABLE" as const;

  constructor(message = "WhatsApp messaging is unavailable") {
    super(message);
    this.name = "WhatsappUnavailableError";
  }
}

export class WhatsappUpstreamError extends Error {
  constructor(
    public readonly code:
      "NANGO_REQUEST_FAILED" | "RECONNECT_REQUIRED" = "NANGO_REQUEST_FAILED",
    message = "The WhatsApp provider request could not be completed",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WhatsappUpstreamError";
  }
}

export class WhatsappConnectionNotFoundError extends Error {
  readonly code = "WHATSAPP_CONNECTION_NOT_FOUND" as const;

  constructor(message = "The requested WhatsApp connection was not found") {
    super(message);
    this.name = "WhatsappConnectionNotFoundError";
  }
}

export class WhatsappConnectionAccessError extends Error {
  readonly code = "WHATSAPP_CONNECTION_ACCESS_DENIED" as const;

  constructor(message = "The actor cannot access this WhatsApp connection") {
    super(message);
    this.name = "WhatsappConnectionAccessError";
  }
}

export class WhatsappOrganizationConnectionExistsError extends Error {
  readonly code = "WHATSAPP_ORGANIZATION_CONNECTION_EXISTS" as const;

  constructor() {
    super(
      "This organization already has a WhatsApp connection. Disconnect it before connecting another one.",
    );
    this.name = "WhatsappOrganizationConnectionExistsError";
  }
}

export class WhatsappConnectionAlreadyAssignedError extends Error {
  readonly code = "WHATSAPP_CONNECTION_ALREADY_ASSIGNED" as const;

  constructor() {
    super(
      "This Nango connection is already assigned to an organization. Authorize a separate connection for this organization.",
    );
    this.name = "WhatsappConnectionAlreadyAssignedError";
  }
}
