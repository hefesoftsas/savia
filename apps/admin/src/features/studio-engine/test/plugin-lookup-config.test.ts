import { expect, it } from "vitest";
import { makeConfig, type StudioObject } from "@savia/studio-shared/metadata";
import { withPluginLookup } from "../plugin-lookup-config";
const object: StudioObject = {
  name: "cases",
  label: "Cases",
  description: "",
  version: 3,
  config: makeConfig({
    customer: { type: "Textbox", label: "Customer", required: true },
  }),
};
const binding = {
  collection: "clients",
  labelField: "name",
  searchFields: ["name"],
};
it("adds an optional ID alongside the required legacy text without mutating the source", () => {
  const next = withPluginLookup(object, "customer", binding);
  expect(next.config.fields.customer.type).toBe("Textbox");
  expect(next.config.fields.customer.required).toBe(true);
  expect(next.config.fields.customer_record_id).toMatchObject({
    type: "Textbox",
    required: false,
  });
  expect(object.config.fields.customer.config?.pluginLookup).toBeUndefined();
});
it("keeps the ID field on display changes, allocates a fresh one for a different target", () => {
  const first = withPluginLookup(object, "customer", binding);
  const renamed = withPluginLookup(first, "customer", {
    ...binding,
    labelField: "legal_name",
  });
  expect(renamed.config.fields.customer.config?.pluginLookup).toMatchObject({
    idField: "customer_record_id",
  });
  const changed = withPluginLookup(first, "customer", {
    ...binding,
    collection: "contacts",
  });
  expect(changed.config.fields.customer.config?.pluginLookup).toMatchObject({
    idField: "customer_record_id_2",
  });
  expect(changed.config.fields.customer_record_id).toEqual(
    first.config.fields.customer_record_id,
  );
});
it("disabling a lookup retains ID metadata and never removes stored fields", () => {
  const first = withPluginLookup(object, "customer", binding);
  const disabled = withPluginLookup(first, "customer", undefined);
  expect(disabled.config.fields.customer.config?.pluginLookup).toBeUndefined();
  expect(disabled.config.fields.customer_record_id).toEqual(
    first.config.fields.customer_record_id,
  );
});

import { pluginLookupFields } from "../extension-screens";
it("exposes only the installed plugin's declared fields while it is active", () => {
  const extension = {
    manifest: { id: "example.plugin" },
    builtIn: false,
    store: true,
    installed: { enabled: true },
    screens: [{ object: "cases", view: "records", lookupFields: ["customer"] }],
  };
  expect(pluginLookupFields("cases", [extension])).toEqual(["customer"]);
  expect(pluginLookupFields("other", [extension])).toEqual([]);
  expect(
    pluginLookupFields("cases", [
      { ...extension, installed: { enabled: false } },
    ]),
  ).toEqual([]);
});
