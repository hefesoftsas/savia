// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomPluginFrame } from "../custom-plugin-frame";
import { setStudioRuntime } from "../runtime";

afterEach(() => {
  cleanup();
  setStudioRuntime({ embedded: false });
});

it("passes the selected store screen to the plugin shell", () => {
  render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Cotizador por pasos"
      screen={{ object: "cotizador_por_pasos", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Cotizador por pasos") as HTMLIFrameElement;
  expect(new URL(frame.src).searchParams.get("screen")).toBe(
    "cotizador_por_pasos",
  );
  expect(new URL(frame.src).searchParams.get("view")).toBe("records");
});

it("allows a plugin to download a generated PDF while keeping its origin isolated", () => {
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const permissions = (frame.getAttribute("sandbox") ?? "").split(/\s+/);
  expect(permissions).toContain("allow-downloads");
  expect(permissions).not.toContain("allow-same-origin");
});

it("loads the plugin shell through the selected data domain", () => {
  setStudioRuntime({
    embedded: false,
    apiBasePath: "/v1/data-domains/platform",
  });
  render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Cotizador por pasos"
      screen={{ object: "cotizador_por_pasos", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Cotizador por pasos") as HTMLIFrameElement;
  expect(new URL(frame.src).pathname).toBe(
    "/v1/data-domains/platform/api/plugin-store/insurance.quotes/shell",
  );
});

it("sends the current host theme when the plugin becomes ready", () => {
  document.documentElement.style.setProperty("--foreground", "rgb(20 30 40)");
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ns: "savia-plugin", type: "ready" },
    }),
  );
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      ns: "savia-plugin",
      type: "theme",
      vars: expect.objectContaining({ "--foreground": "rgb(20 30 40)" }),
    }),
    "*",
  );
  document.documentElement.style.removeProperty("--foreground");
});

it("forwards any workspace API route with the current user's transport", async () => {
  const transport = vi.fn(async () => Response.json({ ok: true }));
  setStudioRuntime({ embedded: false, transport });
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");

  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "read-settings",
        path: "/settings/geocoding",
      },
    }),
  );
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "write-notification",
        path: "/notifications/admin/send",
        method: "POST",
        body: { subject: "Test" },
      },
    }),
  );

  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  expect(transport).toHaveBeenCalledWith(
    "/api/settings/geocoding",
    expect.objectContaining({ method: "GET" }),
  );
  expect(transport).toHaveBeenCalledWith(
    "/api/notifications/admin/send",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ subject: "Test" }),
    }),
  );
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "response",
        id: "write-notification",
        ok: true,
      }),
      "*",
    ),
  );
});

it("returns a backend permission failure to the plugin", async () => {
  const transport = vi.fn(async () =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
  );
  setStudioRuntime({ embedded: false, transport });
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");

  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "denied",
        path: "/notifications/admin/send",
        method: "POST",
      },
    }),
  );

  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "response",
        id: "denied",
        ok: false,
        error: "Forbidden",
      }),
      "*",
    ),
  );
});

it.each(["https://example.com/api/users", "//example.com", "/%2e%2e/users"])(
  "rejects a path that can leave the workspace API: %s",
  (path) => {
    const transport = vi.fn();
    setStudioRuntime({ embedded: false, transport });
    render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
    const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
    const send = vi.spyOn(frame.contentWindow!, "postMessage");

    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          ns: "savia-plugin",
          type: "request",
          id: "bad-path",
          path,
        },
      }),
    );

    expect(transport).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "response", id: "bad-path", ok: false }),
      "*",
    );
  },
);
