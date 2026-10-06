import {
  nativeConfigurationSchema,
  nativeReplySchema,
  type NativeReply,
} from "./native";
import { nativeInboundSchema } from "./native-input";
import { dialectFor, type SqlDialect } from "@savia/db/dialect";
import type { ActiveWhatsappConnection } from "./contracts";
import type {
  WhatsappAssistantBinding,
  WhatsappAssistantSettings,
  WhatsappDeliveryInput,
  WhatsappInboundInput,
} from "./inbound-contracts";

type BindingRow = {
  tenant_id: number;
  connection_id: string;
  employee_id: string;
  enabled: number;
  allowed_contacts: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  native_config: string;
};

type ConnectionRow = {
  id: string;
  tenant_id: number;
  nango_connection_id: string;
  nango_integration_id: string;
  status: ActiveWhatsappConnection["status"];
  phone_number_id: string | null;
  display_phone_number: string | null;
  waba_id: string | null;
  created_by_principal_id: string;
  external_account_label: string | null;
  last_validated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WhatsappInboxItem = WhatsappInboundInput & {
  tenantId: number;
  connectionId: string;
  assignedEmployeeId: string | null;
  assignedOwnerPrincipalId: string | null;
  normalizedContact: string;
  attempts: number;
  leaseToken: string;
};

export type WhatsappHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_CONTACT_DIGITS = 32;
const MAX_MESSAGE_LENGTH = 4096;
export const GENERATION_ATTEMPTS = 3;
// Media download, transcription and completion run sequentially with bounded timeouts.
const PROCESSING_LEASE_MS = 4 * 60 * 1000;
const MESSAGE_AGE_LIMIT_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function normalizeWhatsappContact(value: string): string {
  return value.replace(/\D/g, "");
}

function parseContacts(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  )
    throw new Error("Stored WhatsApp contact allowlist is invalid");
  return parsed.map((entry) => normalizeWhatsappContact(entry));
}

function settingFromRow(row: BindingRow): WhatsappAssistantSettings {
  return {
    tenantId: row.tenant_id,
    connectionId: row.connection_id,
    employeeId: row.employee_id,
    enabled: row.enabled === 1,
    allowedContacts: parseContacts(row.allowed_contacts),
    updatedBy: row.updated_by,
    ...(row.native_config && row.native_config !== "{}"
      ? {
          native: nativeConfigurationSchema.parse(
            JSON.parse(row.native_config),
          ),
        }
      : {}),
  };
}

function activeConnection(row: ConnectionRow): ActiveWhatsappConnection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agencyId: row.tenant_id,
    provider: "whatsapp",
    status: row.status,
    phoneNumberId: row.phone_number_id,
    displayPhoneNumber: row.display_phone_number,
    wabaId: row.waba_id,
    externalAccountLabel: row.external_account_label,
    lastValidatedAt: row.last_validated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nangoConnectionId: row.nango_connection_id,
    nangoIntegrationId: row.nango_integration_id,
  };
}

function receiptRank(status: WhatsappDeliveryInput["status"]): number {
  switch (status) {
    case "sent":
    case "failed":
      return 1;
    case "delivered":
      return 2;
    case "read":
      return 3;
  }
}

function providerTimestamp(
  value: string,
  now = Date.now(),
): string | undefined {
  const epoch = /^\d{10,13}$/.test(value)
    ? Number(value) * (value.length === 10 ? 1000 : 1)
    : Date.parse(value);
  if (
    !Number.isFinite(epoch) ||
    epoch > now + MAX_FUTURE_SKEW_MS ||
    now - epoch > MESSAGE_AGE_LIMIT_MS
  )
    return undefined;
  return new Date(epoch).toISOString();
}

function receiptStatusExpression(): string {
  return `CASE
    WHEN excluded.delivery_rank > whatsapp_delivery_receipts.delivery_rank
      OR (excluded.delivery_rank = whatsapp_delivery_receipts.delivery_rank
        AND excluded.status = 'failed' AND whatsapp_delivery_receipts.status = 'sent')
    THEN excluded.status ELSE whatsapp_delivery_receipts.status END`;
}

function errorExistsExpression(
  document: string,
  code: string,
  dialect: "sqlite" | "postgres",
): string {
  return dialect === "postgres"
    ? `EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(${document}::jsonb,'[]'::jsonb)) AS entry(value) WHERE entry.value=(${code}))`
    : `EXISTS (SELECT 1 FROM json_each(${document}) WHERE value=(${code}))`;
}

function appendErrorExpression(
  document: string,
  code: string,
  dialect: "sqlite" | "postgres",
): string {
  return dialect === "postgres"
    ? `(COALESCE(${document}::jsonb,'[]'::jsonb) || jsonb_build_array(${code}))::text`
    : `json_insert(${document},'$[#]',${code})`;
}

export class WhatsappInboundRepository {
  constructor(
    private readonly db: D1Database,
    private readonly dialectOverride?: SqlDialect,
  ) {}

  private sqlDialect(): SqlDialect {
    return this.dialectOverride ?? dialectFor(this.db);
  }

  async getSettings(
    tenantId: number,
  ): Promise<WhatsappAssistantSettings | undefined> {
    const row = await this.db
      .prepare(
        `SELECT tenant_id,connection_id,employee_id,enabled,allowed_contacts,updated_by,created_at,updated_at,native_config
         FROM tenant_whatsapp_assistant_bindings WHERE tenant_id=?`,
      )
      .bind(tenantId)
      .first<BindingRow>();
    return row ? settingFromRow(row) : undefined;
  }

  async configure(settings: WhatsappAssistantSettings): Promise<void> {
    if (
      !Number.isSafeInteger(settings.tenantId) ||
      settings.tenantId <= 0 ||
      !settings.connectionId.trim() ||
      !settings.employeeId.trim() ||
      !settings.updatedBy.trim() ||
      typeof settings.enabled !== "boolean" ||
      !Array.isArray(settings.allowedContacts)
    )
      throw new Error("WhatsApp assistant settings are invalid");

    const allowedContacts = settings.allowedContacts.map((contact) => {
      if (typeof contact !== "string")
        throw new Error("WhatsApp contacts must be phone numbers");
      const normalized = normalizeWhatsappContact(contact);
      if (!normalized || normalized.length > MAX_CONTACT_DIGITS)
        throw new Error("WhatsApp contacts must contain 1 to 32 digits");
      return normalized;
    });
    const uniqueContacts = [...new Set(allowedContacts)];
    if (settings.enabled && uniqueContacts.length === 0)
      throw new Error(
        "Enable WhatsApp assistant only with an explicit contact allowlist",
      );
    const native = settings.native
      ? nativeConfigurationSchema.parse(settings.native)
      : undefined;
    const owner = await this.db
      .prepare(
        `SELECT 1
         FROM tenant_whatsapp_connections c
         JOIN tenants t ON t.id=c.tenant_id
         JOIN identity_principal p
           ON p.id=c.created_by_principal_id AND (?=0 OR p.is_active=1)
         LEFT JOIN identity_tenant_membership m
           ON m.principal_id=p.id AND m.tenant_id=c.tenant_id
             AND m.is_active=1 AND m.role IN ('tenant_admin','agency_admin')
         JOIN assistant_virtual_employees e
           ON e.id=? AND e.agency_id=c.tenant_id AND (?=0 OR e.status='active')
         JOIN identity_principal updater ON updater.id=? AND updater.is_active=1
         WHERE c.id=? AND c.tenant_id=?
           AND (?=0 OR (t.is_active=1 AND c.status='connected'
             AND c.disconnected_at IS NULL AND m.id IS NOT NULL))
           AND (EXISTS (SELECT 1 FROM identity_tenant_membership um
                 JOIN tenants ut ON ut.id=um.tenant_id AND ut.is_active=1
                 WHERE um.principal_id=updater.id AND um.tenant_id=c.tenant_id
                   AND um.is_active=1 AND um.role IN ('tenant_admin','agency_admin'))
             OR EXISTS (SELECT 1 FROM identity_global_role g
                 WHERE g.principal_id=updater.id AND g.role='platform_admin'))
         LIMIT 1`,
      )
      .bind(
        settings.enabled ? 1 : 0,
        settings.employeeId,
        settings.enabled ? 1 : 0,
        settings.updatedBy,
        settings.connectionId,
        settings.tenantId,
        settings.enabled ? 1 : 0,
      )
      .first();
    if (!owner)
      throw new Error(
        "WhatsApp assistant settings do not match an active tenant connection and employee",
      );

    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO tenant_whatsapp_assistant_bindings
           (tenant_id,connection_id,employee_id,enabled,allowed_contacts,updated_by,created_at,updated_at,native_config)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id) DO UPDATE SET
           connection_id=excluded.connection_id,
           employee_id=excluded.employee_id,
           enabled=excluded.enabled,
           allowed_contacts=excluded.allowed_contacts,
           updated_by=excluded.updated_by,
           updated_at=excluded.updated_at,
           native_config=CASE WHEN ?=1 THEN excluded.native_config ELSE tenant_whatsapp_assistant_bindings.native_config END`,
      )
      .bind(
        settings.tenantId,
        settings.connectionId,
        settings.employeeId,
        settings.enabled ? 1 : 0,
        JSON.stringify(uniqueContacts),
        settings.updatedBy,
        now,
        now,
        JSON.stringify(native ?? {}),
        native ? 1 : 0,
      )
      .run();
  }

  async resolve(
    phoneNumberId: string,
    wabaId: string,
  ): Promise<WhatsappAssistantBinding | undefined> {
    const result = await this.db
      .prepare(
        `SELECT e.id AS active_employee_id,b.tenant_id,b.connection_id,b.employee_id,b.enabled,b.allowed_contacts,
                b.updated_by,b.created_at,b.updated_at,b.native_config,
                c.id,c.tenant_id AS connection_tenant_id,c.created_by_principal_id,
                c.nango_connection_id,c.nango_integration_id,
                c.status,c.phone_number_id,c.display_phone_number,c.waba_id,c.external_account_label,
                c.last_validated_at,c.created_at AS connection_created_at,c.updated_at AS connection_updated_at
         FROM tenant_whatsapp_assistant_bindings b
         JOIN tenant_whatsapp_connections c ON c.id=b.connection_id AND c.tenant_id=b.tenant_id
         JOIN tenants t ON t.id=b.tenant_id AND t.is_active=1
         JOIN identity_principal p ON p.id=c.created_by_principal_id AND p.is_active=1
         JOIN identity_tenant_membership m
           ON m.principal_id=p.id AND m.tenant_id=b.tenant_id AND m.is_active=1
         LEFT JOIN assistant_virtual_employees e
           ON e.id=b.employee_id AND e.agency_id=b.tenant_id AND e.status='active'
         WHERE b.enabled=1 AND c.status='connected' AND c.disconnected_at IS NULL
           AND c.phone_number_id=? AND c.waba_id=?`,
      )
      .bind(phoneNumberId, wabaId)
      .all<
        BindingRow &
          ConnectionRow & {
            connection_tenant_id: number;
            connection_created_at: string;
            connection_updated_at: string;
          }
      >();
    if (result.results.length !== 1) return undefined;
    const row = result.results[0];
    if (
      !(row as typeof row & { active_employee_id?: string }).active_employee_id
    ) {
      const channel = await this.db
        .prepare(
          "SELECT config_json FROM whatsapp_channel_settings WHERE connection_id=? AND tenant_id=?",
        )
        .bind(row.connection_id, row.tenant_id)
        .first<{ config_json: string }>();
      if (!channel || JSON.parse(channel.config_json).routingEnabled !== true)
        return undefined;
    }
    const settings = settingFromRow(row);
    return {
      ...settings,
      connection: activeConnection({
        ...row,
        tenant_id: row.connection_tenant_id,
        created_at: row.connection_created_at,
        updated_at: row.connection_updated_at,
      }),
      ownerPrincipalId: row.created_by_principal_id,
    };
  }

  async receive(input: WhatsappInboundInput): Promise<boolean> {
    const normalizedContact = normalizeWhatsappContact(input.contactPhone);
    if (
      !input.messageId.trim() ||
      !input.phoneNumberId.trim() ||
      !input.wabaId.trim() ||
      !normalizedContact ||
      normalizedContact.length > MAX_CONTACT_DIGITS ||
      !input.text.trim() ||
      input.text.length > MAX_MESSAGE_LENGTH ||
      !input.timestamp.trim()
    )
      return false;
    const canonicalTimestamp = providerTimestamp(input.timestamp);
    if (!canonicalTimestamp) return false;
    const binding = await this.resolve(input.phoneNumberId, input.wabaId);
    if (!binding || !binding.allowedContacts.includes(normalizedContact))
      return false;

    const inserted = await this.db
      .prepare(
        `INSERT INTO whatsapp_inbox
           (message_id,phone_number_id,waba_id,contact_phone,normalized_contact,message_text,
            provider_timestamp,tenant_id,connection_id,assigned_employee_id,
            assigned_owner_principal_id,state,received_at,input_payload)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?) ON CONFLICT(message_id) DO NOTHING`,
      )
      .bind(
        input.messageId,
        input.phoneNumberId,
        input.wabaId,
        input.contactPhone,
        normalizedContact,
        input.text,
        canonicalTimestamp,
        binding.tenantId,
        binding.connectionId,
        binding.employeeId,
        binding.ownerPrincipalId,
        new Date().toISOString(),
        input.native
          ? JSON.stringify(nativeInboundSchema.parse(input.native))
          : null,
      )
      .run();
    return inserted.meta.changes === 1;
  }

  async receipt(input: WhatsappDeliveryInput): Promise<void> {
    const rank = receiptRank(input.status);
    const dialect = this.sqlDialect().name;
    const receiptCode = `SELECT error_code FROM whatsapp_delivery_receipts
      WHERE phone_number_id=? AND waba_id=? AND message_id=?`;
    const errorAlreadyStored = errorExistsExpression(
      "delivery_error_codes",
      `(${receiptCode})`,
      dialect,
    );
    const appendError = appendErrorExpression(
      "delivery_error_codes",
      `(${receiptCode})`,
      dialect,
    );
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO whatsapp_delivery_receipts
             (phone_number_id,waba_id,message_id,status,delivery_rank,error_code,updated_at)
           SELECT ?,?,?,?,?,?,? WHERE EXISTS (
             SELECT 1 FROM tenant_whatsapp_connections
             WHERE phone_number_id=? AND waba_id=?
           )
           ON CONFLICT(phone_number_id,waba_id,message_id) DO UPDATE SET
             status=${receiptStatusExpression()},
             delivery_rank=${dialect === "postgres" ? "GREATEST" : "MAX"}(whatsapp_delivery_receipts.delivery_rank,excluded.delivery_rank),
             error_code=COALESCE(excluded.error_code,whatsapp_delivery_receipts.error_code),
             updated_at=excluded.updated_at`,
        )
        .bind(
          input.phoneNumberId,
          input.wabaId,
          input.messageId,
          input.status,
          rank,
          input.errorCode ?? null,
          new Date().toISOString(),
          input.phoneNumberId,
          input.wabaId,
        ),
      this.db
        .prepare(
          `UPDATE whatsapp_inbox SET
             delivery_status=(SELECT status FROM whatsapp_delivery_receipts
               WHERE phone_number_id=? AND waba_id=? AND message_id=?),
             delivery_rank=(SELECT delivery_rank FROM whatsapp_delivery_receipts
               WHERE phone_number_id=? AND waba_id=? AND message_id=?),
             delivery_error_codes=CASE
               WHEN (SELECT error_code FROM whatsapp_delivery_receipts
                 WHERE phone_number_id=? AND waba_id=? AND message_id=?) IS NOT NULL
                AND NOT ${errorAlreadyStored}
               THEN ${appendError}
               ELSE delivery_error_codes END
           WHERE outbound_message_id=? AND phone_number_id=? AND waba_id=?`,
        )
        .bind(
          input.phoneNumberId,
          input.wabaId,
          input.messageId,
          input.phoneNumberId,
          input.wabaId,
          input.messageId,
          input.phoneNumberId,
          input.wabaId,
          input.messageId,
          input.phoneNumberId,
          input.wabaId,
          input.messageId,
          input.phoneNumberId,
          input.wabaId,
          input.messageId,
          input.messageId,
          input.phoneNumberId,
          input.wabaId,
        ),
    ]);
  }

  async candidates(limit: number, now: string): Promise<string[]> {
    const batchLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(Math.floor(limit), 50))
      : 10;
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE whatsapp_inbox SET state='failed',failure_code='generation_lease_expired',
             lease_token=NULL,lease_until=NULL
           WHERE state='generating' AND lease_until<=? AND generation_attempts>=?`,
        )
        .bind(now, GENERATION_ATTEMPTS),
      this.db
        .prepare(
          `UPDATE whatsapp_inbox SET state='failed',failure_code='outbound_send_uncertain',
             lease_token=NULL,lease_until=NULL
           WHERE state='responding' AND lease_until<=?`,
        )
        .bind(now),
    ]);
    const rows = await this.db
      .prepare(
        `SELECT message_id FROM whatsapp_inbox
         WHERE ((state='pending' AND (retry_at IS NULL OR retry_at<=?))
            OR (state='generating' AND lease_until<=? AND generation_attempts<?))
         AND NOT EXISTS (
           SELECT 1 FROM whatsapp_inbox active
           WHERE active.connection_id=whatsapp_inbox.connection_id
             AND active.normalized_contact=whatsapp_inbox.normalized_contact
             AND active.message_id<>whatsapp_inbox.message_id
             AND active.state IN ('generating','responding')
         ) AND NOT EXISTS (
           SELECT 1 FROM whatsapp_inbox prior
           WHERE prior.connection_id=whatsapp_inbox.connection_id
             AND prior.normalized_contact=whatsapp_inbox.normalized_contact
             AND prior.state IN ('pending','generating','responding')
             AND (prior.received_at<whatsapp_inbox.received_at OR
               (prior.received_at=whatsapp_inbox.received_at AND prior.message_id<whatsapp_inbox.message_id))
         )
         ORDER BY received_at,message_id LIMIT ?`,
      )
      .bind(now, now, GENERATION_ATTEMPTS, batchLimit)
      .all<{ message_id: string }>();
    return rows.results.map((row) => row.message_id);
  }

  async claim(
    messageId: string,
    token: string,
    now: string,
  ): Promise<WhatsappInboxItem | undefined> {
    const leaseUntil = new Date(
      Date.parse(now) + PROCESSING_LEASE_MS,
    ).toISOString();
    let result;
    try {
      result = await this.db
        .prepare(
          `UPDATE whatsapp_inbox SET state='generating',generation_attempts=generation_attempts+1,
           lease_token=?,lease_until=?,retry_at=NULL
         WHERE message_id=? AND (
           (state='pending' AND (retry_at IS NULL OR retry_at<=?))
           OR (state='generating' AND lease_until<=? AND generation_attempts<?)
         ) AND NOT EXISTS (
           SELECT 1 FROM whatsapp_inbox active
           WHERE active.connection_id=whatsapp_inbox.connection_id
             AND active.normalized_contact=whatsapp_inbox.normalized_contact
             AND active.message_id<>whatsapp_inbox.message_id
             AND active.state IN ('generating','responding')
         ) AND NOT EXISTS (
           SELECT 1 FROM whatsapp_inbox prior
           WHERE prior.connection_id=whatsapp_inbox.connection_id
             AND prior.normalized_contact=whatsapp_inbox.normalized_contact
             AND prior.state IN ('pending','generating','responding')
             AND (prior.received_at<whatsapp_inbox.received_at OR
               (prior.received_at=whatsapp_inbox.received_at AND prior.message_id<whatsapp_inbox.message_id))
         )`,
        )
        .bind(token, leaseUntil, messageId, now, now, GENERATION_ATTEMPTS)
        .run();
    } catch (error) {
      if (String(error).includes("whatsapp_inbox_active_contact_unique"))
        return undefined;
      throw error;
    }
    if (result.meta.changes !== 1) return undefined;
    const row = await this.db
      .prepare(
        `SELECT message_id,phone_number_id,waba_id,contact_phone,message_text,provider_timestamp,
           tenant_id,connection_id,assigned_employee_id,assigned_owner_principal_id,
           normalized_contact,generation_attempts,lease_token,input_payload
         FROM whatsapp_inbox WHERE message_id=? AND lease_token=? AND state='generating'`,
      )
      .bind(messageId, token)
      .first<{
        message_id: string;
        phone_number_id: string;
        waba_id: string;
        contact_phone: string;
        message_text: string;
        provider_timestamp: string;
        tenant_id: number;
        connection_id: string;
        assigned_employee_id: string | null;
        assigned_owner_principal_id: string | null;
        normalized_contact: string;
        generation_attempts: number;
        lease_token: string;
        input_payload: string | null;
      }>();
    return row
      ? {
          messageId: row.message_id,
          phoneNumberId: row.phone_number_id,
          wabaId: row.waba_id,
          contactPhone: row.contact_phone,
          text: row.message_text,
          timestamp: row.provider_timestamp,
          tenantId: row.tenant_id,
          connectionId: row.connection_id,
          assignedEmployeeId: row.assigned_employee_id,
          assignedOwnerPrincipalId: row.assigned_owner_principal_id,
          normalizedContact: row.normalized_contact,
          attempts: row.generation_attempts,
          leaseToken: row.lease_token,
          ...(row.input_payload
            ? {
                native: nativeInboundSchema.parse(
                  JSON.parse(row.input_payload),
                ),
              }
            : {}),
        }
      : undefined;
  }

  async getHistory(
    item: Pick<
      WhatsappInboxItem,
      | "connectionId"
      | "phoneNumberId"
      | "wabaId"
      | "normalizedContact"
      | "assignedEmployeeId"
      | "assignedOwnerPrincipalId"
    >,
  ): Promise<WhatsappHistoryMessage[]> {
    if (!item.assignedEmployeeId || !item.assignedOwnerPrincipalId) return [];
    const rows = await this.db
      .prepare(
        `SELECT message_text,reply_text FROM whatsapp_inbox
         WHERE connection_id=? AND phone_number_id=? AND waba_id=? AND normalized_contact=?
           AND assigned_employee_id=? AND assigned_owner_principal_id=?
           AND state='completed' AND reply_text IS NOT NULL
         ORDER BY received_at DESC,message_id DESC LIMIT 20`,
      )
      .bind(
        item.connectionId,
        item.phoneNumberId,
        item.wabaId,
        item.normalizedContact,
        item.assignedEmployeeId,
        item.assignedOwnerPrincipalId,
      )
      .all<{ message_text: string; reply_text: string }>();
    return rows.results.reverse().flatMap((row) => [
      { role: "user" as const, content: row.message_text },
      { role: "assistant" as const, content: row.reply_text },
    ]);
  }

  async isWithinReplyWindow(
    message:
      | string
      | Pick<
          WhatsappInboxItem,
          | "messageId"
          | "phoneNumberId"
          | "wabaId"
          | "tenantId"
          | "connectionId"
          | "assignedEmployeeId"
          | "assignedOwnerPrincipalId"
        >,
    now = Date.now(),
  ): Promise<boolean> {
    const messageId = typeof message === "string" ? message : message.messageId;
    const scope = typeof message === "string" ? undefined : message;
    const query = this.db
      .prepare(
        `SELECT i.provider_timestamp FROM whatsapp_inbox i
         JOIN tenant_whatsapp_connections c
           ON c.id=i.connection_id AND c.tenant_id=i.tenant_id
           AND c.phone_number_id=i.phone_number_id AND c.waba_id=i.waba_id
         WHERE i.message_id=?
           AND (? = 0 OR (i.phone_number_id=? AND i.waba_id=? AND i.tenant_id=? AND i.connection_id=?
             AND i.assigned_employee_id=? AND i.assigned_owner_principal_id=?))`,
      )
      .bind(
        messageId,
        scope ? 1 : 0,
        scope?.phoneNumberId ?? null,
        scope?.wabaId ?? null,
        scope?.tenantId ?? null,
        scope?.connectionId ?? null,
        scope?.assignedEmployeeId ?? null,
        scope?.assignedOwnerPrincipalId ?? null,
      );
    const timestamp = await query.first<string>("provider_timestamp");
    const receivedAt = timestamp ? Date.parse(timestamp) : Number.NaN;
    return (
      Number.isFinite(receivedAt) && now - receivedAt <= MESSAGE_AGE_LIMIT_MS
    );
  }

  async beginResponse(
    messageId: string,
    token: string,
    reply: string,
    now: string,
    payload?: NativeReply,
  ): Promise<boolean> {
    const leaseUntil = new Date(
      Date.parse(now) + PROCESSING_LEASE_MS,
    ).toISOString();
    const result = await this.db
      .prepare(
        `UPDATE whatsapp_inbox SET state='responding',reply_text=?,send_started_at=?,lease_until=?,reply_payload=?
         WHERE message_id=? AND state='generating' AND lease_token=? AND lease_until>?`,
      )
      .bind(
        reply.replace(/CONFIRMAR [A-Z2-7]{10}/g, "[Confirmation pending]"),
        now,
        leaseUntil,
        payload
          ? JSON.stringify(nativeReplySchema.parse(payload)).replace(
              /(?:confirm|cancel):[a-f\d-]{36}:[a-f\d]{32}/g,
              "[Confirmation pending]",
            )
          : null,
        messageId,
        token,
        now,
      )
      .run();
    return result.meta.changes === 1;
  }

  async complete(
    messageId: string,
    token: string,
    outboundId: string,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const dialect = this.sqlDialect().name;
    const receiptCode = `SELECT error_code FROM whatsapp_delivery_receipts r
      WHERE r.phone_number_id=whatsapp_inbox.phone_number_id
        AND r.waba_id=whatsapp_inbox.waba_id AND r.message_id=?`;
    const codeIsStored = errorExistsExpression(
      "whatsapp_inbox.delivery_error_codes",
      `(${receiptCode})`,
      dialect,
    );
    const appendError = appendErrorExpression(
      "whatsapp_inbox.delivery_error_codes",
      `(${receiptCode})`,
      dialect,
    );
    const result = await this.db.batch([
      this.db
        .prepare(
          `UPDATE whatsapp_inbox SET state='completed',outbound_message_id=?,delivery_status='sent',
             delivery_rank=1,completed_at=?,lease_token=NULL,lease_until=NULL
           WHERE message_id=? AND state='responding' AND lease_token=?`,
        )
        .bind(outboundId, now, messageId, token),
      this.db
        .prepare(
          `UPDATE whatsapp_inbox SET
             delivery_status=(SELECT status FROM whatsapp_delivery_receipts r
               WHERE r.phone_number_id=whatsapp_inbox.phone_number_id AND r.waba_id=whatsapp_inbox.waba_id
                 AND r.message_id=?),
             delivery_rank=(SELECT delivery_rank FROM whatsapp_delivery_receipts r
               WHERE r.phone_number_id=whatsapp_inbox.phone_number_id AND r.waba_id=whatsapp_inbox.waba_id
                 AND r.message_id=?),
             delivery_error_codes=CASE
               WHEN (SELECT error_code FROM whatsapp_delivery_receipts r
                 WHERE r.phone_number_id=whatsapp_inbox.phone_number_id AND r.waba_id=whatsapp_inbox.waba_id
                   AND r.message_id=?) IS NULL OR ${codeIsStored} THEN whatsapp_inbox.delivery_error_codes
               ELSE ${appendError} END
           WHERE message_id=? AND outbound_message_id=? AND EXISTS (
             SELECT 1 FROM whatsapp_delivery_receipts r WHERE r.phone_number_id=whatsapp_inbox.phone_number_id
               AND r.waba_id=whatsapp_inbox.waba_id AND r.message_id=?)`,
        )
        .bind(
          outboundId,
          outboundId,
          outboundId,
          outboundId,
          outboundId,
          messageId,
          outboundId,
          outboundId,
        ),
    ]);
    return result[0].meta.changes === 1;
  }

  async retryGeneration(
    messageId: string,
    token: string,
    attempts: number,
  ): Promise<void> {
    const exhausted = attempts >= GENERATION_ATTEMPTS;
    const retryAt = exhausted
      ? null
      : new Date(
          Date.now() + Math.min(60_000, 5_000 * 2 ** (attempts - 1)),
        ).toISOString();
    await this.db
      .prepare(
        `UPDATE whatsapp_inbox SET state=?,retry_at=?,failure_code=?,lease_token=NULL,lease_until=NULL
         WHERE message_id=? AND state='generating' AND lease_token=?`,
      )
      .bind(
        exhausted ? "failed" : "pending",
        retryAt,
        exhausted ? "generation_failed" : null,
        messageId,
        token,
      )
      .run();
  }

  async fail(messageId: string, token: string, code: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE whatsapp_inbox SET state='failed',failure_code=?,lease_token=NULL,lease_until=NULL
         WHERE message_id=? AND state IN ('generating','responding') AND lease_token=?`,
      )
      .bind(code.slice(0, 80), messageId, token)
      .run();
  }
}
