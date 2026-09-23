import { describe, expect, it } from "vitest";
import {
  crmHref,
  crmSidebarChildren,
  isCrmChildActive,
  isCrmNavigationMessage,
  parseCrmSearch,
  summarizeCrmObject,
} from "./crm-navigation";

describe("CRM sidebar navigation", () => {
  it("builds nested CRM routes for objects and studio tools", () => {
    const children = crmSidebarChildren(
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
    const children = crmSidebarChildren(
      [{ name: "account", label: "Empresas", count: 0, hidden: false }],
      9,
    );
    expect(isCrmChildActive(children[0], "agencyId=9&object=account")).toBe(
      true,
    );
    expect(
      isCrmChildActive(
        children[0],
        "agencyId=9&object=account&view=remove-screen",
      ),
    ).toBe(true);
    expect(
      isCrmChildActive(
        children.find((child) => child.id === "studio:admin")!,
        "agencyId=9&object=account&view=screens",
      ),
    ).toBe(true);
  });

  it("does not invent agency business objects for generic domains", () => {
    expect(
      crmSidebarChildren([]).filter((child) => child.group === "objects"),
    ).toEqual([]);
    const children = crmSidebarChildren(
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
    expect(parseCrmSearch("?agencyId=12&object=task&view=create")).toEqual({
      domain: undefined,
      agencyId: 12,
      object: "task",
      view: "create",
    });
    expect(crmHref({ agencyId: 12, object: "task" })).toBe(
      "/studio?agencyId=12&object=task",
    );
  });

  it("accepts navigation catalogs posted by the embedded workspace", () => {
    expect(
      isCrmNavigationMessage({
        type: "savia-crm-navigation",
        objects: [{ name: "task", label: "Tareas", count: 0, hidden: false }],
      }),
    ).toBe(true);
    expect(isCrmNavigationMessage({ type: "other" })).toBe(false);
    expect(
      summarizeCrmObject({
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
    const object = summarizeCrmObject({
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
    expect(crmSidebarChildren([object!], "platform")[0]).toMatchObject({
      section: "administration",
      icon: "settings-2",
    });
  });
});

it("keeps domain scope and distinguishes identical objects across domains", () => {
  const child = crmSidebarChildren(
    [{ name: "agencias", label: "Agencias", count: 1, hidden: false }],
    "platform",
  )[0];
  expect(child.route).toBe("/studio?domain=platform&object=agencias");
  expect(isCrmChildActive(child, "domain=custom&object=agencias")).toBe(false);
});

it("omits unknown collection counts while preserving explicit zero and positive counts", () => {
  const unknown = summarizeCrmObject({ name: "polizas", label: "Pólizas" })!;
  const zero = summarizeCrmObject({ name: "empty", label: "Vacía", count: 0 })!;
  const known = summarizeCrmObject({
    name: "clientes",
    label: "Clientes",
    count: 12,
  })!;
  const children = crmSidebarChildren([unknown, zero, known], "platform");
  expect(
    children.find((child) => child.id === "object:polizas")?.count,
  ).toBeUndefined();
  expect(children.find((child) => child.id === "object:empty")?.count).toBe(0);
  expect(children.find((child) => child.id === "object:clientes")?.count).toBe(
    12,
  );
});
