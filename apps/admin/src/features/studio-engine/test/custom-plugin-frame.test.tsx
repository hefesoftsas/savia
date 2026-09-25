// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
