/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/plugin-sdk";
import { render } from "../entry";
import { removeInterest, type Interest } from "../logic";
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let host: HTMLDivElement;
let dispose: (() => void) | undefined;
afterEach(async () => {
  await act(async () => dispose?.());
  host?.remove();
});
const row: Interest = {
  id: "interest-1",
  _version: 3,
  source_id: "source-1",
  process_id: "CO1.REQ.1",
  name: "Saved tender",
  status: "interested",
  source_url:
    "https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.1",
  notes: "Our notes",
};
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  const remove = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn().mockResolvedValue({ ...row, _version: 4 });
  const collection = {
    list: vi
      .fn()
      .mockResolvedValue({ data: [row], page: 1, perPage: 20, total: 1 }),
    remove,
    get,
  };
  const api = {
    i18n: { locale: "es", translate: () => undefined },
    actions: { execute: vi.fn().mockResolvedValue({ output: { data: [] } }) },
    collections: { collection: () => collection },
  } as unknown as PluginApi;
  await act(async () => {
    dispose = await render(host, api);
  });
  await act(async () =>
    (
      host.querySelectorAll(".secop-tabs button")[1] as HTMLButtonElement
    ).click(),
  );
  return { remove, get, api };
}
it("groups the row actions, asks before removing, and lets the user cancel", async () => {
  const { remove } = await mount();
  expect(
    host.querySelectorAll(".secop-interest-actions .secop-icon-action"),
  ).toHaveLength(3);
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".secop-remove-interest")!.click(),
  );
  expect(
    host.querySelector(".secop-remove-confirmation")?.textContent,
  ).toContain("sus notas");
  expect(remove).not.toHaveBeenCalled();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(".secop-remove-confirmation button")!
      .click(),
  );
  expect(host.querySelector(".secop-remove-confirmation")).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  expect(host.querySelectorAll(".secop-interest")).toHaveLength(1);
});
it("removes only the confirmed interest using its current version and updates the count", async () => {
  const { remove } = await mount();
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".secop-remove-interest")!.click(),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".secop-remove-confirm")!.click(),
  );
  expect(remove).toHaveBeenCalledExactlyOnceWith("interest-1", { version: 3 });
  expect(host.querySelectorAll(".secop-interest")).toHaveLength(0);
  expect(host.textContent).toContain("Seguimiento eliminado.");
  expect(host.querySelector(".secop-section-head")?.textContent).toContain(
    "0 mis intereses",
  );
});
it("keeps a conflicting record visible and refreshes its version before another removal", async () => {
  const { remove, get } = await mount();
  remove.mockRejectedValueOnce({ status: 409, code: "version_conflict" });
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".secop-remove-interest")!.click(),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".secop-remove-confirm")!.click(),
  );
  expect(host.querySelectorAll(".secop-interest")).toHaveLength(1);
  expect(get).toHaveBeenCalledWith("interest-1");
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".secop-remove-interest")!.click(),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".secop-remove-confirm")!.click(),
  );
  expect(remove).toHaveBeenLastCalledWith("interest-1", { version: 4 });
});
it("does not attempt an unversioned deletion", async () => {
  const { remove, api } = await mount();
  await expect(
    removeInterest(api, { ...row, _version: undefined }),
  ).rejects.toThrow("no version");
  expect(remove).not.toHaveBeenCalled();
});
