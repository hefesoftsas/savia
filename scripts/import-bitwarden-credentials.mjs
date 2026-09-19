import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import catalog from "../apps/savia-request/src/server/catalog.json" with { type: "json" };

/**
 * Extracts all key-value pairs from a Bitwarden JSON export.
 */
export function parseBitwardenExport(jsonContent) {
  const data = typeof jsonContent === "string" ? JSON.parse(jsonContent) : jsonContent;
  const items = Array.isArray(data?.items) ? data.items : [];

  const rawVariables = {};
  let crmIntegrationKey = "";

  for (const item of items) {
    const itemName = item.name ?? "";
    if (itemName.includes("CRM_INTEGRATION_KEY") || item.notes?.match(/^[a-f0-9]{64}$/i)) {
      crmIntegrationKey = (item.notes ?? "").trim();
    }

    // Process fields
    for (const field of item.fields ?? []) {
      if (field.name && typeof field.value === "string") {
        rawVariables[field.name] = field.value;
      }
    }

    // Process embedded JSON in notes (e.g. --- SAVIA_BRUNO_PROVIDER_VARIABLES_V1 ---)
    if (typeof item.notes === "string") {
      const notesJsonMatch = item.notes.match(
        /---\s*SAVIA_BRUNO_PROVIDER_VARIABLES_V1\s*---\s*([\s\S]*?)\s*---\s*END/,
      );
      if (notesJsonMatch?.[1]) {
        try {
          const parsedNotes = JSON.parse(notesJsonMatch[1].trim());
          Object.assign(rawVariables, parsedNotes);
        } catch {
          // ignore malformed notes JSON
        }
      }
    }
  }

  return { rawVariables, crmIntegrationKey, totalItems: items.length };
}

function xmlTagValue(xml, tagName) {
  if (!xml) return "";
  const match = String(xml).match(
    new RegExp(
      `<(?:(?:[A-Za-z_][\\w.-]*):)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${tagName}\\s*>`,
      "i",
    ),
  );
  return (match?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
}

/**
 * Maps raw Bitwarden variables to Savia Request flow variables.
 */
export function buildFlowVariablesPlan(rawVariables) {
  const sbsXml = rawVariables.SAVIA_BRUNO_SBS_AUTOS_SESSION_REQUEST_XML ?? "";

  const sbsBaseVariables = {
    sbs_username: xmlTagValue(sbsXml, "nomUsu") || rawVariables.sbs_username || "",
    sbs_password: xmlTagValue(sbsXml, "passwd") || rawVariables.sbs_password || "",
    sbs_product_8_digito_verif_aseg: xmlTagValue(sbsXml, "digitoVerifAseg") || "0",
    sbs_product_8_id_nacionalidad: xmlTagValue(sbsXml, "idNacionalidad") || "1",
    sbs_product_8_id_pais_nacimiento: xmlTagValue(sbsXml, "idPaisNacimiento") || "1",
    sbs_product_8_digito_verif_conduc: xmlTagValue(sbsXml, "digitoVerifConduc") || "0",
    sbs_product_8_tel_fijo_contacto: xmlTagValue(sbsXml, "telFijoContacto") || "6010000000",
    sbs_product_8_id_opcion_rc: xmlTagValue(sbsXml, "idOpcionRC") || "0",
    sbs_product_8_id_opcion_rcexceso: xmlTagValue(sbsXml, "idOpcionRCExceso") || "0",
    sbs_product_8_id_opcion_deduc_ppd: xmlTagValue(sbsXml, "idOpcionDeducPPD") || "0",
    sbs_product_8_id_opcion_deduc_ptd: xmlTagValue(sbsXml, "idOpcionDeducPTD") || "0",
    sbs_product_8_id_opcion_deduc_pph: xmlTagValue(sbsXml, "idOpcionDeducPPH") || "0",
    sbs_product_8_id_opcion_deduc_pth: xmlTagValue(sbsXml, "idOpcionDeducPTH") || "0",
    sbs_product_8_cod_fact_comision: xmlTagValue(sbsXml, "codFactComision") || "9000000000",
  };

  const plan = new Map();

  for (const flow of catalog) {
    const vars = [];

    switch (flow.id) {
      case "sura-autos-provider": {
        const apiKey = rawVariables.SAVIA_BRUNO_SURA_API_KEY || rawVariables.sura_api_key || "";
        vars.push({ key: "sura_api_key", value: apiKey, secret: true });
        break;
      }

      case "liberty-get-oauth-token": {
        vars.push(
          { key: "liberty_autos_username", value: rawVariables.SAVIA_BRUNO_LIBERTY_AUTOS_USERNAME ?? "", secret: true },
          { key: "liberty_autos_password", value: rawVariables.SAVIA_BRUNO_LIBERTY_AUTOS_PASSWORD ?? "", secret: true },
          { key: "liberty_autos_token_endpoint", value: rawVariables.SAVIA_BRUNO_LIBERTY_AUTOS_TOKEN_ENDPOINT || "https://apis-auto.hdiseguros.com.co/generic-auto/token", secret: false },
          { key: "liberty_run_consent", value: "ALLOW_NON_READ_ONLY", secret: false },
        );
        break;
      }

      case "liberty-basico-quote":
      case "liberty-basico-pt-quote":
      case "liberty-full-quote":
      case "liberty-integral-quote": {
        const requestBodyKey = flow.id.replace("-quote", "").replace(/-/g, "_") + "_request_body";
        vars.push(
          { key: "liberty_autos_username", value: rawVariables.SAVIA_BRUNO_LIBERTY_AUTOS_USERNAME ?? "", secret: true },
          { key: "liberty_autos_password", value: rawVariables.SAVIA_BRUNO_LIBERTY_AUTOS_PASSWORD ?? "", secret: true },
          { key: "liberty_autos_token_endpoint", value: rawVariables.SAVIA_BRUNO_LIBERTY_AUTOS_TOKEN_ENDPOINT || "https://apis-auto.hdiseguros.com.co/generic-auto/token", secret: false },
          { key: "liberty_autos_quote_endpoint", value: rawVariables.SAVIA_BRUNO_LIBERTY_AUTOS_QUOTE_ENDPOINT || "https://apis-auto.hdiseguros.com.co/generic-auto/GenericTariffVehicleREST/generictariffservice", secret: false },
          { key: "liberty_run_consent", value: "ALLOW_NON_READ_ONLY", secret: false },
          { key: requestBodyKey, value: rawVariables.SAVIA_BRUNO_LIBERTY_AUTOS_QUOTE_REQUEST_BODY || "{}", secret: false },
        );
        break;
      }

      case "mapfre-para-la-mujer-quote": {
        vars.push(
          { key: "mapfre_autos_username", value: rawVariables.SAVIA_BRUNO_MAPFRE_AUTOS_USERNAME ?? "", secret: true },
          { key: "mapfre_autos_password", value: rawVariables.SAVIA_BRUNO_MAPFRE_AUTOS_PASSWORD ?? "", secret: true },
          { key: "mapfre_autos_quote_endpoint", value: rawVariables.SAVIA_BRUNO_MAPFRE_AUTOS_QUOTE_ENDPOINT || "https://sgo.mapfre.com.co/servicios/restv2/calcula_prima/118/01", secret: false },
          { key: "mapfre_autos_quote_request_body", value: rawVariables.SAVIA_BRUNO_MAPFRE_AUTOS_QUOTE_REQUEST_BODY || "{}", secret: false },
          { key: "mapfre_run_consent", value: "ALLOW_NON_READ_ONLY", secret: false },
        );
        break;
      }

      case "sbs-producto-8": {
        for (const [k, val] of Object.entries(sbsBaseVariables)) {
          vars.push({ key: k, value: val, secret: /password|username/.test(k) });
        }
        vars.push(
          { key: "sbs_product_8_coverage_1_type", value: "Base", secret: false },
          { key: "sbs_product_8_coverage_1_id", value: "6", secret: false },
          { key: "sbs_product_8_coverage_2_type", value: "Adicional", secret: false },
          { key: "sbs_product_8_coverage_2_id", value: "31", secret: false },
        );
        break;
      }

      case "sbs-producto-10": {
        for (const [k, val] of Object.entries(sbsBaseVariables)) {
          vars.push({ key: k, value: val, secret: /password|username/.test(k) });
        }
        for (let i = 1; i <= 6; i++) {
          vars.push(
            { key: `sbs_product_10_coverage_${i}_type`, value: "Base", secret: false },
            { key: `sbs_product_10_coverage_${i}_id`, value: String(i), secret: false },
          );
        }
        vars.push(
          { key: "sbs_product_10_coverage_7_type", value: "Adicional", secret: false },
          { key: "sbs_product_10_coverage_7_id", value: "26", secret: false },
        );
        break;
      }

      case "sbs-producto-11": {
        for (const [k, val] of Object.entries(sbsBaseVariables)) {
          vars.push({ key: k, value: val, secret: /password|username/.test(k) });
        }
        for (let i = 1; i <= 6; i++) {
          vars.push(
            { key: `sbs_product_11_coverage_${i}_type`, value: "Base", secret: false },
            { key: `sbs_product_11_coverage_${i}_id`, value: String(i), secret: false },
          );
        }
        vars.push(
          { key: "sbs_product_11_coverage_7_type", value: "Adicional", secret: false },
          { key: "sbs_product_11_coverage_7_id", value: "26", secret: false },
        );
        break;
      }

      case "equidad-basico-quote":
      case "equidad-full-quote":
      case "equidad-ligero-quote":
      case "equidad-rce-quote": {
        const bodyKey = flow.id.replace("-quote", "").replace(/-/g, "_") + "_request_body";
        const planName = flow.id.replace("equidad-", "").replace("-quote", "").toUpperCase();
        vars.push(
          { key: "equidad_run_consent", value: "ALLOW_NON_READ_ONLY", secret: false },
          {
            key: bodyKey,
            value: JSON.stringify({
              AseguradoTipoDocumentoID: 1,
              AseguradoID: "10000000",
              Placa: "TESTCAR",
              Fasecolda: "08001136",
              CorredorID: "10000000",
              ProductoSelecto: null,
              CompaniaID: 0,
              AgrupadorCatalogo: { ListaCatalogos: [{ CompaniaID: 20, Nombre: `EQUIDAD ${planName}` }] },
            }),
            secret: false,
          },
        );
        break;
      }

      case "qualitas-direct-research":
      case "qualitas-base-quote":
      case "qualitas-plus-quote": {
        const variant = flow.id.includes("direct") ? "amplia" : flow.id.includes("plus") ? "plus" : "base";
        const bodyKey = `qualitas_${variant}_request_body`;
        vars.push(
          { key: "qualitas_run_consent", value: "ALLOW_NON_READ_ONLY", secret: false },
          {
            key: bodyKey,
            value: JSON.stringify({
              correlationalID: "SAVIA-IMPORT",
              Movimientos: [
                {
                  Movimiento: {
                    referencialID: "1",
                    TipoMovimiento: "1",
                    NoNegocio: "1",
                    DatosAsegurado: { Departamento: "11", CodigoMunicipio: "11001", ConsideracionesAdicionalesDA: [] },
                    DatosVehiculo: [
                      {
                        NoInciso: "1",
                        ClaveFasecolda: "08001136",
                        Modelo: 2015,
                        Uso: "01",
                        Servicio: "01",
                        Paquete: variant === "amplia" ? "01" : variant === "plus" ? "03" : "02",
                        Coberturas: [],
                        ConsideracionesAdicionalesDV: [],
                      },
                    ],
                    DatosGenerales: {
                      FechaEmision: "2026-01-01",
                      FechaInicio: "2026-01-01",
                      FechaTermino: "2027-01-01",
                      Moneda: "1",
                      Agente: "00000",
                      FormaPago: "1",
                      ConsideracionesAdicionalesDG: [],
                    },
                  },
                },
              ],
            }),
            secret: false,
          },
        );
        break;
      }

      case "previsora-clasica-quote":
      case "previsora-preferente-quote":
      case "previsora-premium-quote":
      case "previsora-sin-asistencia-quote": {
        const variant = flow.id.replace("previsora-", "").replace("-quote", "").replace(/-/g, "_");
        vars.push(
          { key: "previsora_auth_header", value: "Bearer PREVISORA-TOKEN-PLACEHOLDER", secret: true },
          { key: `previsora_${variant}_request_body`, value: JSON.stringify({ plan: variant }), secret: true },
          { key: "previsora_run_consent", value: "ALLOW_NON_READ_ONLY", secret: false },
        );
        break;
      }

      default: {
        for (const v of flow.variables) {
          const matched = rawVariables[v.key] ?? "";
          vars.push({ key: v.key, value: matched, secret: v.secret });
        }
        break;
      }
    }

    plan.set(flow.id, vars);
  }

  return plan;
}

/**
 * Generates an idempotent SQL script to insert variables into Cloudflare D1.
 */
export function generateSqlScript(flowVariablesPlan) {
  const statements = ["-- Generated by Savia Bitwarden Credential Importer", "BEGIN TRANSACTION;"];

  for (const [flowId, vars] of flowVariablesPlan.entries()) {
    for (const v of vars) {
      const escapedValue = v.value.replace(/'/g, "''");
      const secretBit = v.secret ? 1 : 0;
      statements.push(
        `INSERT INTO flow_variables (flow_id, key, value, secret) VALUES ('${flowId}', '${v.key}', '${escapedValue}', ${secretBit}) ` +
          `ON CONFLICT(flow_id, key) DO UPDATE SET value=excluded.value, secret=excluded.secret;`,
      );
    }
  }

  statements.push("COMMIT;");
  return statements.join("\n");
}

/**
 * Sends flow variables via HTTP to a local Savia Request server.
 */
export async function sendVariablesLocal(flowId, variables, port = 8797) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(variables);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/flows/${encodeURIComponent(flowId)}/variables`,
        method: "PUT",
        headers: {
          Host: "savia-request.internal",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, flowId });
          } else {
            reject(new Error(`Failed to update ${flowId} (HTTP ${res.statusCode}): ${body}`));
          }
        });
      },
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Sends flow variables via HTTPS to a production Savia API server.
 */
export async function sendVariablesProduction(flowId, variables, apiUrl, token) {
  const url = new URL(`/v1/savia-request/api/flows/${encodeURIComponent(flowId)}/variables`, apiUrl);
  const payload = JSON.stringify(variables);

  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, flowId });
          } else {
            reject(new Error(`Production update failed for ${flowId} (HTTP ${res.statusCode}): ${body}`));
          }
        });
      },
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function parseCliArgs(argv) {
  const args = {
    bitwarden: "",
    target: "local",
    apiUrl: "https://savia.app.hefesoft.com",
    token: "",
    apply: false,
    exportSql: "",
    exportEnv: "",
    audit: false,
    port: 8797,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--bitwarden" && argv[i + 1]) args.bitwarden = argv[++i];
    else if (arg === "--target" && argv[i + 1]) args.target = argv[++i];
    else if (arg === "--api-url" && argv[i + 1]) args.apiUrl = argv[++i];
    else if (arg === "--token" && argv[i + 1]) args.token = argv[++i];
    else if (arg === "--port" && argv[i + 1]) args.port = Number.parseInt(argv[++i], 10);
    else if (arg === "--export-sql" && argv[i + 1]) args.exportSql = argv[++i];
    else if (arg === "--export-env" && argv[i + 1]) args.exportEnv = argv[++i];
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--audit") args.audit = true;
  }

  return args;
}

export async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (!args.bitwarden) {
    console.error("Uso: node scripts/import-bitwarden-credentials.mjs --bitwarden <path> [opciones]");
    console.error("Opciones:");
    console.error("  --target <local|production>      Entorno destino (def: local)");
    console.error("  --apply                          Aplica los cambios (por defecto es dry-run)");
    console.error("  --audit                          Muestra resumen detallado de credenciales");
    console.error("  --export-sql <file.sql>          Exporta comandos SQL para Cloudflare D1");
    console.error("  --export-env <file.env>          Exporta archivo .env con CRM_INTEGRATION_KEY");
    console.error("  --api-url <url>                  URL base de la API de Savia en producción");
    console.error("  --token <token>                  Token de Platform Administrator para producción");
    console.error("  --port <port>                    Puerto local de savia-request (def: 8797)");
    process.exit(1);
  }

  console.log(`\n📂 Leyendo export de Bitwarden: ${args.bitwarden}...`);
  const content = await readFile(args.bitwarden, "utf8");
  const parsed = parseBitwardenExport(content);
  console.log(`✓ Ítems parseados: ${parsed.totalItems}`);
  console.log(`✓ Variables en bruto extraídas: ${Object.keys(parsed.rawVariables).length}`);
  if (parsed.crmIntegrationKey) {
    console.log(`✓ CRM_INTEGRATION_KEY encontrada: ${parsed.crmIntegrationKey.slice(0, 8)}... (${parsed.crmIntegrationKey.length} caracteres)`);
  }

  const plan = buildFlowVariablesPlan(parsed.rawVariables);
  console.log(`\n📋 Plan de importación para ${plan.size} flows de Savia Request:`);

  for (const [flowId, vars] of plan.entries()) {
    const configuredCount = vars.filter((v) => v.value !== "").length;
    const secretsCount = vars.filter((v) => v.secret).length;
    console.log(`  • ${flowId.padEnd(32)} ${configuredCount}/${vars.length} variables configuradas (${secretsCount} secretos)`);
  }

  if (args.exportEnv) {
    console.log(`\n📝 Guardando variables de entorno en ${args.exportEnv}...`);
    let envContent = `# Savia Production Secrets\n`;
    if (parsed.crmIntegrationKey) {
      envContent += `CRM_INTEGRATION_KEY=${parsed.crmIntegrationKey}\n`;
    }
    await writeFile(args.exportEnv, envContent, "utf8");
    console.log(`✓ Archivo ${args.exportEnv} escrito exitosamente.`);
  }

  if (args.exportSql) {
    console.log(`\n📝 Generando script SQL para D1 en ${args.exportSql}...`);
    const sql = generateSqlScript(plan);
    await writeFile(args.exportSql, sql, "utf8");
    console.log(`✓ Archivo ${args.exportSql} escrito exitosamente.`);
  }

  if (args.apply) {
    if (args.target === "local") {
      console.log(`\n🚀 Aplicando variables a Savia Request local (puerto ${args.port})...`);
      let successCount = 0;
      for (const [flowId, vars] of plan.entries()) {
        try {
          await sendVariablesLocal(flowId, vars, args.port);
          successCount++;
        } catch (err) {
          console.error(`  ✗ Error en ${flowId}:`, err.message);
        }
      }
      console.log(`\n✅ Importación completada: ${successCount}/${plan.size} flows actualizados exitosamente en local.`);
    } else if (args.target === "production") {
      if (!args.token) {
        console.error("✗ Error: El modo producción requiere --token <admin_token>");
        process.exit(1);
      }
      console.log(`\n🚀 Aplicando variables a Savia Request en producción (${args.apiUrl})...`);
      let successCount = 0;
      for (const [flowId, vars] of plan.entries()) {
        try {
          await sendVariablesProduction(flowId, vars, args.apiUrl, args.token);
          successCount++;
        } catch (err) {
          console.error(`  ✗ Error en ${flowId}:`, err.message);
        }
      }
      console.log(`\n✅ Importación en producción completada: ${successCount}/${plan.size} flows actualizados.`);
    }
  } else if (!args.exportSql && !args.exportEnv) {
    console.log(`\nℹ️ Modo Dry-Run. Para aplicar los cambios a Savia Request, añade la bandera --apply`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
