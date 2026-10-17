/** @vitest-environment jsdom */
import { act } from "react";
import { expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/plugin-sdk";
import { render } from "../entry";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
it("defaults to active tenders, supports history and resets the scope on clear", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const execute = vi.fn(async (id: string) => ({
    output: {
      data:
        id === "search"
          ? [
              {
                id: "old",
                name: "Historical tender",
                fecha_de_recepcion_de: "2021-08-19T00:00:00.000",
              },
            ]
          : [],
    },
  }));
  const api = {
    i18n: { locale: "es", translate: () => undefined },
    actions: { execute },
    collections: { collection: () => ({ list: async () => ({ data: [] }) }) },
  } as unknown as PluginApi;
  let dispose: void | (() => void);
  try {
    await act(async () => {
      dispose = await render(host, api);
    });
    const select = host.querySelector(
      ".secop-availability select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("active");
    await act(async () =>
      (host.querySelector(".secop-primary") as HTMLButtonElement).click(),
    );
    expect(execute).toHaveBeenLastCalledWith("search", {
      input: { vigentes: true, page: 1, perPage: 20 },
    });
    await act(async () => {
      select.value = "all";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () =>
      (host.querySelector(".secop-primary") as HTMLButtonElement).click(),
    );
    expect(execute).toHaveBeenLastCalledWith("search", {
      input: { vigentes: false, page: 1, perPage: 20 },
    });
    expect(host.textContent).toContain("19 de ago de 2021");
    expect(host.textContent).toContain("Cerró");
    expect(host.textContent).not.toContain("2021-08-19T");
    await act(async () =>
      (host.querySelector(".secop-text-button") as HTMLButtonElement).click(),
    );
    expect(select.value).toBe("active");
    expect(execute).toHaveBeenLastCalledWith("search", {
      input: { vigentes: true, page: 1, perPage: 20 },
    });
  } finally {
    await act(async () => {
      if (typeof dispose === "function") dispose();
    });
    host.remove();
  }
});
