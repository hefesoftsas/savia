import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import authWorker from "../src/index";

const origin = "http://127.0.0.1:8787";

function resourceOperations(prepare: ReturnType<typeof vi.spyOn>) {
  return prepare.mock.calls.filter(([query]) =>
    /\boauthResource\b/i.test(String(query)),
  ).length;
}

it("reuses OAuth initialization across warmed default-worker requests", async () => {
  const environment = {
    ...env,
    BETTER_AUTH_SECRET: "request-initialization-cache-test-secret",
  };
  const prepare = vi.spyOn(environment.AUTH_DB, "prepare");
  const request = (path: string, init?: RequestInit) =>
    authWorker.fetch(
      new Request(`${origin}${path}`, init),
      { ...environment },
      { waitUntil() {} } as ExecutionContext,
    );

  try {
    const cold = await request("/api/auth/oauth-ui.css");
    expect(cold.status).toBe(200);
    prepare.mockClear();

    for (const path of [
      "/api/auth/oauth-ui.css",
      "/api/auth/login",
      "/_internal/oauth/admin-client",
    ]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expect(resourceOperations(prepare)).toBe(0);
      prepare.mockClear();
    }

    const signIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "savia.admin@example.test",
        password: environment.BETTER_AUTH_BOOTSTRAP_PASSWORD,
      }),
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toContain("savia.session_token=");
    const authenticated = await request("/_internal/session", {
      headers: { cookie },
    });
    const anonymous = await request("/_internal/session");
    const authenticatedAgain = await request("/_internal/session", {
      headers: { cookie },
    });
    expect((await authenticated.json()).user.email).toBe(
      "savia.admin@example.test",
    );
    expect((await anonymous.json()).user).toBeNull();
    expect((await authenticatedAgain.json()).user.email).toBe(
      "savia.admin@example.test",
    );
  } finally {
    prepare.mockRestore();
  }
});

it("reinitializes auth when secret or resource binding values change", async () => {
  const environment = {
    ...env,
    BETTER_AUTH_SECRET: "request-initialization-invalidation-secret-a",
  };
  const prepare = vi.spyOn(environment.AUTH_DB, "prepare");
  const request = async (secret: string, resource?: string) => {
    const response = await authWorker.fetch(
      new Request(`${origin}/api/auth/oauth-ui.css`),
      {
        ...environment,
        BETTER_AUTH_SECRET: secret,
        ...(resource ? { SAVIA_API_RESOURCE: resource } : {}),
      },
      { waitUntil() {} } as ExecutionContext,
    );
    expect(response.status).toBe(200);
  };

  try {
    await request(environment.BETTER_AUTH_SECRET);
    prepare.mockClear();
    await request("request-initialization-invalidation-secret-b");
    expect(resourceOperations(prepare)).toBe(4);
    prepare.mockClear();
    await request(
      "request-initialization-invalidation-secret-b",
      "https://binding-change.example/api",
    );
    expect(resourceOperations(prepare)).toBe(4);
    prepare.mockClear();
    const addedBinding = {
      ...environment,
      BETTER_AUTH_SECRET: "request-initialization-invalidation-secret-b",
      SAVIA_API_RESOURCE: "https://binding-change.example/api",
      CACHE_TEST_BINDING: "present",
    };
    const addedResponse = await authWorker.fetch(
      new Request(`${origin}/api/auth/oauth-ui.css`),
      addedBinding,
      { waitUntil() {} } as ExecutionContext,
    );
    expect(addedResponse.status).toBe(200);
    expect(resourceOperations(prepare)).toBe(4);
    prepare.mockClear();
    const removedResponse = await authWorker.fetch(
      new Request(`${origin}/api/auth/oauth-ui.css`),
      {
        ...environment,
        BETTER_AUTH_SECRET: "request-initialization-invalidation-secret-b",
        SAVIA_API_RESOURCE: "https://binding-change.example/api",
      },
      { waitUntil() {} } as ExecutionContext,
    );
    expect(removedResponse.status).toBe(200);
    expect(resourceOperations(prepare)).toBe(4);
    prepare.mockClear();
    const replacementBinding = new Proxy(environment.AUTH_DB, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const replacementBindingResponse = await authWorker.fetch(
      new Request(`${origin}/api/auth/oauth-ui.css`),
      {
        ...environment,
        AUTH_DB: replacementBinding,
        BETTER_AUTH_SECRET: "request-initialization-invalidation-secret-b",
        SAVIA_API_RESOURCE: "https://binding-change.example/api",
      },
      { waitUntil() {} } as ExecutionContext,
    );
    expect(replacementBindingResponse.status).toBe(200);
    expect(resourceOperations(prepare)).toBeGreaterThanOrEqual(4);
  } finally {
    prepare.mockRestore();
  }
});

it("drops a cached handler after a transient context initialization failure", async () => {
  const environment = {
    ...env,
    BETTER_AUTH_SECRET: "request-initialization-retry-test-secret",
  };
  const prepareDatabase = environment.AUTH_DB.prepare.bind(environment.AUTH_DB);
  let failOnce = true;
  const prepare = vi
    .spyOn(environment.AUTH_DB, "prepare")
    .mockImplementation((query) => {
      if (failOnce && /\boauthResource\b/i.test(String(query))) {
        failOnce = false;
        throw new Error("transient OAuth resource initialization failure");
      }
      return prepareDatabase(query);
    });
  const request = () =>
    authWorker.fetch(
      new Request(`${origin}/api/auth/oauth-ui.css`),
      { ...environment },
      { waitUntil() {} } as ExecutionContext,
    );

  try {
    await expect(request()).rejects.toThrow(
      "transient OAuth resource initialization failure",
    );
    expect((await request()).status).toBe(200);
  } finally {
    prepare.mockRestore();
  }
});
