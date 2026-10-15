import type { PluginApi } from "@savia/plugin-sdk";

export const CATALOG_FIELDS = ["departamento", "entidad", "modalidad"] as const;
export type CatalogField = (typeof CATALOG_FIELDS)[number];
export type CatalogState = {
  options: string[];
  loading: boolean;
  error: boolean;
};

/** Catalog requests never inherit tender search terms, filters or pagination. */
export async function loadSecopCatalog(
  api: PluginApi,
  field: CatalogField,
): Promise<string[]> {
  const result = await api.actions.execute<unknown>(`catalog-${field}`, {
    input: {},
  });
  const output = result.output;
  const data =
    output && typeof output === "object" && "data" in output
      ? output.data
      : null;
  const catalog = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (
    !catalog ||
    typeof catalog !== "object" ||
    catalog.id !== field ||
    catalog.complete !== true ||
    !Array.isArray(catalog.values) ||
    catalog.count !== catalog.values.length ||
    catalog.count >= 50000 ||
    catalog.values.some(
      (value: unknown) => typeof value !== "string" || !value.trim(),
    )
  ) {
    throw new Error("SECOP did not return a complete catalog.");
  }
  return Array.from(new Set<string>(catalog.values)).sort((a, b) =>
    a.localeCompare(b, "es"),
  );
}
