import { z } from "@hono/zod-openapi";
import { AuthenticationError, type AppActor } from "./types";
import { findPrincipal, loadActor } from "./identity-repository";
import { accessAuthority } from "./access-context";
import { AccessControlError } from "./access-registry";

export const recordingScopeSchema = z.enum([
  "recordings:read",
  "recordings:upload",
  "recordings:process",
  "recordings:delete",
]);
export type RecordingScope = z.infer<typeof recordingScopeSchema>;
export const apiKeyScopeSchema = z.enum([
  ...recordingScopeSchema.options,
  "records:read",
  "records:create",
  "records:update",
]);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;
export function isRecordingScope(scope: ApiKeyScope): scope is RecordingScope {
  return recordingScopeSchema.safeParse(scope).success;
}
export const createPersonalApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    tenantId: z.number().int().nonnegative(),
    scopes: z
      .array(apiKeyScopeSchema)
      .min(1)
      .max(7)
      .refine((s) => new Set(s).size === s.length),
    lifetimeDays: z
      .union([z.literal(7), z.literal(30), z.literal(90)])
      .default(30),
  })
  .strict();
export const personalApiKeySummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  tenantId: z.number().int(),
  scopes: z.array(apiKeyScopeSchema),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
export type PersonalApiKeySummary = z.infer<typeof personalApiKeySummarySchema>;
export const tenantApiKeySummarySchema = personalApiKeySummarySchema.extend({
  principalId: z.string(),
  ownerName: z.string(),
  ownerEmail: z.string(),
});
export const tenantApiKeyMemberSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
});
export const createTenantApiKeySchema = createPersonalApiKeySchema
  .omit({ tenantId: true })
  .extend({ principalId: z.string().min(1).max(200) })
  .strict();
type Row = {
  id: string;
  principal_id: string;
  tenant_id: number;
  deployment_id: string;
  name: string;
  prefix: string;
  secret_digest: string;
  scopes: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};
const denied = () =>
  new AuthenticationError(
    "AUTHENTICATION_REQUIRED",
    "A valid Savia credential is required",
  );
const forbidden = () =>
  new AuthenticationError(
    "AUTHORIZATION_FORBIDDEN",
    "An active membership in this tenant is required",
  );
const digest = async (secret: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
function summary(row: Row): PersonalApiKeySummary {
  return personalApiKeySummarySchema.parse({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    tenantId: row.tenant_id,
    scopes: JSON.parse(row.scopes),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  });
}
export class PersonalApiKeys {
  constructor(
    private db: D1Database,
    private deploymentId: string | null,
    private now: () => number = Date.now,
  ) {
    if (deploymentId !== null && !deploymentId.trim())
      throw new Error("A deployment identifier is required");
  }
  private requireDeployment(): void {
    if (!this.deploymentId)
      throw new AuthenticationError(
        "AUTHENTICATION_UNAVAILABLE",
        "Configure the canonical public origin before using personal API keys",
      );
  }
  async eligibleActor(ownerId: string, tenantId: number): Promise<AppActor> {
    this.requireDeployment();
    const principal = await findPrincipal(this.db, ownerId);
    if (!principal?.isActive) throw forbidden();
    const actor = await loadActor(this.db, principal);
    const tenant = await this.db
      .prepare("SELECT is_active FROM tenants WHERE id=?")
      .bind(tenantId)
      .first<{ is_active: number }>();
    if (
      !tenant?.is_active ||
      !actor.memberships.some(
        (m) => m.isActive && (m.tenantId ?? m.agencyId) === tenantId,
      ) ||
      (tenantId === 0 && !actor.globalRoles.includes("platform_admin"))
    )
      throw forbidden();
    return actor;
  }
  async eligibleTenants(
    ownerId: string,
  ): Promise<{ id: number; name: string }[]> {
    this.requireDeployment();
    const principal = await findPrincipal(this.db, ownerId);
    if (!principal?.isActive) throw forbidden();
    const actor = await loadActor(this.db, principal);
    const rows = await this.db
      .prepare("SELECT id,name FROM tenants WHERE is_active=1 ORDER BY name")
      .all<{ id: number; name: string }>();
    return rows.results.filter(
      (t) =>
        actor.memberships.some(
          (m) => m.isActive && (m.tenantId ?? m.agencyId) === t.id,
        ) &&
        (t.id !== 0 || actor.globalRoles.includes("platform_admin")),
    );
  }
  async create(
    actor: AppActor,
    input: z.input<typeof createPersonalApiKeySchema>,
  ): Promise<{ key: PersonalApiKeySummary; secret: string }> {
    return this.createForOwner(actor.principal.id, actor.principal.id, input);
  }
  private async createForOwner(
    ownerId: string,
    administratorId: string,
    input: z.input<typeof createPersonalApiKeySchema>,
  ): Promise<{ key: PersonalApiKeySummary; secret: string }> {
    this.requireDeployment();
    const parsed = createPersonalApiKeySchema.parse(input);
    if (
      parsed.tenantId === 0 &&
      parsed.scopes.some((scope) => !isRecordingScope(scope))
    )
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "Data scopes require a commercial tenant",
      );
    await this.eligibleActor(ownerId, parsed.tenantId);
    const id = crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = `savia_pat_${id.replaceAll("-", "")}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    const hash = await digest(secret),
      now = new Date(this.now()).toISOString(),
      expires = new Date(
        this.now() + parsed.lifetimeDays * 86400000,
      ).toISOString();
    const prefix = `savia_pat_${id.slice(0, 8)}`;
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO personal_api_keys(id,principal_id,tenant_id,deployment_id,name,prefix,secret_digest,scopes,created_at,expires_at)
 SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM personal_api_keys WHERE principal_id=? AND deployment_id=? AND revoked_at IS NULL AND expires_at>?)<20`,
        )
        .bind(
          id,
          ownerId,
          parsed.tenantId,
          this.deploymentId,
          parsed.name,
          prefix,
          hash,
          JSON.stringify(parsed.scopes),
          now,
          expires,
          ownerId,
          this.deploymentId,
          now,
        ),
      this.db
        .prepare(
          `INSERT INTO access_audit(id,scope,actor_id,action,target_id,before_state,after_state,created_at)
 SELECT ?,?,?,'personal_api_key.create',id,NULL,?,? FROM personal_api_keys WHERE id=?`,
        )
        .bind(
          crypto.randomUUID(),
          `tenant:${parsed.tenantId}`,
          administratorId,
          JSON.stringify({
            principalId: ownerId,
            name: parsed.name,
            scopes: parsed.scopes,
            expiresAt: expires,
          }),
          now,
          id,
        ),
      this.db.prepare("SELECT * FROM personal_api_keys WHERE id=?").bind(id),
    ]);
    const row = results[2].results[0] as Row | undefined;
    if (!row)
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "You already have 20 active API keys",
      );
    return { key: summary(row), secret };
  }
  async list(ownerId: string): Promise<PersonalApiKeySummary[]> {
    this.requireDeployment();
    const rows = await this.db
      .prepare(
        "SELECT * FROM personal_api_keys WHERE principal_id=? AND deployment_id=? ORDER BY created_at DESC,id",
      )
      .bind(ownerId, this.deploymentId)
      .all<Row>();
    return rows.results.map(summary);
  }
  async revoke(ownerId: string, keyId: string): Promise<void> {
    this.requireDeployment();
    const now = new Date(this.now()).toISOString();
    const existing = await this.db
      .prepare(
        "SELECT revoked_at FROM personal_api_keys WHERE id=? AND principal_id=? AND deployment_id=?",
      )
      .bind(keyId, ownerId, this.deploymentId)
      .first<{ revoked_at: string | null }>();
    if (!existing) return;
    if (existing.revoked_at) {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO access_audit(id,scope,actor_id,action,target_id,before_state,after_state,created_at) SELECT ?, 'tenant:' || tenant_id, ?, 'personal_api_key.delete',id,?,NULL,? FROM personal_api_keys WHERE id=? AND principal_id=? AND deployment_id=? AND revoked_at IS NOT NULL`,
          )
          .bind(
            crypto.randomUUID(),
            ownerId,
            JSON.stringify({ revokedAt: existing.revoked_at }),
            now,
            keyId,
            ownerId,
            this.deploymentId,
          ),
        this.db
          .prepare(
            "DELETE FROM personal_api_keys WHERE id=? AND principal_id=? AND deployment_id=? AND revoked_at IS NOT NULL",
          )
          .bind(keyId, ownerId, this.deploymentId),
      ]);
      return;
    }
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO access_audit(id,scope,actor_id,action,target_id,before_state,after_state,created_at) SELECT ?, 'tenant:' || tenant_id, ?, 'personal_api_key.revoke',id,NULL,?,? FROM personal_api_keys WHERE id=? AND principal_id=? AND deployment_id=? AND revoked_at IS NULL`,
        )
        .bind(
          crypto.randomUUID(),
          ownerId,
          JSON.stringify({ revokedAt: now }),
          now,
          keyId,
          ownerId,
          this.deploymentId,
        ),
      this.db
        .prepare(
          "UPDATE personal_api_keys SET revoked_at=? WHERE id=? AND principal_id=? AND deployment_id=? AND revoked_at IS NULL",
        )
        .bind(now, keyId, ownerId, this.deploymentId),
    ]);
  }
  private async requireTenantAdministrator(
    actor: AppActor,
    tenantId: number,
  ): Promise<void> {
    this.requireDeployment();
    if (actor.credential?.kind === "personal-api-key")
      throw new AuthenticationError(
        "INSUFFICIENT_SCOPE",
        "Sign in to manage API keys",
      );
    try {
      await accessAuthority(this.db, actor, `tenant:${tenantId}`, true);
    } catch (error) {
      if (error instanceof AccessControlError)
        throw new AuthenticationError(
          "AUTHORIZATION_FORBIDDEN",
          "Tenant administration is required",
        );
      throw error;
    }
  }
  async listForTenant(actor: AppActor, tenantId: number) {
    await this.requireTenantAdministrator(actor, tenantId);
    const rows = await this.db
      .prepare(
        "SELECT k.*,p.display_name AS owner_name,p.email AS owner_email FROM personal_api_keys k JOIN identity_principal p ON p.id=k.principal_id WHERE k.tenant_id=? AND k.deployment_id=? ORDER BY k.created_at DESC,k.id",
      )
      .bind(tenantId, this.deploymentId)
      .all<Row & { owner_name: string; owner_email: string }>();
    return rows.results.map((row) =>
      tenantApiKeySummarySchema.parse({
        ...summary(row),
        principalId: row.principal_id,
        ownerName: row.owner_name,
        ownerEmail: row.owner_email,
      }),
    );
  }
  async membersForTenant(actor: AppActor, tenantId: number) {
    await this.requireTenantAdministrator(actor, tenantId);
    const rows = await this.db
      .prepare(
        "SELECT p.id,p.display_name,p.email FROM identity_principal p JOIN identity_tenant_membership m ON m.principal_id=p.id WHERE m.tenant_id=? AND m.is_active=1 AND p.is_active=1 ORDER BY p.display_name,p.id",
      )
      .bind(tenantId)
      .all<{ id: string; display_name: string; email: string }>();
    return rows.results.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
    }));
  }
  async createForTenant(
    actor: AppActor,
    tenantId: number,
    input: z.input<typeof createTenantApiKeySchema>,
  ) {
    await this.requireTenantAdministrator(actor, tenantId);
    const { principalId, ...keyInput } = createTenantApiKeySchema.parse(input);
    return this.createForOwner(principalId, actor.principal.id, {
      ...keyInput,
      tenantId,
    });
  }
  async revokeForTenant(
    actor: AppActor,
    tenantId: number,
    keyId: string,
  ): Promise<void> {
    await this.requireTenantAdministrator(actor, tenantId);
    const now = new Date(this.now()).toISOString();
    const existing = await this.db
      .prepare(
        "SELECT revoked_at FROM personal_api_keys WHERE id=? AND tenant_id=? AND deployment_id=?",
      )
      .bind(keyId, tenantId, this.deploymentId)
      .first<{ revoked_at: string | null }>();
    if (!existing) return;
    if (existing.revoked_at) {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO access_audit(id,scope,actor_id,action,target_id,before_state,after_state,created_at) SELECT ?, 'tenant:' || tenant_id, ?, 'personal_api_key.delete',id,?,NULL,? FROM personal_api_keys WHERE id=? AND tenant_id=? AND deployment_id=? AND revoked_at IS NOT NULL`,
          )
          .bind(
            crypto.randomUUID(),
            actor.principal.id,
            JSON.stringify({ revokedAt: existing.revoked_at }),
            now,
            keyId,
            tenantId,
            this.deploymentId,
          ),
        this.db
          .prepare(
            "DELETE FROM personal_api_keys WHERE id=? AND tenant_id=? AND deployment_id=? AND revoked_at IS NOT NULL",
          )
          .bind(keyId, tenantId, this.deploymentId),
      ]);
      return;
    }
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO access_audit(id,scope,actor_id,action,target_id,before_state,after_state,created_at) SELECT ?, 'tenant:' || tenant_id, ?, 'personal_api_key.revoke',id,NULL,?,? FROM personal_api_keys WHERE id=? AND tenant_id=? AND deployment_id=? AND revoked_at IS NULL`,
        )
        .bind(
          crypto.randomUUID(),
          actor.principal.id,
          JSON.stringify({ revokedAt: now }),
          now,
          keyId,
          tenantId,
          this.deploymentId,
        ),
      this.db
        .prepare(
          "UPDATE personal_api_keys SET revoked_at=? WHERE id=? AND tenant_id=? AND deployment_id=? AND revoked_at IS NULL",
        )
        .bind(now, keyId, tenantId, this.deploymentId),
    ]);
  }
  async authenticate(
    secret: string,
  ): Promise<{ actor: AppActor; key: PersonalApiKeySummary }> {
    this.requireDeployment();
    if (!/^savia_pat_[a-f0-9]{32}_[a-f0-9]{64}$/.test(secret)) throw denied();
    const row = await this.db
      .prepare(
        "SELECT * FROM personal_api_keys WHERE secret_digest=? AND deployment_id=? AND revoked_at IS NULL AND expires_at>?",
      )
      .bind(
        await digest(secret),
        this.deploymentId,
        new Date(this.now()).toISOString(),
      )
      .first<Row>();
    if (!row) throw denied();
    let actor: AppActor;
    try {
      actor = await this.eligibleActor(row.principal_id, row.tenant_id);
    } catch {
      throw denied();
    }
    return { actor, key: summary(row) };
  }
  async touch(keyId: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE personal_api_keys SET last_used_at=? WHERE id=? AND deployment_id=? AND revoked_at IS NULL",
      )
      .bind(new Date(this.now()).toISOString(), keyId, this.deploymentId)
      .run();
  }
}
