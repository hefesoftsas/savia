// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CollectionRecordForm from "../collection-record-form";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";
import { setCrmRuntime } from "../runtime";
afterEach(cleanup);
it("edits JSON and omits generated identifiers and unchanged null values", async () => {
  setCrmRuntime({ embedded: false });
  const object: CrmObject = {
    name: "orders",
    label: "Orders",
    description: "",
    config: makeConfig({
      id: { type: "Textbox", label: "ID", readOnly: true },
      data: { type: "Textarea", label: "Data" },
      note: { type: "Textbox", label: "Note" },
    }),
  };
  object.config.studio = {
    collection: {
      kind: "postgres",
      sourceId: "pg",
      resource: "orders",
      idColumn: "id",
      capabilities: {
        list: true,
        read: true,
        create: true,
        update: true,
        delete: true,
        schema: false,
        customFields: false,
      },
      databaseMetadata: {
        resource: "orders",
        kind: "table",
        sampled: false,
        primaryKey: ["id"],
        uniqueKeys: [],
        fields: [
          {
            name: "id",
            nativeType: "int8",
            valueType: "bigint",
            nullable: false,
            generated: true,
            writable: false,
            hasDefault: true,
          },
          {
            name: "data",
            nativeType: "jsonb",
            valueType: "json",
            nullable: true,
            generated: false,
            writable: true,
            hasDefault: false,
          },
          {
            name: "note",
            nativeType: "text",
            valueType: "string",
            nullable: true,
            generated: false,
            writable: true,
            hasDefault: false,
          },
        ],
      },
    },
  };
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CollectionRecordForm
        object={object}
        values={{ id: "1", data: { active: true }, note: null }}
        onSave={save}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("Data")).toHaveValue('{"active":true}');
  fireEvent.change(screen.getByLabelText("Data"), {
    target: { value: '{"active":false}' },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toEqual({ data: '{"active":false}' });
});

it.each([
  [undefined, {}],
  ["false", { enabled: false }],
  ["true", { enabled: true }],
])(
  "preserves optional boolean defaults and explicit choices (%s)",
  async (enabled, expected) => {
    setCrmRuntime({ embedded: false });
    const object: CrmObject = {
      name: "orders",
      label: "Orders",
      description: "",
      config: makeConfig({ enabled: { type: "Toggle", label: "Enabled" } }),
    };
    object.config.studio = {
      collection: {
        kind: "postgres",
        sourceId: "pg",
        resource: "orders",
        idColumn: "id",
        capabilities: {
          list: true,
          read: true,
          create: true,
          update: true,
          delete: true,
          schema: false,
          customFields: false,
        },
        databaseMetadata: {
          resource: "orders",
          kind: "table",
          sampled: false,
          primaryKey: ["id"],
          uniqueKeys: [],
          fields: [
            {
              name: "enabled",
              nativeType: "boolean",
              valueType: "boolean",
              nullable: false,
              generated: false,
              writable: true,
              hasDefault: true,
              defaultValue: "true",
            },
          ],
        },
      },
    };
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CollectionRecordForm
          object={object}
          values={{ enabled }}
          onSave={save}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toEqual(expected);
  },
);
