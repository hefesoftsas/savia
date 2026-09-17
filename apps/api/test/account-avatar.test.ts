import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { AuthService } from "../src/auth/better-auth";
import { platformAdministratorAuthenticator } from "./auth-fixtures";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migration.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  }
}

const userId = "test-platform-admin";
let image: string | null;
let rejectNextUpdate: boolean;
const updateUser = vi.fn();

const authService: AuthService = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/auth/get-session") {
      return Response.json({
        user: {
          id: userId,
          email: "admin@savia.test",
          image,
          name: "Savia Test Administrator",
        },
      });
    }
    if (request.method === "POST" && path === "/api/auth/update-user") {
      const body = (await request.json()) as { image?: unknown };
      updateUser(body);
      if (rejectNextUpdate) {
        rejectNextUpdate = false;
        return Response.json(
          { error: { message: "No fue posible actualizar el avatar." } },
          { status: 500 },
        );
      }
      image = typeof body.image === "string" ? body.image : null;
      return Response.json({ user: { id: userId, image } });
    }
    return Response.json({ error: { message: "Not found" } }, { status: 404 });
  },
};

function app() {
  return createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    platformAdministratorAuthenticator(),
    undefined,
    authService,
  );
}

function avatarUrl(version: string): string {
  return `http://localhost/v1/account/avatar?v=${version}`;
}

function imageForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

async function deleteAvatarObjects(): Promise<void> {
  const objects = await env.DOCUMENTS.list({ prefix: "avatars/" });
  await Promise.all(objects.objects.map((object) => env.DOCUMENTS.delete(object.key)));
}

beforeAll(applyMigrations);
beforeEach(async () => {
  image = null;
  rejectNextUpdate = false;
  updateUser.mockClear();
  await deleteAvatarObjects();
});

describe("account avatar routes", () => {
  it("stores an accepted avatar before publishing its Better Auth URL", async () => {
    const response = await app().request("/v1/account/avatar", {
      method: "PUT",
      body: imageForm(
        new File(["png-bytes"], "portrait.png", { type: "image/png" }),
      ),
    });

    expect(response.status).toBe(204);
    const objects = await env.DOCUMENTS.list({
      prefix: `avatars/${userId}/`,
    });
    expect(objects.objects).toHaveLength(1);
    expect(updateUser).toHaveBeenCalledWith({
      image: expect.stringMatching(/\/v1\/account\/avatar\?v=/),
    });
    expect(image).toEqual(expect.stringMatching(/\?v=/));
  });

  it("rejects a disallowed file without creating an object", async () => {
    const response = await app().request("/v1/account/avatar", {
      method: "PUT",
      body: imageForm(
        new File(["pdf-bytes"], "portrait.pdf", {
          type: "application/pdf",
        }),
      ),
    });

    expect(response.status).toBe(400);
    expect(await env.DOCUMENTS.list({ prefix: "avatars/" })).toEqual(
      expect.objectContaining({ objects: [] }),
    );
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("removes a staged replacement when Better Auth rejects it", async () => {
    const version = "11111111-1111-4111-8111-111111111111";
    image = avatarUrl(version);
    await env.DOCUMENTS.put(`avatars/${userId}/${version}`, "old-bytes", {
      httpMetadata: { contentType: "image/png" },
    });
    rejectNextUpdate = true;

    const response = await app().request("/v1/account/avatar", {
      method: "PUT",
      body: imageForm(
        new File(["new-bytes"], "portrait.png", { type: "image/png" }),
      ),
    });

    expect(response.status).toBe(502);
    expect(image).toBe(avatarUrl(version));
    expect(await env.DOCUMENTS.get(`avatars/${userId}/${version}`)).not.toBeNull();
    expect((await env.DOCUMENTS.list({ prefix: `avatars/${userId}/` })).objects).toHaveLength(1);
  });

  it("deletes the previous object after publishing a replacement", async () => {
    const oldVersion = "12121212-1212-4121-8121-121212121212";
    image = avatarUrl(oldVersion);
    await env.DOCUMENTS.put(`avatars/${userId}/${oldVersion}`, "old-bytes", {
      httpMetadata: { contentType: "image/png" },
    });

    const response = await app().request("/v1/account/avatar", {
      method: "PUT",
      body: imageForm(
        new File(["new-bytes"], "portrait.png", { type: "image/png" }),
      ),
    });

    expect(response.status).toBe(204);
    expect(image).not.toBe(avatarUrl(oldVersion));
    expect(await env.DOCUMENTS.get(`avatars/${userId}/${oldVersion}`)).toBeNull();
    expect((await env.DOCUMENTS.list({ prefix: `avatars/${userId}/` })).objects).toHaveLength(1);
  });

  it("streams the signed-in user's stored avatar with private no-store headers", async () => {
    const version = "22222222-2222-4222-8222-222222222222";
    image = avatarUrl(version);
    await env.DOCUMENTS.put(`avatars/${userId}/${version}`, "png-bytes", {
      httpMetadata: { contentType: "image/png" },
    });

    const response = await app().request("/v1/account/avatar");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe(
      "png-bytes",
    );
  });

  it("clears Better Auth image and deletes its object", async () => {
    const version = "33333333-3333-4333-8333-333333333333";
    image = avatarUrl(version);
    await env.DOCUMENTS.put(`avatars/${userId}/${version}`, "png-bytes", {
      httpMetadata: { contentType: "image/png" },
    });

    const response = await app().request("/v1/account/avatar", {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(updateUser).toHaveBeenCalledWith({ image: null });
    expect(image).toBeNull();
    expect(await env.DOCUMENTS.get(`avatars/${userId}/${version}`)).toBeNull();
  });
});
