import {
  webhookDestinationSchema,
  type WebhookDestinationSummary,
} from "@savia/crm-shared/workflow-webhooks";
import { encryptSecret, decryptSecret, publicUrl } from "../integrations";
import { fail } from "../context";
import { guard, transaction } from "../services";
export type WebhookDependencies = {
  encryptionKey?: string;
  fetcher?: typeof fetch;
  now?: () => number;
};
type Destination = {
  id: string;
  name: string;
  current_revision: number;
  enabled: number;
  encrypted_secret: string | null;
  credential_type: string;
  credential_header: string | null;
  url: string;
  auth_type: "none" | "bearer" | "api-key";
  auth_header: string | null;
  revision: number;
};
export class WebhookDestinationRepository {
  constructor(
    readonly db: D1Database,
    readonly workspace: string,
    readonly dependencies: WebhookDependencies = {},
  ) {}
  private context(id: string) {
    return `workflow-webhook:${this.workspace}:${id}`;
  }
  private summary(r: Destination): WebhookDestinationSummary {
    return {
      id: r.id,
      name: r.name,
      revision: r.revision,
      enabled: !!r.enabled,
      url: r.url,
      authType: r.auth_type,
      ...(r.auth_header ? { authHeader: r.auth_header } : {}),
      hasSecret: !!r.encrypted_secret,
    };
  }
  async list() {
    const rows = await this.db
      .prepare(
        "SELECT d.*,v.url,v.auth_type,v.auth_header,v.revision FROM workflow_webhook_destinations d JOIN workflow_webhook_destination_versions v ON v.workspace_id=d.workspace_id AND v.id=d.id AND v.revision=d.current_revision WHERE d.workspace_id=? ORDER BY d.name LIMIT 200",
      )
      .bind(this.workspace)
      .all<Destination>();
    return rows.results.map((r) => this.summary(r));
  }
  private async row(id: string, revision?: number) {
    const row = await this.db
      .prepare(
        "SELECT d.*,v.url,v.auth_type,v.auth_header,v.revision FROM workflow_webhook_destinations d JOIN workflow_webhook_destination_versions v ON v.workspace_id=d.workspace_id AND v.id=d.id AND v.revision=COALESCE(?,d.current_revision) WHERE d.workspace_id=? AND d.id=?",
      )
      .bind(revision ?? null, this.workspace, id)
      .first<Destination>();
    if (!row) fail("Webhook destination not found", 404);
    return row;
  }
  async resolve(id: string, revision: number) {
    const r = await this.row(id, revision);
    if (!r.enabled) fail("Webhook destination is disabled", 409);
    if (
      r.auth_type !== "none" &&
      (r.auth_type !== r.credential_type ||
        r.auth_header !== r.credential_header ||
        !r.encrypted_secret)
    )
      fail(
        "Webhook credentials no longer match the published destination",
        409,
      );
    return {
      url: r.url,
      authType: r.auth_type,
      authHeader: r.auth_header ?? undefined,
      secret:
        r.auth_type !== "none" && r.encrypted_secret
          ? await decryptSecret(
              r.encrypted_secret,
              this.dependencies.encryptionKey,
              this.context(id),
            )
          : undefined,
    };
  }
  async validate(id: string, revision: number) {
    const r = await this.row(id, revision);
    if (!r.enabled) fail("Webhook destination is disabled", 409);
    if (
      r.auth_type !== "none" &&
      (!r.encrypted_secret ||
        r.auth_type !== r.credential_type ||
        r.auth_header !== r.credential_header)
    )
      fail("Webhook credentials unavailable", 409);
  }
  async create(input: unknown) {
    const v = webhookDestinationSchema.parse(input);
    publicUrl(v.url);
    if (v.authType !== "none" && !v.secret)
      fail("Destination credential required", 422);
    const id = crypto.randomUUID(),
      encrypted = v.secret
        ? await encryptSecret(
            v.secret,
            this.dependencies.encryptionKey,
            this.context(id),
          )
        : null;
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO workflow_webhook_destinations(workspace_id,id,name,current_revision,encrypted_secret,credential_type,credential_header) VALUES (?,?,?,1,?,?,?)",
        )
        .bind(
          this.workspace,
          id,
          v.name,
          encrypted,
          v.authType,
          v.authHeader ?? null,
        ),
      this.db
        .prepare(
          "INSERT INTO workflow_webhook_destination_versions(workspace_id,id,revision,url,auth_type,auth_header) VALUES (?,?,1,?,?,?)",
        )
        .bind(this.workspace, id, v.url, v.authType, v.authHeader ?? null),
    ]);
    return this.summary(await this.row(id));
  }
  async update(id: string, expectedRevision: number, input: unknown) {
    const v = webhookDestinationSchema.parse(input),
      old = await this.row(id);
    publicUrl(v.url);
    if (old.current_revision !== expectedRevision)
      fail("Destination changed; reload", 409);
    const sameAuth =
      old.credential_type === v.authType &&
      old.credential_header === (v.authHeader ?? null);
    if (
      v.authType !== "none" &&
      !v.secret &&
      (!sameAuth || !old.encrypted_secret)
    )
      fail("Destination credential required", 422);
    const encrypted =
      v.authType === "none"
        ? null
        : v.secret
          ? await encryptSecret(
              v.secret,
              this.dependencies.encryptionKey,
              this.context(id),
            )
          : old.encrypted_secret;
    const g = guard(
      this.db,
      "SELECT current_revision=? FROM workflow_webhook_destinations WHERE workspace_id=? AND id=?",
      [expectedRevision, this.workspace, id],
    );
    await transaction(this.db, [
      g.start,
      this.db
        .prepare(
          "UPDATE workflow_webhook_destinations SET name=?,current_revision=current_revision+1,encrypted_secret=CASE WHEN ? THEN ? ELSE encrypted_secret END,credential_type=?,credential_header=? WHERE workspace_id=? AND id=?",
        )
        .bind(
          v.name,
          Number(v.authType === "none" || !!v.secret),
          encrypted,
          v.authType,
          v.authHeader ?? null,
          this.workspace,
          id,
        ),
      this.db
        .prepare(
          "INSERT INTO workflow_webhook_destination_versions(workspace_id,id,revision,url,auth_type,auth_header) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          this.workspace,
          id,
          expectedRevision + 1,
          v.url,
          v.authType,
          v.authHeader ?? null,
        ),
      g.end,
    ]);
    return this.summary(await this.row(id));
  }
  async rotate(id: string, secret: string) {
    const old = await this.row(id);
    const v = webhookDestinationSchema.parse({
      name: old.name,
      url: old.url,
      authType: old.auth_type,
      ...(old.auth_header ? { authHeader: old.auth_header } : {}),
      secret,
    });
    if (v.authType === "none") fail("Destination has no authentication", 422);
    const encrypted = await encryptSecret(
      secret,
      this.dependencies.encryptionKey,
      this.context(id),
    );
    const g = guard(
      this.db,
      "SELECT current_revision=? FROM workflow_webhook_destinations WHERE workspace_id=? AND id=?",
      [old.current_revision, this.workspace, id],
    );
    await transaction(this.db, [
      g.start,
      this.db
        .prepare(
          "UPDATE workflow_webhook_destinations SET encrypted_secret=? WHERE workspace_id=? AND id=?",
        )
        .bind(encrypted, this.workspace, id),
      g.end,
    ]);
    return this.summary(await this.row(id));
  }
  async setEnabled(id: string, enabled: boolean) {
    await this.row(id);
    await this.db
      .prepare(
        "UPDATE workflow_webhook_destinations SET enabled=? WHERE workspace_id=? AND id=?",
      )
      .bind(Number(enabled), this.workspace, id)
      .run();
    return this.summary(await this.row(id));
  }
}
