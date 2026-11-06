import type { Flow, Trace } from "./types";
import type { Env } from "./env";
import { cacheRequest, type RequestCachePolicy } from "./request-cache";

export const daneSource = "https://www.datos.gov.co/resource/gdxc-w37w.json";
type Municipality = { code: string; city: string; department: string };
function parseCatalog(body: unknown): Municipality[] {
  if (!Array.isArray(body) || !body.length || body.length >= 5000)
    throw new Error("El catálogo DANE no está disponible completo.");
  const rows: Municipality[] = body.flatMap((row) =>
    row &&
    /^\d{5}$/.test(row.cod_mpio) &&
    typeof row.nom_mpio === "string" &&
    typeof row.dpto === "string"
      ? [{ code: row.cod_mpio, city: row.nom_mpio, department: row.dpto }]
      : [],
  );
  if (rows.length !== body.length)
    throw new Error("El catálogo DANE contiene datos inválidos.");
  return rows;
}
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^bogota(?: d c| dc| distrito capital)?$/, "bogota");
export async function lookupDaneCity(
  city: string,
  department?: string,
  fetcher: typeof fetch = fetch,
  environment?: Pick<Env, "DB">,
  policy: RequestCachePolicy | undefined = daneCityFlow.steps[0]?.cache,
  tenant = "",
) {
  if (
    typeof city !== "string" ||
    city.trim().length < 2 ||
    city.length > 100 ||
    (department !== undefined &&
      (typeof department !== "string" || department.length > 100))
  )
    throw new Error(
      "Indica una ciudad válida y, si es necesario, su departamento.",
    );
  const response = await cacheRequest(
    environment ?? {},
    new Request(daneCityFlow.steps[0].url, {
      headers: daneCityFlow.steps[0].headers,
      signal: AbortSignal.timeout(15000),
    }),
    policy,
    {
      tenant,
      revision: JSON.stringify({
        operation: daneCityFlow.id,
        contract: 1,
        policy,
      }),
      validateResponse: async (candidate) => {
        try {
          parseCatalog(await candidate.json());
          return true;
        } catch {
          return false;
        }
      },
    },
    fetcher,
  );
  if (!response.ok)
    throw new Error("No se pudo consultar el catálogo oficial DANE.");
  const rows = parseCatalog(await response.json());
  const ageHeader = response.headers.get("x-savia-cache-age-ms");
  const rawAge = Number(ageHeader);
  const cacheAgeMs =
    ageHeader !== null && Number.isFinite(rawAge)
      ? Math.max(0, rawAge)
      : undefined;
  const cacheStatus = (response.headers.get("x-savia-cache") ??
    "bypass") as NonNullable<Trace["cacheStatus"]>;
  const retrievedAt = new Date(Date.now() - (cacheAgeMs ?? 0)).toISOString();
  const query = normalize(city),
    region = department?.trim() ? normalize(department) : undefined;
  if (query.length < 2) throw new Error("Indica una ciudad válida.");
  const candidates = rows.filter(
    (row) => !region || normalize(row.department) === region,
  );
  const exact = candidates.filter(
    (row) => normalize(row.city) === query || row.code === city.trim(),
  );
  const matches = exact.length
    ? exact
    : candidates.filter((row) => normalize(row.city).includes(query));
  return {
    status:
      matches.length === 1
        ? "matched"
        : matches.length
          ? "ambiguous"
          : "not_found",
    matches: matches.slice(0, 20),
    totalMatches: matches.length,
    source: daneSource,
    retrievedAt,
    cacheStatus,
    ...(cacheAgeMs === undefined ? {} : { cacheAgeMs }),
  };
}
export const daneCityFlow: Flow = {
  id: "dane-city-lookup",
  name: "DANE · Código de municipio por ciudad",
  description:
    "Consulta de referencia de solo lectura. Resuelve ciudad y departamento contra el catálogo oficial DIVIPOLA del DANE. Devuelve coincidencias y exige desambiguar nombres repetidos; no crea cotizaciones.",
  provider: "DANE",
  kind: "lookup",
  folderPath: "Referencias/Colombia",
  allowedOrigins: ["https://www.datos.gov.co"],
  input: { city: "Bogotá", department: "" },
  variables: [],
  steps: [
    {
      id: "dane-city",
      name: "Consultar catálogo DIVIPOLA oficial y resolver ciudad",
      method: "GET",
      url: daneSource + "?$select=cod_mpio,nom_mpio,dpto&$limit=5000",
      headers: { Accept: "application/json" },
      cache: { enabled: true, ttlSeconds: 86400, scope: "public" },
      body: "",
      pre: "",
      post: "",
    },
  ],
};
