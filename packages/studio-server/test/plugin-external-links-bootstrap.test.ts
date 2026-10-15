import { describe, expect, it, vi } from "vitest";
import { shellBootstrapJs } from "../src/plugin-store";

function harness(requestHost = vi.fn().mockResolvedValue(null)) {
  const source = shellBootstrapJs().match(
    /function routePluginExternalClick\(event\) \{[\s\S]*?\n\}/,
  )?.[0];
  expect(source).toBeDefined();
  const status = { setAttribute: vi.fn(), textContent: "" };
  const document = {
    createElement: vi.fn(() => status),
    documentElement: { lang: "es" },
  };
  const click = new Function(
    "requestHost",
    "activePanelId",
    "document",
    "scheduleResize",
    `${source}; return routePluginExternalClick;`,
  )(requestHost, "panel-7", document, vi.fn());
  const anchor = {
    target: "_blank",
    href: "https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.10247078",
    hasAttribute: vi.fn(() => false),
    isConnected: true,
    nextElementSibling: null,
    insertAdjacentElement: vi.fn(),
  };
  const event = {
    isTrusted: true,
    defaultPrevented: false,
    button: 0,
    target: { closest: vi.fn(() => anchor) },
    preventDefault: vi.fn(),
  };
  return { click, event, anchor, requestHost, status };
}

describe("sandbox external link clicks", () => {
  it("forwards a real link click to the host while preserving the target URL and panel identity", () => {
    const h = harness();
    h.click(h.event);
    expect(h.event.preventDefault).toHaveBeenCalledOnce();
    expect(h.requestHost).toHaveBeenCalledWith(
      "/navigation/external",
      "POST",
      { url: h.anchor.href },
      "panel-7",
    );
  });
  it("does not forward script-generated clicks, cancelled events, right clicks or downloads", () => {
    for (const patch of [
      { isTrusted: false },
      { defaultPrevented: true },
      { button: 2 },
    ]) {
      const h = harness();
      h.click({ ...h.event, ...patch });
      expect(h.requestHost).not.toHaveBeenCalled();
    }
    const h = harness();
    h.anchor.hasAttribute.mockReturnValue(true);
    h.click(h.event);
    expect(h.requestHost).not.toHaveBeenCalled();
  });
  it("keeps in-frame links under the plugin's existing navigation behavior", () => {
    const h = harness();
    h.anchor.target = "_self";
    h.click(h.event);
    expect(h.requestHost).not.toHaveBeenCalled();
  });
  it("shows an accessible recovery message if external navigation is refused", async () => {
    const h = harness(
      vi.fn().mockRejectedValue(new Error("<untrusted error>")),
    );
    h.click(h.event);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.status.setAttribute).toHaveBeenCalledWith("role", "alert");
    expect(h.status.textContent).not.toContain("<untrusted error>");
    expect(h.anchor.insertAdjacentElement).toHaveBeenCalledWith(
      "afterend",
      h.status,
    );
  });
});
