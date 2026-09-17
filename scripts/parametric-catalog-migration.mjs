import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function optionalNumber(value) {
  return value === null || value === undefined ? undefined : Number(value);
}

function decimalText(value) {
  return String(value);
}

function jsonText(value) {
  return JSON.stringify(value ?? {});
}

function globalScope(row) {
  return row.agency_id === null || row.agency_id === undefined;
}

function neverMigratable() {
  return false;
}

export const sourceCatalogs = Object.freeze([
  {
    sourceTable: "app_country",
    domain: "geographic-catalog",
    command: "register-country",
    collectionPath: "/v1/geographic-catalog/countries",
    toInput: (row) => ({ id: row.id, name: row.name, code: row.code }),
  },
  {
    sourceTable: "app_department",
    domain: "geographic-catalog",
    command: "register-department",
    collectionPath: "/v1/geographic-catalog/departments",
    toInput: (row) => ({
      id: row.id,
      name: row.name,
      countryId: row.country_id,
      externalId: row.external_id,
    }),
  },
  {
    sourceTable: "app_city",
    domain: "geographic-catalog",
    command: "register-city",
    collectionPath: "/v1/geographic-catalog/cities",
    toInput: (row) => ({
      id: row.id,
      name: row.name,
      departmentId: row.department_id,
      externalId: row.external_id,
    }),
  },
  {
    sourceTable: "business_category",
    domain: "insurance-catalog",
    command: "define-product-category",
    collectionPath: "/v1/insurance-catalog/product-categories",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      externalId: optionalNumber(row.external_id),
    }),
  },
  {
    sourceTable: "business_subramo",
    domain: "insurance-catalog",
    command: "define-product-specialization",
    collectionPath: "/v1/insurance-catalog/product-specializations",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      categoryId: row.category_id,
      externalIds: row.external_ids ?? [],
    }),
  },
  {
    sourceTable: "business_insurercompany",
    domain: "insurance-catalog",
    command: "register-insurance-partner",
    collectionPath: "/v1/insurance-catalog/insurance-partners",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      shortName: row.name,
      displayName: row.name_long,
      taxNumber: row.id_number,
      verificationDigit: row.id_check_digit,
      externalId: optionalNumber(row.external_id),
      paymentPortal: row.payment_url,
      reconciliationType: row.reconciliation_type,
      venduCode: row.vendu_code,
      collectionReconciliationType: row.collection_reconciliation_type,
      paymentInformation: row.payment_information,
      assistanceLine: row.assistance_line,
      active: row.is_active,
    }),
  },
  {
    sourceTable: "business_ramo",
    domain: "insurance-catalog",
    command: "define-product-line",
    collectionPath: "/v1/insurance-catalog/product-lines",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      specializationId: row.sub_ramo_id,
      taxIva: decimalText(row.tax_iva),
      externalId: optionalNumber(row.external_id),
      manageReinvestment: row.manage_reinvestment,
      supportsMonthlyPayment: row.has_monthly_payment,
      allowsCustomRenewalDays: row.allow_custom_renewal_days,
      renewable: !row.is_non_renewable,
      subjectValidation: row.insurance_subject_validation,
      subjectValidationMessage: row.insurance_subject_validation_message,
      monthlyPaymentFormLabel: row.monthly_payment_form_label,
      compliancePolicyType: row.compliance_policy_type,
    }),
  },
  {
    sourceTable: "claim_claimtype",
    domain: "claims",
    command: "define-claim-type",
    collectionPath: "/v1/claims/workflow-types",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      visible: row.show_dropdown,
    }),
  },
  {
    sourceTable: "claim_claimstatus",
    domain: "claims",
    command: "define-claim-status",
    collectionPath: "/v1/claims/workflow-statuses",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      order: row.index,
      color: row.color,
      closed: row.is_closed,
    }),
  },
  {
    sourceTable: "claim_claimsubstatus",
    domain: "claims",
    command: "define-claim-substatus",
    collectionPath: "/v1/claims/workflow-statuses",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      order: row.index,
      statusId: row.status_id,
      visible: row.show_dropdown,
    }),
  },
  {
    sourceTable: "sales_entity",
    domain: "sales-pipeline",
    command: "register-sales-entity",
    collectionPath: "/v1/sales-pipeline/sales-offers",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      externalId: row.vendu_id,
      code: row.vendu_code,
      commercialCollectiveEndDay: optionalNumber(
        row.commercial_collective_end_day,
      ),
      commercialCollectiveStartDay: optionalNumber(
        row.commercial_collective_start_day,
      ),
      operationalCollectiveEndDay: optionalNumber(
        row.operational_collective_end_day,
      ),
      operationalCollectiveStartDay: optionalNumber(
        row.operational_collective_start_day,
      ),
      skipOtp: row.skip_otp,
    }),
  },
  {
    sourceTable: "sales_operator",
    domain: "sales-pipeline",
    command: "register-sales-operator",
    collectionPath: "/v1/sales-pipeline/sales-offers",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      hasAiAudit: row.has_ai_audit,
      aiInstruction: row.ai_instruction,
    }),
  },
  {
    sourceTable: "sales_product",
    domain: "sales-pipeline",
    command: "register-sales-product",
    collectionPath: "/v1/sales-pipeline/sales-offers",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      prompt: row.prompt,
      externalId: row.vendu_id,
      code: row.vendu_code,
      entityId: optionalNumber(row.entity_id),
      insurancePartnerId: optionalNumber(row.insurer_company_id),
      operatorId: row.operator_id,
      allowsDuplicates: Boolean(row.allowed_duplicates),
      transactionalExportConfig: jsonText(row.transactional_export_config),
    }),
  },
  {
    sourceTable: "sales_plan",
    domain: "sales-pipeline",
    command: "register-sales-plan",
    collectionPath: "/v1/sales-pipeline/sales-offers",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      externalId: row.vendu_id,
      description: row.description,
      price: row.price === null ? undefined : decimalText(row.price),
      productId: optionalNumber(row.product_id),
      code: row.vendu_code,
    }),
  },
  {
    sourceTable: "app_bank",
    domain: "finance-reference",
    command: "register-bank",
    collectionPath: "/v1/finance-reference/banks",
    toInput: (row) => ({ id: row.id, name: row.name }),
  },
  {
    sourceTable: "app_economicactivity",
    domain: "finance-reference",
    command: "register-economic-activity",
    collectionPath: "/v1/finance-reference/economic-activities",
    toInput: (row) => ({ id: row.id, code: row.code, name: row.name }),
  },
  {
    sourceTable: "renewal_nonrenewalreason",
    domain: "renewal-catalog",
    command: "define-non-renewal-reason",
    collectionPath: "/v1/renewal-catalog/non-renewal-reasons",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      visible: row.show_dropdown,
      showRenewalButton: row.show_renewal_button,
    }),
  },
  {
    sourceTable: "insurance_reinvestmentactivity",
    domain: "policy-lifecycle",
    command: "define-reinvestment-activity",
    collectionPath: "/v1/policy-lifecycle/reinvestment-activities",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      active: row.is_active,
    }),
  },
  {
    sourceTable: "operation_tasktype",
    domain: "operations-catalog",
    command: "define-task-type",
    collectionPath: "/v1/operations-catalog/task-types",
    toInput: (row) => ({
      id: row.id,
      name: row.name,
      code: row.slug,
      visible: row.show_dropdown,
      optionalCustomer: row.optional_customer,
      prospectStatus: row.prospect_status ?? undefined,
    }),
  },
  {
    sourceTable: "operation_tasktag",
    domain: "operations-catalog",
    command: "define-task-tag",
    collectionPath: "/v1/operations-catalog/task-tags",
    isMigratable: globalScope,
    blockReason: "requires the referenced agency",
    toInput: (row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      agencyId: optionalNumber(row.agency_id),
    }),
  },
  {
    sourceTable: "app_documenttag",
    domain: "agency-network",
    command: "define-document-tag",
    collectionPath: "/v1/agency-network/document-tags",
    isMigratable: globalScope,
    blockReason: "requires the referenced agency",
    toInput: (row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      agencyId: optionalNumber(row.agency_id),
      createdBy: row.created_by,
    }),
  },
  {
    sourceTable: "sales_provider",
    domain: "sales-pipeline",
    command: "register-sales-provider",
    collectionPath: "/v1/sales-pipeline/providers",
    toInput: (row) => ({ id: row.id, slug: row.id_slug, name: row.name }),
  },
  {
    sourceTable: "business_commercialunit",
    domain: "agency-network",
    command: "define-commercial-unit",
    collectionPath: "/v1/agency-network/commercial-units",
    isMigratable: neverMigratable,
    blockReason: "requires the referenced agency",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      agencyId: row.agency_id,
      createdBy: row.created_by,
      editedBy: row.edited_by,
    }),
  },
  {
    sourceTable: "customer_group",
    domain: "customer-portfolio",
    command: "define-customer-group",
    collectionPath: "/v1/customer-portfolio/customer-groups",
    isMigratable: globalScope,
    blockReason: "requires the referenced agency",
    toInput: (row) => ({
      id: row.id,
      slug: row.id_slug,
      name: row.name,
      description: row.description,
      agencyId: optionalNumber(row.agency_id),
    }),
  },
]);

export function buildCatalogRecords(rowsBySourceTable) {
  return sourceCatalogs.flatMap((catalog) =>
    (rowsBySourceTable[catalog.sourceTable] ?? [])
      .filter((row) => catalog.isMigratable?.(row) ?? true)
      .map((row) => ({
        sourceTable: catalog.sourceTable,
        domain: catalog.domain,
        command: catalog.command,
        collectionPath: catalog.collectionPath,
        input: catalog.toInput(row),
      })),
  );
}

function parseArgs(args) {
  const unknown = args.filter((argument) => argument !== "--apply");
  if (unknown.length)
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  return { apply: args.includes("--apply") };
}

async function sourceRows(catalog) {
  const database = process.env.SAVIA_SOURCE_DB ?? "savia_source";
  const user = process.env.SAVIA_SOURCE_USER ?? "savia";
  const service = process.env.SAVIA_SOURCE_SERVICE ?? "postgres";
  const sql = `SELECT row_to_json(source_row) FROM (SELECT * FROM ${catalog.sourceTable} ORDER BY id) AS source_row;`;
  const { stdout } = await execFileAsync("docker", [
    "compose",
    "exec",
    "-T",
    service,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    user,
    "-d",
    database,
    "-At",
    "-c",
    sql,
  ]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sourceSummary(rowsBySourceTable) {
  return sourceCatalogs.map((catalog) => {
    const rows = rowsBySourceTable[catalog.sourceTable] ?? [];
    const migratable = rows.filter(
      (row) => catalog.isMigratable?.(row) ?? true,
    ).length;
    return {
      sourceTable: catalog.sourceTable,
      source: rows.length,
      planned: migratable,
      blocked: rows.length - migratable,
      reason: catalog.blockReason,
    };
  });
}

async function executeRecord(apiUrl, record) {
  const response = await fetch(
    `${apiUrl}/v1/domains/${record.domain}/commands/${record.command}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record.input),
    },
  );
  if (response.status === 200) return "created";
  if (response.status === 409) return "already-present";
  throw new Error(
    `${record.sourceTable}#${record.input.id} failed with ${response.status}: ${await response.text()}`,
  );
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const apiUrl = (process.env.SAVIA_API_URL ?? "http://127.0.0.1:8788").replace(
    /\/$/,
    "",
  );
  const rowsBySourceTable = Object.fromEntries(
    await Promise.all(
      sourceCatalogs.map(async (catalog) => [
        catalog.sourceTable,
        await sourceRows(catalog),
      ]),
    ),
  );
  const summary = sourceSummary(rowsBySourceTable);
  const records = buildCatalogRecords(rowsBySourceTable);
  const blocked = summary.reduce((total, item) => total + item.blocked, 0);

  console.table(summary);
  console.info(
    `Prepared ${records.length} parametric records; ${blocked} agency-scoped records remain intentionally blocked.`,
  );
  if (!apply) {
    console.info(
      "Dry run only. Re-run with --apply to write to the local D1 API.",
    );
    return;
  }

  const result = { created: 0, "already-present": 0 };
  for (const [index, record] of records.entries()) {
    const outcome = await executeRecord(apiUrl, record);
    result[outcome] += 1;
    if ((index + 1) % 100 === 0 || index + 1 === records.length)
      console.info(`Applied ${index + 1}/${records.length}`);
  }
  console.info(
    `Migration complete: ${result.created} created, ${result["already-present"]} already present, ${blocked} blocked by agency dependencies.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
