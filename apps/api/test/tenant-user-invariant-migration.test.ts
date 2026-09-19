import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([left], [right]) => left.localeCompare(right));

function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

async function apply(name: string): Promise<void> {
  const migration = migrations.find(([path]) => path.endsWith(`/${name}`));
  expect(migration, `Missing migration ${name}`).toBeDefined();
  for (const statement of statements(migration![1]))
    await env.DB.exec(statement);
}

async function row<T>(sql: string): Promise<T | null> {
  return env.DB.prepare(sql).first<T>();
}

beforeAll(async () => {
  for (const [path] of migrations) {
    const name = path.split("/").at(-1)!;
    if (name === "0046_tenant_user_invariant.sql") break;
    await apply(name);
  }
  const fixture = `
    INSERT INTO tenants (id,id_slug,name,is_active,created_at,updated_at)
    VALUES
      (101,'primary','Tenant primario',1,'2026-09-15','2026-09-15'),
      (102,'empty-source','Tenant sin usuarios',1,'2026-09-15','2026-09-15');
    INSERT INTO agencies (
      id,tenant_id,id_slug,created_at,updated_at,name,address,id_check_digit,id_number,
      lr_id_number,lr_id_type,lr_name,payments_email,is_active,email,is_in_house,email_domain,
      birthday_from_email,payment_from_email,renewal_from_email,home_url,short_name,
      seller_required,has_compliance,surnames,type,theme
    ) VALUES (
      102,102,'empty-source','2026-09-15','2026-09-15','Tenant sin usuarios','Calle 1','0','102',
      '102','NIT','Representante','pagos@source.test',1,'source@test.test',0,'source.test',
      'birthday@source.test','payment@source.test','renewal@source.test','https://source.test','source',
      0,0,'','agency','default'
    );
    INSERT INTO document_ownership (domain,collection,document_id,agency_id,created_at,updated_at)
    VALUES ('customer-portfolio','customer-profiles','source-document',102,'2026-09-15','2026-09-15');
    INSERT INTO agency_contacts (id_slug,created_at,updated_at,name,surname,email,phone,position,agency_id)
    VALUES ('source-contact','2026-09-15','2026-09-15','Contacto','Origen','contact@source.test','3000000000','Operador',102);
    INSERT INTO identity_principal (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
    VALUES
      ('admin','test','admin','admin@savia.test','Administradora',1,'2026-09-15','2026-09-15'),
      ('orphan','test','orphan','orphan@savia.test','Sin tenant',1,'2026-09-15','2026-09-15');
    INSERT INTO identity_global_role (principal_id,role,created_at)
    VALUES ('admin','platform_admin','2026-09-15');
    INSERT INTO identity_tenant_membership (id,principal_id,tenant_id,role,is_active,created_at,updated_at)
    VALUES ('admin-membership','admin',102,'tenant_admin',1,'2026-09-15','2026-09-15');
    INSERT INTO crm_objects (tenant_id,name,label,config)
    VALUES ('agency:102','contacts','Contactos','{}');
    INSERT INTO crm_records (id,tenant_id,object_name,data)
    VALUES ('source-record','agency:102','contacts','{}');
    INSERT INTO crm_notes (id,tenant_id,object_name,record_id,body)
    VALUES ('source-note','agency:102','contacts','source-record','Nota conservada');
    INSERT INTO crm_files (id,tenant_id,object_name,record_id,name,mime,size,storage_key)
    VALUES ('source-file','agency:102','contacts','source-record','contacto.pdf','application/pdf',12,'files/source-contacto.pdf');
    INSERT INTO crm_tasks (id,tenant_id,object_name,record_id,title,due_at)
    VALUES ('source-task','agency:102','contacts','source-record','Llamar al contacto','2026-09-16');
    INSERT INTO crm_collection_bindings (tenant_id,object_name,source_id,resource,config)
    VALUES ('agency:102','contacts','source','contacts','{}');
    INSERT INTO crm_solution_installations (tenant_id,id,version,manifest)
    VALUES ('agency:102','source.solution','1.0.0','{}');
    INSERT INTO crm_solution_objects (tenant_id,solution_id,object_name,definition)
    VALUES ('agency:102','source.solution','contacts','{}');
    INSERT INTO crm_extension_installations (tenant_id,id,version,manifest)
    VALUES ('agency:102','source.extension','1.0.0','{}');
    INSERT INTO crm_studio_settings (tenant_id,menu_layout,updated_at)
    VALUES
      ('agency:101','{"source":"destination"}','2026-09-15'),
      ('agency:102','{"source":"source"}','2026-09-15');
    INSERT INTO assistant_virtual_employees (
      id,agency_id,name,handle,system_prompt,allowed_collections,created_at,updated_at
    ) VALUES (
      'source-employee',102,'Equipo origen','origen','Ayuda al tenant origen.','["*"]','2026-09-15','2026-09-15'
    );
  `;
  for (const statement of statements(fixture)) await env.DB.exec(statement);
});

describe("tenant user invariant migration", () => {
  it("creates the platform tenant and consolidates tenants left without active users", async () => {
    await apply("0046_tenant_user_invariant.sql");

    expect(
      await row<{ id: number; kind: string }>(
        "SELECT id,kind FROM tenants WHERE id=0",
      ),
    ).toEqual({ id: 0, kind: "platform" });
    expect(
      await row<{ tenant_id: number }>(
        "SELECT tenant_id FROM identity_tenant_membership WHERE principal_id='admin'",
      ),
    ).toEqual({ tenant_id: 0 });
    expect(
      await row<{ tenant_id: number }>(
        "SELECT tenant_id FROM identity_tenant_membership WHERE principal_id='orphan'",
      ),
    ).toEqual({ tenant_id: 101 });
    expect(
      await row<{ tenant_id: string }>(
        "SELECT tenant_id FROM crm_records WHERE id='source-record'",
      ),
    ).toEqual({ tenant_id: "agency:101" });
    expect(
      await row<{ tenant_id: string }>(
        "SELECT tenant_id FROM crm_files WHERE id='source-file'",
      ),
    ).toEqual({ tenant_id: "agency:101" });
    expect(
      await row<{ tenant_id: string }>(
        "SELECT tenant_id FROM crm_collection_bindings WHERE object_name='contacts'",
      ),
    ).toEqual({ tenant_id: "agency:101" });
    expect(
      await row<{ tenant_id: string }>(
        "SELECT tenant_id FROM crm_extension_installations WHERE id='source.extension'",
      ),
    ).toEqual({ tenant_id: "agency:101" });
    expect(
      await row<{ tenant_id: string }>(
        "SELECT tenant_id FROM crm_solution_installations WHERE id='source.solution'",
      ),
    ).toEqual({ tenant_id: "agency:101" });
    expect(
      await row<{ tenant_id: string }>(
        "SELECT tenant_id FROM crm_solution_objects WHERE solution_id='source.solution'",
      ),
    ).toEqual({ tenant_id: "agency:101" });
    expect(
      await row<{ agency_id: number }>(
        "SELECT agency_id FROM assistant_virtual_employees WHERE id='source-employee'",
      ),
    ).toEqual({ agency_id: 101 });
    expect(
      await row<{ id: number; tenant_id: number }>(
        "SELECT id,tenant_id FROM agencies WHERE id=101",
      ),
    ).toEqual({ id: 101, tenant_id: 101 });
    expect(
      await row<{ agency_id: number }>(
        "SELECT agency_id FROM agency_contacts WHERE id_slug='source-contact'",
      ),
    ).toEqual({ agency_id: 101 });
    expect(
      await row<{ menu_layout: string }>(
        "SELECT menu_layout FROM crm_studio_settings WHERE tenant_id='agency:101'",
      ),
    ).toEqual({ menu_layout: '{"source":"destination"}' });
    expect(
      await row<{ source_tenant_id: number; target_tenant_id: number }>(
        "SELECT source_tenant_id,target_tenant_id FROM tenant_consolidation_discards WHERE table_name='crm_studio_settings'",
      ),
    ).toEqual({ source_tenant_id: 102, target_tenant_id: 101 });
    expect(
      await row<{ agency_id: number }>(
        "SELECT agency_id FROM document_ownership WHERE document_id='source-document'",
      ),
    ).toEqual({ agency_id: 101 });
    expect(await row("SELECT id FROM tenants WHERE id=102")).toBeNull();
    expect(
      (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  });
});
