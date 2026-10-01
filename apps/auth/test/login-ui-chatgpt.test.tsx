import { describe, expect, it } from "vitest";
import { renderOAuthSurface } from "../src/login-ui";

describe("ChatGPT OAuth UI", () => {
  it("renders a hidden-by-default ChatGPT social button for configured-provider filtering", () => {
    const html = renderOAuthSurface("login", { tenantSlug: "team" });
    expect(html).toContain('data-social-provider="chatgpt"');
    expect(html).toContain('aria-label="Continuar con ChatGPT"');
  });

  it("uses the ChatGPT proof endpoints on its email verification page", () => {
    const html = renderOAuthSurface("chatgpt-verification", {
      verification: { id: "intent-id", email: "member@example.test" },
    });
    expect(html).toContain("ChatGPT");
    expect(html).toContain(
      'action="/api/auth/chatgpt-email-verification/send"',
    );
    expect(html).not.toContain(
      'action="/api/auth/microsoft-email-verification/send"',
    );
  });
});
