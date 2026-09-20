import { createHash, createHmac, randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";

const origin = process.env.SAVIA_E2E_ORIGIN;
const resource = `${origin}/mcp`;
const protocol = "2026-07-28";

function totp(uri) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0,
    bits = 0;
  const bytes = [];
  for (const char of new URL(uri).searchParams
    .get("secret")
    .replace(/=+$/, "")) {
    const part = alphabet.indexOf(char);
    if (part < 0) throw new Error("Invalid fixture TOTP secret");
    value = (value << 5) | part;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  return ((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

async function rpc(request, token, method = "tools/list", args = {}) {
  return request.post("/mcp", {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": protocol,
      "mcp-method": method,
      ...(args.name ? { "mcp-name": args.name } : {}),
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocol,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "Savia disposable E2E",
            version: "1",
          },
        },
      },
    },
  });
}

async function rpcBody(response) {
  expect(response.status()).toBe(200);
  const text = await response.text();
  const message = response
    .headers()
    ["content-type"]?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)))
        .find((item) => item.id === 1)
    : JSON.parse(text);
  expect(message.error).toBeUndefined();
  return message.result;
}

test("public MCP rejects missing and invalid bearer credentials with OAuth discovery", async ({
  request,
}) => {
  const metadata = await request.get(
    "/.well-known/oauth-protected-resource/mcp",
  );
  expect(metadata.status()).toBe(200);
  expect((await metadata.json()).resource).toBe(resource);
  for (const token of [undefined, "invalid-token"]) {
    const response = await rpc(request, token);
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toContain(
      "oauth-protected-resource/mcp",
    );
    expect(await response.json()).toEqual({ error: "invalid_token" });
  }
});

test("browser login, MFA and consent produce tools, collection reads and scoped refresh tokens", async ({
  page,
  request,
}) => {
  // Real Savia requests only. This test catches broken auth HTML/JS, lost OAuth
  // continuation, missing gateway routing headers, empty tools and scope bypass.
  const callback = `${origin}/docs`;
  const discoveryResponse = await request.get(
    "/.well-known/oauth-authorization-server/api/auth",
  );
  expect(discoveryResponse.status()).toBe(200);
  const discovery = await discoveryResponse.json();
  for (const endpoint of [
    discovery.registration_endpoint,
    discovery.authorization_endpoint,
    discovery.token_endpoint,
  ])
    expect(new URL(endpoint).origin).toBe(origin);
  const scope = "openid savia.api.read offline_access";
  const registration = await request.post(discovery.registration_endpoint, {
    data: {
      client_name: "Disposable MCP integration",
      application_type: "native",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope,
    },
  });
  expect(registration.status(), await registration.text()).toBe(201);
  const { client_id } = await registration.json();
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(24).toString("hex");
  const query = new URLSearchParams({
    client_id,
    response_type: "code",
    redirect_uri: callback,
    scope,
    resource,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  await page.goto(`${discovery.authorization_endpoint}?${query}`);
  await expect(
    page.getByLabel("Correo electrónico", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill(process.env.SAVIA_E2E_EMAIL);
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill(process.env.SAVIA_E2E_PASSWORD);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Configura tu segundo factor" }),
  ).toBeVisible();
  await page
    .getByLabel("Confirma tu contraseña")
    .fill(process.env.SAVIA_E2E_PASSWORD);
  await page
    .getByRole("button", { name: "Generar código de configuración" })
    .click();
  await page.getByText("Configurar manualmente", { exact: true }).click();
  await expect(page.locator("[data-oauth-totp-uri]")).toContainText(
    "otpauth://",
  );
  const uri = await page.locator("[data-oauth-totp-uri]").innerText();
  await page
    .getByLabel("Código de autenticación", { exact: true })
    .fill(totp(uri));
  await page.getByRole("button", { name: "Activar MFA y continuar" }).click();
  await expect(
    page.getByRole("button", { name: "Autorizar acceso" }),
  ).toBeVisible();
  await expect(page.locator("[data-oauth-scopes]")).toContainText(
    "savia.api.read",
  );
  await page.getByRole("button", { name: "Autorizar acceso" }).click();
  await page.waitForURL(
    (url) => url.pathname === "/docs" && url.searchParams.has("code"),
  );
  const redirect = new URL(page.url());
  expect(redirect.searchParams.get("state")).toBe(state);
  const exchange = await request.post(discovery.token_endpoint, {
    form: {
      grant_type: "authorization_code",
      client_id,
      code: redirect.searchParams.get("code"),
      redirect_uri: callback,
      code_verifier: verifier,
      resource,
    },
  });
  expect(exchange.status()).toBe(200);
  const tokens = await exchange.json();
  expect(tokens.access_token).toBeTruthy();
  expect(tokens.refresh_token).toBeTruthy();
  const tools = await rpcBody(await rpc(request, tokens.access_token));
  expect(tools.tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining([
      "savia_list_crm_collections",
      "savia_list_crm_records",
      "savia_create_crm_record",
    ]),
  );

  // Seed via the real authenticated API, never direct database writes.
  const base = "/v1/data-domains/platform/api";
  const collection = "mcp_e2e_records";
  const created = await page.request.post(`${base}/objects`, {
    headers: { origin },
    data: {
      name: collection,
      label: "MCP integration records",
      config: {
        version: 2,
        fields: { name: { type: "Textbox", label: "Name", required: true } },
        fieldOrder: ["name"],
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const record = await page.request.post(`${base}/records/${collection}`, {
    headers: { origin },
    data: { name: "Disposable fixture" },
  });
  expect(record.status(), await record.text()).toBe(201);

  const collections = await rpcBody(
    await rpc(request, tokens.access_token, "tools/call", {
      name: "savia_list_crm_collections",
      arguments: { all: true },
    }),
  );
  expect(collections.isError).not.toBe(true);
  expect(JSON.stringify(collections)).toContain(collection);
  const records = await rpcBody(
    await rpc(request, tokens.access_token, "tools/call", {
      name: "savia_list_crm_records",
      arguments: { object: collection, page: 1, perPage: 25 },
    }),
  );
  expect(records.isError).not.toBe(true);
  expect(JSON.stringify(records)).toContain("Disposable fixture");

  const denied = await rpcBody(
    await rpc(request, tokens.access_token, "tools/call", {
      name: "savia_create_crm_record",
      arguments: { object: collection, data: { name: "Must not exist" } },
    }),
  );
  expect(denied.isError).toBe(true);
  expect(JSON.stringify(denied)).toContain("INSUFFICIENT_SCOPE");
  expect(JSON.stringify(denied)).toContain("savia.api.write");
  const unchanged = await page.request.get(`${base}/records/${collection}`);
  expect(unchanged.status()).toBe(200);
  expect(await unchanged.text()).not.toContain("Must not exist");

  const renewed = await request.post(discovery.token_endpoint, {
    form: {
      grant_type: "refresh_token",
      client_id,
      refresh_token: tokens.refresh_token,
      resource,
    },
  });
  expect(renewed.status()).toBe(200);
  const refreshed = await renewed.json();
  const refreshedTools = await rpcBody(
    await rpc(request, refreshed.access_token),
  );
  expect(refreshedTools.tools.map((tool) => tool.name)).toContain(
    "savia_list_crm_collections",
  );
});
