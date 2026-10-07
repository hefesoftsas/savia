import {
  channelConfigurationSchema,
  type ChannelConfiguration,
  type ContactKey,
  type ContactAccess,
  type EmployeeSession,
  type ChannelMenu,
} from "./channel-contracts";
import { findPrincipal, loadActor } from "../auth/identity-repository";

export class WhatsappChannelRepository {
  constructor(readonly db: D1Database) {}

  async settings(tenantId: number, connectionId: string) {
    const row = await this.db
      .prepare(
        "SELECT config_json,revision FROM whatsapp_channel_settings WHERE tenant_id=? AND connection_id=?",
      )
      .bind(tenantId, connectionId)
      .first<{ config_json: string; revision: string }>();
    return row
      ? {
          config: channelConfigurationSchema.parse(JSON.parse(row.config_json)),
          revision: row.revision,
        }
      : null;
  }

  async configure(
    tenantId: number,
    connectionId: string,
    value: unknown,
    principalId: string,
  ) {
    const config = channelConfigurationSchema.parse(value);
    const previous = await this.settings(tenantId, connectionId);
    if (
      !(await this.db
        .prepare(
          "SELECT id FROM tenant_whatsapp_connections WHERE id=? AND tenant_id=?",
        )
        .bind(connectionId, tenantId)
        .first())
    )
      throw new Error("CHANNEL_CONNECTION_UNAVAILABLE");
    for (const task of config.tasks)
      if (
        !(await this.db
          .prepare(
            "SELECT id FROM assistant_virtual_employees WHERE id=? AND agency_id=? AND status='active'",
          )
          .bind(task.employeeId, tenantId)
          .first())
      )
        throw new Error("CHANNEL_EMPLOYEE_UNAVAILABLE");
    for (const staff of config.staff.filter((s) => s.active && s.principalId)) {
      const principal = await findPrincipal(this.db, staff.principalId!);
      if (
        !principal?.isActive ||
        !(await loadActor(this.db, principal)).memberships.some(
          (m) => m.isActive && (m.tenantId ?? m.agencyId) === tenantId,
        )
      )
        throw new Error("CHANNEL_STAFF_UNAVAILABLE");
    }
    const withoutSupportContact = (candidate: ChannelConfiguration) => {
      const { humanSupportContact: _humanSupportContact, ...operational } =
        candidate;
      return JSON.stringify(operational);
    };
    const configurationChanged =
      previous === null ||
      withoutSupportContact(previous.config) !== withoutSupportContact(config);
    const revision =
      previous && !configurationChanged
        ? previous.revision
        : crypto.randomUUID();
    const accessShape = (candidate: ChannelConfiguration) =>
      JSON.stringify({
        staff: candidate.staff
          .map(({ phone, active, principalId }) => ({
            phone,
            active,
            principalId,
          }))
          .sort((a, b) => a.phone.localeCompare(b.phone)),
        internalCapabilities: [...candidate.internalCapabilities].sort(),
        externalCapabilities: [...candidate.externalCapabilities].sort(),
      });
    const accessChanged =
      previous !== null && accessShape(previous.config) !== accessShape(config);
    const statements = [
      this.db
        .prepare(
          "INSERT INTO whatsapp_channel_settings(connection_id,tenant_id,config_json,revision,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET config_json=excluded.config_json,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
        )
        .bind(
          connectionId,
          tenantId,
          JSON.stringify(config),
          revision,
          principalId,
          new Date().toISOString(),
        ),
    ];
    if (configurationChanged)
      statements.push(
        this.db
          .prepare(
            "UPDATE whatsapp_channel_contacts SET employee_id=NULL,selection_revision=selection_revision+1,menu_json=NULL,buffered_text=NULL,access_fingerprint=CASE WHEN ? THEN NULL ELSE access_fingerprint END WHERE connection_id=?",
          )
          .bind(accessChanged ? 1 : 0, connectionId),
        this.db
          .prepare(
            "UPDATE whatsapp_channel_actions SET status='cancelled' WHERE connection_id=? AND status IN ('pending','queued')",
          )
          .bind(connectionId),
      );
    await this.db.batch(statements);
  }

  async getAccess(key: ContactKey): Promise<ContactAccess> {
    const settings = await this.settings(key.tenantId, key.connectionId);
    if (!settings?.config.routingEnabled)
      throw new Error("CHANNEL_ROUTING_DISABLED");
    const staff = settings.config.staff.find(
      (s) => s.active && s.phone === key.contact,
    );
    // Membership changes must revoke old generations even without a settings edit.
    let principalId = staff?.principalId ?? null;
    let membershipStamp = "external";
    if (principalId) {
      const principal = await findPrincipal(this.db, principalId);
      const actor = principal?.isActive
        ? await loadActor(this.db, principal)
        : null;
      const membership = actor?.memberships.find(
        (m) => m.isActive && (m.tenantId ?? m.agencyId) === key.tenantId,
      );
      if (!membership) {
        await this.db
          .prepare(
            "UPDATE whatsapp_channel_contacts SET access_fingerprint=NULL WHERE connection_id=? AND contact=?",
          )
          .bind(key.connectionId, key.contact)
          .run();
        throw new Error("CHANNEL_STAFF_REVOKED");
      }
      membershipStamp = `${principal!.updatedAt}:${membership.id}:${membership.role}:${membership.updatedAt}`;
    }
    const audience = staff ? "internal" : "external";
    const capabilities =
      audience === "internal"
        ? settings.config.internalCapabilities
        : settings.config.externalCapabilities;
    const material = JSON.stringify({
      principalId,
      membershipStamp,
      audience,
      capabilities: [...capabilities].sort(),
    });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(material),
    );
    const accessFingerprint = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const candidateGeneration = crypto.randomUUID();
    await this.db
      .prepare(
        "INSERT INTO whatsapp_channel_contacts(connection_id,contact,generation,access_fingerprint) VALUES(?,?,?,?) ON CONFLICT(connection_id,contact) DO UPDATE SET generation=excluded.generation,access_fingerprint=excluded.access_fingerprint,employee_id=NULL,selection_revision=whatsapp_channel_contacts.selection_revision+1,menu_json=NULL,buffered_text=NULL,draft_json=NULL,reset_token_hash=NULL,reset_expires_at=NULL,reset_attempts=0,last_reset_message_id=NULL WHERE whatsapp_channel_contacts.access_fingerprint IS NULL OR whatsapp_channel_contacts.access_fingerprint<>excluded.access_fingerprint",
      )
      .bind(
        key.connectionId,
        key.contact,
        candidateGeneration,
        accessFingerprint,
      )
      .run();
    const contactState = await this.db
      .prepare(
        "SELECT generation FROM whatsapp_channel_contacts WHERE connection_id=? AND contact=?",
      )
      .bind(key.connectionId, key.contact)
      .first<{ generation: string }>();
    if (!contactState) throw new Error("CHANNEL_CONTACT_STATE_UNAVAILABLE");
    return {
      ...key,
      audience,
      generation: contactState.generation,
      principalId,
      profileId: audience,
      capabilities:
        audience === "internal"
          ? settings.config.internalCapabilities
          : settings.config.externalCapabilities,
    };
  }

  async listTasks(
    access: ContactAccess,
    currentSettings?: Awaited<
      ReturnType<WhatsappChannelRepository["settings"]>
    >,
  ) {
    const settings =
      currentSettings ??
      (await this.settings(access.tenantId, access.connectionId));
    if (!settings?.config.routingEnabled) return [];
    const active = await this.db
      .prepare(
        "SELECT id FROM assistant_virtual_employees WHERE agency_id=? AND status='active'",
      )
      .bind(access.tenantId)
      .all<{ id: string }>();
    const ids = new Set(active.results.map((e) => e.id));
    return settings.config.tasks
      .filter(
        (t) => t.audiences.includes(access.audience) && ids.has(t.employeeId),
      )
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  async issueMenu(access: ContactAccess, page = 0): Promise<ChannelMenu> {
    const settings = await this.settings(access.tenantId, access.connectionId);
    if (!settings?.config.routingEnabled)
      throw new Error("CHANNEL_ROUTING_DISABLED");
    const menu = {
      id: crypto.randomUUID(),
      revision: settings.revision,
      tasks: await this.listTasks(access, settings),
      page,
    };
    await this.db
      .prepare(
        "UPDATE whatsapp_channel_contacts SET menu_json=? WHERE connection_id=? AND contact=? AND generation=?",
      )
      .bind(
        JSON.stringify(menu),
        access.connectionId,
        access.contact,
        access.generation,
      )
      .run();
    return menu;
  }

  async menu(access: ContactAccess): Promise<ChannelMenu | null> {
    const row = await this.db
      .prepare(
        "SELECT menu_json FROM whatsapp_channel_contacts WHERE connection_id=? AND contact=? AND generation=?",
      )
      .bind(access.connectionId, access.contact, access.generation)
      .first<{ menu_json: string | null }>();
    return row?.menu_json ? JSON.parse(row.menu_json) : null;
  }

  async selectTask(
    access: ContactAccess,
    taskId: string,
    menuId: string,
  ): Promise<EmployeeSession | null> {
    const current = await this.getAccess(access);
    if (current.generation !== access.generation) return null;
    const currentSettings = await this.settings(
      access.tenantId,
      access.connectionId,
    );
    if (!currentSettings?.config.routingEnabled) return null;
    const menu = await this.menu(access);
    const tasks = await this.listTasks(access, currentSettings);
    const task = tasks.find((t) => t.id === taskId);
    const savedTaskIds = menu?.tasks.map((item) => item.id).sort() ?? [];
    const currentTaskIds = tasks.map((item) => item.id).sort();
    if (
      !task ||
      menu?.id !== menuId ||
      menu.revision !== currentSettings.revision ||
      savedTaskIds.length !== currentTaskIds.length ||
      !savedTaskIds.every((id, index) => id === currentTaskIds[index]) ||
      !menu.tasks.some((t) => t.id === taskId)
    )
      return null;
    const row = await this.db
      .prepare(
        "UPDATE whatsapp_channel_contacts SET employee_id=?,selection_revision=selection_revision+1,menu_json=NULL WHERE connection_id=? AND contact=? AND generation=? RETURNING selection_revision",
      )
      .bind(
        task.employeeId,
        access.connectionId,
        access.contact,
        access.generation,
      )
      .first<{ selection_revision: number }>();
    return row
      ? {
          access,
          employeeId: task.employeeId,
          selectionRevision: row.selection_revision,
        }
      : null;
  }

  async getSession(key: ContactKey): Promise<EmployeeSession | null> {
    const access = await this.getAccess(key);
    const row = await this.db
      .prepare(
        "SELECT employee_id,selection_revision FROM whatsapp_channel_contacts WHERE connection_id=? AND contact=? AND generation=?",
      )
      .bind(key.connectionId, key.contact, access.generation)
      .first<{ employee_id: string | null; selection_revision: number }>();
    if (
      !row?.employee_id ||
      !(await this.listTasks(access)).some(
        (t) => t.employeeId === row.employee_id,
      )
    )
      return null;
    return {
      access,
      employeeId: row.employee_id,
      selectionRevision: row.selection_revision,
    };
  }

  async returnToMenu(access: ContactAccess) {
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE whatsapp_channel_contacts SET employee_id=NULL,selection_revision=selection_revision+1,menu_json=NULL,buffered_text=NULL WHERE connection_id=? AND contact=? AND generation=?",
        )
        .bind(access.connectionId, access.contact, access.generation),
      this.db
        .prepare(
          "UPDATE whatsapp_channel_actions SET status='cancelled' WHERE connection_id=? AND contact=? AND generation=? AND status='pending'",
        )
        .bind(access.connectionId, access.contact, access.generation),
    ]);
  }

  async buffer(access: ContactAccess, text: string | null) {
    await this.db
      .prepare(
        "UPDATE whatsapp_channel_contacts SET buffered_text=? WHERE connection_id=? AND contact=? AND generation=?",
      )
      .bind(text, access.connectionId, access.contact, access.generation)
      .run();
  }
  async takeBuffer(access: ContactAccess): Promise<string | null> {
    const row = await this.db
      .prepare(
        "SELECT buffered_text FROM whatsapp_channel_contacts WHERE connection_id=? AND contact=? AND generation=?",
      )
      .bind(access.connectionId, access.contact, access.generation)
      .first<{ buffered_text: string | null }>();
    await this.buffer(access, null);
    return row?.buffered_text ?? null;
  }
}
