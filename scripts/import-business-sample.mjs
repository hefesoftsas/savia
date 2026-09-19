import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function booleanValue(value) {
  return value ? 1 : 0;
}

function nullableBooleanValue(value) {
  return value === null || value === undefined ? null : booleanValue(value);
}

function decimalValue(value) {
  return value === null || value === undefined ? null : String(value);
}

function jsonValue(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function firstEmail(value) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

const rowMappers = {
  business_agency: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    name: row.name,
    address: row.address,
    id_check_digit: row.id_check_digit,
    id_number: row.id_number,
    phone: row.phone,
    logo: row.logo,
    city_id: row.city_id,
    coordinates: jsonValue(row.coordinates),
    lr_id_number: row.lr_id_number,
    lr_id_type: row.lr_id_type,
    lr_name: row.lr_name,
    payments_email: row.payments_email,
    is_active: booleanValue(row.is_active),
    email: row.email,
    is_in_house: booleanValue(row.is_in_house),
    email_domain: row.email_domain,
    birthday_from_email: row.birthday_from_email,
    payment_from_email: row.payment_from_email,
    renewal_from_email: row.renewal_from_email,
    home_url: row.home_url,
    short_name: row.short_name,
    seller_required: booleanValue(row.seller_required),
    has_compliance: booleanValue(row.has_compliance),
    default_cc_emails: jsonValue(row.default_cc_emails),
    surnames: row.surnames,
    type: row.type,
    theme: row.theme,
    retirement_date: row.retirement_date,
  }),
  business_agencycontact: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    name: row.name,
    surname: row.surname,
    email: row.email,
    phone: row.phone,
    position: row.position,
    agency_id: row.agency_id,
  }),
  business_commercialunit: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    name: row.name,
    created_by: row.created_by,
    agency_id: row.agency_id,
    edited_by: row.edited_by,
  }),
  app_documenttag: (row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    agency_id: row.agency_id,
    created_by: row.created_by,
  }),
  operation_tasktag: (row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    agency_id: row.agency_id,
  }),
  customer_group: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    name: row.name,
    agency_id: row.agency_id,
    description: row.description,
  }),
  customer_client: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    id_number: row.id_number,
    migration_slug: row.migration_slug,
    external_id: row.external_id,
  }),
  customer_clientagency: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    agency_id: row.agency_id,
    client_id: row.client_id,
    created_by: row.created_by,
    created_by_slug: row.created_by_slug,
    birthday_notification: booleanValue(row.birthday_notification),
    payment_notification: booleanValue(row.payment_notification),
    renewal_notification: booleanValue(row.renewal_notification),
    commercial_unit_id: row.commercial_unit_id,
    group_id: row.group_id,
    document_url: row.document_url,
    computed_data: jsonValue(row.computed_data),
    completed_at: row.completed_at,
    origin_from_prospects: booleanValue(row.origin_from_prospects),
  }),
  customer_naturalperson: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    surname: row.surname,
    birth_date: row.birth_date,
    phone: row.phone,
    id_type: row.id_type,
    id_number: row.id_number,
    id_issue_at: row.id_issue_at,
    marital_status: row.marital_status,
    occupation: row.occupation,
    company: row.company,
    home_address_id: row.home_address_id,
    work_address_id: row.work_address_id,
    genre: row.genre,
    name: row.name,
    email: firstEmail(row.email),
    client_id: row.client_id,
  }),
  insurance_policy: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    type: row.type,
    currency: row.currency,
    insurance_number: row.insurance_number,
    holder_name: row.holder_name,
    holder_id: row.holder_id,
    client_id: row.client_id,
    payment_type: row.payment_type,
    ramo_id: row.ramo_id,
    renewal_type: row.renewal_type,
    created_by: row.created_by,
    status: row.status,
    completed_at: row.completed_at,
    is_same_insured: booleanValue(row.is_same_insured),
    renewed_policy_id: row.renewed_policy_id,
    migration_slug: row.migration_slug,
    created_by_slug: row.created_by_slug,
    has_lienholder: booleanValue(row.has_lienholder),
    has_seller: nullableBooleanValue(row.has_seller),
    computed_data: jsonValue(row.computed_data),
    insurance_subject: row.insurance_subject,
    external_id: row.external_id,
    owner_id: row.owner_id,
    allows_endorsement_extended_term: booleanValue(
      row.allows_endorsement_extended_term,
    ),
    document_url: row.document_url,
    prospect_id: row.prospect_id,
  }),
  insurance_term: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    start_at: row.start_at,
    finish_at: row.finish_at,
    policy_id: row.policy_id,
    computed_data: jsonValue(row.computed_data),
  }),
  operation_payment: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    amount: decimalValue(row.amount),
    commission_amount: decimalValue(row.commission_amount),
    due_date: row.due_date,
    receipt: row.receipt,
    status: row.status,
    commissioned_at: row.commissioned_at,
    remission: row.remission,
    paid_at: row.paid_at,
    settlement_id: row.settlement_id,
    migration_slug: row.migration_slug,
    created_by: row.created_by,
    created_by_slug: row.created_by_slug,
    receipt_number: row.receipt_number,
    installments: row.installments,
    agency_id: row.agency_id,
    basic_premium_cop: decimalValue(row.basic_premium_cop),
    commission_amount_cop: decimalValue(row.commission_amount_cop),
    rmr: decimalValue(row.rmr),
    comments: row.comments,
    reconciliation_slug: row.reconciliation_slug,
    paid_at_set_at: row.paid_at_set_at,
    computed_data: jsonValue(row.computed_data),
    external_id: row.external_id,
    term_id: row.term_id,
  }),
  claim_claim: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    insurer_number: row.insurer_number,
    incident_at: row.incident_at,
    notified_at: row.notified_at,
    adjuster: row.adjuster,
    description: row.description,
    claimed_amount: decimalValue(row.claimed_amount),
    deductible: row.deductible,
    paid_amount: decimalValue(row.paid_amount),
    completed_at: row.completed_at,
    policy_id: row.policy_id,
    status_id: row.status_id,
    type_id: row.type_id,
    closed_at: row.closed_at,
    migration_slug: row.migration_slug,
    created_by: row.created_by,
    created_by_slug: row.created_by_slug,
    external_id: row.external_id,
    document_url: row.document_url,
  }),
  sales_sale: (row) => ({
    id: row.id,
    id_slug: row.id_slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
    vendu_id: row.vendu_id,
    price: decimalValue(row.price),
    contract_number: row.contract_number,
    sales_mode: row.sales_mode,
    status: row.status,
    otp_code: row.otp_code,
    extra_info: jsonValue(row.extra_info),
    created_by_name: row.created_by_name,
    is_otp_verified: booleanValue(row.is_otp_verified),
    created_by_id: row.created_by_id,
    entity_id: row.entity_id,
    plan_id: row.plan_id,
    product_id: row.product_id,
    insurer_company_id: row.insurer_company_id,
    transaction_id: row.transaction_id,
    positive_at: row.positive_at,
    contract_id: row.contract_id,
    is_reviewed: booleanValue(row.is_reviewed),
    reviewed_at: row.reviewed_at,
    reviewed_by_email: row.reviewed_by_email,
    reviewed_by_name: row.reviewed_by_name,
    client_id: row.client_id,
  }),
};

export const sampleSelection = Object.freeze([
  { sourceTable: "business_agency", id: 3, targetTable: "agencies" },
  { sourceTable: "business_agency", id: 2, targetTable: "agencies" },
  { sourceTable: "business_agency", id: 15, targetTable: "agencies" },
  {
    sourceTable: "business_agencycontact",
    id: 4,
    targetTable: "agency_contacts",
  },
  {
    sourceTable: "business_commercialunit",
    id: 25,
    targetTable: "business_commercialunit",
  },
  { sourceTable: "app_documenttag", id: 351, targetTable: "app_documenttag" },
  {
    sourceTable: "operation_tasktag",
    id: 13,
    targetTable: "operation_tasktag",
  },
  { sourceTable: "customer_group", id: 2, targetTable: "customer_group" },
  { sourceTable: "customer_client", id: 3530, targetTable: "customer_client" },
  { sourceTable: "customer_client", id: 32555, targetTable: "customer_client" },
  {
    sourceTable: "customer_clientagency",
    id: 3531,
    targetTable: "customer_clientagency",
  },
  {
    sourceTable: "customer_clientagency",
    id: 93250,
    targetTable: "customer_clientagency",
  },
  {
    sourceTable: "customer_naturalperson",
    id: 2655,
    targetTable: "customer_naturalperson",
  },
  {
    sourceTable: "customer_naturalperson",
    id: 23504,
    targetTable: "customer_naturalperson",
  },
  {
    sourceTable: "insurance_policy",
    id: 5853,
    targetTable: "insurance_policy",
  },
  { sourceTable: "insurance_term", id: 41761, targetTable: "insurance_term" },
  {
    sourceTable: "operation_payment",
    id: 23889,
    targetTable: "operation_payment",
  },
  { sourceTable: "claim_claim", id: 1490, targetTable: "claim_claim" },
  { sourceTable: "sales_sale", id: 1341, targetTable: "sales_sale" },
  { sourceTable: "sales_sale", id: 1342, targetTable: "sales_sale" },
]);

export function buildBusinessSampleRecords(rowsBySourceTable) {
  return sampleSelection.flatMap((selection) => {
    const row = (rowsBySourceTable[selection.sourceTable] ?? []).find(
      (candidate) => candidate.id === selection.id,
    );
    if (!row) return [];
    return [
      {
        targetTable: selection.targetTable,
        id: selection.id,
        values: rowMappers[selection.sourceTable](row),
      },
    ];
  });
}

function parseArgs(args) {
  const unknown = args.filter((argument) => argument !== "--apply");
  if (unknown.length)
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  return { apply: args.includes("--apply") };
}

function sourceSelectionByTable() {
  return Map.groupBy(sampleSelection, ({ sourceTable }) => sourceTable);
}

async function sourceRows(sourceTable, selections) {
  const database = process.env.SAVIA_SOURCE_DB ?? "savia_source";
  const user = process.env.SAVIA_SOURCE_USER ?? "savia";
  const service = process.env.SAVIA_SOURCE_SERVICE ?? "postgres";
  const ids = selections.map(({ id }) => id).join(", ");
  const sql = `SELECT row_to_json(source_row) FROM (SELECT * FROM ${sourceTable} WHERE id IN (${ids}) ORDER BY id) AS source_row;`;
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

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function insertStatement({ targetTable, values }) {
  const columns = Object.keys(values);
  return `INSERT INTO ${targetTable} (${columns.join(", ")}) VALUES (${columns.map((column) => sqlValue(values[column])).join(", ")}) ON CONFLICT(id) DO NOTHING;`;
}

async function writeToLocalD1(statement) {
  return execFileAsync("pnpm", [
    "--filter",
    "@savia/api",
    "exec",
    "wrangler",
    "d1",
    "execute",
    "savia-agencies",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--command",
    statement,
  ]);
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const rowsBySourceTable = Object.fromEntries(
    await Promise.all(
      [...sourceSelectionByTable()].map(async ([sourceTable, selections]) => [
        sourceTable,
        await sourceRows(sourceTable, selections),
      ]),
    ),
  );
  const records = buildBusinessSampleRecords(rowsBySourceTable);
  if (records.length !== sampleSelection.length)
    throw new Error(
      `Expected ${sampleSelection.length} source records but prepared ${records.length}`,
    );

  console.table(
    records.map(({ targetTable, id }) => ({ targetTable, sourceId: id })),
  );
  if (!apply) {
    console.info(
      "Dry run only. Re-run with --apply to write the sample to local D1.",
    );
    return;
  }

  for (const record of records) await writeToLocalD1(insertStatement(record));
  console.info(`Applied ${records.length} source records to local D1.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
