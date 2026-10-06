import type { VirtualEmployee } from "./virtual-employees";
export const readToolNames = new Set([
  "savia_list_domains",
  "savia_list_documents",
  "savia_get_document",
  "savia_search_personal_files",
  "savia_search_personal_messages",
  "savia_list_personal_events",
  "savia_get_quote_summary",
  "savia_get_quote_form",
  "savia_lookup_dane_city",
  "savia_lookup_quote_vehicle",
  "savia_list_studio_collections",
  "savia_list_studio_records",
  "savia_get_studio_record",
  "savia_get_studio_record_links",
  "savia_aggregate_studio_records",
  // Legacy aliases of the Studio tools above.
  "savia_list_crm_collections",
  "savia_list_crm_records",
  "savia_get_crm_record",
  "savia_get_crm_record_links",
  "savia_aggregate_crm_records",
]);

type McpToolMetadata = {
  annotations?: { readOnlyHint?: boolean };
};

export function isExtensionReadTool(
  name: string,
  tool: McpToolMetadata,
): boolean {
  return (
    name.startsWith("savia_extension_") &&
    tool.annotations?.readOnlyHint === true
  );
}

export function readOnlyTools(tools: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(tools).filter(
      ([name, tool]) =>
        readToolNames.has(name) ||
        isExtensionReadTool(name, tool as McpToolMetadata),
    ),
  );
}

export function applyCollectionScoping(
  tools: Record<string, any>,
  employee?: VirtualEmployee | null,
): Record<string, any> {
  if (!employee) return tools;
  const isAll = employee.allowedCollections.includes("*");
  if (isAll) return tools;

  const allowed = new Set(
    employee.allowedCollections.map((c) => c.toLowerCase().trim()),
  );

  const scopedTools: Record<string, any> = { ...tools };

  const filterDiscovery = (result: any): any => {
    if (!result || typeof result !== "object") return result;
    const filtered = { ...result };
    for (const key of ["collections", "data"]) {
      if (Array.isArray(result[key])) {
        filtered[key] = result[key].filter(
          (col: any) =>
            allowed.has(String(col.name ?? "").toLowerCase()) ||
            allowed.has(String(col.slug ?? "").toLowerCase()),
        );
      }
    }
    if (result.structuredContent) {
      filtered.structuredContent = filterDiscovery(result.structuredContent);
    }
    if (Array.isArray(result.content)) {
      filtered.content = result.content.map((part: any) => {
        if (part.type !== "text" || typeof part.text !== "string") return part;
        try {
          return {
            ...part,
            text: JSON.stringify(filterDiscovery(JSON.parse(part.text))),
          };
        } catch {
          return part;
        }
      });
    }
    return filtered;
  };

  for (const discoveryTool of [
    "savia_list_studio_collections",
    "savia_list_crm_collections",
  ]) {
    if (scopedTools[discoveryTool]) {
      const originalList = scopedTools[discoveryTool];
      scopedTools[discoveryTool] = {
        ...originalList,
        execute: async (args: any, options: any) =>
          filterDiscovery(await originalList.execute(args, options)),
      };
    }
  }

  for (const quoteTool of [
    "savia_get_quote_summary",
    "savia_get_quote_form",
    "savia_lookup_quote_vehicle",
  ]) {
    if (!scopedTools[quoteTool]) continue;
    const originalSummary = scopedTools[quoteTool];
    scopedTools[quoteTool] = {
      ...originalSummary,
      execute: async (args: any, options: any) => {
        if (
          !["cotizaciones", "cotizaciones_detalle"].every((name) =>
            allowed.has(name),
          )
        ) {
          return {
            isError: true,
            error: "ACCESS_DENIED",
            message:
              "El resumen requiere acceso a Cotizaciones y Detalles de cotización.",
          };
        }
        return originalSummary.execute(args, options);
      },
    };
  }

  const dataTools = [
    "savia_list_studio_records",
    "savia_get_studio_record",
    "savia_get_studio_record_links",
    "savia_aggregate_studio_records",
    // Legacy aliases, scoped identically.
    "savia_list_crm_records",
    "savia_get_crm_record",
    "savia_get_crm_record_links",
    "savia_aggregate_crm_records",
  ];

  for (const toolName of dataTools) {
    if (scopedTools[toolName]) {
      const originalTool = scopedTools[toolName];
      scopedTools[toolName] = {
        ...originalTool,
        execute: async (args: any, options: any) => {
          const targetCollection = String(
            args?.object ?? args?.collection ?? "",
          )
            .toLowerCase()
            .trim();
          if (targetCollection && !allowed.has(targetCollection)) {
            return {
              isError: true,
              error: "ACCESS_DENIED",
              message: `Acceso denegado: El empleado @${employee.handle} tiene acceso restringido y no puede consultar la colección '${targetCollection}'. Colecciones permitidas: ${employee.allowedCollections.join(", ")}.`,
            };
          }
          return originalTool.execute(args, options);
        },
      };
    }
  }

  return scopedTools;
}
