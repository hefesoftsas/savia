// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomPluginFrame } from "../custom-plugin-frame";
import { setStudioRuntime } from "../runtime";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

it("passes the active theme before the plugin shell loads", () => {
  document.documentElement.classList.add("dark");
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Dark plugin" />);
  expect(
    new URL(
      (screen.getByTitle("Dark plugin") as HTMLIFrameElement).src,
    ).searchParams.get("theme"),
  ).toBe("dark");
  cleanup();
  document.documentElement.classList.remove("dark");
  render(
    <CustomPluginFrame pluginId="insurance.quotes" title="Light plugin" />,
  );
  expect(
    new URL(
      (screen.getByTitle("Light plugin") as HTMLIFrameElement).src,
    ).searchParams.get("theme"),
  ).toBe("light");
});

it("covers the iframe with the host background until the shell loads", () => {
  const { rerender } = render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Loading plugin"
      screen={{ object: "quotes", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Loading plugin") as HTMLIFrameElement;
  expect(frame.parentElement).toHaveClass("bg-background");
  expect(frame).toHaveClass("invisible");
  fireEvent.load(frame);
  expect(frame).not.toHaveClass("invisible");
  rerender(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Loading plugin"
      screen={{ object: "quotes", view: "admin" }}
    />,
  );
  expect(screen.getByTitle("Loading plugin")).toHaveClass("invisible");
});

it("allows a plugin to download a generated PDF while keeping its origin isolated", () => {
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const permissions = (frame.getAttribute("sandbox") ?? "").split(/\s+/);
  expect(permissions).toContain("allow-downloads");
  expect(permissions).not.toContain("allow-same-origin");
});

it("loads the plugin shell through the selected tenant", () => {
  setStudioRuntime({
    embedded: false,
    apiBasePath: "/v1/studio/0",
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
    "/v1/studio/0/api/plugin-store/insurance.quotes/shell",
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

it("shows a ready plugin without waiting for the iframe load event", () => {
  render(
    <CustomPluginFrame pluginId="insurance.quotes" title="Ready plugin" />,
  );
  const frame = screen.getByTitle("Ready plugin") as HTMLIFrameElement;
  expect(screen.getByRole("status")).toBeVisible();
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ns: "savia-plugin", type: "ready" },
    }),
  );
  expect(frame).not.toHaveClass("invisible");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("offers a fresh iframe after a plugin startup failure", () => {
  render(
    <CustomPluginFrame pluginId="insurance.quotes" title="Failed plugin" />,
  );
  const frame = screen.getByTitle("Failed plugin") as HTMLIFrameElement;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ns: "savia-plugin", type: "error", error: "Module unavailable" },
    }),
  );
  expect(screen.getByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByTitle("Failed plugin")).not.toBe(frame);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeVisible();
});

it("offers retry when a frame never announces readiness", () => {
  vi.useFakeTimers();
  render(
    <CustomPluginFrame pluginId="custom.stalled" title="Stalled plugin" />,
  );
  act(() => vi.advanceTimersByTime(30_000));
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

it("does not send a previous screen's pending response to a replacement frame", async () => {
  let resolve!: (value: Response) => void;
  const transport = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  setStudioRuntime({ embedded: false, transport });
  const { rerender } = render(
    <CustomPluginFrame pluginId="custom.first" title="Plugin" />,
  );
  const first = screen.getByTitle("Plugin") as HTMLIFrameElement;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: first.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "pending",
        path: "/objects",
      },
    }),
  );
  rerender(<CustomPluginFrame pluginId="custom.second" title="Plugin" />);
  const second = screen.getByTitle("Plugin") as HTMLIFrameElement;
  const send = vi.spyOn(second.contentWindow!, "postMessage");
  await act(async () => resolve(Response.json({ data: ["private"] })));
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ id: "pending" }),
    "*",
  );
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
