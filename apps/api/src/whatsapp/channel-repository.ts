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
    for (const staff of config.staff.filter((s) => s.principalId)) {
      const principal = await findPrincipal(this.db, staff.principalId!);
      if (
        !principal?.isActive ||
        !(await loadActor(this.db, principal)).memberships.some(
          (m) => m.isActive && (m.tenantId ?? m.agencyId) === tenantId,
        )
      )
        throw new Error("CHANNEL_STAFF_UNAVAILABLE");
    }
    const revision = crypto.randomUUID();
    await this.db.batch([
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
      this.db
        .prepare(
          "UPDATE whatsapp_channel_contacts SET generation=?,employee_id=NULL,selection_revision=selection_revision+1,menu_json=NULL,buffered_text=NULL,draft_json=NULL WHERE connection_id=?",
        )
        .bind(revision, connectionId),
      this.db
        .prepare(
          "UPDATE whatsapp_channel_actions SET status='cancelled' WHERE connection_id=? AND status IN ('pending','queued')",
        )
        .bind(connectionId),
    ]);
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
      if (!membership) throw new Error("CHANNEL_STAFF_REVOKED");
      membershipStamp = `${membership.id}:${membership.role}:${membership.updatedAt}`;
    }
    const generation = `${settings.revision}:${membershipStamp}`;
    const audience = staff ? "internal" : "external";
    await this.db
      .prepare(
        "INSERT INTO whatsapp_channel_contacts(connection_id,contact,generation) VALUES(?,?,?) ON CONFLICT(connection_id,contact) DO UPDATE SET generation=excluded.generation,employee_id=NULL,selection_revision=whatsapp_channel_contacts.selection_revision+1,menu_json=NULL,buffered_text=NULL,draft_json=NULL WHERE whatsapp_channel_contacts.generation<>excluded.generation",
      )
      .bind(key.connectionId, key.contact, generation)
      .run();
    return {
      ...key,
      audience,
      generation,
      principalId,
      profileId: audience,
      capabilities:
        audience === "internal"
          ? settings.config.internalCapabilities
          : settings.config.externalCapabilities,
    };
  }

  async listTasks(access: ContactAccess) {
    const settings = await this.settings(access.tenantId, access.connectionId);
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
    const menu = {
      id: crypto.randomUUID(),
      tasks: await this.listTasks(access),
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
    const menu = await this.menu(access);
    const task = (await this.listTasks(access)).find((t) => t.id === taskId);
    if (
      !task ||
      menu?.id !== menuId ||
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
