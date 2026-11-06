import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import type { OAuthRuntime } from "./oauth";

type JwtService = {
  api: {
    getJwks(): Promise<JSONWebKeySet>;
    signJWT(input: {
      body: { payload: Record<string, unknown> };
    }): Promise<{ token: string }>;
  };
};
const prefix = "https://savia.hefesoft.com/";

/** Private service-binding endpoint. The external bearer never reaches the API. */
export async function exchangeMcpToken(
  request: Request,
  runtime: OAuthRuntime,
  auth: JwtService,
): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || request.headers.has("dpop"))
    return Response.json({ error: "invalid_token" }, { status: 401, headers });
  let claims;
  try {
    claims = (
      await jwtVerify(
        authorization.slice(7),
        createLocalJWKSet(await auth.api.getJwks()),
        {
          issuer: runtime.issuer,
          audience: `${runtime.apiResource}/mcp`,
          requiredClaims: ["sub", "exp", "scope"],
        },
      )
    ).payload;
    // This endpoint is bearer-only; never remove proof-of-possession binding.
    if (claims.cnf !== undefined)
      throw new Error("Bound tokens are not supported");
    for (const name of ["email", "name"])
      if (typeof claims[prefix + name] !== "string" || !claims[prefix + name])
        throw new Error("Invalid identity");
    const roles = claims[prefix + "roles"];
    if (
      !claims.sub ||
      !Array.isArray(roles) ||
      roles.some((role) => typeof role !== "string") ||
      typeof claims[prefix + "two-factor-enabled"] !== "boolean" ||
      typeof claims.scope !== "string"
    )
      throw new Error("Invalid identity");
  } catch {
    return Response.json({ error: "invalid_token" }, { status: 401, headers });
  }
  const granted = (claims.scope as string).split(" ");
  if (!granted.includes("savia.api.read"))
    return Response.json(
      { error: "insufficient_scope" },
      { status: 403, headers },
    );
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.min(claims.exp!, now + 120);
  const { token } = await auth.api.signJWT({
    body: {
      payload: {
        iss: runtime.issuer,
        aud: runtime.apiResource,
        sub: claims.sub,
        iat: now,
        exp,
        jti: crypto.randomUUID(),
        scope: ["savia.api.read", "savia.api.write"]
          .filter((scope) => granted.includes(scope))
          .join(" "),
        ...Object.fromEntries(
          ["email", "name", "roles", "two-factor-enabled"].map((name) => [
            prefix + name,
            claims[prefix + name],
          ]),
        ),
      },
    },
  });
  return Response.json(
    { access_token: token, token_type: "Bearer", expires_in: exp - now },
    { headers },
  );
}
