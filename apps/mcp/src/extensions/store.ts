import type { FastMCP } from "@prefecthq/fastmcp-ts/server";
import { z } from "zod";
import type { SaviaApiClient } from "../savia-api";

const nonEmptyString = z.string().trim().min(1);

/**
 * Plugins del store visibles al asistente. Solo acciones de lectura
 * declaradas (`simulation` o `http` GET con bloque `mcp`): el catálogo
 * ya trae etiquetas saneadas y `savia_store_execute` vuelve a verificar
 * la entrada contra el catálogo antes de ejecutar, así la anotación
 * readOnlyHint es veraz aunque el modelo pida otra acción.
 */
export function registerStoreAssistantTools(
  server: FastMCP,
  clientForRequest: () => SaviaApiClient,
): void {
  const readOnly = { readOnlyHint: true } as const;

  server.tool(
    {
      name: "savia_store_catalog",
      annotations: readOnly,
      description:
        "List the tenant's active store plugins and their assistant-ready read-only actions.",
      input: z.object({}),
    },
    async () => clientForRequest().listStoreMcpCatalog(),
  );

  server.tool(
    {
      name: "savia_store_execute",
      annotations: readOnly,
      description:
        "Execute a read-only store plugin action listed by savia_store_catalog. Simulation and HTTP GET actions only; anything else is rejected.",
      input: z.object({
        pluginId: nonEmptyString.describe("Store plugin id (custom.*)"),
        actionId: nonEmptyString.describe("Action id from the catalog"),
        input: z
          .record(z.string(), z.unknown())
          .describe("Action input payload"),
      }),
    },
    async ({ pluginId, actionId, input }) => {
      const client = clientForRequest();
      const catalog = await client.listStoreMcpCatalog();
      const plugin = catalog.data.find((entry) => entry.pluginId === pluginId);
      const action = plugin?.actions.find((item) => item.id === actionId);
      const readable =
        action?.kind === "simulation" ||
        (action?.kind === "http" && action.method === "GET");
      if (!readable) {
        throw new Error("Store action is not available to the assistant.");
      }
      return client.executeStoreAction(pluginId, actionId, input);
    },
  );
}
