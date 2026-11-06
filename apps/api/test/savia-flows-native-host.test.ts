import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createExtensionRegistry } from "@savia/studio-shared/extension-package";
import type { WorkflowBundle } from "@savia/studio-shared/workflow-bundles";
import { registerSaviaNativeHostRoutes } from "../src/savia-flows/native-host";
import { createTestApp } from "./test-app";

const secret = "savia-native-host-test-secret-at-least-32-bytes";
const principalId = "native-host-principal";
const tenant = "tenant:1101";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(1101,'native-host-test','Native host test','commercial',1,'2026-10-12','2026-10-12') ON CONFLICT(id) DO NOTHING",
  ).run();
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,'test',?,'native-host@savia.test','Native host test',1,'2026-10-12','2026-10-12') ON CONFLICT(id) DO NOTHING",
  )
    .bind(principalId, principalId)
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('native-host-membership',?,1101,'tenant_admin',1,'2026-10-12','2026-10-12') ON CONFLICT(id) DO NOTHING",
  )
    .bind(principalId)
    .run();
});

async function request(
  method: "GET" | "POST" | "PUT",
  path: string,
  options: {
    tokenTenant?: string;
    signedBody?: string;
    body?: unknown;
    app?: ReturnType<typeof createTestApp>;
  } = {},
) {
  const body = JSON.stringify({
    method,
    path,
    ...(options.body === undefined ? {} : { body: options.body }),
  });
  const digestInput = options.signedBody ?? body;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(digestInput),
  );
  const bodyDigest = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const token = await new SignJWT({
    tenant: options.tokenTenant ?? tenant,
    bodyDigest,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("savia-flows")
    .setAudience("savia-flows-native-host")
    .setSubject(principalId)
    .setIssuedAt()
    .setExpirationTime("10s")
    .sign(new TextEncoder().encode(secret));
  const app =
    options.app ?? createTestApp({ saviaFlows: { bridgeSecret: secret } });
  return app.request(
    "/api/public/savia-flows/native",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body,
    },
    env,
  );
}

describe("private native workflow host", () => {
  it("dispatches a body-bound authorized request to the canonical workflow runtime", async () => {
    const response = await request("GET", "/workflows");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [] });
  });

  it("uses the compiled extension registry when listing enabled workflow bundles", async () => {
    const extensionId = "native-compiled-test";
    const registry = createExtensionRegistry([
      {
        builtIn: true,
        manifest: {
          format: "savia.extension",
          formatVersion: 1,
          id: extensionId,
          version: "1.0.0",
          label: "Native compiled test",
          description: "Compiled workflow contribution test.",
          requires: [],
          apiVersion: 1,
        },
      },
    ]);
    const bundle: WorkflowBundle = {
      id: "native_compiled_bundle",
      extensionId,
      label: "Native compiled bundle",
      description: "A compiled workflow bundle.",
      collections: [],
      fields: [],
      workflows: [],
    };
    const app = new OpenAPIHono();
    registerSaviaNativeHostRoutes(app, {
      db: env.DB,
      secret,
      workflowBundles: [bundle],
      extensionRegistry: registry,
    });

    const response = await request("GET", "/workflow-bundles", { app });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ id: "native_compiled_bundle" }],
    });
  });

  it("rejects a token whose digest does not match the call", async () => {
    const response = await request("GET", "/workflows", {
      signedBody: "different body",
    });
    expect(response.status).toBe(401);
  });

  it("rejects client-selected identity fields", async () => {
    const response = await request("GET", "/workflows", {
      body: { principalId: "forged" },
    });
    expect(response.status).toBe(400);
  });

  it("rejects a tenant without current active membership", async () => {
    const response = await request("GET", "/workflows", {
      tokenTenant: "tenant:1102",
    });
    expect(response.status).toBe(403);
  });
});
