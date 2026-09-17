import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBitwardenExport,
  buildFlowVariablesPlan,
  generateSqlScript,
} from "./import-bitwarden-credentials.mjs";

test("parseBitwardenExport extracts fields, notes JSON and CRM_INTEGRATION_KEY", () => {
  const fixture = {
    items: [
      {
        name: "Savia · Bruno · proveedores reales",
        notes: `
          Some notes text
          --- SAVIA_BRUNO_PROVIDER_VARIABLES_V1 ---
          {"SAVIA_BRUNO_CHUBB_KEY": "secret-123"}
          --- END SAVIA_BRUNO_PROVIDER_VARIABLES_V1 ---
        `,
        fields: [
          { name: "SAVIA_BRUNO_SURA_API_KEY", value: "sura-key-xyz" },
          { name: "SAVIA_BRUNO_LIBERTY_AUTOS_USERNAME", value: "liberty-user" },
        ],
      },
      {
        name: "Savia · Production · CRM_INTEGRATION_KEY",
        notes: "a1b2c3d4e5f600112233445566778899aabbccddeeff00112233445566778899",
      },
    ],
  };

  const parsed = parseBitwardenExport(fixture);

  assert.equal(parsed.totalItems, 2);
  assert.equal(parsed.rawVariables.SAVIA_BRUNO_SURA_API_KEY, "sura-key-xyz");
  assert.equal(parsed.rawVariables.SAVIA_BRUNO_LIBERTY_AUTOS_USERNAME, "liberty-user");
  assert.equal(parsed.rawVariables.SAVIA_BRUNO_CHUBB_KEY, "secret-123");
  assert.equal(
    parsed.crmIntegrationKey,
    "a1b2c3d4e5f600112233445566778899aabbccddeeff00112233445566778899",
  );
});

test("buildFlowVariablesPlan configures Sura, Liberty, SBS, and Mapfre properly", () => {
  const rawVariables = {
    SAVIA_BRUNO_SURA_API_KEY: "sura-live-key",
    SAVIA_BRUNO_LIBERTY_AUTOS_USERNAME: "lib-user",
    SAVIA_BRUNO_LIBERTY_AUTOS_PASSWORD: "lib-password",
    SAVIA_BRUNO_LIBERTY_AUTOS_TOKEN_ENDPOINT: "https://liberty.test/token",
    SAVIA_BRUNO_LIBERTY_AUTOS_QUOTE_ENDPOINT: "https://liberty.test/quote",
    SAVIA_BRUNO_LIBERTY_AUTOS_QUOTE_REQUEST_BODY: '{"liberty":1}',
    SAVIA_BRUNO_MAPFRE_AUTOS_USERNAME: "map-user",
    SAVIA_BRUNO_MAPFRE_AUTOS_PASSWORD: "map-password",
    SAVIA_BRUNO_MAPFRE_AUTOS_QUOTE_ENDPOINT: "https://mapfre.test/quote",
    SAVIA_BRUNO_MAPFRE_AUTOS_QUOTE_REQUEST_BODY: '{"mapfre":1}',
    SAVIA_BRUNO_SBS_AUTOS_SESSION_REQUEST_XML: `
      <CrearSesion>
        <nomUsu>sbs-user</nomUsu>
        <passwd>sbs-pass</passwd>
        <codFactComision>999</codFactComision>
      </CrearSesion>
    `,
  };

  const plan = buildFlowVariablesPlan(rawVariables);

  // Sura
  const suraVars = plan.get("sura-autos-provider");
  assert.ok(suraVars);
  assert.equal(suraVars.find((v) => v.key === "sura_api_key")?.value, "sura-live-key");
  assert.equal(suraVars.find((v) => v.key === "sura_api_key")?.secret, true);

  // Liberty OAuth
  const libertyAuth = plan.get("liberty-get-oauth-token");
  assert.ok(libertyAuth);
  assert.equal(libertyAuth.find((v) => v.key === "liberty_autos_username")?.value, "lib-user");
  assert.equal(libertyAuth.find((v) => v.key === "liberty_run_consent")?.value, "ALLOW_NON_READ_ONLY");

  // Liberty Quote
  const libertyBasico = plan.get("liberty-basico-quote");
  assert.ok(libertyBasico);
  assert.equal(libertyBasico.find((v) => v.key === "liberty_basico_request_body")?.value, '{"liberty":1}');

  // SBS Product 8
  const sbs8 = plan.get("sbs-producto-8");
  assert.ok(sbs8);
  assert.equal(sbs8.find((v) => v.key === "sbs_username")?.value, "sbs-user");
  assert.equal(sbs8.find((v) => v.key === "sbs_password")?.value, "sbs-pass");
  assert.equal(sbs8.find((v) => v.key === "sbs_product_8_cod_fact_comision")?.value, "999");
  assert.equal(sbs8.find((v) => v.key === "sbs_product_8_coverage_1_id")?.value, "6");

  // Mapfre
  const mapfre = plan.get("mapfre-para-la-mujer-quote");
  assert.ok(mapfre);
  assert.equal(mapfre.find((v) => v.key === "mapfre_autos_username")?.value, "map-user");
  assert.equal(mapfre.find((v) => v.key === "mapfre_run_consent")?.value, "ALLOW_NON_READ_ONLY");
});

test("buildFlowVariablesPlan never supplies SBS credentials from source code", () => {
  const plan = buildFlowVariablesPlan({});
  const sbs8 = plan.get("sbs-producto-8");

  assert.ok(sbs8);
  assert.equal(sbs8.find((variable) => variable.key === "sbs_username")?.value, "");
  assert.equal(sbs8.find((variable) => variable.key === "sbs_password")?.value, "");
});

test("generateSqlScript creates valid idempotent SQL batch", () => {
  const testPlan = new Map([
    [
      "sura-autos-provider",
      [
        { key: "sura_api_key", value: "secret'key", secret: true },
      ],
    ],
  ]);

  const sql = generateSqlScript(testPlan);
  assert.match(sql, /BEGIN TRANSACTION;/);
  assert.match(sql, /INSERT INTO flow_variables/);
  assert.match(sql, /ON CONFLICT\(flow_id, key\) DO UPDATE/);
  assert.match(sql, /secret''key/); // Properly escaped quote
  assert.match(sql, /COMMIT;/);
});
