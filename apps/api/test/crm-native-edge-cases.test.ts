import { expect, it, vi } from "vitest";
import { createRemoteWorkspaceAdapter } from "../src/external-crm/workspace-adapter";
const conn = (provider: string) =>
  ({
    id: "connection",
    provider,
    externalAccountId: "account",
    scopes: ["api", "ZohoCRM.modules.ALL", "contacts:full", "deals:full"],
  }) as any;
const nango = (proxy: (request: any) => Promise<Response>) =>
  ({ proxy }) as any;
it("preserves Salesforce picklist values, system defaults, and datetime semantics", async () => {
  const adapter = createRemoteWorkspaceAdapter(
    "salesforce",
    nango(async () =>
      Response.json({
        queryable: true,
        retrieveable: true,
        createable: true,
        updateable: true,
        fields: [
          {
            name: "Name",
            label: "Name",
            type: "string",
            nillable: false,
            createable: true,
            updateable: true,
          },
          {
            name: "StageName",
            label: "Stage",
            type: "picklist",
            nillable: false,
            createable: true,
            updateable: true,
            picklistValues: [
              { value: "Qualified", label: "Calificada", active: true },
            ],
          },
          {
            name: "OwnerId",
            label: "Owner",
            type: "reference",
            nillable: false,
            defaultedOnCreate: true,
            createable: true,
            updateable: true,
          },
          {
            name: "ReminderDateTime",
            label: "Reminder",
            type: "datetime",
            nillable: true,
            createable: true,
            updateable: true,
          },
        ],
      }),
    ),
  );
  const description = await adapter.describe(conn("salesforce"), "deals");
  expect(description.fields.StageName.options).toEqual([
    { value: "Qualified", label: "Calificada" },
  ]);
  expect(description.fields.OwnerId.required).toBe(false);
  expect(description.fields.ReminderDateTime).toMatchObject({
    type: "Textbox",
    config: { dateTime: true },
  });
});
it("respects Zoho module denials even with broad OAuth scope", async () => {
  const adapter = createRemoteWorkspaceAdapter(
    "zoho",
    nango(async ({ path }) =>
      path.includes("/settings/modules")
        ? Response.json({
            modules: [
              {
                api_name: "Contacts",
                creatable: false,
                editable: false,
                viewable: false,
              },
            ],
          })
        : Response.json({
            fields: [
              {
                api_name: "Last_Name",
                field_label: "Last Name",
                data_type: "text",
                read_only: false,
                operation_type: { api_create: true, api_update: true },
              },
            ],
          }),
    ),
  );
  const description = await adapter.describe(conn("zoho"), "contacts");
  expect(description.capabilities).toMatchObject({
    create: false,
    update: false,
    list: false,
    read: false,
  });
});
it("does not turn a malformed successful list response into an empty CRM", async () => {
  const adapter = createRemoteWorkspaceAdapter(
    "pipedrive",
    nango(async () => new Response("not-json", { status: 200 })),
  );
  await expect(
    adapter.list(conn("pipedrive"), "contacts", {
      page: 1,
      perPage: 25,
      fields: ["name"],
    }),
  ).rejects.toThrow();
});
it("treats Zoho no-content as an empty terminal page", async () => {
  const adapter = createRemoteWorkspaceAdapter(
    "zoho",
    nango(async () => new Response(null, { status: 204 })),
  );
  expect(
    await adapter.list(conn("zoho"), "contacts", {
      page: 1,
      perPage: 25,
      fields: ["Last_Name"],
    }),
  ).toEqual({ records: [], hasNextPage: false });
});
it("reports upstream authorization and rate limits without exposing provider payloads", async () => {
  for (const status of [401, 403, 429]) {
    const adapter = createRemoteWorkspaceAdapter(
      "pipedrive",
      nango(async () =>
        Response.json({ secret: "private upstream message" }, { status }),
      ),
    );
    await expect(
      adapter.list(conn("pipedrive"), "contacts", {
        page: 1,
        perPage: 25,
        fields: ["name"],
      }),
    ).rejects.toMatchObject({ status });
  }
});
it("uses Pipedrive organization related-record endpoints instead of unsupported list filters", async () => {
  const proxy = vi.fn(async (_request: any) =>
    Response.json({
      success: true,
      data: [{ id: 42, name: "Ada" }],
      additional_data: { pagination: { more_items_in_collection: false } },
    }),
  );
  const adapter = createRemoteWorkspaceAdapter("pipedrive", nango(proxy));
  await adapter.links(conn("pipedrive"), "companies", "12", "contacts", {
    page: 1,
    perPage: 20,
    fields: ["name"],
  });
  expect(proxy.mock.calls[0][0].path.split("?")[0]).toBe(
    "/v1/organizations/12/persons",
  );
});
it("uses exact Zoho relation page sizes to avoid skipping records", async () => {
  const proxy = vi.fn(async (_request: any) =>
    Response.json({
      data: [{ id: "123", Last_Name: "Ada" }],
      info: { more_records: true },
    }),
  );
  const adapter = createRemoteWorkspaceAdapter("zoho", nango(proxy));
  const page = await adapter.links(
    conn("zoho"),
    "companies",
    "12",
    "contacts",
    { page: 2, perPage: 20, fields: ["Last_Name"] },
  );
  expect(
    new URL(proxy.mock.calls[0][0].path, "https://crm.test").searchParams.get(
      "per_page",
    ),
  ).toBe("20");
  expect(page.hasNextPage).toBe(true);
});
it.each([
  ["salesforce", "companies", "Name", "Acme"],
  ["salesforce", "deals", "Name", "New opportunity"],
  ["zoho", "companies", "Account_Name", "Acme"],
  ["zoho", "deals", "Deal_Name", "New deal"],
  ["pipedrive", "companies", "name", "Acme"],
  ["pipedrive", "deals", "title", "New deal"],
] as const)(
  "creates %s %s using its native title field",
  async (provider, resource, title, value) => {
    const id = provider === "salesforce" ? "001000000000001AAA" : "42";
    const payloads: unknown[] = [];
    const proxy = async ({ path, method, body }: any) => {
      if (path.endsWith("/describe"))
        return Response.json({
          queryable: true,
          retrieveable: true,
          createable: true,
          updateable: true,
          fields: [
            {
              name: title,
              label: "Title",
              type: "string",
              nillable: false,
              createable: true,
              updateable: true,
            },
          ],
        });
      if (path.includes("/settings/modules"))
        return Response.json({
          modules: [
            {
              api_name: resource === "companies" ? "Accounts" : "Deals",
              viewable: true,
              creatable: true,
              editable: true,
            },
          ],
        });
      if (path.includes("/settings/fields"))
        return Response.json({
          fields: [
            {
              api_name: title,
              field_label: "Title",
              data_type: "text",
              system_mandatory: true,
              read_only: false,
              operation_type: { api_create: true, api_update: true },
            },
          ],
        });
      if (path.includes("Fields"))
        return Response.json({
          success: true,
          data: [
            {
              key: title,
              name: "Title",
              field_type: "varchar",
              mandatory_flag: true,
              active_flag: true,
              edit_flag: false,
            },
          ],
          additional_data: { pagination: { more_items_in_collection: false } },
        });
      if (method === "POST") {
        payloads.push(body);
        return provider === "salesforce"
          ? Response.json({ id, success: true })
          : provider === "zoho"
            ? Response.json({
                data: [{ status: "success", code: "SUCCESS", details: { id } }],
              })
            : Response.json({ success: true, data: { id, [title]: value } });
      }
      return provider === "salesforce"
        ? Response.json({ Id: id, [title]: value })
        : provider === "zoho"
          ? Response.json({ data: [{ id, [title]: value }] })
          : Response.json({ success: true, data: { id, [title]: value } });
    };
    const adapter = createRemoteWorkspaceAdapter(provider, nango(proxy));
    const result = await adapter.create(conn(provider), resource, {
      [title]: value,
    });
    expect(result[title]).toBe(value);
    expect(payloads).toEqual([
      provider === "zoho" ? { data: [{ [title]: value }] } : { [title]: value },
    ]);
  },
);
it("keeps integer metadata numeric and returns empty Zoho relationship pages", async () => {
  const sf = createRemoteWorkspaceAdapter(
    "salesforce",
    nango(async () =>
      Response.json({
        queryable: true,
        retrieveable: true,
        createable: true,
        updateable: true,
        fields: [
          {
            name: "Name",
            label: "Name",
            type: "string",
            createable: true,
            updateable: true,
          },
          {
            name: "NumberOfEmployees",
            label: "Employees",
            type: "int",
            createable: true,
            updateable: true,
          },
        ],
      }),
    ),
  );
  expect(
    (await sf.describe(conn("salesforce"), "companies")).fields
      .NumberOfEmployees.type,
  ).toBe("Number");
  const zoho = createRemoteWorkspaceAdapter(
    "zoho",
    nango(async () => new Response(null, { status: 204 })),
  );
  expect(
    await zoho.links(conn("zoho"), "companies", "123", "contacts", {
      page: 1,
      perPage: 20,
      fields: ["Last_Name"],
    }),
  ).toEqual({ records: [], hasNextPage: false });
});
it("bounds Zoho screen fields to fifty while retaining required fields and reporting the limit", async () => {
  const fields = [
    {
      api_name: "Last_Name",
      field_label: "Last name",
      data_type: "text",
      system_mandatory: true,
      read_only: false,
    },
    ...Array.from({ length: 60 }, (_, i) => ({
      api_name: `Field_${i}`,
      field_label: `Field ${i}`,
      data_type: "text",
      system_mandatory: i === 59,
      read_only: false,
    })),
  ];
  const zoho = createRemoteWorkspaceAdapter(
    "zoho",
    nango(async ({ path }) =>
      path.includes("/settings/modules")
        ? Response.json({
            modules: [
              {
                api_name: "Contacts",
                viewable: true,
                creatable: true,
                editable: true,
              },
            ],
          })
        : Response.json({ fields }),
    ),
  );
  const described = await zoho.describe(conn("zoho"), "contacts");
  expect(Object.keys(described.fields)).toHaveLength(50);
  expect(described.fields.Field_59.required).toBe(true);
  expect(described.schemaIssues?.[0]).toContain("50");
});
it("hydrates Pipedrive search hits so ordinary contact email fields remain available", async () => {
  const pd = createRemoteWorkspaceAdapter(
    "pipedrive",
    nango(async ({ path }) =>
      path.includes("/search")
        ? Response.json({
            success: true,
            data: {
              items: [
                { item: { id: 42, name: "Ada", emails: ["ada@example.test"] } },
              ],
            },
            additional_data: {
              pagination: { more_items_in_collection: false },
            },
          })
        : Response.json({
            success: true,
            data: {
              id: 42,
              name: "Ada",
              email: [{ value: "ada@example.test", primary: true }],
            },
          }),
    ),
  );
  expect(
    (
      await pd.list(conn("pipedrive"), "contacts", {
        page: 1,
        perPage: 20,
        q: "ada@example.test",
        fields: ["name", "email"],
      })
    ).records[0].email,
  ).toBe("ada@example.test");
});
it("searches Salesforce Email rather than Name for exact contact matching", async () => {
  const { createRemoteCrmAdapter } =
    await import("../src/external-crm/remote-crm");
  const proxy = vi.fn(async ({ path }: any) => {
    const query = new URL(path, "https://crm.test").searchParams.get("q") ?? "";
    return Response.json({
      records: query.includes("Email = 'ada@example.test'")
        ? [
            {
              Id: "003000000000001AAA",
              FirstName: "Ada",
              LastName: "Lovelace",
              Email: "ada@example.test",
            },
          ]
        : [],
      done: true,
      totalSize: 1,
    });
  });
  const results = await createRemoteCrmAdapter(
    "salesforce",
    nango(proxy),
  ).findContactByEmail(conn("salesforce"), "ada@example.test");
  expect(results).toHaveLength(1);
});
it("preserves the other Pipedrive name component during a partial legacy contact update", async () => {
  const { createRemoteCrmAdapter } =
    await import("../src/external-crm/remote-crm");
  let write: any;
  const proxy = async ({ path, method, body }: any) => {
    if (path.includes("personFields"))
      return Response.json({
        success: true,
        data: [
          {
            key: "name",
            name: "Name",
            field_type: "varchar",
            mandatory_flag: true,
          },
        ],
      });
    if (method === "PUT") {
      write = body;
      return Response.json({
        success: true,
        data: {
          id: 42,
          name: body.name,
          first_name: "Grace",
          last_name: "Lovelace",
        },
      });
    }
    return Response.json({
      success: true,
      data: {
        id: 42,
        name: write?.name ?? "Ada Lovelace",
        first_name: write ? "Grace" : "Ada",
        last_name: "Lovelace",
      },
    });
  };
  await createRemoteCrmAdapter("pipedrive", nango(proxy)).updateContact(
    conn("pipedrive"),
    "42",
    { firstName: "Grace" },
  );
  expect(write.name).toBe("Grace Lovelace");
});
