import { describe, expect, it } from "vitest";
import { publicAuthUrls } from "./public-origin";

describe("publicAuthUrls", () => {
  it("uses the explicit HTTPS production origin for both OAuth endpoints", () => {
    expect(
      publicAuthUrls(
        "http://127.0.0.1:8787/docs",
        "https://savia.example.workers.dev",
      ),
    ).toEqual({
      authorizationUrl:
        "https://savia.example.workers.dev/api/auth/oauth2/authorize",
      tokenUrl: "https://savia.example.workers.dev/api/auth/oauth2/token",
    });
  });

  it("uses the request origin when no explicit origin is configured", () => {
    expect(publicAuthUrls("http://127.0.0.1:8787/docs")).toEqual({
      authorizationUrl: "http://127.0.0.1:8787/api/auth/oauth2/authorize",
      tokenUrl: "http://127.0.0.1:8787/api/auth/oauth2/token",
    });
  });
});
