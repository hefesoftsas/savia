// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { render } from "./studio-test-render";
import userEvent from "@testing-library/user-event";
import Root from "../app";
import ScreenAdministration from "../screen-administration";
import { setStudioRuntime } from "../runtime";
import { makeConfig } from "@savia/studio-shared/metadata";

afterEach(() => {
  cleanup();
  setStudioRuntime({ embedded: false });
  window.history.replaceState(null, "", "/");
});

it("creates a screen with sidebar visibility turned off when unchecking the option", async () => {
  const user = userEvent.setup();
  let createdPayload: any = null;
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/objects" && init?.method === "POST") {
      createdPayload = JSON.parse(init.body as string);
      return Response.json({
        data: {
          name: createdPayload.name,
          label: createdPayload.label,
          description: createdPayload.description,
          config: createdPayload.config,
          version: 1,
        },
      });
    }
    if (path === "/api/objects") return Response.json({ data: [] });
    return Response.json({ data: {} });
  });

  setStudioRuntime({
    embedded: true,
    transport,
  });

  render(<Root embedded search="view=new-object" />);

  const labelInput = await screen.findByLabelText("Nombre visible");
  await user.type(labelInput, "Sub Pantalla");

  const sidebarSwitch = screen.getByRole("switch", {
    name: "Mostrar en la barra lateral",
  });
  expect(sidebarSwitch).toBeChecked();

  // Turn off sidebar visibility
  await user.click(sidebarSwitch);
  expect(sidebarSwitch).not.toBeChecked();

  const submitButton = screen.getByRole("button", { name: /Crear y diseñar/i });
  await user.click(submitButton);

  expect(createdPayload).toBeTruthy();
  expect(createdPayload.name).toBe("sub_pantalla");
  expect(createdPayload.label).toBe("Sub Pantalla");
  expect(createdPayload.config.studio?.screen?.hidden).toBe(true);
});

it("creates a screen with sidebar visibility turned on by default", async () => {
  const user = userEvent.setup();
  let createdPayload: any = null;
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/objects" && init?.method === "POST") {
      createdPayload = JSON.parse(init.body as string);
      return Response.json({
        data: {
          name: createdPayload.name,
          label: createdPayload.label,
          description: createdPayload.description,
          config: createdPayload.config,
          version: 1,
        },
      });
    }
    if (path === "/api/objects") return Response.json({ data: [] });
    return Response.json({ data: {} });
  });

  setStudioRuntime({
    embedded: true,
    transport,
  });

  render(<Root embedded search="view=new-object" />);

  const labelInput = await screen.findByLabelText("Nombre visible");
  await user.type(labelInput, "Pantalla Principal");

  const sidebarSwitch = screen.getByRole("switch", {
    name: "Mostrar en la barra lateral",
  });
  expect(sidebarSwitch).toBeChecked();

  const submitButton = screen.getByRole("button", { name: /Crear y diseñar/i });
  await user.click(submitButton);

  expect(createdPayload).toBeTruthy();
  expect(createdPayload.name).toBe("pantalla_principal");
  expect(createdPayload.config.studio?.screen?.hidden).toBeFalsy();
});

it("shows sidebar subtitles without labeling ordinary screens as compiled plugins", () => {
  const objects = [
    {
      name: "polizas",
      label: "Pólizas",
      description: "",
      version: 1,
      config: makeConfig({
        title: { type: "Textbox" as const, label: "Título" },
      }),
    },
    {
      name: "custom_subscreen",
      label: "Sub Pantalla",
      description: "",
      version: 1,
      config: {
        ...makeConfig({ title: { type: "Textbox" as const, label: "Título" } }),
        studio: { screen: { hidden: true } },
      },
    },
  ];

  render(
    <ScreenAdministration
      objects={objects}
      selected="polizas"
      detail={false}
      domainTools
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={vi.fn(async () => undefined)}
    />,
  );

  // Check section subtitles explaining sidebar visibility
  expect(
    screen.getByText(
      "Disponibles para el menú según tus permisos y preferencias",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /Fuera del menú del dominio · Accesibles mediante enlaces con permiso/,
    ),
  ).toBeInTheDocument();

  expect(screen.queryByText("Plugin")).toBeNull();
});

it("labels an active tenant ZIP screen as a plugin", () => {
  const objects = [
    {
      name: "polizas",
      label: "Pólizas",
      description: "",
      version: 1,
      config: makeConfig({ title: { type: "Textbox", label: "Título" } }),
    },
  ];

  render(
    <ScreenAdministration
      objects={objects}
      selected="polizas"
      detail={false}
      domainTools
      extensions={[
        {
          manifest: { id: "insurance.portfolio-dashboard" },
          builtIn: false,
          store: true,
          screens: [{ object: "polizas", view: "records" }],
          installed: { enabled: true },
        },
      ]}
      onNavigate={vi.fn()}
      onVisibilityChange={vi.fn(async () => undefined)}
      onMenuLayoutChange={vi.fn(async () => undefined)}
      onDeletePermanent={vi.fn(async () => undefined)}
    />,
  );

  expect(screen.getByText("Plugin")).toBeVisible();
});
