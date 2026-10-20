import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import authWorker, { createAuthHandler } from "../src/index";

const origin = "http://127.0.0.1:8787";
const deploymentRevision = "0123456789abcdef0123456789abcdef01234567";

function managedEnvironment(revision = deploymentRevision) {
  return {
    ...env,
    BETTER_AUTH_SECRET: "managed-auth-deployment-test-secret",
    BETTER_AUTH_BOOTSTRAP_EMAIL: "managed-auth@example.test",
    BETTER_AUTH_BOOTSTRAP_PASSWORD: "Managed-Auth-Password-123!",
    BETTER_AUTH_BOOTSTRAP_NAME: "Managed Auth Deployment",
    SAVIA_INTERNAL_BRIDGE_KEY: "managed-auth-deployment-bridge",
    SAVIA_AUTH_DEPLOYMENT_REVISION: revision,
  };
}

function initializeRequest(revision = deploymentRevision) {
  return new Request(`${origin}/_internal/deployment/initialize`, {
    method: "POST",
    headers: {
      "x-savia-bridge-key": "managed-auth-deployment-bridge",
      "content-type": "application/json",
    },
    body: JSON.stringify({ revision }),
  });
}

function resourceOperations(prepare: ReturnType<typeof vi.spyOn>) {
  return prepare.mock.calls.filter(([query]) =>
    /\boauthResource\b/i.test(String(query)),
  ).length;
}

it("rejects invalid deployment initialization before touching the database", async () => {
  const environment = managedEnvironment();
  const prepare = vi.spyOn(environment.AUTH_DB, "prepare");
  const handler = createAuthHandler(environment);
  const wrongKey = await handler.fetch(
    new Request(`${origin}/_internal/deployment/initialize`, {
      method: "POST",
      headers: {
        "x-savia-bridge-key": "wrong-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ revision: deploymentRevision }),
    }),
  );
  const wrongMethod = await handler.fetch(
    new Request(`${origin}/_internal/deployment/initialize`, {
      method: "GET",
      headers: { "x-savia-bridge-key": "managed-auth-deployment-bridge" },
    }),
  );
  const wrongRevision = await handler.fetch(
    initializeRequest("1123456789abcdef0123456789abcdef01234567"),
  );

  expect(wrongKey.status).toBe(403);
  expect(wrongMethod.status).toBe(405);
  expect(wrongRevision.status).toBe(409);
  expect(prepare).not.toHaveBeenCalled();
  prepare.mockRestore();
});

it("loads persisted readiness without schema or bootstrap work in a fresh handler", async () => {
  const revision = "4123456789abcdef0123456789abcdef01234567";
  const environment = managedEnvironment(revision);
  const initializer = createAuthHandler(environment);
  const uninitialized = await initializer.fetch(
    new Request(`${origin}/_internal/session`),
  );
  const initialized = await initializer.fetch(initializeRequest(revision));
  const retryAfterInitialization = await initializer.fetch(
    new Request(`${origin}/_internal/session`),
  );
  expect(uninitialized.status).toBe(503);
  expect(initialized.status).toBe(200);
  expect(retryAfterInitialization.status).toBe(200);
  expect(await initialized.json()).toEqual({
    status: "ready",
    revision,
  });

  const prepare = vi.spyOn(environment.AUTH_DB, "prepare");
  const exec = vi.spyOn(environment.AUTH_DB, "exec");
  const runtime = createAuthHandler({ ...environment });
  const metadata = await runtime.fetch(
    new Request(`${origin}/_internal/oauth/admin-client`),
  );
  const signIn = await runtime.fetch(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        email: environment.BETTER_AUTH_BOOTSTRAP_EMAIL,
        password: environment.BETTER_AUTH_BOOTSTRAP_PASSWORD,
      }),
    }),
  );
  const loginPage = await runtime.fetch(
    new Request(`${origin}/api/auth/login`, {
      headers: {
        "x-savia-bridge-key": environment.SAVIA_INTERNAL_BRIDGE_KEY,
        "x-savia-tenant-email-id": "42",
      },
    }),
  );

  expect(metadata.status).toBe(200);
  expect(metadata.headers.get("server-timing")).toMatch(
    /^auth_readiness;dur=\d+(?:\.\d+)?, auth_dispatch;dur=\d+(?:\.\d+)?$/,
  );
  expect(await metadata.json()).toMatchObject({
    clientId: expect.any(String),
    redirectUri: expect.any(String),
    resource: expect.any(String),
  });
  expect(signIn.status).toBe(200);
  expect(loginPage.status).toBe(200);
  expect(resourceOperations(prepare)).toBe(0);
  expect(
    prepare.mock.calls.some(([query]) =>
      /CREATE TABLE|ALTER TABLE|FROM "user" WHERE email = \?|FROM "oauthClient" WHERE name = \?/i.test(
        String(query),
      ),
    ),
  ).toBe(false);
  expect(exec).not.toHaveBeenCalled();
  prepare.mockRestore();
  exec.mockRestore();
});

it("does not serve a release when its readiness write fails", async () => {
  const revision = "3123456789abcdef0123456789abcdef01234567";
  const environment = managedEnvironment(revision);
  const database = new Proxy(environment.AUTH_DB, {
    get(target, property) {
      if (property === "prepare")
        return (query: string) => {
          if (
            String(query).includes(
              'INSERT INTO "savia_auth_deployment_readiness"',
            )
          )
            return {
              bind() {
                return {
                  async run() {
                    throw new Error("readiness write failed");
                  },
                };
              },
            };
          return target.prepare(query);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const failedInitialization = await createAuthHandler({
    ...environment,
    AUTH_DB: database,
  }).fetch(initializeRequest(revision));
  const runtime = await createAuthHandler(environment).fetch(
    new Request(`${origin}/_internal/session`),
  );

  expect(failedInitialization.status).toBe(503);
  expect(runtime.status).toBe(503);
});

it("keeps a managed handler unready when its revision or bootstrap configuration changes", async () => {
  const revision = "5123456789abcdef0123456789abcdef01234567";
  const environment = managedEnvironment(revision);
  const initialized = await createAuthHandler(environment).fetch(
    initializeRequest(revision),
  );
  expect(initialized.status).toBe(200);

  const changedRevision = await createAuthHandler({
    ...environment,
    SAVIA_AUTH_DEPLOYMENT_REVISION: "1123456789abcdef0123456789abcdef01234567",
  }).fetch(new Request(`${origin}/_internal/session`));
  const changedConfiguration = await createAuthHandler({
    ...environment,
    BETTER_AUTH_BOOTSTRAP_NAME: "Changed managed bootstrap configuration",
  }).fetch(new Request(`${origin}/_internal/session`));

  const nextRevision = "1123456789abcdef0123456789abcdef01234567";
  const nextRelease = {
    ...environment,
    SAVIA_AUTH_DEPLOYMENT_REVISION: nextRevision,
  };
  const nextInitialized = await createAuthHandler(nextRelease).fetch(
    initializeRequest(nextRevision),
  );
  const rollbackRuntime = await createAuthHandler({ ...environment }).fetch(
    new Request(`${origin}/_internal/session`),
  );

  expect(changedRevision.status).toBe(503);
  expect(changedConfiguration.status).toBe(503);
  expect(nextInitialized.status).toBe(200);
  expect(rollbackRuntime.status).toBe(200);
});

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
