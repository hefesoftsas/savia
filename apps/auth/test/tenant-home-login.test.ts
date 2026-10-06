import { describe, expect, it } from "vitest";
import { oauthPageResponse } from "../src/oauth-pages";

describe("tenant-home login redirect", () => {
  it("prepopulates the email input from ?email=", async () => {
    const html = await oauthPageResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/login?email=User@Example.COM",
      ),
    )!.text();
    expect(html).toContain('value="user@example.com"');
    expect(html).toContain('id="email"');
  });

  it("ignores an invalid ?email= value", async () => {
    const html = await oauthPageResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/login?email=not-an-email",
      ),
    )!.text();
    expect(html).not.toContain('value="not-an-email"');
  });

  it("ships blur discovery that preserves the typed email", async () => {
    const script = await oauthPageResponse(
      new Request("https://savia.app.hefesoft.com/api/auth/oauth-ui.js"),
    )!.text();
    expect(script).toContain("/api/auth/tenant-home?email=");
    expect(script).toContain('addEventListener("blur"');
    expect(script).toContain('searchParams.set("email"');
    expect(script).toContain("Redirigiendo a tu espacio de trabajo");
  });

  it("relies on server-resolved host context without hard-coded domains", async () => {
    const script = await oauthPageResponse(
      new Request("https://savia.app.hefesoft.com/api/auth/oauth-ui.js"),
    )!.text();
    expect(script).not.toContain("savia.app.hefesoft.com");
    expect(script).not.toContain("savia-preview.hefesoft.com");
    expect(script).toContain("currentTenantId");
  });

  it("ignores stale lookup responses edited before they arrive", async () => {
    const script = await oauthPageResponse(
      new Request("https://savia.app.hefesoft.com/api/auth/oauth-ui.js"),
    )!.text();
    expect(script).toContain("tenantHomeRedirecting");
    // The input value is re-verified against the queried email after await.
    expect(script).toContain("currentValue");
  });
});
