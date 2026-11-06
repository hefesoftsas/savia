import { activeTenant, PagesError } from "../pages/service";
import type { AppActor } from "../auth/types";

export type OfficeSettings = {
  tenantId: number;
  platformAllowed: boolean;
  tenantEnabled: boolean;
  enabled: boolean;
  canManagePlatform: boolean;
  canManageTenant: boolean;
};

export class OfficeSettingsError extends Error {
  constructor(
    readonly status: 400 | 403 | 404,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type StoredSettings = {
  platform_allowed: number;
  tenant_enabled: number;
};

const unavailable = () =>
  new OfficeSettingsError(404, "TENANT_NOT_FOUND", "Tenant not found");

export async function resolveOfficeSettings(
  db: D1Database,
  tenantId: number,
  actor: AppActor,
): Promise<OfficeSettings> {
  if (tenantId === 0) {
    const platformRole = await db
      .prepare(
        "SELECT 1 FROM identity_global_role g JOIN identity_principal p ON p.id=g.principal_id AND p.is_active=1 WHERE g.principal_id=? AND g.role='platform_admin'",
      )
      .bind(actor.principal.id)
      .first();
    if (!platformRole) throw unavailable();
    return {
      tenantId: 0,
      platformAllowed: true,
      tenantEnabled: true,
      enabled: true,
      canManagePlatform: false,
      canManageTenant: false,
    };
  }
  const tenant = await db
    .prepare(
      "SELECT id FROM tenants WHERE id=? AND is_active=1 AND kind='commercial'",
    )
    .bind(tenantId)
    .first<{ id: number }>();
  if (!tenant) throw unavailable();

  const activePrincipal = await db
    .prepare("SELECT 1 FROM identity_principal WHERE id=? AND is_active=1")
    .bind(actor.principal.id)
    .first();
  if (!activePrincipal) throw unavailable();

  const platformRole = await db
    .prepare(
      "SELECT 1 FROM identity_global_role WHERE principal_id=? AND role='platform_admin'",
    )
    .bind(actor.principal.id)
    .first();
  const canManagePlatform = Boolean(platformRole);
  const membership = await db
    .prepare(
      "SELECT role FROM identity_tenant_membership WHERE principal_id=? AND tenant_id=? AND is_active=1",
    )
    .bind(actor.principal.id, tenantId)
    .first<{ role: string }>();
  if (!canManagePlatform && !membership) throw unavailable();
  const activeTenantAdmin = Boolean(
    membership && ["tenant_admin", "agency_admin"].includes(membership.role),
  );
  const stored = await db
    .prepare(
      "SELECT platform_allowed,tenant_enabled FROM office_settings WHERE tenant_id=?",
    )
    .bind(tenantId)
    .first<StoredSettings>();
  const platformAllowed = stored ? stored.platform_allowed === 1 : true;
  const tenantEnabled = stored ? stored.tenant_enabled === 1 : true;

  return {
    tenantId,
    platformAllowed,
    tenantEnabled,
    enabled: platformAllowed && tenantEnabled,
    canManagePlatform,
    canManageTenant: canManagePlatform || activeTenantAdmin,
  };
}

export async function resolveCurrentOfficeSettings(
  db: D1Database,
  actor: AppActor,
): Promise<OfficeSettings> {
  let tenantId: number;
  try {
    tenantId = await activeTenant(db, actor);
  } catch (error) {
    if (error instanceof PagesError) throw unavailable();
    throw error;
  }
  if (tenantId === 0) {
    const activePrincipal = await db
      .prepare("SELECT 1 FROM identity_principal WHERE id=? AND is_active=1")
      .bind(actor.principal.id)
      .first();
    if (!activePrincipal) throw unavailable();
    const platformRole = await db
      .prepare(
        "SELECT 1 FROM identity_global_role WHERE principal_id=? AND role='platform_admin'",
      )
      .bind(actor.principal.id)
      .first();
    return {
      tenantId: 0,
      platformAllowed: true,
      tenantEnabled: true,
      enabled: true,
      canManagePlatform: Boolean(platformRole),
      canManageTenant: Boolean(platformRole),
    };
  }
  return resolveOfficeSettings(db, tenantId, actor);
}

export async function patchOfficeSettings(
  db: D1Database,
  tenantId: number,
  actor: AppActor,
  patch: { platformAllowed?: boolean; tenantEnabled?: boolean },
): Promise<OfficeSettings> {
  if (tenantId === 0)
    throw new OfficeSettingsError(
      403,
      "FORBIDDEN",
      "Platform tenant settings are read-only",
    );
  if (patch.platformAllowed === undefined && patch.tenantEnabled === undefined)
    throw new OfficeSettingsError(
      400,
      "EMPTY_PATCH",
      "Provide at least one setting to update",
    );
  const before = await resolveOfficeSettings(db, tenantId, actor);
  if (patch.platformAllowed !== undefined && !before.canManagePlatform)
    throw new OfficeSettingsError(
      403,
      "FORBIDDEN",
      "Platform office settings require platform administrator access",
    );
  if (patch.tenantEnabled !== undefined && !before.canManageTenant)
    throw new OfficeSettingsError(
      403,
      "FORBIDDEN",
      "Tenant office settings require tenant administrator access",
    );

  const platformSpecified = patch.platformAllowed !== undefined;
  const tenantSpecified = patch.tenantEnabled !== undefined;
  const row = await db
    .prepare(
      `INSERT INTO office_settings(tenant_id,platform_allowed,tenant_enabled,updated_by,updated_at)
       SELECT ?,?,?,?,? FROM tenants t
       WHERE t.id=? AND t.is_active=1 AND t.kind='commercial'
         AND (?=0 OR EXISTS(SELECT 1 FROM identity_global_role g JOIN identity_principal p ON p.id=g.principal_id AND p.is_active=1 WHERE g.principal_id=? AND g.role='platform_admin'))
         AND (?=0 OR EXISTS(SELECT 1 FROM identity_global_role g JOIN identity_principal p ON p.id=g.principal_id AND p.is_active=1 WHERE g.principal_id=? AND g.role='platform_admin')
           OR EXISTS(SELECT 1 FROM identity_tenant_membership m JOIN identity_principal p ON p.id=m.principal_id AND p.is_active=1 JOIN tenants mt ON mt.id=m.tenant_id AND mt.is_active=1 WHERE m.principal_id=? AND m.tenant_id=? AND m.is_active=1 AND m.role IN ('tenant_admin','agency_admin')))
       ON CONFLICT(tenant_id) DO UPDATE SET
         platform_allowed=CASE WHEN ?=1 THEN excluded.platform_allowed ELSE office_settings.platform_allowed END,
         tenant_enabled=CASE WHEN ?=1 THEN excluded.tenant_enabled ELSE office_settings.tenant_enabled END,
         updated_by=excluded.updated_by,updated_at=excluded.updated_at
       RETURNING tenant_id`,
    )
    .bind(
      tenantId,
      platformSpecified ? Number(patch.platformAllowed) : 1,
      tenantSpecified ? Number(patch.tenantEnabled) : 1,
      actor.principal.id,
      new Date().toISOString(),
      tenantId,
      Number(platformSpecified),
      actor.principal.id,
      Number(tenantSpecified),
      actor.principal.id,
      actor.principal.id,
      tenantId,
      Number(platformSpecified),
      Number(tenantSpecified),
    )
    .first<{ tenant_id: number }>();
  if (!row)
    throw new OfficeSettingsError(
      403,
      "FORBIDDEN",
      "Office settings permission is no longer active",
    );
  return resolveOfficeSettings(db, tenantId, actor);
}

export async function assertOfficeSuiteEnabled(
  db: D1Database,
  tenantId: number,
): Promise<void> {
  const row = await db
    .prepare(
      "SELECT platform_allowed,tenant_enabled FROM office_settings WHERE tenant_id=?",
    )
    .bind(tenantId)
    .first<StoredSettings>();
  if (row && (!row.platform_allowed || !row.tenant_enabled))
    throw new OfficeSettingsError(
      403,
      "OFFICE_SUITE_DISABLED",
      "The office suite is disabled for this tenant",
    );
}
