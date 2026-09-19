import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createApplication } from "../src/application";
import { loadConfiguration } from "../src/config";
import { makeConfig } from "../../../packages/crm-shared/src/metadata";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";
function totp(uri: string) {
  const url = new URL(uri);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0,
    bits = 0;
  const bytes: number[] = [];
  for (const character of url.searchParams.get("secret")!.replace(/=+$/, "")) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Invalid TOTP secret");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(
      Math.floor(
        Date.now() / 1000 / Number(url.searchParams.get("period") ?? 30),
      ),
    ),
  );
  const hash = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hash.at(-1)! & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

it.skipIf(!postgresTestUrl)(
  "preserves native tenant/relation metadata and nullable API filters",
  async () => {
    await withPostgresFixture(async (_db, url) => {
      const directory = mkdtempSync(join(tmpdir(), "savia-native-api-"));
      const origin = "http://localhost:8080",
        email = "api-native@example.test",
        password = "Native-Api-Password-123!";
      const config = loadConfiguration({
        SAVIA_DATABASE_DRIVER: "postgres",
        SAVIA_POSTGRES_URL: url,
        SAVIA_PUBLIC_ORIGIN: origin,
        SAVIA_DATA_DIR: directory,
        SAVIA_AUTH_SECRET: "native-api-auth-".repeat(4),
        SAVIA_ENCRYPTION_KEY: "native-api-encryption-".repeat(4),
        SAVIA_CAPTCHA_SECRET: "native-api-captcha-".repeat(4),
        SAVIA_BOOTSTRAP_EMAIL: email,
        SAVIA_BOOTSTRAP_PASSWORD: password,
        S3_ENDPOINT: "http://127.0.0.1:1",
        S3_PUBLIC_ENDPOINT: "http://127.0.0.1:1",
        S3_ACCESS_KEY_ID: "test-access",
        S3_SECRET_ACCESS_KEY: "native-api-storage-secret",
      });
      let app: Awaited<ReturnType<typeof createApplication>> | undefined;
      const cookies = new Map<string, string>();
      async function json(
        path: string,
        method = "GET",
        body?: unknown,
        status = 200,
        extra: Record<string, string> = {},
      ) {
        const headers = new Headers({ origin, ...extra });
        headers.set(
          "cookie",
          [...cookies].map(([key, value]) => key + "=" + value).join("; "),
        );
        if (body !== undefined) headers.set("content-type", "application/json");
        const response = await app!.fetch(
          new Request(origin + path, {
            method,
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        );
        for (const value of response.headers.getSetCookie()) {
          const pair = value.split(";")[0],
            i = pair.indexOf("=");
          cookies.set(pair.slice(0, i), pair.slice(i + 1));
        }
        expect(
          response.status,
          path + ": " + (await response.clone().text()),
        ).toBe(status);
        return response.json() as Promise<any>;
      }
      try {
        app = await createApplication(config, {});
        await json("/api/auth/sign-in/email", "POST", { email, password });
        const enrollment = await json("/api/auth/two-factor/enable", "POST", {
          password,
          method: "totp",
        });
        await json("/api/auth/two-factor/verify-totp", "POST", {
          code: totp(enrollment.totpURI),
        });
        const tenant = (
          await json(
            "/v1/tenants",
            "POST",
            {
              name: "Native API Tenant",
              idSlug: "native-api-tenant",
              isActive: true,
              initialUser: {
                email: "tenant-user@example.test",
                firstName: "Tenant",
                lastName: "User",
                role: "tenant_admin",
                temporaryPassword: "Native-Tenant-Password-123!",
              },
            },
            201,
          )
        ).data;
        expect(tenant).toMatchObject({
          idSlug: "native-api-tenant",
          name: "Native API Tenant",
          isActive: true,
          kind: "commercial",
          agencyId: null,
        });
        expect(tenant.id).toBeTypeOf("number");
        expect(tenant.createdAt).toBeTypeOf("string");
        expect(tenant.updatedAt).toBeTypeOf("string");
        expect((await json("/v1/tenants")).data).toEqual(
          expect.arrayContaining([expect.objectContaining(tenant)]),
        );
        expect((await json(`/v1/tenants/${tenant.id}`)).data).toEqual(tenant);
        expect(
          (
            await json("/v1/tenants/current", "GET", undefined, 200, {
              "x-savia-tenant-slug": tenant.idSlug,
            })
          ).data,
        ).toMatchObject({
          id: tenant.id,
          slug: tenant.idSlug,
          name: tenant.name,
          isDedicated: true,
        });
        const base = "/v1/data-domains/platform/api";
        for (const name of ["source_items", "target_items"])
          await json(
            base + "/objects",
            "POST",
            {
              name,
              label: name,
              config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
            },
            201,
          );
        const definition = {
          sourceObject: "source_items",
          targetObject: "target_items",
          sourceLabel: "Sources",
          targetLabel: "Targets",
          cardinality: "one-to-many",
          sourceField: "id",
          targetField: "id",
          sourceDisplayField: "name",
          targetDisplayField: "name",
          storage: "local",
        };
        const relation = (
          await json(base + "/collection-relations", "POST", definition, 201)
        ).data;
        expect((await json(base + "/collection-relations")).data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: relation.id,
              ...definition,
              version: 1,
            }),
          ]),
        );
        const noFilters = await json("/v1/access-control/audit?scope=platform");
        expect(noFilters.data).toBeInstanceOf(Array);
        const filtered = await json(
          "/v1/access-control/audit?scope=platform&action=role.saved&actorId=missing&targetId=missing&from=2020-01-01T00%3A00%3A00.000Z&to=2099-01-01T00%3A00%3A00.000Z",
        );
        expect(filtered.data).toEqual([]);
        const global = await json("/v1/access-control/members?scope=platform");
        expect(global.members).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ email, displayName: expect.any(String) }),
          ]),
        );
        const scoped = await json(
          `/v1/access-control/members?scope=tenant:${tenant.id}`,
        );
        expect(scoped.members).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              email: "tenant-user@example.test",
              displayName: "Tenant User",
            }),
          ]),
        );
        const scope = `tenant:${tenant.id}`;
        const rolesPath = "/v1/access-control/roles";
        const roleState = await json(rolesPath + "?scope=" + scope);
        const input = {
          scope,
          name: "native_role",
          label: "Native role",
          description: "Native permission contract",
          enabled: true,
          expectedRevision: roleState.revision,
          grants: [],
        };
        const role = await json(rolesPath, "POST", input, 201);
        expect(role.revision).toBe(roleState.revision + 1);
        const updated = await json(rolesPath + "/" + role.id, "PATCH", {
          ...input,
          label: "Updated native role",
          expectedRevision: role.revision,
        });
        expect(updated.revision).toBe(role.revision + 1);
        await json(
          rolesPath + "/" + role.id,
          "PATCH",
          { ...input, label: "Stale write", expectedRevision: role.revision },
          409,
        );
        const principal = scoped.members.find(
          (member: any) => member.email === "tenant-user@example.test",
        );
        const assignmentPath = "/v1/access-control/assignments/" + principal.id;
        const assigned = await json(assignmentPath, "PUT", {
          scope,
          roleIds: [role.id],
          expectedRevision: updated.revision,
        });
        expect(assigned.revision).toBe(updated.revision + 1);
        expect(await json(assignmentPath + "?scope=" + scope)).toMatchObject({
          revision: assigned.revision,
          roleIds: [role.id],
        });
        await json(
          assignmentPath,
          "PUT",
          { scope, roleIds: [], expectedRevision: updated.revision },
          409,
        );
        const committed = await json(rolesPath + "?scope=" + scope);
        expect(committed.roles).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: role.id,
              label: "Updated native role",
            }),
          ]),
        );
        const audit = await json("/v1/access-control/audit?scope=" + scope);
        expect(audit.data.map((entry: any) => entry.action)).toEqual(
          expect.arrayContaining(["role.saved", "assignments.saved"]),
        );
        const brandingPath = `/v1/tenants/${tenant.id}/branding`;
        const branding = (await json(brandingPath)).data;
        expect(branding).toMatchObject({ logoUrl: null, coverUrl: null });
        const saved = (
          await json(brandingPath, "PUT", {
            ...branding,
            displayName: "Native Brand",
            loginTitle: "Welcome",
            primaryColor: "#123456",
          })
        ).data;
        expect(saved).toMatchObject({
          displayName: "Native Brand",
          loginTitle: "Welcome",
          primaryColor: "#123456",
          logoUrl: null,
          coverUrl: null,
          version: branding.version + 1,
        });
        expect((await json(brandingPath)).data).toEqual(saved);
      } finally {
        await app?.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  },
  180_000,
);
