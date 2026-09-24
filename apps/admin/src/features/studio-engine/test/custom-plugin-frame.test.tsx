// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CustomPluginFrame } from "../custom-plugin-frame";

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
