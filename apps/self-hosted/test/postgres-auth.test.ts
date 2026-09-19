import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { createAuthHandler } from "../../auth/src/index";
import { openPostgresDatabase } from "../src/postgres/database";
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
  "boots native PostgreSQL authentication, exercises OAuth PKCE, MCP exchange, refresh and session revocation",
  async () => {
    await withPostgresFixture(async (_core, url) => {
      const db = openPostgresDatabase({
        connectionString: url,
        schema: "savia_auth",
        maxConnections: 3,
      });
      try {
        const origin = "http://localhost:8080";
        const email = "native-auth@example.test",
          password = "Native-Auth-Password-For-Test-123!";
        const auth = createAuthHandler(
          {
            AUTH_DB: db,
            BETTER_AUTH_URL: origin,
            BETTER_AUTH_SECRET: "native-auth-secret-".repeat(4),
            BETTER_AUTH_BOOTSTRAP_EMAIL: email,
            BETTER_AUTH_BOOTSTRAP_PASSWORD: password,
            SAVIA_API_RESOURCE: origin,
            SAVIA_ADMIN_REDIRECT_URI: origin + "/auth/callback",
            SAVIA_SCALAR_REDIRECT_URI: origin + "/docs",
          },
          { database: db.pool },
        );
        const response = await auth.fetch(
          new Request(origin + "/api/auth/sign-in/email", {
            method: "POST",
            headers: { "content-type": "application/json", origin },
            body: JSON.stringify({ email, password }),
          }),
        );
        expect(response.status, await response.clone().text()).toBe(200);
        expect(response.headers.get("set-cookie")).toContain("savia");
        expect(
          ((await response.json()) as { user: { email: string } }).user.email,
        ).toBe(email);
        let cookie = response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        const issuer = origin + "/api/auth",
          resource = origin + "/mcp";
        const enroll = await auth.fetch(
          new Request(issuer + "/two-factor/enable", {
            method: "POST",
            headers: { cookie, origin, "content-type": "application/json" },
            body: JSON.stringify({ password, method: "totp" }),
          }),
        );
        expect(enroll.status, await enroll.clone().text()).toBe(200);
        const enrollment = (await enroll.json()) as { totpURI: string };
        for (const value of enroll.headers.getSetCookie())
          cookie += "; " + value.split(";")[0];
        const verified = await auth.fetch(
          new Request(issuer + "/two-factor/verify-totp", {
            method: "POST",
            headers: { cookie, origin, "content-type": "application/json" },
            body: JSON.stringify({ code: totp(enrollment.totpURI) }),
          }),
        );
        expect(verified.status, await verified.clone().text()).toBe(200);
        const jar = new Map(
          cookie
            .split("; ")
            .map((pair) => [
              pair.slice(0, pair.indexOf("=")),
              pair.slice(pair.indexOf("=") + 1),
            ]),
        );
        for (const value of verified.headers.getSetCookie()) {
          const pair = value.split(";")[0];
          jar.set(
            pair.slice(0, pair.indexOf("=")),
            pair.slice(pair.indexOf("=") + 1),
          );
        }
        cookie = [...jar].map(([key, value]) => key + "=" + value).join("; ");
        const registration = await auth.fetch(
          new Request(issuer + "/oauth2/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              client_name: "Native MCP contract",
              redirect_uris: ["https://client.example/callback"],
              token_endpoint_auth_method: "none",
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              scope: "openid savia.api.read offline_access",
            }),
          }),
        );
        expect(registration.status, await registration.clone().text()).toBe(
          201,
        );
        const { client_id } = (await registration.json()) as {
          client_id: string;
        };
        const verifier = "v".repeat(64);
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        );
        const query = new URLSearchParams({
          client_id,
          response_type: "code",
          redirect_uri: "https://client.example/callback",
          scope: "openid savia.api.read offline_access",
          resource,
          state: "native-state",
          code_challenge: Buffer.from(digest).toString("base64url"),
          code_challenge_method: "S256",
        });
        const authorize = await auth.fetch(
          new Request(issuer + "/oauth2/authorize?" + query, {
            headers: { cookie },
          }),
        );
        expect(authorize.status, await authorize.clone().text()).toBe(302);
        const consentUrl = new URL(authorize.headers.get("location")!, origin);
        expect(consentUrl.pathname).toBe("/api/auth/consent");
        const consent = await auth.fetch(
          new Request(issuer + "/oauth2/consent", {
            method: "POST",
            headers: { cookie, origin, "content-type": "application/json" },
            body: JSON.stringify({
              accept: true,
              oauth_query: consentUrl.search.slice(1),
            }),
          }),
        );
        expect(consent.status, await consent.clone().text()).toBe(200);
        const callback = new URL(
          ((await consent.json()) as { url: string }).url,
        );
        expect(callback.searchParams.get("state")).toBe("native-state");
        const token = (body: Record<string, string>) =>
          auth.fetch(
            new Request(issuer + "/oauth2/token", {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams(body),
            }),
          );
        const issued = await token({
          grant_type: "authorization_code",
          client_id,
          code: callback.searchParams.get("code")!,
          redirect_uri: "https://client.example/callback",
          code_verifier: verifier,
          resource,
        });
        expect(issued.status, await issued.clone().text()).toBe(200);
        const credentials = (await issued.json()) as {
          access_token: string;
          refresh_token: string;
        };
        expect(credentials.refresh_token).toBeTruthy();
        const exchange = (accessToken: string) =>
          auth.fetch(
            new Request(
              "https://savia-auth.internal/_internal/oauth/mcp-exchange",
              {
                method: "POST",
                headers: { authorization: `Bearer ${accessToken}` },
              },
            ),
          );
        const exchanged = await exchange(credentials.access_token);
        expect(exchanged.status, await exchanged.clone().text()).toBe(200);
        const internal = (await exchanged.json()) as {
          access_token: string;
          expires_in: number;
        };
        expect(internal.access_token).not.toBe(credentials.access_token);
        expect(internal.expires_in).toBeLessThanOrEqual(120);
        const refreshed = await token({
          grant_type: "refresh_token",
          client_id,
          refresh_token: credentials.refresh_token,
          resource,
        });
        expect(refreshed.status, await refreshed.clone().text()).toBe(200);
        expect(
          (
            await exchange(
              ((await refreshed.json()) as { access_token: string })
                .access_token,
            )
          ).status,
        ).toBe(200);
        const session = () =>
          auth.fetch(
            new Request(issuer + "/get-session", { headers: { cookie } }),
          );
        const activeSession = (await (await session()).json()) as {
          session: { id: string };
          user: { email: string };
        };
        expect(activeSession).toMatchObject({ user: { email } });
        const signOut = await auth.fetch(
          new Request(issuer + "/sign-out", {
            method: "POST",
            headers: { cookie, origin, "content-type": "application/json" },
            body: "{}",
          }),
        );
        expect(signOut.status, await signOut.clone().text()).toBe(200);
        // Reuse the old cookie deliberately: revocation must invalidate server state.
        expect(await (await session()).json()).toBeNull();
        expect(
          await db
            .prepare('SELECT count(*) AS n FROM "session" WHERE id=?')
            .bind(activeSession.session.id)
            .first("n"),
        ).toBe(0);
        expect(
          await db
            .prepare('SELECT count(*) AS n FROM "oauthClient"')
            .first("n"),
        ).toBe(3);
      } finally {
        await db.close();
      }
    });
  },
  180000,
);
