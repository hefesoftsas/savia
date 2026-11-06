import { dialectFor } from "@savia/db/dialect";

export type RecordSummaryConfig = {
  group: string;
  amountField?: string;
};

type SummaryRow = {
  value: unknown;
  count: number;
  amount: number;
};

const rootIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateSummaries(summaries: RecordSummaryConfig[]): void {
  if (!Array.isArray(summaries) || summaries.length > 4)
    throw new TypeError("At most four record summaries can be configured");
  const seen = new Set<string>();
  for (const summary of summaries) {
    if (
      !summary ||
      !rootIdentifier.test(summary.group) ||
      (summary.amountField !== undefined &&
        !rootIdentifier.test(summary.amountField))
    )
      throw new TypeError("Summary fields must be ASCII root identifiers");
    const key = `${summary.group}\0${summary.amountField ?? ""}`;
    if (seen.has(key)) throw new TypeError("Duplicate record summary");
    seen.add(key);
  }
}

function postgresSummaryConfigurationStatements(
  db: D1Database,
  tenant: string,
  objectName: string,
  summaries: RecordSummaryConfig[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare("LOCK TABLE studio_records IN SHARE ROW EXCLUSIVE MODE"),
    db
      .prepare(
        "DELETE FROM studio_record_summary_definitions WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, objectName),
  ];
  for (const { group, amountField } of summaries) {
    const amountKey = amountField ?? "";
    statements.push(
      db
        .prepare(
          "INSERT INTO studio_record_summary_definitions(tenant_id,object_name,group_field,amount_field) VALUES(?,?,?,?)",
        )
        .bind(tenant, objectName, group, amountKey),
      db
        .prepare(
          `INSERT INTO studio_record_summary_groups
             (tenant_id,object_name,group_field,amount_field,value_type,value_key,record_count,amount)
           SELECT ?,?,?,?,v.value_type,v.value_key,COUNT(*),
                  SUM(CASE WHEN ?='' THEN 0.0
                           ELSE studio_record_summary_amount(r.data,?) END)
           FROM studio_records r
           CROSS JOIN LATERAL studio_record_summary_value(r.data,?) v
           WHERE r.tenant_id=? AND r.object_name=? AND r.deleted_at IS NULL
           GROUP BY v.value_type,v.value_key`,
        )
        .bind(
          tenant,
          objectName,
          group,
          amountKey,
          amountKey,
          amountKey,
          group,
          tenant,
          objectName,
        ),
    );
  }
  return statements;
}

/**
 * Returns statements that replace all summaries for an object and backfill
 * their current values. Include the returned statements in the same D1 batch
 * as the metadata change that selected the summaries.
 */
export function summaryConfigurationStatements(
  db: D1Database,
  tenant: string,
  objectName: string,
  summaries: RecordSummaryConfig[],
): D1PreparedStatement[] {
  validateSummaries(summaries);
  if (dialectFor(db).name === "postgres")
    return postgresSummaryConfigurationStatements(
      db,
      tenant,
      objectName,
      summaries,
    );

  const statements = [
    db
      .prepare(
        "DELETE FROM studio_record_summary_definitions WHERE tenant_id=? AND object_name=?",
      )
      .bind(tenant, objectName),
  ];

  for (const { group, amountField } of summaries) {
    const amountKey = amountField ?? "";
    statements.push(
      db
        .prepare(
          "INSERT INTO studio_record_summary_definitions(tenant_id,object_name,group_field,amount_field) VALUES(?,?,?,?)",
        )
        .bind(tenant, objectName, group, amountKey),
    );

    const value = `json_extract(data, '$.' || ?)`;
    const valueType = `CASE WHEN ${value} IS NULL THEN 'null' WHEN typeof(${value}) IN ('integer','real') THEN 'number' ELSE 'text' END`;
    const valueKey = `CASE WHEN ${value} IS NULL THEN '' ELSE ${value} END`;
    const amount = amountField
      ? `COALESCE(SUM(CAST(json_extract(data, '$.' || ?) AS REAL)), 0.0)`
      : "0.0";
    // Group paths occur four times in the projection and four times in GROUP BY.
    const groupBinds = [group, group, group, group];
    // Grouping directly by json_extract preserves SQLite's integer/real
    // equivalence while the stored type marker keeps numeric and text values
    // distinct.
    statements.push(
      db
        .prepare(
          `INSERT INTO studio_record_summary_groups(tenant_id,object_name,group_field,amount_field,value_type,value_key,record_count,amount)
           SELECT ?,?,?,?,${valueType},${valueKey},COUNT(*),${amount}
           FROM studio_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL
           GROUP BY ${valueType},${valueKey}`,
        )
        .bind(
          tenant,
          objectName,
          group,
          amountKey,
          ...groupBinds,
          ...(amountField ? [amountField] : []),
          tenant,
          objectName,
          ...groupBinds,
        ),
    );
  }
  return statements;
}

export async function getMaintainedSummary(
  db: D1Database,
  tenant: string,
  objectName: string,
  group: string,
  amountField?: string,
): Promise<SummaryRow[] | undefined> {
  if (dialectFor(db).name === "postgres") {
    const result = await db
      .prepare(
        `SELECT CASE value_type
                  WHEN 'null' THEN 'null'::jsonb
                  WHEN 'number' THEN to_jsonb(value_key::double precision)
                  ELSE to_jsonb(value_key)
                END AS value,
                record_count AS count, amount
         FROM studio_record_summary_groups
         WHERE tenant_id=? AND object_name=? AND group_field=? AND amount_field=?
         ORDER BY record_count DESC,
                  CASE value_type WHEN 'null' THEN 0 WHEN 'number' THEN 1 ELSE 2 END,
                  CASE WHEN value_type='number' THEN value_key::numeric END,
                  CASE WHEN value_type='text' THEN value_key END COLLATE "C"`,
      )
      .bind(tenant, objectName, group, amountField ?? "")
      .all<SummaryRow>();
    if (result.results.length > 0) return result.results;

    const configured = await db
      .prepare(
        "SELECT 1 FROM studio_record_summary_definitions WHERE tenant_id=? AND object_name=? AND group_field=? AND amount_field=? LIMIT 1",
      )
      .bind(tenant, objectName, group, amountField ?? "")
      .first();
    return configured ? [] : undefined;
  }
  const result = await db
    .prepare(
      `SELECT CASE WHEN value_type='null' THEN NULL ELSE value_key END AS value,
              record_count AS count, amount
       FROM studio_record_summary_groups
       WHERE tenant_id=? AND object_name=? AND group_field=? AND amount_field=?
       ORDER BY record_count DESC, value`,
    )
    .bind(tenant, objectName, group, amountField ?? "")
    .all<SummaryRow>();
  if (result.results.length > 0) return result.results;

  const configured = await db
    .prepare(
      "SELECT 1 FROM studio_record_summary_definitions WHERE tenant_id=? AND object_name=? AND group_field=? AND amount_field=? LIMIT 1",
    )
    .bind(tenant, objectName, group, amountField ?? "")
    .first();
  return configured ? [] : undefined;
}

function groupValueParts(value: unknown): {
  type: string;
  key: string | number;
} {
  if (value === null) return { type: "null", key: "" };
  if (typeof value === "boolean") return { type: "number", key: value ? 1 : 0 };
  if (typeof value === "number") return { type: "number", key: value };
  if (typeof value === "string") return { type: "text", key: value };
  throw new TypeError("Group value must be a SQLite scalar");
}

/** Prepared exact group count suitable for inclusion in a records query batch. */
export function maintainedGroupCountStatement(
  db: D1Database,
  tenant: string,
  objectName: string,
  group: string,
  value: unknown,
): D1PreparedStatement {
  const parts = groupValueParts(value);
  if (dialectFor(db).name === "postgres") {
    const node = "(data::jsonb -> ?)";
    const comparison =
      parts.type === "null"
        ? `(${node} IS NULL OR ${node}='null'::jsonb)`
        : parts.type === "number"
          ? `jsonb_typeof(${node}) IN ('number','boolean') AND
             (CASE WHEN ${node}='true'::jsonb THEN 1::numeric
                   WHEN ${node}='false'::jsonb THEN 0::numeric
                   ELSE (${node} #>> '{}')::numeric END)=?::numeric`
          : `jsonb_typeof(${node})='string' AND (${node} #>> '{}')=?`;
    const fallbackFieldBindings =
      parts.type === "null" ? 2 : parts.type === "number" ? 4 : 2;
    const fallbackBindings = Array.from(
      { length: fallbackFieldBindings },
      () => group,
    );
    const valueBindings = parts.type === "null" ? [] : [parts.key];
    const valueKeyComparison =
      parts.type === "number"
        ? "value_key=trim_scale(?::numeric)::text"
        : "value_key=?";
    return db
      .prepare(
        `SELECT CASE WHEN EXISTS (
                   SELECT 1 FROM studio_record_summary_definitions
                   WHERE tenant_id=? AND object_name=? AND group_field=?
                 )
                 THEN COALESCE((
                   SELECT record_count FROM studio_record_summary_groups
                   WHERE tenant_id=? AND object_name=? AND group_field=?
                     AND amount_field=(
                       SELECT MIN(amount_field) FROM studio_record_summary_definitions
                       WHERE tenant_id=? AND object_name=? AND group_field=?
                     )
                     AND value_type=? AND ${valueKeyComparison}
                 ),0)
                 ELSE (SELECT COUNT(*) FROM studio_records
                       WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL
                         AND ${comparison}) END AS count`,
      )
      .bind(
        tenant,
        objectName,
        group,
        tenant,
        objectName,
        group,
        tenant,
        objectName,
        group,
        parts.type,
        parts.key,
        tenant,
        objectName,
        ...fallbackBindings,
        ...valueBindings,
      );
  }
  return db
    .prepare(
      `SELECT CASE WHEN EXISTS (
                 SELECT 1 FROM studio_record_summary_definitions
                 WHERE tenant_id=? AND object_name=? AND group_field=?
               )
               THEN COALESCE((
                 SELECT record_count FROM studio_record_summary_groups
                 WHERE tenant_id=? AND object_name=? AND group_field=?
                   AND amount_field=(
                     SELECT MIN(amount_field) FROM studio_record_summary_definitions
                     WHERE tenant_id=? AND object_name=? AND group_field=?
                   )
                   AND value_type=? AND value_key IS ?
               ),0)
               ELSE (
                 SELECT COUNT(*) FROM studio_records
                 WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL
                   AND json_extract(data, '$.' || ?) IS ?
               ) END AS count`,
    )
    .bind(
      tenant,
      objectName,
      group,
      tenant,
      objectName,
      group,
      tenant,
      objectName,
      group,
      parts.type,
      parts.key,
      tenant,
      objectName,
      group,
      value === null ? null : parts.key,
    );
}

export async function getMaintainedGroupCount(
  db: D1Database,
  tenant: string,
  objectName: string,
  group: string,
  value: unknown,
): Promise<number | undefined> {
  const result = await maintainedGroupCountStatement(
    db,
    tenant,
    objectName,
    group,
    value,
  ).first<{ count: number | null }>();
  return result?.count ?? undefined;
}
