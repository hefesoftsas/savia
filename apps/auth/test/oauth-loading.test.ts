import { describe, expect, it, vi } from "vitest";
import { oauthPageResponse } from "../src/oauth-pages";

async function loadingHarness() {
  const loading = { hidden: true };
  const content = { hidden: false };
  const resume = { hidden: true, href: "" };
  const secondFactor = { hidden: true };
  const status = { textContent: "" };
  const button = { disabled: false };
  let submit!: (event: { preventDefault(): void }) => Promise<void>;
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  const redirects: string[] = [];
  const form = {
    dataset: { oauthForm: "sign-in" },
    hidden: false,
    querySelector: () => button,
    addEventListener: (_: string, listener: typeof submit) => {
      submit = listener;
    },
  };
  const targets: Record<string, unknown> = {
    "[data-oauth-loading]": loading,
    "[data-oauth-content]": content,
    "[data-oauth-resume]": resume,
    "[data-oauth-two-factor]": secondFactor,
    "#oauth-status": status,
    '[data-oauth-form="sign-in"]': form,
  };
  const script = await oauthPageResponse(
    new Request("https://example.test/api/auth/oauth-ui.js"),
  )!.text();
  new Function("window", "document", "fetch", "FormData", script)(
    { location: { search: "", assign: (url: string) => redirects.push(url) } },
    {
      querySelector: (selector: string) => targets[selector] ?? null,
      querySelectorAll: () => [form],
    },
    () => pending,
    class {
      get(name: string) {
        return name === "email" ? "user@example.test" : "password";
      }
    },
  );
  return {
    loading,
    content,
    resume,
    secondFactor,
    status,
    button,
    redirects,
    resolve,
    submit,
  };
}

describe("shared authentication loading", () => {
  it.each(["error", "second-factor"] as const)(
    "restores the form for %s",
    async (outcome) => {
      const h = await loadingHarness();
      const submitted = h.submit({ preventDefault() {} });
      expect(h.loading.hidden).toBe(false);
      expect(h.content.hidden).toBe(true);
      expect(h.button.disabled).toBe(true);
      h.resolve(
        outcome === "error"
          ? Response.json({ message: "Invalid credentials" }, { status: 401 })
          : Response.json({ twoFactorRedirect: true }),
      );
      await submitted;
      expect(h.loading.hidden).toBe(true);
      expect(h.content.hidden).toBe(false);
      expect(h.button.disabled).toBe(false);
      if (outcome === "error")
        expect(h.status.textContent).toBe("Invalid credentials");
      else expect(h.secondFactor.hidden).toBe(false);
    },
  );

  it("keeps the shared splash visible while navigating to the application", async () => {
    const h = await loadingHarness();
    const submitted = h.submit({ preventDefault() {} });
    h.resolve(Response.json({ url: "https://example.test/auth/callback" }));
    await submitted;
    expect(h.redirects).toEqual(["https://example.test/auth/callback"]);
    expect(h.loading.hidden).toBe(false);
    expect(h.content.hidden).toBe(true);
  });
  it("restores a manual continuation when browser navigation does not finish", async () => {
    vi.useFakeTimers();
    try {
      const h = await loadingHarness();
      const submitted = h.submit({ preventDefault() {} });
      h.resolve(Response.json({ url: "https://example.test/auth/callback" }));
      await submitted;
      await vi.advanceTimersByTimeAsync(10000);
      expect(h.loading.hidden).toBe(true);
      expect(h.content.hidden).toBe(false);
      expect(h.resume.hidden).toBe(false);
      expect(h.resume.href).toBe("https://example.test/auth/callback");
      expect(h.status.textContent).toContain("Continuar");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
