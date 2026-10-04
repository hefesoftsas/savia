import { readFile } from "node:fs/promises";

// Only tracked catalog code/templates are used; all input/response values are synthetic.
const catalog = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/savia-request/src/server/catalog.json",
      import.meta.url,
    ),
  ),
);
const requestBody = JSON.stringify({
  correlationalID: "probe",
  Movimientos: [],
  CorredorID: "probe",
  AgrupadorCatalogo: { ListaCatalogos: [{ CompaniaID: 20 }] },
  LicensePlate: "SYNTHETIC-PLATE",
  RiskQuotation: { InsuredQuotation: { NaturalPerson: {} } },
});
const xml =
  "<Envelope><No_Sesion>test-session</No_Sesion><CoberturaAgregada>true</CoberturaAgregada><No_Cotizacion>TEST-123</No_Cotizacion><Prima_Total>1200000</Prima_Total></Envelope>";

export const fixtures = [];
for (const flow of catalog) {
  for (const [index, step] of flow.steps.entries()) {
    for (const phase of ["pre", "post"]) {
      const code = step[phase];
      if (!code?.trim()) continue;
      const keys = new Set([
        ...Object.keys(flow.input ?? {}),
        ...flow.variables.map((v) => v.key),
        ...Array.from(
          code.matchAll(
            /(?:getEnvVar|getGlobalEnvVar|getVar|environmentValue|requiredInput)\("([^"]+)"/g,
          ),
          (m) => m[1],
        ),
      ]);
      const values = Object.fromEntries(
        [...keys].map((key) => [
          key,
          key.endsWith("_run_consent")
            ? "ALLOW_NON_READ_ONLY"
            : key.endsWith("_request_body")
              ? requestBody
              : "1",
        ]),
      );
      Object.assign(values, {
        "auto_light.applicant.documentType": "CC",
        "auto_light.applicant.gender": "F",
        "auto_light.applicant.birthDate": "1990-01-02",
        "auto_light.vehicle.isNew": "false",
        "auto_light.applicant.firstName": "Synthetic & <test>",
      });
      fixtures.push({
        name: `${flow.id}/${index}/${phase}`,
        code,
        payload: {
          body: step.body,
          values,
          response: flow.id.startsWith("sbs-")
            ? xml
            : '{"access_token":"synthetic-token"}',
        },
      });
    }
  }
}
export const corpus = {
  flowCount: catalog.length,
  steps: catalog.reduce((n, f) => n + f.steps.length, 0),
  hooks: fixtures.length,
  uniqueScripts: new Set(fixtures.map((f) => f.code)).size,
};

const largeResponse = JSON.stringify({
  rows: Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    premium: 100 + i,
    description: "x".repeat(60),
  })),
});
export const benchmarks = [
  { name: "empty-hook", code: "", payload: { body: "hello", values: {} } },
  {
    ...fixtures.find((f) => f.name === "liberty-get-oauth-token/0/post"),
    name: "token-json",
  },
  {
    ...fixtures.find((f) => f.name === "sbs-producto-8/0/pre"),
    name: "sbs-request-xml",
  },
  {
    ...fixtures.find((f) => f.name === "sbs-producto-8/3/post"),
    name: "sbs-response-xml",
  },
  {
    name: "json-100kb",
    code: 'const rows=JSON.parse(res.getBody()).rows; bru.setVar("total",rows.reduce((n,r)=>n+r.premium,0));',
    payload: { body: "", values: {}, response: largeResponse },
  },
];
