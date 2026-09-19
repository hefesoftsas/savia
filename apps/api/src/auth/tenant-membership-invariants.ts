import { dialectFor } from "@savia/db/dialect";
import type { AgencyMembership, AgencyRole } from "./types";

export const PLATFORM_TENANT_ID = 0;

export class TenantMembershipInvariantError extends Error {
  constructor(
    public readonly code:
      | "TENANT_NOT_FOUND"
      | "LAST_ACTIVE_MEMBER"
      | "PLATFORM_TENANT_RESERVED"
      | "PLATFORM_ADMIN_REQUIRES_REVOCATION"
      | "COMMERCIAL_TENANT_REQUIRED"
      | "PRIMARY_TENANT_MISSING",
    message: string,
  ) {
    super(message);
  }
}

type TenantRow = {
  id: number;
  kind: "commercial" | "platform";
  is_active: number;
};

type MembershipRow = {
  id: string;
  principal_id: string;
  tenant_id: number;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};

function document(row: MembershipRow): AgencyMembership {
  return {
    id: row.id,
    principalId: row.principal_id,
    tenantId: row.tenant_id,
    agencyId: row.tenant_id,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function tenant(d1: D1Database, tenantId: number): Promise<TenantRow> {
  const result = await d1
    .prepare("SELECT id,kind,is_active FROM tenants WHERE id=?")
    .bind(tenantId)
    .first<TenantRow>();
  if (!result) {
    throw new TenantMembershipInvariantError(
      "TENANT_NOT_FOUND",
      "Tenant does not exist",
    );
  }
  return result;
}

async function ensurePlatformTenant(d1: D1Database): Promise<TenantRow> {
  const now = new Date().toISOString();
  await d1
    .prepare(
      dialectFor(d1).name === "postgres"
        ? "INSERT INTO tenants(\n        id,id_slug,name,is_active,created_at,updated_at,kind\n      ) VALUES(0,'savia-platform','Plataforma Savia',1,?,?, 'platform') ON CONFLICT (id) DO NOTHING"
        : `INSERT OR IGNORE INTO tenants(
        id,id_slug,name,is_active,created_at,updated_at,kind
      ) VALUES(0,'savia-platform','Plataforma Savia',1,?,?, 'platform')`,
    )
    .bind(now, now)
    .run();
  return tenant(d1, PLATFORM_TENANT_ID);
}

export async function ensureActiveCommercialTenant(
  d1: D1Database,
  tenantId: number,
): Promise<void> {
  const selected = await tenant(d1, tenantId);
  if (selected.kind !== "commercial" || !selected.is_active) {
    throw new TenantMembershipInvariantError(
      selected.kind === "platform"
        ? "PLATFORM_TENANT_RESERVED"
        : "COMMERCIAL_TENANT_REQUIRED",
      selected.kind === "platform"
        ? "The internal platform tenant cannot be assigned directly"
        : "An active commercial tenant is required",
    );
  }
}

export async function assignOrTransferMembership(
  d1: D1Database,
  principalId: string,
  tenantId: number,
  role: AgencyRole,
): Promise<AgencyMembership> {
  await ensureActiveCommercialTenant(d1, tenantId);
  const current = await d1
    .prepare(
      "SELECT tenant_id,is_active FROM identity_tenant_membership WHERE principal_id=?",
    )
    .bind(principalId)
    .first<{ tenant_id: number; is_active: number }>();
  if (current && current.tenant_id !== tenantId && current.is_active) {
    await assertPrincipalCanLoseActiveMembership(d1, principalId);
  }
  const now = new Date().toISOString();
  const saved = await d1
    .prepare(
      `INSERT INTO identity_tenant_membership(
        id,principal_id,tenant_id,role,is_active,created_at,updated_at
      ) VALUES(?,?,?,?,1,?,?)
      ON CONFLICT(principal_id) DO UPDATE SET
        tenant_id=excluded.tenant_id,
        role=excluded.role,
        is_active=1,
        updated_at=excluded.updated_at
      RETURNING id,principal_id,tenant_id,role,is_active,created_at,updated_at`,
    )
    .bind(crypto.randomUUID(), principalId, tenantId, role, now, now)
    .first<MembershipRow>();
  if (!saved) throw new Error("Unable to assign tenant membership");
  return document(saved);
}

export async function assertPrincipalCanLoseActiveMembership(
  d1: D1Database,
  principalId: string,
): Promise<void> {
  const current = await d1
    .prepare(
      `SELECT m.tenant_id,m.is_active AS membership_active,p.is_active AS principal_active,t.kind
       FROM identity_tenant_membership m
       JOIN identity_principal p ON p.id=m.principal_id
       JOIN tenants t ON t.id=m.tenant_id
       WHERE m.principal_id=?`,
    )
    .bind(principalId)
    .first<{
      tenant_id: number;
      membership_active: number;
      principal_active: number;
      kind: "commercial" | "platform";
    }>();
  if (!current || !current.membership_active || !current.principal_active)
    return;
  if (current.kind !== "commercial") return;
  const activeMembers = await d1
    .prepare(
      `SELECT COUNT(*) AS count
       FROM identity_tenant_membership m
       JOIN identity_principal p ON p.id=m.principal_id
       WHERE m.tenant_id=? AND m.is_active=1 AND p.is_active=1`,
    )
    .bind(current.tenant_id)
    .first<{ count: number }>();
  if ((activeMembers?.count ?? 0) <= 1) {
    throw new TenantMembershipInvariantError(
      "LAST_ACTIVE_MEMBER",
      "A commercial tenant must retain at least one active user",
    );
  }
}

export async function syncPlatformAdministratorMembership(
  d1: D1Database,
  principalId: string,
  enabled: boolean,
  commercialTenantId?: number,
  commercialRole: AgencyRole = "viewer",
): Promise<AgencyMembership> {
  if (!enabled) {
    if (commercialTenantId === undefined) {
      throw new TenantMembershipInvariantError(
        "COMMERCIAL_TENANT_REQUIRED",
        "A commercial tenant is required when revoking platform administration",
      );
    }
    return assignOrTransferMembership(
      d1,
      principalId,
      commercialTenantId,
      commercialRole,
    );
  }
  await assertPrincipalCanLoseActiveMembership(d1, principalId);
  const platform = await ensurePlatformTenant(d1);
  if (platform.kind !== "platform") {
    throw new TenantMembershipInvariantError(
      "PLATFORM_TENANT_RESERVED",
      "The internal platform tenant is misconfigured",
    );
  }
  const now = new Date().toISOString();
  const saved = await d1
    .prepare(
      `INSERT INTO identity_tenant_membership(
        id,principal_id,tenant_id,role,is_active,created_at,updated_at
      ) VALUES(?,?,?,?,1,?,?)
      ON CONFLICT(principal_id) DO UPDATE SET
        tenant_id=excluded.tenant_id,
        role=excluded.role,
        is_active=1,
        updated_at=excluded.updated_at
      RETURNING id,principal_id,tenant_id,role,is_active,created_at,updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      principalId,
      PLATFORM_TENANT_ID,
      "tenant_admin",
      now,
      now,
    )
    .first<MembershipRow>();
  if (!saved) throw new Error("Unable to assign platform membership");
  return document(saved);
}
