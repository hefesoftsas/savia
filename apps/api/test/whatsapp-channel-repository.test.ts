import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";

async function fixture() {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  const key = {
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    contact: "573001234567",
  };
  const config = {
    routingEnabled: true,
    tasks: [
      {
        id: "quote",
        employeeId: s.employeeId,
        title: "Consultar seguros",
        description: "Cotiza tu vehículo",
        order: 0,
        audiences: ["external", "internal"] as const,
      },
    ],
    staff: [],
    internalCapabilities: [],
    externalCapabilities: [],
  };
  return { ...s, repo, key, config };
}

describe("WhatsApp channel state", () => {
  it("keeps admitted contacts external until explicitly registered as staff", async () => {
    const s = await fixture();
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      s.config,
      s.principal.id,
    );
    const access = await s.repo.getAccess(s.key);
    expect(access.audience).toBe("external");
    expect(access.principalId).toBeNull();
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      {
        ...s.config,
        staff: [
          {
            phone: s.key.contact,
            label: "Staff",
            active: true,
            principalId: s.principal.id,
          },
        ],
      },
      s.principal.id,
    );
    const staff = await s.repo.getAccess(s.key);
    expect(staff.audience).toBe("internal");
    expect(staff.principalId).toBe(s.principal.id);
    expect(staff.generation).not.toBe(access.generation);
  });

  it("rejects duplicate normalized staff phones and invalid native task labels", async () => {
    const s = await fixture();
    const staff = [
      {
        phone: "+57 3001234567",
        label: "One",
        active: true,
        principalId: null,
      },
      { phone: s.key.contact, label: "Two", active: true, principalId: null },
    ];
    await expect(
      s.repo.configure(
        s.tenantId,
        s.connectionId,
        { ...s.config, staff },
        s.principal.id,
      ),
    ).rejects.toThrow();
    await expect(
      s.repo.configure(
        s.tenantId,
        s.connectionId,
        {
          ...s.config,
          tasks: [{ ...s.config.tasks[0], title: "x".repeat(25) }],
        },
        s.principal.id,
      ),
    ).rejects.toThrow();
  });

  it("fences selections with menu revision and invalidates them on configuration change", async () => {
    const s = await fixture();
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      {
        ...s.config,
        tasks: [{ ...s.config.tasks[0], title: "Updated task label" }],
      },
      s.principal.id,
    );
    const access = await s.repo.getAccess(s.key);
    const menu = await s.repo.issueMenu(access);
    expect(
      await s.repo.selectTask(access, "quote", "wrong-revision"),
    ).toBeNull();
    const session = (await s.repo.selectTask(access, "quote", menu.id))!;
    expect(session).toMatchObject({ employeeId: s.employeeId });
    expect(await s.repo.getSession(s.key)).toMatchObject({
      employeeId: s.employeeId,
    });
    const createdAt = new Date().toISOString();
    for (const [id, status] of [
      ["routing-pending", "pending"],
      ["routing-queued", "queued"],
    ] as const)
      await env.DB.prepare(
        `INSERT INTO whatsapp_channel_actions
         (id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,
          action_json,token_hash,status,expires_at,created_at)
         VALUES(?,?,?,?,?,?,?,'{}','test-hash',?,?,?)`,
      )
        .bind(
          `${id}-${s.tenantId}`,
          s.connectionId,
          s.tenantId,
          s.key.contact,
          access.generation,
          session.employeeId,
          session.selectionRevision,
          status,
          new Date(Date.now() + 60_000).toISOString(),
          createdAt,
        )
        .run();
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      s.config,
      s.principal.id,
    );
    expect(await s.repo.getSession(s.key)).toBeNull();
    expect(await s.repo.selectTask(access, "quote", menu.id)).toBeNull();
    const actionStatuses = await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE connection_id=? ORDER BY id",
    )
      .bind(s.connectionId)
      .all<{ status: string }>();
    expect(actionStatuses.results.map((row) => row.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
  });

  it("preserves selected employees, menu revisions, and pending actions when only the support contact changes", async () => {
    const s = await fixture();
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      s.config,
      s.principal.id,
    );
    const access = await s.repo.getAccess(s.key);
    const menu = await s.repo.issueMenu(access);
    const session = (await s.repo.selectTask(access, "quote", menu.id))!;
    const stillValidMenu = await s.repo.issueMenu(access);
    const createdAt = new Date().toISOString();
    for (const [id, status] of [
      ["support-pending", "pending"],
      ["support-queued", "queued"],
    ] as const)
      await env.DB.prepare(
        `INSERT INTO whatsapp_channel_actions
         (id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,
          action_json,token_hash,status,expires_at,created_at)
         VALUES(?,?,?,?,?,?,?,'{}','test-hash',?,?,?)`,
      )
        .bind(
          `${id}-${s.tenantId}`,
          s.connectionId,
          s.tenantId,
          s.key.contact,
          access.generation,
          session.employeeId,
          session.selectionRevision,
          status,
          new Date(Date.now() + 60_000).toISOString(),
          createdAt,
        )
        .run();
    const originalRevision = (await s.repo.settings(
      s.tenantId,
      s.connectionId,
    ))!.revision;

    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      { ...s.config, humanSupportContact: "+57 300 123 4567" },
      s.principal.id,
    );

    expect((await s.repo.settings(s.tenantId, s.connectionId))?.revision).toBe(
      originalRevision,
    );
    expect(await s.repo.getSession(s.key)).toMatchObject({
      employeeId: s.employeeId,
    });
    expect(
      await s.repo.selectTask(access, "quote", stillValidMenu.id),
    ).toMatchObject({ employeeId: s.employeeId });
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      { ...s.config, humanSupportContact: "+57 300 123 4567" },
      s.principal.id,
    );
    expect((await s.repo.settings(s.tenantId, s.connectionId))?.revision).toBe(
      originalRevision,
    );
    expect(await s.repo.getSession(s.key)).toMatchObject({
      employeeId: s.employeeId,
    });
    const statuses = await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE connection_id=? ORDER BY id",
    )
      .bind(s.connectionId)
      .all<{ status: string }>();
    expect(statuses.results.map((row) => row.status).sort()).toEqual([
      "pending",
      "queued",
    ]);
  });

  it("does not publish inactive or cross-tenant employees", async () => {
    const s = await fixture();
    await env.DB.prepare(
      "UPDATE assistant_virtual_employees SET status='inactive' WHERE id=?",
    )
      .bind(s.employeeId)
      .run();
    await expect(
      s.repo.configure(s.tenantId, s.connectionId, s.config, s.principal.id),
    ).rejects.toThrow();
  });

  it("uses a fresh access generation when a previously revoked staff profile returns", async () => {
    const s = await fixture();
    const staff = [
      {
        phone: s.key.contact,
        label: "Staff",
        active: true,
        principalId: s.principal.id,
      },
    ];
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      { ...s.config, staff },
      s.principal.id,
    );
    const original = await s.repo.getAccess(s.key);
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      s.config,
      s.principal.id,
    );
    const external = await s.repo.getAccess(s.key);
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      { ...s.config, staff },
      s.principal.id,
    );
    const restored = await s.repo.getAccess(s.key);
    expect(external.generation).not.toBe(original.generation);
    expect(restored.generation).not.toBe(original.generation);
    expect(restored.generation).not.toBe(external.generation);
  });

  it("persists access revocation across staff changes even when no message arrives between edits", async () => {
    const s = await fixture();
    const staff = [
      {
        phone: s.key.contact,
        label: "Staff",
        active: true,
        principalId: s.principal.id,
      },
    ];
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      { ...s.config, staff },
      s.principal.id,
    );
    const original = await s.repo.getAccess(s.key);
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      s.config,
      s.principal.id,
    );
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      { ...s.config, staff },
      s.principal.id,
    );
    expect((await s.repo.getAccess(s.key)).generation).not.toBe(
      original.generation,
    );
  });

  it("rotates staff access after a principal is revoked and restored", async () => {
    const s = await fixture();
    const staff = [
      {
        phone: s.key.contact,
        label: "Staff",
        active: true,
        principalId: s.principal.id,
      },
    ];
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      { ...s.config, staff },
      s.principal.id,
    );
    const original = await s.repo.getAccess(s.key);
    await env.DB.prepare(
      "UPDATE identity_principal SET is_active=0,updated_at=? WHERE id=?",
    )
      .bind(new Date(Date.now() + 1000).toISOString(), s.principal.id)
      .run();
    await expect(s.repo.getAccess(s.key)).rejects.toThrow(
      "CHANNEL_STAFF_REVOKED",
    );
    await env.DB.prepare(
      "UPDATE identity_principal SET is_active=1,updated_at=? WHERE id=?",
    )
      .bind(new Date(Date.now() + 2000).toISOString(), s.principal.id)
      .run();
    const restored = await s.repo.getAccess(s.key);
    expect(restored.generation).not.toBe(original.generation);
  });

  it("allows disabling a staff entry after its linked principal was revoked", async () => {
    const s = await fixture();
    const staff = [
      {
        phone: s.key.contact,
        label: "Staff",
        active: true,
        principalId: s.principal.id,
      },
    ];
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      { ...s.config, staff },
      s.principal.id,
    );
    await env.DB.prepare("UPDATE identity_principal SET is_active=0 WHERE id=?")
      .bind(s.principal.id)
      .run();
    await expect(
      s.repo.configure(
        s.tenantId,
        s.connectionId,
        {
          ...s.config,
          staff: [{ ...staff[0], active: false }],
        },
        s.principal.id,
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps access history generation across task label edits while issuing a new menu revision", async () => {
    const s = await fixture();
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      s.config,
      s.principal.id,
    );
    const access = await s.repo.getAccess(s.key);
    const first = await s.repo.issueMenu(access);
    await env.DB.prepare(
      "INSERT INTO whatsapp_channel_history(message_id,connection_id,contact,generation,employee_id,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        "label-edit-history",
        s.connectionId,
        s.key.contact,
        access.generation,
        s.employeeId,
        "Hi",
        "Hello",
        new Date().toISOString(),
      )
      .run();
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      {
        ...s.config,
        tasks: [{ ...s.config.tasks[0], title: "Updated task label" }],
      },
      s.principal.id,
    );
    const refreshedAccess = await s.repo.getAccess(s.key);
    const refreshedMenu = await s.repo.issueMenu(refreshedAccess);
    expect(refreshedAccess.generation).toBe(access.generation);
    expect(refreshedMenu.revision).not.toBe(first.revision);
    expect(
      await env.DB.prepare(
        "SELECT message_id FROM whatsapp_channel_history WHERE message_id=? AND generation=?",
      )
        .bind("label-edit-history", refreshedAccess.generation)
        .first(),
    ).toBeTruthy();
  });
});
