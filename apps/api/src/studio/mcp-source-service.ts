import {
  auth,
  type OAuthClientProvider,
  type OAuthTokens,
  type OAuthClientInformation,
  type OAuthAuthorizationServerInformation,
} from "@ai-sdk/mcp";
import { z } from "@hono/zod-openapi";
import {
  encryptSecret,
  decryptSecret,
} from "@savia/studio-server/integrations";
import { validateJsonApiBaseUrl } from "./jsonapi-adapter";
import {
  McpAdapterError,
  secureMcpFetch,
  type McpConnection,
} from "./mcp-adapter";

export const mcpSourceInputSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
    label: z.string().trim().min(1).max(100),
    kind: z.literal("mcp"),
    endpoint: z.string().max(2000),
    authMode: z.enum(["none", "bearer", "oauth"]),
    token: z.string().min(1).max(8192).meta({ writeOnly: true }).optional(),
    readOnlyTools: z
      .array(z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/))
      .max(100)
      .optional(),
    oauth: z
      .object({
        clientId: z.string().min(1).max(500).optional(),
        clientSecret: z
          .string()
          .min(1)
          .max(10000)
          .meta({ writeOnly: true })
          .optional(),
        scope: z.string().max(1000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.authMode === "bearer" && !v.token)
      c.addIssue({ code: "custom", message: "A bearer token is required." });
    if (v.authMode !== "bearer" && v.token)
      c.addIssue({
        code: "custom",
        message: "Bearer tokens require bearer authentication.",
      });
    if (v.authMode !== "oauth" && v.oauth)
      c.addIssue({
        code: "custom",
        message: "OAuth settings require OAuth authentication.",
      });
    if (v.oauth?.clientSecret && !v.oauth.clientId)
      c.addIssue({
        code: "custom",
        message: "A client secret requires a client ID.",
      });
  });
export type McpSourceConfig = {
  authorized?: boolean;
  readOnlyTools?: string[];
  endpoint: string;
  authMode: "none" | "bearer" | "oauth";
  oauth?: { clientId?: string; scope?: string };
};
export type McpSourceRow = {
  id: string;
  kind: string;
  config: string;
  encrypted_secret: string | null;
};
type Credentials = {
  token?: string;
  client?: OAuthClientInformation;
  tokens?: OAuthTokens;
  tokenExpiresAt?: number;
  server?: OAuthAuthorizationServerInformation;
  redirectUri?: string;
};
type Flow = Credentials & {
  verifier?: string;
  state: string;
  redirectUri: string;
};
function reject(status: number, message: string): never {
  throw new McpAdapterError(status, message);
}
export function createMcpSourceService(options: {
  db: D1Database;
  tenant: string;
  principalId: string;
  integrationKey?: string;
  fetcher?: typeof fetch;
}) {
  const { db, tenant, principalId, integrationKey, fetcher } = options;
  const runOAuth = async (
    client: OAuthClientProvider,
    request: Parameters<typeof auth>[1],
  ) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new McpAdapterError(504, "MCP authorization timed out."),
        ),
      15000,
    );
    const secured = secureMcpFetch(fetcher);
    try {
      return await auth(client, {
        ...request,
        fetchFn: (input, init) =>
          secured(input, {
            ...init,
            signal: AbortSignal.any([
              controller.signal,
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const credentialContext = (id: string) =>
    `${JSON.stringify([tenant, principalId])}:collection-source:${id}`;
  const decode = async (row: McpSourceRow): Promise<Credentials> =>
    row.encrypted_secret
      ? JSON.parse(
          await decryptSecret(
            row.encrypted_secret,
            integrationKey,
            credentialContext(row.id),
          ),
        )
      : {};
  const encode = (id: string, data: Credentials) =>
    encryptSecret(JSON.stringify(data), integrationKey, credentialContext(id));
  async function persist(row: McpSourceRow, data: Credentials) {
    const encrypted = await encode(row.id, data);
    const result = await db
      .prepare(
        "UPDATE studio_collection_sources SET encrypted_secret=? WHERE tenant_id=? AND owner_principal_id=? AND id=? AND encrypted_secret IS ?",
      )
      .bind(encrypted, tenant, principalId, row.id, row.encrypted_secret)
      .run();
    if (!result.meta.changes)
      reject(409, "The connection changed. Refresh and try again.");
    row.encrypted_secret = encrypted;
  }
  function provider(
    data: Flow,
    config: McpSourceConfig,
    save: () => Promise<void>,
    allowRedirect = false,
  ): OAuthClientProvider {
    return {
      redirectUrl: data.redirectUri,
      clientMetadata: {
        client_name: "Savia read-only collections",
        redirect_uris: [data.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: data.client?.client_secret
          ? "client_secret_post"
          : "none",
        ...(config.oauth?.scope ? { scope: config.oauth.scope } : {}),
      },
      tokens: () => data.tokens,
      saveTokens: async (tokens) => {
        data.tokens = {
          ...tokens,
          refresh_token: tokens.refresh_token ?? data.tokens?.refresh_token,
        };
        data.tokenExpiresAt = tokens.expires_in
          ? Date.now() + tokens.expires_in * 1000
          : undefined;
        await save();
      },
      clientInformation: () => data.client,
      saveClientInformation: async (client) => {
        data.client = client;
        await save();
      },
      authorizationServerInformation: () => data.server,
      saveAuthorizationServerInformation: async (server) => {
        data.server = server;
        await save();
      },
      saveCodeVerifier: async (v) => {
        data.verifier = v;
        await save();
      },
      codeVerifier: () =>
        data.verifier ??
        reject(422, "OAuth verification expired. Connect again."),
      state: () => data.state,
      saveState: async (state) => {
        data.state = state;
        await save();
      },
      storedState: () => data.state,
      redirectToAuthorization: async (url) => {
        if (!allowRedirect)
          reject(401, "Authorization required. Connect this source again.");
        validateJsonApiBaseUrl(url.origin + url.pathname);
        throw new OAuthRedirect(url.href);
      },
      validateAuthorizationServerURL: async (_server, url) => {
        validateJsonApiBaseUrl(String(url));
      },
      validateResourceURL: async (_server, resource) => {
        if (
          resource &&
          new URL(resource).href !== new URL(config.endpoint).href
        )
          reject(422, "OAuth resource does not match the MCP endpoint.");
        return new URL(config.endpoint);
      },
      invalidateCredentials: async (scope) => {
        if (scope === "all" || scope === "client") {
          data.client = undefined;
          data.server = undefined;
        }
        if (scope === "all" || scope === "tokens") {
          data.tokens = undefined;
          data.tokenExpiresAt = undefined;
        }
        if (scope === "all" || scope === "verifier") data.verifier = undefined;
        await save();
      },
    };
  }
  return {
    async initial(input: z.infer<typeof mcpSourceInputSchema>) {
      const endpoint = validateJsonApiBaseUrl(input.endpoint).href;
      const config: McpSourceConfig = {
        endpoint,
        authMode: input.authMode,
        ...(input.readOnlyTools ? { readOnlyTools: input.readOnlyTools } : {}),
        ...(input.oauth
          ? {
              oauth: {
                ...(input.oauth.clientId
                  ? { clientId: input.oauth.clientId }
                  : {}),
                ...(input.oauth.scope ? { scope: input.oauth.scope } : {}),
              },
            }
          : {}),
      };
      const credentials: Credentials = {
        ...(input.token ? { token: input.token } : {}),
        ...(input.oauth?.clientId
          ? {
              client: {
                client_id: input.oauth.clientId,
                ...(input.oauth.clientSecret
                  ? { client_secret: input.oauth.clientSecret }
                  : {}),
              },
            }
          : {}),
      };
      return {
        config: JSON.stringify(config),
        encrypted_secret: Object.keys(credentials).length
          ? await encode(input.id, credentials)
          : null,
      };
    },
    async connection(row: McpSourceRow): Promise<McpConnection> {
      const config = JSON.parse(row.config) as McpSourceConfig;
      const data = await decode(row);
      if (config.authMode === "bearer" && !data.token)
        reject(401, "A bearer token is required. Update source access.");
      if (config.authMode !== "oauth")
        return {
          endpoint: config.endpoint,
          readOnlyTools: config.readOnlyTools,
          ...(data.token ? { token: data.token } : {}),
        };
      if (!data.tokens || !data.redirectUri)
        reject(401, "Authorize this MCP source before using it.");
      const flow: Flow = { ...data, state: "", redirectUri: data.redirectUri };
      const save = () => persist(row, flow);
      const authProvider = provider(flow, config, save);
      if (data.tokenExpiresAt && data.tokenExpiresAt < Date.now() + 30000) {
        try {
          await runOAuth(authProvider, {
            serverUrl: config.endpoint,
            scope: config.oauth?.scope,
          });
        } catch {
          reject(401, "OAuth refresh failed. Connect this source again.");
        }
      }
      return {
        endpoint: config.endpoint,
        authProvider,
        readOnlyTools: config.readOnlyTools,
      };
    },
    async start(row: McpSourceRow, redirectUri: string) {
      const config = JSON.parse(row.config) as McpSourceConfig;
      if (config.authMode !== "oauth")
        reject(422, "This source does not use OAuth.");
      const data = await decode(row);
      const state = crypto.randomUUID();
      const flow: Flow = {
        client: data.client,
        server: data.server,
        state,
        redirectUri,
      };
      const flowContext = `${credentialContext(row.id)}:oauth:${state}`;
      const save = async () => {
        const encrypted = await encryptSecret(
          JSON.stringify(flow),
          integrationKey,
          flowContext,
        );
        await db
          .prepare(
            "UPDATE studio_mcp_oauth_flows SET encrypted_flow=? WHERE state=? AND tenant_id=? AND owner_principal_id=? AND source_id=?",
          )
          .bind(encrypted, state, tenant, principalId, row.id)
          .run();
      };
      await db
        .prepare("DELETE FROM studio_mcp_oauth_flows WHERE expires_at<?")
        .bind(Date.now())
        .run();
      await db
        .prepare(
          "INSERT INTO studio_mcp_oauth_flows(state,tenant_id,owner_principal_id,source_id,encrypted_flow,expires_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          state,
          tenant,
          principalId,
          row.id,
          await encryptSecret(
            JSON.stringify(flow),
            integrationKey,
            flowContext,
          ),
          Date.now() + 600000,
        )
        .run();
      try {
        await runOAuth(provider(flow, config, save, true), {
          serverUrl: config.endpoint,
          scope: config.oauth?.scope,
        });
      } catch (error) {
        if (error instanceof OAuthRedirect)
          return { authorizationUrl: error.url };
        await db
          .prepare("DELETE FROM studio_mcp_oauth_flows WHERE state=?")
          .bind(state)
          .run();
        reject(
          502,
          "Could not start MCP authorization. Check the server URL and OAuth client settings.",
        );
      }
      reject(502, "The MCP server did not provide an authorization URL.");
    },
    async finish(
      row: McpSourceRow,
      state: string,
      code: string,
      issuer?: string,
    ) {
      const stored = await db
        .prepare(
          "DELETE FROM studio_mcp_oauth_flows WHERE state=? AND tenant_id=? AND owner_principal_id=? AND source_id=? RETURNING encrypted_flow,expires_at",
        )
        .bind(state, tenant, principalId, row.id)
        .first<{ encrypted_flow: string; expires_at: number }>();
      if (!stored || stored.expires_at < Date.now())
        reject(422, "OAuth state is invalid or expired. Connect again.");
      const flow: Flow = JSON.parse(
        await decryptSecret(
          stored.encrypted_flow,
          integrationKey,
          `${credentialContext(row.id)}:oauth:${state}`,
        ),
      );
      const config = JSON.parse(row.config) as McpSourceConfig;
      try {
        await runOAuth(
          provider(flow, config, async () => {}),
          {
            serverUrl: config.endpoint,
            authorizationCode: code,
            callbackState: state,
            callbackIssuer: issuer,
            scope: config.oauth?.scope,
          },
        );
        if (!flow.tokens?.access_token)
          reject(502, "The server did not issue an access token.");
        delete flow.verifier;
        await persist(row, flow);
        await db
          .prepare(
            "UPDATE studio_collection_sources SET config=? WHERE tenant_id=? AND owner_principal_id=? AND id=?",
          )
          .bind(
            JSON.stringify({ ...config, authorized: true }),
            tenant,
            principalId,
            row.id,
          )
          .run();
      } catch {
        reject(502, "MCP authorization failed. Connect this source again.");
      }
    },
    async updateToken(row: McpSourceRow, token: string | null) {
      const config = JSON.parse(row.config) as McpSourceConfig;
      if (config.authMode !== "bearer")
        reject(422, "Only bearer sources accept a token update.");
      await persist(row, token ? { token } : {});
    },
  };
}
class OAuthRedirect extends Error {
  constructor(readonly url: string) {
    super("OAuth redirect");
  }
}
