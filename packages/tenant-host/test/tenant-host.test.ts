import { describe, expect, it } from "vitest";

import {
  buildTenantHostname,
  buildTenantOrigin,
  cookieDomainForHost,
  DEFAULT_CANONICAL_HOST,
  isAllowedPublicOrigin,
  isAllowedTenantOrigin,
  isCanonicalOrigin,
  isReservedTenantSlug,
  normalizeTenantSlug,
  parseTenantSlugFromHostname,
} from "../src/tenant-host";

describe("tenant-host", () => {
  it("parses the Slack-style tenant subdomain", () => {
    expect(
      parseTenantSlugFromHostname(
        "merkaseguros.savia.app.hefesoft.com",
        DEFAULT_CANONICAL_HOST,
      ),
    ).toBe("merkaseguros");
  });

  it("is case-insensitive and ignores a trailing dot", () => {
    expect(
      parseTenantSlugFromHostname(
        "MerkaSeguros.SAVIA.APP.HEFESOFT.COM.",
        DEFAULT_CANONICAL_HOST,
      ),
    ).toBe("merkaseguros");
  });

  it("returns null for the canonical host and unrelated hosts", () => {
    expect(
      parseTenantSlugFromHostname(
        "savia.app.hefesoft.com",
        DEFAULT_CANONICAL_HOST,
      ),
    ).toBeNull();
    expect(
      parseTenantSlugFromHostname("evil.example.com", DEFAULT_CANONICAL_HOST),
    ).toBeNull();
    expect(
      parseTenantSlugFromHostname("127.0.0.1", DEFAULT_CANONICAL_HOST),
    ).toBeNull();
  });

  it("rejects nested subdomains and reserved slugs", () => {
    expect(
      parseTenantSlugFromHostname(
        "a.merkaseguros.savia.app.hefesoft.com",
        DEFAULT_CANONICAL_HOST,
      ),
    ).toBeNull();
    expect(
      parseTenantSlugFromHostname("api.savia.app.hefesoft.com"),
    ).toBeNull();
    expect(
      parseTenantSlugFromHostname("admin.savia.app.hefesoft.com"),
    ).toBeNull();
    expect(isReservedTenantSlug("API")).toBe(true);
    expect(isReservedTenantSlug("merkaseguros")).toBe(false);
  });

  it("rejects slugs that are not valid DNS labels", () => {
    expect(normalizeTenantSlug("merka_seguros")).toBeNull();
    expect(normalizeTenantSlug("-merka")).toBeNull();
    expect(normalizeTenantSlug("merka-")).toBeNull();
    expect(normalizeTenantSlug("")).toBeNull();
    expect(normalizeTenantSlug("a".repeat(64))).toBeNull();
    expect(normalizeTenantSlug(" merka-123 ")).toBe("merka-123");
  });

  it("builds tenant hostnames and origins", () => {
    expect(buildTenantHostname("merkaseguros")).toBe(
      "merkaseguros.savia.app.hefesoft.com",
    );
    expect(buildTenantOrigin("merkaseguros")).toBe(
      "https://merkaseguros.savia.app.hefesoft.com",
    );
  });

  it("allowlists only https tenant origins under the canonical host", () => {
    expect(
      isAllowedTenantOrigin("https://merkaseguros.savia.app.hefesoft.com"),
    ).toBe(true);
    expect(
      isAllowedTenantOrigin("https://savia.app.hefesoft.com"),
    ).toBe(false);
    expect(
      isAllowedTenantOrigin("http://merkaseguros.savia.app.hefesoft.com"),
    ).toBe(false);
    expect(isAllowedTenantOrigin("https://api.savia.app.hefesoft.com")).toBe(
      false,
    );
    expect(isAllowedTenantOrigin("https://evil.com")).toBe(false);
    expect(isAllowedTenantOrigin("not-a-url")).toBe(false);
  });

  it("recognizes the canonical origin and the combined allowlist", () => {
    expect(isCanonicalOrigin("https://savia.app.hefesoft.com")).toBe(true);
    expect(isCanonicalOrigin("https://merkaseguros.savia.app.hefesoft.com")).toBe(
      false,
    );
    expect(
      isAllowedPublicOrigin("https://savia.app.hefesoft.com"),
    ).toBe(true);
    expect(
      isAllowedPublicOrigin("https://merkaseguros.savia.app.hefesoft.com"),
    ).toBe(true);
    expect(isAllowedPublicOrigin("https://evil.com")).toBe(false);
  });

  it("computes the shared cookie domain for subdomains and canonical host", () => {
    expect(
      cookieDomainForHost(
        "merkaseguros.savia.app.hefesoft.com",
        DEFAULT_CANONICAL_HOST,
      ),
    ).toBe(".savia.app.hefesoft.com");
    expect(
      cookieDomainForHost("savia.app.hefesoft.com", DEFAULT_CANONICAL_HOST),
    ).toBe(".savia.app.hefesoft.com");
    expect(
      cookieDomainForHost("localhost", DEFAULT_CANONICAL_HOST),
    ).toBeUndefined();
    expect(
      cookieDomainForHost("127.0.0.1", DEFAULT_CANONICAL_HOST),
    ).toBeUndefined();
    expect(
      cookieDomainForHost("evil.example.com", DEFAULT_CANONICAL_HOST),
    ).toBeUndefined();
  });

  it("supports preview canonical host and subdomains automatically", () => {
    expect(
      parseTenantSlugFromHostname("merkaseguros.savia-preview.hefesoft.com"),
    ).toBe("merkaseguros");
    expect(
      isAllowedTenantOrigin("https://merkaseguros.savia-preview.hefesoft.com"),
    ).toBe(true);
    expect(
      isCanonicalOrigin("https://savia-preview.hefesoft.com"),
    ).toBe(true);
    expect(
      isAllowedPublicOrigin("https://merkaseguros.savia-preview.hefesoft.com"),
    ).toBe(true);
    expect(
      cookieDomainForHost("merkaseguros.savia-preview.hefesoft.com"),
    ).toBe(".savia-preview.hefesoft.com");
    expect(
      cookieDomainForHost("savia-preview.hefesoft.com"),
    ).toBe(".savia-preview.hefesoft.com");
  });
});

