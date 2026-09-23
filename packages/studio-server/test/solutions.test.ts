import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { createStudioApp } from "../src/index";
import { installSolution } from "../src/solutions";
import { makeConfig } from "@savia/studio-shared/metadata";

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;
const manifest = {
  format: "savia.solution",
  formatVersion: 1,
  id: "test.clinic",
  version: "1.0.0",
  label: "Clínica",
  description: "Consultas independientes de seguros",
  requires: [],
  objects: [
    {
      name: "appointments",
      label: "Citas",
      description: "",
      config: makeConfig({
        name: { type: "Textbox", label: "Nombre", required: true },
      }),
    },
  ],
};
function request(tenant: string, path: string, method = "GET", body?: unknown) {
  const app = createStudioApp(tenant, {
    seedObjects: [],
    solutionCatalog: [manifest],
  } as any);
  return app.request(
    "http://localhost/api" + path,
    {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    platform.env,
  );
}
async function json(
  tenant: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const response = await request(tenant, path, method, body);
  const text = await response.text();
  expect(response.status, text).toBeLessThan(300);
  const payload = JSON.parse(text) as any;
  return payload;
}
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const file of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await platform.env.DB.prepare(sql).run();
});
afterAll(async () => {
  await platform?.dispose();
});

describe("industry packages on real D1", () => {
  it("runs an installation hook before committing a solution", async () => {
    const seen: string[] = [];

    await installSolution(platform.env.DB, "bundle-hook", manifest, {
      solutionCatalog: [manifest],
      beforeInstall: async (candidate: { id: string }) => {
        seen.push(candidate.id);
      },
    });

    expect(seen).toEqual(["test.clinic"]);
  });

  it("previews and installs a downloaded package on an empty independent workspace", async () => {
    await json("clinic", "/bootstrap", "POST");
    expect((await json("clinic", "/objects")).data).toHaveLength(0);
    const catalog = await json("clinic", "/solutions");
    expect(catalog.data[0].installed).toBeNull();
    const preview = await json(
      "clinic",
      "/solutions/preview",
      "POST",
      catalog.data[0].manifest,
    );
    expect(preview.data).toMatchObject({
      canInstall: true,
      objects: [{ name: "appointments", action: "create" }],
    });
    expect((await json("clinic", "/objects")).data).toHaveLength(0);
    await json("clinic", "/solutions/install", "POST", manifest);
    const record = (
      await json("clinic", "/records/appointments", "POST", {
        name: "Patient-private-973",
      })
    ).data;
    expect(record.name).toBe("Patient-private-973");
    expect((await json("other", "/objects")).data).toHaveLength(0);
    expect(
      (await request("other", "/solutions/test.clinic/export")).status,
    ).toBe(404);
    const exported = await json("clinic", "/solutions/test.clinic/export");
    expect(exported.objects).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain("Patient-private-973");
    await json("other", "/solutions/install", "POST", exported);
  });
  it("is idempotent, disables access without deleting records and reactivates", async () => {
    await json("lifecycle", "/solutions/install", "POST", manifest);
    const record = (
      await json("lifecycle", "/records/appointments", "POST", {
        name: "Keep me",
      })
    ).data;
    await json("lifecycle", "/solutions/install", "POST", manifest);
    expect((await json("lifecycle", "/objects")).data).toHaveLength(1);
    await json("lifecycle", "/solutions/test.clinic", "PATCH", {
      enabled: false,
    });
    expect((await json("lifecycle", "/objects")).data).toHaveLength(0);
    expect(
      (await request("lifecycle", `/records/appointments/${record.id}`)).status,
    ).toBe(404);
    await json("lifecycle", "/solutions/test.clinic", "PATCH", {
      enabled: true,
    });
    expect(
      (await json("lifecycle", `/records/appointments/${record.id}`)).data.name,
    ).toBe("Keep me");
  });
  it("rejects collisions and missing dependencies without partial installation", async () => {
    await json("collision", "/objects", "POST", manifest.objects[0]);
    const preview = await json(
      "collision",
      "/solutions/preview",
      "POST",
      manifest,
    );
    expect(preview.data.canInstall).toBe(false);
    expect(
      (await request("collision", "/solutions/install", "POST", manifest))
        .status,
    ).toBe(409);
    expect(
      (
        await request("dependency", "/solutions/install", "POST", {
          ...manifest,
          requires: ["missing.extension"],
        })
      ).status,
    ).toBe(409);
    expect((await json("dependency", "/objects")).data).toHaveLength(0);
  });
  it("updates additively but protects customization, semantic version immutability and data", async () => {
    await json("upgrade", "/solutions/install", "POST", manifest);
    await json("upgrade", "/records/appointments", "POST", {
      name: "Preserved",
    });
    const next = structuredClone(manifest);
    next.version = "1.1.0";
    next.objects[0].config = makeConfig({
      name: { type: "Textbox", label: "Nombre", required: true },
      notes: { type: "Textbox", label: "Notas" },
    });
    await json("upgrade", "/solutions/install", "POST", next);
    expect((await json("upgrade", "/records/appointments")).data[0].name).toBe(
      "Preserved",
    );
    expect(
      (await request("upgrade", "/solutions/install", "POST", manifest)).status,
    ).toBe(409);
    const sameVersion = { ...next, label: "Replaced" };
    expect(
      (await request("upgrade", "/solutions/install", "POST", sameVersion))
        .status,
    ).toBe(409);
    await platform.env.DB.prepare(
      "UPDATE crm_objects SET label='Personalizado' WHERE tenant_id='upgrade' AND name='appointments'",
    ).run();
    expect(
      (
        await request("upgrade", "/solutions/install", "POST", {
          ...next,
          version: "1.2.0",
        })
      ).status,
    ).toBe(409);
  });
  it("validates relations and rejects privileged collection bindings and embedded secrets", async () => {
    const bad = structuredClone(manifest);
    bad.objects[0].config.studio = {
      collection: {
        kind: "domain",
        domain: "insurance-catalog",
        collection: "insurance-partners",
      },
    } as any;
    expect(
      (await request("invalid", "/solutions/install", "POST", bad)).status,
    ).toBe(422);
    expect(
      (
        await request("invalid", "/solutions/install", "POST", {
          ...manifest,
          credentials: { token: "secret" },
        })
      ).status,
    ).toBe(422);
    const relation = structuredClone(manifest);
    relation.objects[0].config.fields.name = {
      type: "Dropdown",
      label: "Related",
      options: [],
      config: { relation: "missing" },
    };
    expect(
      (await request("invalid", "/solutions/install", "POST", relation)).status,
    ).toBe(409);
  });
});

it("rejects script-bearing declarative packages", async () => {
  const script = structuredClone(manifest);
  script.objects[0].config = makeConfig({
    custom: {
      type: "FormHtml",
      label: "Custom",
      config: { formHtml: { html: "<p>Hello</p>", script: "alert(1)" } },
    },
  });
  expect(
    (await request("script", "/solutions/install", "POST", script)).status,
  ).toBe(422);
});
it("rejects new uniqueness and conditional requirement during updates", async () => {
  await json("constraints", "/solutions/install", "POST", manifest);
  for (const config of [
    { unique: true },
    { requiredWhen: { field: "name", op: "eq", value: "Example" } },
  ]) {
    const next = structuredClone(manifest);
    next.version = "1.1.0";
    next.objects[0].config = makeConfig({
      ...manifest.objects[0].config.fields,
      code: { type: "Textbox", label: "Code", config },
    });
    expect(
      (await request("constraints", "/solutions/install", "POST", next)).status,
    ).toBe(409);
  }
});

it("requires dependent-first deactivation and dependency-first reactivation", async () => {
  const tenant = "dependency-lifecycle";
  const dependent = {
    ...manifest,
    id: "test.reports",
    requires: [manifest.id],
    objects: [],
  };
  await json(tenant, "/solutions/install", "POST", manifest);
  await json(tenant, "/solutions/install", "POST", dependent);
  expect(
    (
      await request(tenant, `/solutions/${manifest.id}`, "PATCH", {
        enabled: false,
      })
    ).status,
  ).toBe(409);
  await json(tenant, `/solutions/${dependent.id}`, "PATCH", { enabled: false });
  await json(tenant, `/solutions/${manifest.id}`, "PATCH", { enabled: false });
  expect(
    (
      await request(tenant, `/solutions/${dependent.id}`, "PATCH", {
        enabled: true,
      })
    ).status,
  ).toBe(409);
  await json(tenant, `/solutions/${manifest.id}`, "PATCH", { enabled: true });
  await json(tenant, `/solutions/${dependent.id}`, "PATCH", { enabled: true });
  const installations = (await json(tenant, "/solutions")).data;
  expect(
    installations.filter((entry: any) => entry.installed?.enabled),
  ).toHaveLength(2);
});

it("serializes dependent installation against disabling its dependency", async () => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const tenant = `dependency-race-${attempt}`;
    await json(tenant, "/solutions/install", "POST", manifest);
    const dependent = {
      ...manifest,
      id: "test.reports",
      requires: [manifest.id],
      objects: [],
    };
    const responses = await Promise.all([
      request(tenant, "/solutions/install", "POST", dependent),
      request(tenant, `/solutions/${manifest.id}`, "PATCH", { enabled: false }),
    ]);
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status < 300)).toHaveLength(1);
    expect(statuses).toContain(409);
    const { results } = await platform.env.DB.prepare(
      "SELECT id,enabled FROM crm_solution_installations WHERE tenant_id=?",
    )
      .bind(tenant)
      .all<{ id: string; enabled: number }>();
    const base = results.find((row) => row.id === manifest.id)!;
    const child = results.find((row) => row.id === dependent.id);
    expect(Boolean(child?.enabled) && !base.enabled).toBe(false);
  }
});

it("leaves every object and installation untouched when one object collides", async () => {
  const tenant = "multi-collision";
  await json(tenant, "/objects", "POST", manifest.objects[0]);
  const original = (await json(tenant, "/objects")).data;
  const mixed = {
    ...manifest,
    objects: [
      { ...manifest.objects[0], name: "first_new_object" },
      manifest.objects[0],
    ],
  };
  expect(
    (await request(tenant, "/solutions/install", "POST", mixed)).status,
  ).toBe(409);
  expect((await json(tenant, "/objects")).data).toEqual(original);
  expect(
    (await request(tenant, `/solutions/${manifest.id}/export`)).status,
  ).toBe(404);
  expect(
    await platform.env.DB.prepare(
      "SELECT count(*) AS n FROM crm_solution_objects WHERE tenant_id=?",
    )
      .bind(tenant)
      .first("n"),
  ).toBe(0);
});

it("installs mutually related objects together", async () => {
  const tenant = "mutual-relations";
  const related = {
    ...manifest,
    objects: [
      {
        name: "teams",
        label: "Equipos",
        description: "",
        config: makeConfig({
          name: { type: "Textbox", label: "Nombre" },
          lead: {
            type: "Dropdown",
            label: "Responsable",
            options: [],
            config: { relation: "members" },
          },
        }),
      },
      {
        name: "members",
        label: "Miembros",
        description: "",
        config: makeConfig({
          name: { type: "Textbox", label: "Nombre" },
          team: {
            type: "Dropdown",
            label: "Equipo",
            options: [],
            config: { relation: "teams" },
          },
        }),
      },
    ],
  };
  expect(
    (await json(tenant, "/solutions/preview", "POST", related)).data.canInstall,
  ).toBe(true);
  await json(tenant, "/solutions/install", "POST", related);
  expect(
    (await json(tenant, "/objects")).data
      .map((object: any) => object.name)
      .sort(),
  ).toEqual(["members", "teams"]);
  const team = (
    await json(tenant, "/records/teams", "POST", { name: "Equipo" })
  ).data;
  const member = (
    await json(tenant, "/records/members", "POST", {
      name: "Ana",
      team: team.id,
    })
  ).data;
  expect(member.team).toBe(team.id);
});

it("rejects object and field removal without altering the installed version or records", async () => {
  const tenant = "removal-upgrade";
  await json(tenant, "/solutions/install", "POST", manifest);
  const record = (
    await json(tenant, "/records/appointments", "POST", { name: "Retained" })
  ).data;
  const noField = {
    ...manifest.objects[0],
    config: makeConfig({ notes: { type: "Textbox", label: "Notas" } }),
  };
  for (const objects of [[], [noField]]) {
    const removal = { ...manifest, version: "2.0.0", objects };
    expect(
      (await json(tenant, "/solutions/preview", "POST", removal)).data
        .canInstall,
    ).toBe(false);
    expect(
      (await request(tenant, "/solutions/install", "POST", removal)).status,
    ).toBe(409);
  }
  expect((await json(tenant, `/solutions/${manifest.id}/export`)).version).toBe(
    "1.0.0",
  );
  expect(
    (await json(tenant, `/records/appointments/${record.id}`)).data.name,
  ).toBe("Retained");
});

it("rejects malformed and oversized packages before persisting definitions", async () => {
  const tenant = "invalid-bodies";
  const app = createStudioApp(tenant, { seedObjects: [] });
  for (const path of ["preview", "install"]) {
    const malformed = await app.request(
      `http://localhost/api/solutions/${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{invalid",
      },
      platform.env,
    );
    expect(malformed.status).toBe(422);
    expect(
      (
        await request(tenant, `/solutions/${path}`, "POST", {
          ...manifest,
          description: "x".repeat(2 * 1024 * 1024),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await request(tenant, `/solutions/${path}`, "POST", {
          ...manifest,
          formatVersion: 9,
        })
      ).status,
    ).toBe(422);
  }
  expect((await json(tenant, "/objects")).data).toHaveLength(0);
  expect(
    (await request(tenant, `/solutions/${manifest.id}/export`)).status,
  ).toBe(404);
});

it("requires restoring a missing owned object and prevents another package taking its name", async () => {
  const tenant = "orphan-ownership";
  await json(tenant, "/solutions/install", "POST", manifest);
  await platform.env.DB.prepare(
    "DELETE FROM crm_objects WHERE tenant_id=? AND name=?",
  )
    .bind(tenant, "appointments")
    .run();
  const before = await platform.env.DB.prepare(
    "SELECT * FROM crm_solution_objects WHERE tenant_id=?",
  )
    .bind(tenant)
    .all();
  for (const candidate of [
    manifest,
    { ...manifest, version: "1.1.0" },
    { ...manifest, id: "test.other" },
  ]) {
    const preview = (
      await json(tenant, "/solutions/preview", "POST", candidate)
    ).data;
    expect(preview.canInstall).toBe(false);
    expect(preview.conflicts.join(" ")).toMatch(/restaur|pertenece/);
    expect(
      (await request(tenant, "/solutions/install", "POST", candidate)).status,
    ).toBe(409);
  }
  expect((await json(tenant, "/objects")).data).toHaveLength(0);
  expect((await json(tenant, `/solutions/${manifest.id}/export`)).version).toBe(
    "1.0.0",
  );
  expect((await request(tenant, "/solutions/test.other/export")).status).toBe(
    404,
  );
  expect(
    (
      await platform.env.DB.prepare(
        "SELECT * FROM crm_solution_objects WHERE tenant_id=?",
      )
        .bind(tenant)
        .all()
    ).results,
  ).toEqual(before.results);
});

it("requires the owner dependency for cross-package relations but permits local relations", async () => {
  const tenant = "relation-dependency";
  await json(tenant, "/solutions/install", "POST", manifest);
  const related = {
    ...manifest,
    id: "test.followups",
    objects: [
      {
        name: "followups",
        label: "Seguimientos",
        description: "",
        config: makeConfig({
          appointment: {
            type: "Dropdown",
            label: "Cita",
            options: [],
            config: { relation: "appointments" },
          },
        }),
      },
    ],
  };
  expect(
    (await json(tenant, "/solutions/preview", "POST", related)).data.canInstall,
  ).toBe(false);
  expect(
    (await request(tenant, "/solutions/install", "POST", related)).status,
  ).toBe(409);
  await json(tenant, "/solutions/install", "POST", {
    ...related,
    requires: [manifest.id],
  });
  expect(
    (
      await request(tenant, `/solutions/${manifest.id}`, "PATCH", {
        enabled: false,
      })
    ).status,
  ).toBe(409);
  const localTenant = "relation-local";
  await json(localTenant, "/objects", "POST", manifest.objects[0]);
  expect(
    (await json(localTenant, "/solutions/preview", "POST", related)).data
      .canInstall,
  ).toBe(true);
  await json(localTenant, "/solutions/install", "POST", related);
});
