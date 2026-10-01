import { expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { linkedFields } from "../src/linked-fields";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("loads each unique relation concurrently while preserving field order and selected values", async () => {
  const firstRelationPage = deferred<{
    data: { id: string; name: string }[];
    total: number;
  }>();
  const collections = new Map<
    string,
    { describe: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> }
  >();
  const collection = (name: string) => {
    let item = collections.get(name);
    if (!item) {
      item = {
        describe: vi.fn(async () => ({ name })),
        list: vi.fn(async ({ page }: { page: number }) => {
          if (name === "accounts") {
            if (page === 1) return firstRelationPage.promise;
            return { data: [], total: 1 };
          }
          if (page === 1)
            return { data: [{ id: "contact-1", name: "Ana" }], total: 2 };
          return { data: [{ id: "contact-2", name: "Luis" }], total: 2 };
        }),
      };
      collections.set(name, item);
    }
    return item;
  };
  const savia = {
    collections: { collection },
  } as unknown as PluginApi;
  collection("policies").describe.mockResolvedValue({
    name: "policies",
    config: {
      fields: {
        configured: { config: { relation: "ignored-configured" } },
        hidden: { hidden: true, config: { relation: "ignored-hidden" } },
        locked: { readOnly: true, config: { relation: "ignored-readonly" } },
        account: { label: "Account", config: { relation: "accounts" } },
        contact: { label: "Contact", config: { relation: "contacts" } },
        account_copy: {
          label: "Account copy",
          config: { relation: "accounts" },
        },
      },
    },
  });

  const resultPromise = linkedFields(
    savia,
    "policies",
    [{ key: "configured", label: "Configured" }],
    { account: "account-unavailable" },
  );
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const bothRelationsStarted =
    collection("accounts").list.mock.calls.length > 0 &&
    collection("contacts").list.mock.calls.length > 0;
  firstRelationPage.resolve({
    data: [{ id: "account-1", name: "Acme" }],
    total: 1,
  });
  const fields = await resultPromise;

  expect(bothRelationsStarted).toBe(true);
  expect(collection("accounts").describe).toHaveBeenCalledTimes(1);
  expect(collection("accounts").list).toHaveBeenCalledTimes(1);
  expect(collection("contacts").list).toHaveBeenCalledTimes(2);
  expect(collection("contacts").list).toHaveBeenLastCalledWith({
    page: 2,
    perPage: 100,
    sort: "id",
    order: "ASC",
  });
  expect(fields.map((field) => field.key)).toEqual([
    "account",
    "contact",
    "account_copy",
  ]);
  expect(fields[0]?.options).toEqual([
    {
      value: "account-unavailable",
      label: "Vínculo actual (sin acceso al nombre)",
    },
    { value: "account-1", label: "Acme" },
  ]);
  expect(fields[1]?.options).toEqual([
    { value: "contact-1", label: "Ana" },
    { value: "contact-2", label: "Luis" },
  ]);
});

it("propagates relation loading errors", async () => {
  const savia = {
    collections: {
      collection: (name: string) => ({
        describe: async () =>
          name === "policies"
            ? {
                name,
                config: {
                  fields: {
                    account: {
                      label: "Account",
                      config: { relation: "accounts" },
                    },
                  },
                },
              }
            : { name },
        list: async () => {
          throw new Error("Relation unavailable");
        },
      }),
    },
  } as unknown as PluginApi;

  await expect(linkedFields(savia, "policies", [], {})).rejects.toThrow(
    "Relation unavailable",
  );
});
