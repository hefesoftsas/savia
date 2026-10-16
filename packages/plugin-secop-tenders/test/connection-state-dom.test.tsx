/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/plugin-sdk";
import { render } from "../entry";

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(async () => {
  await act(async () => dispose?.());
  host?.remove();
});

async function mount(message: string, locale = "es") {
  host = document.createElement("div");
  document.body.append(host);
  const execute = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error(message), { status: 404 }));
  const api = {
    i18n: { locale, translate: () => undefined },
    actions: { execute },
    collections: { collection: () => ({ list: async () => ({ data: [] }) }) },
  } as unknown as PluginApi;
  await act(async () => {
    dispose = (await render(host, api)) as () => void;
  });
  return execute;
}
it.each([
  ["es", "Conecta SECOP para esta cuenta"],
  ["en", "Connect SECOP for this account"],
  ["pt", "Conecte o SECOP a esta conta"],
])(
  "explains a missing personal MCP source once in %s without useless catalog retries",
  async (locale, heading) => {
    const execute = await mount(
      "Authorize the configured MCP source in Sources and collections first.",
      locale,
    );
    expect(host.textContent).toContain(heading);
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(host.querySelectorAll(".secop-catalog-error")).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(3);
  },
);
it("preserves ordinary catalog errors when the remote MCP tool is unavailable", async () => {
  await mount("Remote MCP tool not found.");
  expect(host.textContent).not.toContain("Conecta SECOP para esta cuenta");
  expect(host.querySelectorAll(".secop-catalog-error")).toHaveLength(3);
});

it("checks again and restores catalogs after this account authorizes its own source", async () => {
  const execute = await mount(
    "Authorize the configured MCP source in Sources and collections first.",
  );
  execute.mockImplementation(async (id: string) => {
    const field = id.replace("catalog-", "");
    return {
      output: {
        data: [{ id: field, complete: true, count: 1, values: ["Example"] }],
      },
    };
  });
  const button = host.querySelector(
    ".secop-connection-required button",
  ) as HTMLButtonElement;
  expect(button).not.toBeNull();
  await act(async () => button.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelectorAll(".secop-catalog-status")).toHaveLength(3);
  expect(execute).toHaveBeenCalledTimes(6);
  execute.mockRejectedValueOnce(
    Object.assign(
      new Error(
        "Authorize the configured MCP source in Sources and collections first.",
      ),
      { status: 404 },
    ),
  );
  await act(async () =>
    (host.querySelector(".secop-primary") as HTMLButtonElement).click(),
  );
  expect(host.querySelector(".secop-connection-required")).not.toBeNull();
  const beforeClear = execute.mock.calls.length;
  await act(async () =>
    (host.querySelector(".secop-text-button") as HTMLButtonElement).click(),
  );
  expect(execute).toHaveBeenCalledTimes(beforeClear);
  execute.mockImplementation(async (id: string) => ({
    output: {
      data:
        id === "search"
          ? []
          : [
              {
                id: id.replace("catalog-", ""),
                complete: true,
                count: 1,
                values: ["Example"],
              },
            ],
    },
  }));
  await act(async () =>
    (
      host.querySelector(
        ".secop-connection-required button",
      ) as HTMLButtonElement
    ).click(),
  );
  expect(host.querySelector(".secop-connection-required")).toBeNull();
  expect(host.querySelector(".secop-primary")?.hasAttribute("disabled")).toBe(
    false,
  );
});
