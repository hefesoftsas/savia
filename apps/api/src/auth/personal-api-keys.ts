import { z } from "@hono/zod-openapi";
import { AuthenticationError, type AppActor } from "./types";
import { findPrincipal, loadActor } from "./identity-repository";

export const recordingScopeSchema = z.enum([
  "recordings:read",
  "recordings:upload",
  "recordings:process",
  "recordings:delete",
]);
export type RecordingScope = z.infer<typeof recordingScopeSchema>;
export const createPersonalApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    tenantId: z.number().int().nonnegative(),
    scopes: z
      .array(recordingScopeSchema)
      .min(1)
      .max(4)
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
  scopes: z.array(recordingScopeSchema),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
export type PersonalApiKeySummary = z.infer<typeof personalApiKeySummarySchema>;
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
    this.requireDeployment();
    const parsed = createPersonalApiKeySchema.parse(input);
    await this.eligibleActor(actor.principal.id, parsed.tenantId);
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
 SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM personal_api_keys WHERE principal_id=? AND revoked_at IS NULL AND expires_at>?)<20`,
        )
        .bind(
          id,
          actor.principal.id,
          parsed.tenantId,
          this.deploymentId,
          parsed.name,
          prefix,
          hash,
          JSON.stringify(parsed.scopes),
          now,
          expires,
          actor.principal.id,
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
          actor.principal.id,
          JSON.stringify({
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
