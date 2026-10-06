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
      s.config,
      s.principal.id,
    );
    const access = await s.repo.getAccess(s.key);
    const menu = await s.repo.issueMenu(access);
    expect(
      await s.repo.selectTask(access, "quote", "wrong-revision"),
    ).toBeNull();
    expect(await s.repo.selectTask(access, "quote", menu.id)).toMatchObject({
      employeeId: s.employeeId,
    });
    expect(await s.repo.getSession(s.key)).toMatchObject({
      employeeId: s.employeeId,
    });
    await s.repo.configure(
      s.tenantId,
      s.connectionId,
      s.config,
      s.principal.id,
    );
    expect(await s.repo.getSession(s.key)).toBeNull();
    expect(await s.repo.selectTask(access, "quote", menu.id)).toBeNull();
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
});
