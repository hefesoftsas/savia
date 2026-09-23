import { describe, expect, it } from "vitest";
import {
  studioHref,
  studioSidebarChildren,
  isStudioChildActive,
  isStudioNavigationMessage,
  parseStudioSearch,
  summarizeStudioObject,
} from "./studio-navigation";

describe("CRM sidebar navigation", () => {
  it("builds nested CRM routes for objects and studio tools", () => {
    const children = studioSidebarChildren(
      [
        { name: "account", label: "Empresas", count: 0, hidden: false },
        { name: "hidden", label: "Oculto", count: 2, hidden: true },
        { name: "contact", label: "Contactos", count: 4, hidden: false },
      ],
      101,
      "contact",
    );

    expect(children.map((child) => child.label)).toEqual([
      "Empresas",
      "Contactos",
      "Administrar",
    ]);
    expect(children[0]).toMatchObject({
      route: "/studio?agencyId=101&object=account",
      count: 0,
      removeRoute: "/studio?agencyId=101&object=account&view=remove-screen",
    });
    expect(children.find((child) => child.id === "studio:admin")?.route).toBe(
      "/studio?agencyId=101&object=contact&view=admin",
    );
  });

  it("marks the current CRM child from the workspace query", () => {
    const children = studioSidebarChildren(
      [{ name: "account", label: "Empresas", count: 0, hidden: false }],
      9,
    );
    expect(isStudioChildActive(children[0], "agencyId=9&object=account")).toBe(
      true,
    );
    expect(
      isStudioChildActive(
        children[0],
        "agencyId=9&object=account&view=remove-screen",
      ),
    ).toBe(true);
    expect(
      isStudioChildActive(
        children.find((child) => child.id === "studio:admin")!,
        "agencyId=9&object=account&view=screens",
      ),
    ).toBe(true);
  });

  it("does not invent agency business objects for generic domains", () => {
    expect(
      studioSidebarChildren([]).filter((child) => child.group === "objects"),
    ).toEqual([]);
    const children = studioSidebarChildren(
      [{ name: "clientes", label: "Clientes", count: 3, hidden: false }],
      12,
    );
    expect(
      children.filter((child) => child.id === "object:clientes"),
    ).toHaveLength(1);
    expect(children[0]).toMatchObject({
      route: "/studio?agencyId=12&object=clientes",
      count: 3,
    });
  });

  it("parses CRM search params and hrefs without dropping the agency", () => {
    expect(parseStudioSearch("?agencyId=12&object=task&view=create")).toEqual({
      domain: undefined,
      agencyId: 12,
      object: "task",
      view: "create",
    });
    expect(studioHref({ agencyId: 12, object: "task" })).toBe(
      "/studio?agencyId=12&object=task",
    );
  });

  it("accepts navigation catalogs posted by the embedded workspace", () => {
    expect(
      isStudioNavigationMessage({
        type: "savia-studio-navigation",
        objects: [{ name: "task", label: "Tareas", count: 0, hidden: false }],
      }),
    ).toBe(true);
    expect(isStudioNavigationMessage({ type: "other" })).toBe(false);
    expect(
      summarizeStudioObject({
        name: "account",
        label: "Empresas",
        count: "3",
        config: { studio: { screen: { hidden: true } } },
      }),
    ).toEqual({
      name: "account",
      label: "Empresas",
      count: 3,
      hidden: true,
    });
  });

  it("passes each screen's configured sidebar section and icon to its menu item", () => {
    const object = summarizeStudioObject({
      name: "administrar_seguros",
      label: "Administrar Seguros",
      config: {
        studio: {
          screen: { section: "administration", icon: "settings-2" },
        },
      },
    });

    expect(object).toMatchObject({
      section: "administration",
      icon: "settings-2",
    });
    expect(studioSidebarChildren([object!], "platform")[0]).toMatchObject({
      section: "administration",
      icon: "settings-2",
    });
  });
});

it("keeps domain scope and distinguishes identical objects across domains", () => {
  const child = studioSidebarChildren(
    [{ name: "agencias", label: "Agencias", count: 1, hidden: false }],
    "platform",
  )[0];
  expect(child.route).toBe("/studio?domain=platform&object=agencias");
  expect(isStudioChildActive(child, "domain=custom&object=agencias")).toBe(
    false,
  );
});

it("omits unknown collection counts while preserving explicit zero and positive counts", () => {
  const unknown = summarizeStudioObject({ name: "polizas", label: "Pólizas" })!;
  const zero = summarizeStudioObject({
    name: "empty",
    label: "Vacía",
    count: 0,
  })!;
  const known = summarizeStudioObject({
    name: "clientes",
    label: "Clientes",
    count: 12,
  })!;
  const children = studioSidebarChildren([unknown, zero, known], "platform");
  expect(
    children.find((child) => child.id === "object:polizas")?.count,
  ).toBeUndefined();
  expect(children.find((child) => child.id === "object:empty")?.count).toBe(0);
  expect(children.find((child) => child.id === "object:clientes")?.count).toBe(
    12,
  );
});
