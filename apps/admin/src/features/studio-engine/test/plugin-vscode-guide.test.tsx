// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render } from "./locale-test-render";
import { PluginVscodeGuide } from "../plugin-vscode-guide";

afterEach(cleanup);

it("offers a VSIX download and shows workspace-specific connection instructions", () => {
  render(
    <MemoryRouter>
      <PluginVscodeGuide tenantId={12} />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("link", { name: /Descargar extensión/ }),
  ).toHaveAttribute("href", "/downloads/savia-plugin-authoring-0.1.0.vsix");
  fireEvent.click(screen.getByText("Instalación y uso paso a paso"));
  expect(screen.getByText("12", { selector: "code" })).toBeVisible();
  expect(
    screen.getByText(window.location.origin, { selector: "code" }),
  ).toBeVisible();
  expect(screen.getByText("plugins:read")).toBeVisible();
  expect(screen.getByText("plugins:publish")).toBeVisible();
  expect(screen.getByRole("link", { name: "Abrir Mi cuenta" })).toHaveAttribute(
    "href",
    "/account",
  );
  expect(screen.getByText(/no activa el plugin automáticamente/)).toBeVisible();
});

it("does not suggest connecting to platform workspace zero", () => {
  render(
    <MemoryRouter>
      <PluginVscodeGuide tenantId={0} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("Instalación y uso paso a paso"));
  expect(screen.getByText(/Selecciona un espacio de trabajo/)).toBeVisible();
  expect(screen.queryByText("0", { selector: "code" })).not.toBeInTheDocument();
});

it.each(["en", "pt"] as const)("localizes the guide in %s", (locale) => {
  render(
    <MemoryRouter>
      <PluginVscodeGuide tenantId={37} />
    </MemoryRouter>,
    { locale },
  );
  expect(
    screen.getByRole("heading", {
      name: locale === "en" ? "Work from VS Code" : "Trabalhar no VS Code",
    }),
  ).toBeInTheDocument();
});
