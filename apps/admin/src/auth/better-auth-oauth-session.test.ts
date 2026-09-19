import { describe, expect, it, vi } from "vitest";
import {
  BetterAuthOAuthSession,
  normalizeAvatarUrl,
} from "./better-auth-oauth-session";

describe("BetterAuthOAuthSession", () => {
  it("starts a first-party OAuth authorization flow through the API", async () => {
    const navigation = {
      currentUrl: () => "http://127.0.0.1:5173/#/login",
      redirect: vi.fn(),
    };
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      navigation,
      fetcher: vi.fn(),
    });

    await session.login();

    expect(navigation.redirect).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/auth/admin/authorize",
    );
  });

  it("restores an access token from the secure server session after a reload", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "refreshed-access-token",
            token_type: "Bearer",
            expires_in: 300,
            scope: "openid savia.api.read savia.api.write",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "principal-1",
              attributes: {
                displayName: "Savia Administrator",
                globalRoles: ["platform_admin"],
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    await Promise.all([session.checkSession(), session.checkSession()]);

    expect(await session.getAccessToken()).toBe("refreshed-access-token");
    await expect(session.getPermissions()).resolves.toEqual({
      canReadDocuments: true,
      canExecuteCommands: true,
      canManageIdentity: true,
      memberships: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/auth/admin/refresh",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("exchanges a callback code once and retains its access token only in memory", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "better-auth-access-token",
            token_type: "Bearer",
            expires_in: 300,
            scope: "openid savia.api.read savia.api.write",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "principal-1",
              attributes: {
                displayName: "Savia Administrator",
                globalRoles: ["platform_admin"],
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      navigation: {
        currentUrl: () =>
          "http://127.0.0.1:5173/auth/callback?code=code-1&state=state-1",
        redirect: vi.fn(),
      },
      fetcher,
    });

    await Promise.all([session.handleCallback(), session.handleCallback()]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/auth/admin/callback",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ code: "code-1", state: "state-1" }),
      }),
    );
    expect(await session.getAccessToken()).toBe("better-auth-access-token");
    await expect(session.getPermissions()).resolves.toEqual({
      canReadDocuments: true,
      canExecuteCommands: true,
      canManageIdentity: true,
      memberships: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("exchanges a callback code and returns the returnOrigin if provided", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "better-auth-access-token",
          token_type: "Bearer",
          expires_in: 300,
          scope: "openid savia.api.read savia.api.write",
          returnOrigin: "https://merkaseguros.savia-preview.hefesoft.com",
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      navigation: {
        currentUrl: () =>
          "http://127.0.0.1:5173/auth/callback?code=code-1&state=state-1",
        redirect: vi.fn(),
      },
      fetcher,
    });

    const result = await session.handleCallback();

    expect(result).toEqual({
      returnOrigin: "https://merkaseguros.savia-preview.hefesoft.com",
    });
  });

  it("reports the safe OAuth error returned by the callback bridge", async () => {
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      navigation: {
        currentUrl: () =>
          "http://127.0.0.1:5173/auth/callback?code=code-1&state=state-1",
        redirect: vi.fn(),
      },
      fetcher: vi.fn().mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "OAUTH_TOKEN_EXCHANGE_FAILED",
              message:
                "Better Auth rejected the authorization code (invalid_request)",
            },
          },
          { status: 401 },
        ),
      ),
    });

    await expect(session.handleCallback()).rejects.toThrow(
      "Better Auth rejected the authorization code (invalid_request)",
    );
  });

  it("renews an access token before it expires", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "initial-access-token",
              token_type: "Bearer",
              expires_in: 60,
              scope: "openid savia.api.read",
            }),
            { headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "renewed-access-token",
              token_type: "Bearer",
              expires_in: 300,
              scope: "openid savia.api.read",
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      const session = new BetterAuthOAuthSession({
        apiUrl: "http://127.0.0.1:8787",
        navigation: {
          currentUrl: () =>
            "http://127.0.0.1:5173/auth/callback?code=code-1&state=state-1",
          redirect: vi.fn(),
        },
        fetcher,
      });

      await session.handleCallback();
      await vi.advanceTimersByTimeAsync(31_000);

      await expect(session.getAccessToken()).resolves.toBe(
        "renewed-access-token",
      );
      expect(fetcher).toHaveBeenLastCalledWith(
        "http://127.0.0.1:8787/api/auth/admin/refresh",
        expect.objectContaining({ method: "POST", credentials: "include" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the OAuth bearer token to resolve the Savia identity", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "better-auth-access-token",
            token_type: "Bearer",
            scope: "savia.api.read",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "principal-1",
              attributes: {
                displayName: "Savia Administrator",
                email: "admin@savia.test",
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          user: {
            id: "better-auth-user",
            image: null,
            name: "Savia Administrator",
            email: "admin@savia.test",
          },
        }),
      );
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      navigation: {
        currentUrl: () =>
          "http://127.0.0.1:5173/auth/callback?code=code-1&state=state-1",
        redirect: vi.fn(),
      },
      fetcher,
    });

    await session.handleCallback();

    await expect(session.getIdentity()).resolves.toEqual({
      id: "principal-1",
      fullName: "Savia Administrator",
      email: "admin@savia.test",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8787/v1/identity/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer better-auth-access-token",
        }),
        credentials: "include",
      }),
    );
    const identityRequest = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(identityRequest.headers).get("Authorization")).toBe(
      "Bearer better-auth-access-token",
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8787/api/auth/get-session",
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("adds the Better Auth profile image to the React Admin identity", async () => {
    const avatar =
      "http://127.0.0.1:8787/v1/account/avatar?v=11111111-1111-4111-8111-111111111111";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "better-auth-access-token",
          token_type: "Bearer",
          scope: "savia.api.read",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            id: "principal-1",
            attributes: {
              displayName: "Savia Administrator",
              email: "admin@savia.test",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          user: {
            id: "better-auth-user",
            image: avatar,
            name: "Savia Administrator",
            email: "admin@savia.test",
          },
        }),
      );
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    await expect(session.getIdentity()).resolves.toEqual({
      id: "principal-1",
      fullName: "Savia Administrator",
      email: "admin@savia.test",
      avatar,
    });
    expect(fetcher).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8787/api/auth/get-session",
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("normalizes loopback avatar URLs to match the remote API origin", async () => {
    const loopbackAvatar =
      "http://127.0.0.1:8787/v1/account/avatar?v=2dbb6efe-1b1f-4462-ae99-8084bf9cd37e";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "better-auth-access-token",
          token_type: "Bearer",
          scope: "savia.api.read",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            id: "principal-1",
            attributes: {
              displayName: "Savia Administrator",
              email: "admin@savia.test",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          user: {
            id: "better-auth-user",
            image: loopbackAvatar,
            name: "Savia Administrator",
            email: "admin@savia.test",
          },
        }),
      );
    const session = new BetterAuthOAuthSession({
      apiUrl: "https://savia-preview.hefesoft.com",
      fetcher,
    });

    await expect(session.getIdentity()).resolves.toEqual({
      id: "principal-1",
      fullName: "Savia Administrator",
      email: "admin@savia.test",
      avatar:
        "https://savia-preview.hefesoft.com/v1/account/avatar?v=2dbb6efe-1b1f-4462-ae99-8084bf9cd37e",
    });
  });

  it("coalesces concurrent getIdentity calls to avoid duplicate session requests", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "better-auth-access-token",
          token_type: "Bearer",
          scope: "savia.api.read",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            id: "principal-1",
            attributes: {
              displayName: "Savia Administrator",
              email: "admin@savia.test",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          user: {
            id: "better-auth-user",
            image: "https://example.com/avatar.png",
            name: "Savia Administrator",
            email: "admin@savia.test",
          },
        }),
      );
    const session = new BetterAuthOAuthSession({
      apiUrl: "https://savia-preview.hefesoft.com",
      fetcher,
    });

    const [id1, id2, id3, id4] = await Promise.all([
      session.getIdentity(),
      session.getIdentity(),
      session.getIdentity(),
      session.getIdentity(),
    ]);

    expect(id1).toEqual(id2);
    expect(id1.avatar).toBe("https://example.com/avatar.png");
    // Token refresh + identity/me + get-session = exactly 3 calls total
    expect(fetcher).toHaveBeenCalledTimes(3);

    // Sequential subsequent call uses cached avatar and cached identity
    const id5 = await session.getIdentity();
    expect(id5).toEqual(id1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("refreshes avatar and identity when savia:identity-changed is dispatched", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "better-auth-access-token",
          token_type: "Bearer",
          scope: "savia.api.read",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            id: "principal-1",
            attributes: {
              displayName: "Savia Administrator",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          user: {
            image: "https://example.com/avatar-v1.png",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            id: "principal-1",
            attributes: {
              displayName: "Savia Administrator Updated",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          user: {
            image: "https://example.com/avatar-v2.png",
          },
        }),
      );
    const session = new BetterAuthOAuthSession({
      apiUrl: "https://savia-preview.hefesoft.com",
      fetcher,
    });

    const first = await session.getIdentity();
    expect(first.avatar).toBe("https://example.com/avatar-v1.png");

    window.dispatchEvent(new Event("savia:identity-changed"));

    const second = await session.getIdentity();
    expect(second.avatar).toBe("https://example.com/avatar-v2.png");
    expect(second.fullName).toBe("Savia Administrator Updated");
  });

  it("exposes active agency memberships with the session permissions", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "better-auth-access-token",
            token_type: "Bearer",
            scope: "savia.api.read savia.api.write",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "principal-1",
              attributes: {
                displayName: "Agency Administrator",
                globalRoles: [],
              },
              relationships: {
                memberships: [
                  {
                    role: "agency_admin",
                    attributes: { isActive: true },
                    relationships: { agency: { id: "101" } },
                  },
                  {
                    role: "viewer",
                    attributes: { isActive: false },
                    relationships: { agency: { id: "102" } },
                  },
                ],
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      navigation: {
        currentUrl: () =>
          "http://127.0.0.1:5173/auth/callback?code=code-1&state=state-1",
        redirect: vi.fn(),
      },
      fetcher,
    });

    await session.handleCallback();

    await expect(session.getPermissions()).resolves.toMatchObject({
      canReadDocuments: true,
      canManageIdentity: false,
      memberships: [{ agencyId: 101, tenantId: 101, role: "agency_admin" }],
    });
  });

  it("clears every browser session through the CORS-enabled admin endpoint", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "better-auth-access-token",
            token_type: "Bearer",
            scope: "savia.api.read",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      navigation: {
        currentUrl: () =>
          "http://127.0.0.1:5173/auth/callback?code=code-1&state=state-1",
        redirect: vi.fn(),
      },
      fetcher,
    });
    await session.handleCallback();

    const redirectUrl = await session.logout();

    expect(redirectUrl).toBe("http://127.0.0.1:8787/api/auth/admin/authorize");
    expect(await session.getAccessToken()).toBeNull();
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8787/api/auth/admin/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns authorize URL even if the server logout request encounters a network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      fetcher,
    });
    const redirectUrl = await session.logout();
    expect(redirectUrl).toBe("http://127.0.0.1:8787/api/auth/admin/authorize");
  });

  it("keeps the stale token when a refresh hits a network failure", async () => {
    const refresh = (token: string, expiresIn: number) =>
      new Response(
        JSON.stringify({
          access_token: token,
          token_type: "Bearer",
          expires_in: expiresIn,
          scope: "openid savia.api.read savia.api.write",
        }),
        { headers: { "content-type": "application/json" } },
      );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(refresh("stale-token", 1))
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    // First call refreshes (no token yet); the token expires almost
    // immediately so every later call attempts a refresh that fails.
    await session.checkSession();
    await session.checkSession();
    expect(fetcher).toHaveBeenCalledTimes(2);

    expect(await session.getAccessToken()).toBe("stale-token");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("serves last known permissions when identity lookup goes offline", async () => {
    const identity = new Response(
      JSON.stringify({
        data: {
          id: "principal-1",
          attributes: {
            displayName: "Savia Administrator",
            globalRoles: ["platform_admin"],
          },
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    const refresh = (token: string, expiresIn: number) =>
      new Response(
        JSON.stringify({
          access_token: token,
          token_type: "Bearer",
          expires_in: expiresIn,
          scope: "openid savia.api.read savia.api.write",
        }),
        { headers: { "content-type": "application/json" } },
      );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(refresh("token-1", 1))
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(refresh("token-2", 300))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    const online = await session.getPermissions();
    expect(online.canManageIdentity).toBe(true);

    // The second lookup rotates the token (expiring first one) and then the
    // identity request fails: cached permissions keep resources visible.
    const offline = await session.getPermissions();
    expect(offline).toEqual(online);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("degrades without cached permissions on a first offline lookup", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "better-auth-access-token",
            token_type: "Bearer",
            expires_in: 300,
            scope: "openid savia.api.read savia.api.write",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const session = new BetterAuthOAuthSession({
      apiUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    await expect(session.getPermissions()).resolves.toMatchObject({
      canReadDocuments: true,
      canManageIdentity: false,
      memberships: [],
    });
  });
});

it("requires a fresh identity response for lease verification despite cached credentials", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        access_token: "token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "savia.api.read",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        data: { id: "user", attributes: { displayName: "User" } },
      }),
    )
    .mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const session = new BetterAuthOAuthSession({
    apiUrl: "https://savia.test",
    fetcher,
  });
  await session.checkSession();
  await session.getPermissions();
  await expect(session.checkSession()).resolves.toBeUndefined();
  await expect(session.verifySession()).rejects.toThrow("Failed to fetch");
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
    "https://savia.test/v1/identity/me",
  );
});

it("preserves the network error on a cold offline start so a persisted workspace lease can be used", async () => {
  const session = new BetterAuthOAuthSession({
    apiUrl: "https://savia.test",
    fetcher: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  });
  await expect(session.checkSession()).rejects.toThrow("Failed to fetch");
});
it("keeps server unavailability distinguishable from rejected credentials during refresh", async () => {
  const session = new BetterAuthOAuthSession({
    apiUrl: "https://savia.test",
    fetcher: vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: { message: "Unavailable" } }, { status: 503 }),
      ),
  });
  await expect(session.checkSession()).rejects.toMatchObject({ status: 503 });
});

describe("normalizeAvatarUrl", () => {
  it("rewrites loopback host to target apiUrl origin", () => {
    expect(
      normalizeAvatarUrl(
        "http://127.0.0.1:8787/v1/account/avatar?v=123",
        "https://savia-preview.hefesoft.com",
      ),
    ).toBe("https://savia-preview.hefesoft.com/v1/account/avatar?v=123");

    expect(
      normalizeAvatarUrl(
        "http://localhost:8787/v1/account/avatar?v=123",
        "https://savia-preview.hefesoft.com",
      ),
    ).toBe("https://savia-preview.hefesoft.com/v1/account/avatar?v=123");
  });

  it("resolves relative avatar path against apiUrl", () => {
    expect(
      normalizeAvatarUrl(
        "/v1/account/avatar?v=456",
        "https://savia-preview.hefesoft.com",
      ),
    ).toBe("https://savia-preview.hefesoft.com/v1/account/avatar?v=456");
  });

  it("leaves external and matching URLs unchanged", () => {
    expect(
      normalizeAvatarUrl(
        "https://cdn.example.com/pic.jpg",
        "https://savia-preview.hefesoft.com",
      ),
    ).toBe("https://cdn.example.com/pic.jpg");

    expect(
      normalizeAvatarUrl(
        "http://127.0.0.1:8787/v1/account/avatar?v=123",
        "http://127.0.0.1:8787",
      ),
    ).toBe("http://127.0.0.1:8787/v1/account/avatar?v=123");
  });

  it("handles empty or whitespace strings safely", () => {
    expect(normalizeAvatarUrl("", "https://savia-preview.hefesoft.com")).toBe("");
    expect(normalizeAvatarUrl("   ", "https://savia-preview.hefesoft.com")).toBe("");
  });
});

