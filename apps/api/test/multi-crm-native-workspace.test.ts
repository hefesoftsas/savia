import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";

import { createRemoteWorkspaceApp } from "../src/external-crm/remote-workspace";
const ids = {
  salesforce: "003000000000001AAA",
  zoho: "572000000000001",
  pipedrive: "42",
};
vi.mock("../src/external-crm/repository", () => ({
  createCrmRepository: () => ({
    findActiveConnection: async (
      _tenantId: number,
      provider: string,
      _principal: string,
    ) => ({
      id: `${provider}-connection`,
      provider,
      status: "connected",
      externalAccountId: "account-1",
      scopes: [
        "api",
        "ZohoCRM.modules.ALL",
        "ZohoCRM.settings.ALL",
        "contacts:full",
        "deals:full",
      ],
      nangoConnectionId: "nango",
      nangoIntegrationId: provider,
    }),
    findActiveConnectionForPrincipal: async (provider: string) => ({
      id: `${provider}-connection`,
      provider,
      status: "connected",
      externalAccountId: "account-1",
      scopes: [
        "api",
        "ZohoCRM.modules.ALL",
        "ZohoCRM.settings.ALL",
        "contacts:full",
        "deals:full",
      ],
      nangoConnectionId: "nango",
      nangoIntegrationId: provider,
    }),
  }),
}));
beforeAll(async () => {
  for (const [, sql] of Object.entries(
    import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
      eager: true,
      import: "default",
      query: "?raw",
    }),
  ).sort(([a], [b]) => a.localeCompare(b)))
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
});
it.each(["salesforce", "zoho", "pipedrive"] as const)(
  "installs editable %s contact metadata and performs native record operations",
  async (provider) => {
    const requests: any[] = [];
    const nativeRecord =
      provider === "salesforce"
        ? { Id: ids[provider], FirstName: "Ada", LastName: "Lovelace" }
        : provider === "zoho"
          ? { id: ids[provider], First_Name: "Ada", Last_Name: "Lovelace" }
          : { id: 42, name: "Ada Lovelace" };
    const proxy = async (request: any) => {
      requests.push(request);
      const path = request.path;
      if (provider === "salesforce" && path.endsWith("/describe"))
        return Response.json({
          name: "Contact",
          queryable: true,
          retrieveable: true,
          createable: true,
          updateable: true,
          fields: [
            {
              name: "Id",
              label: "Contact ID",
              type: "id",
              nillable: false,
              defaultedOnCreate: true,
              createable: false,
              updateable: false,
            },
            {
              name: "FirstName",
              label: "First Name",
              type: "string",
              nillable: true,
              createable: true,
              updateable: true,
            },
            {
              name: "LastName",
              label: "Last Name",
              type: "string",
              nillable: false,
              createable: true,
              updateable: true,
            },
          ],
        });
      if (provider === "zoho" && path.includes("/settings/modules"))
        return Response.json({
          modules: [
            {
              api_name: "Contacts",
              api_supported: true,
              viewable: true,
              creatable: true,
              editable: true,
            },
          ],
        });
      if (provider === "zoho" && path.includes("/settings/fields"))
        return Response.json({
          fields: [
            {
              api_name: "First_Name",
              field_label: "First Name",
              data_type: "text",
              system_mandatory: false,
              read_only: false,
              operation_type: { api_create: true, api_update: true },
            },
            {
              api_name: "Last_Name",
              field_label: "Last Name",
              data_type: "text",
              system_mandatory: true,
              read_only: false,
              operation_type: { api_create: true, api_update: true },
            },
          ],
        });
      if (provider === "pipedrive" && path.startsWith("/v1/personFields"))
        return Response.json({
          success: true,
          data: [
            {
              id: 1,
              key: "name",
              name: "Name",
              field_type: "varchar",
              mandatory_flag: true,
              active_flag: true,
              edit_flag: false,
              add_visible_flag: true,
            },
          ],
          additional_data: { pagination: { more_items_in_collection: false } },
        });
      if (request.method === "POST") {
        if (provider === "salesforce")
          return Response.json({
            id: ids[provider],
            success: true,
            errors: [],
          });
        if (provider === "zoho")
          return Response.json({
            data: [
              {
                code: "SUCCESS",
                status: "success",
                details: { id: ids[provider] },
              },
            ],
          });
        return Response.json({ success: true, data: nativeRecord });
      }
      if (request.method === "PATCH" || request.method === "PUT")
        return provider === "salesforce"
          ? new Response(null, { status: 204 })
          : provider === "zoho"
            ? Response.json({
                data: [
                  {
                    code: "SUCCESS",
                    status: "success",
                    details: { id: ids[provider] },
                  },
                ],
              })
            : Response.json({ success: true, data: nativeRecord });
      if (path.includes("/query"))
        return Response.json({
          done: true,
          totalSize: 1,
          records: [nativeRecord],
        });
      if (provider === "salesforce") return Response.json(nativeRecord);
      if (provider === "zoho")
        return Response.json({
          data: [nativeRecord],
          info: { more_records: false },
        });
      return Response.json({
        success: true,
        data: path.split("?")[0].endsWith("/42")
          ? nativeRecord
          : [nativeRecord],
        additional_data: { pagination: { more_items_in_collection: false } },
      });
    };
    const app = createRemoteWorkspaceApp({
      db: env.DB,
      files: env.FILES,
      tenant: `tenant:${provider === "salesforce" ? 99821 : provider === "zoho" ? 99822 : 99823}`,
      actor: {
        principal: { id: "owner", isActive: true },
        globalRoles: ["platform_admin"],
        memberships: [],
      },
      seedObjects: [],
      crm: { nango: { proxy } },
    } as any);
    const request = (path: string, method = "GET", body?: unknown) =>
      app.request("/api/" + path, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
    const installed = await request(
      `crm-workspace/${provider}/install`,
      "POST",
      { resources: ["contacts"] },
    );
    expect(installed.status, await installed.clone().text()).toBe(200);
    expect(
      ((await installed.json()) as any).data.objects[0].capabilities,
    ).toMatchObject({
      create: true,
      update: true,
      schema: false,
      customFields: false,
    });
    const list = await request(`records/${provider}_contacts`);
    expect(list.status, await list.clone().text()).toBe(200);
    expect(((await list.json()) as any).data[0].id).toBe(ids[provider]);
    const input =
      provider === "salesforce"
        ? { firstname: "Ada", lastname: "Lovelace" }
        : provider === "zoho"
          ? { first_name: "Ada", last_name: "Lovelace" }
          : { name: "Ada Lovelace" };
    const created = await request(
      `records/${provider}_contacts`,
      "POST",
      input,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    expect(((await created.json()) as any).data.id).toBe(ids[provider]);
    const updated = await request(
      `records/${provider}_contacts/${ids[provider]}`,
      "PATCH",
      input,
    );
    expect(updated.status, await updated.clone().text()).toBe(200);
    expect(requests.some((request) => request.method === "POST")).toBe(true);
  },
);
