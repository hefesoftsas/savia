# Tenant–usuario obligatorio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantizar localmente que cada usuario de Savia tenga exactamente un tenant y que cada tenant comercial tenga al menos un usuario activo, usando un tenant interno para los superadmins.

**Architecture:** La migración añade un tipo de tenant y crea el singleton interno con ID `0`; normaliza usuarios existentes y consolida tenants comerciales sin miembros en el tenant comercial activo de menor ID. Un servicio de invariantes centraliza asignación, transferencia, promoción y protección del último miembro; las rutas de identidad y tenant lo usan como única autoridad. La interfaz consume los contratos actualizados y nunca expone el tenant interno.

**Tech Stack:** TypeScript, Hono/OpenAPI, Cloudflare D1, Drizzle ORM, Better Auth, React Admin, Vitest, Testing Library, pnpm/Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-15-tenant-user-invariant-design.md`

## Global Constraints

- Trabajar exclusivamente contra D1 local; no hacer `git push`, despliegues ni llamadas a D1 remoto.
- El tenant interno es `tenants.id = 0`, `id_slug = 'savia-platform'` y `kind = 'platform'`; los tenants comerciales tienen `kind = 'commercial'`.
- El destino de consolidación es el tenant comercial activo con menor ID, calculado antes de insertar el tenant interno.
- Todo usuario tiene una sola membresía; los superadmins pertenecen al tenant interno y conservan `platform_admin` como autorización global.
- Un tenant comercial no puede quedar sin miembro activo por las rutas de aplicación.
- Una colisión de migración conserva la fila del tenant destino y descarta la del tenant origen; el resultado de verificación local debe enumerar los descartes.
- Las pruebas se escriben y se observan fallar antes de cada cambio de producción.

---

## File Structure

| Archivo | Responsabilidad |
| --- | --- |
| `packages/db/migrations/0046_tenant_user_invariant.sql` | Añade `tenants.kind`, crea el singleton de plataforma, normaliza membresías, conserva una auditoría de descartes y consolida tenants vacíos con semántica destino-gana. |
| `packages/db/src/core-schema.ts` | Expone `tenants.kind` a Drizzle. |
| `apps/api/src/auth/tenant-membership-invariants.ts` | Define el ID interno, errores tipados, conteos de miembros activos, transferencia atómica y sincronización de membresía de superadmin. |
| `apps/api/src/auth/identity-repository.ts` | Delega altas, cambios de rol, listas y eliminación de membresías en las invariantes. |
| `apps/api/src/auth/better-auth.ts` | Sincroniza la membresía interna al autenticar a un administrador de plataforma. |
| `apps/api/src/routes/identity.ts` | Hace obligatoria la membresía de usuarios ordinarios y protege eliminación, suspensión, transferencias y cambios de superadmin. |
| `apps/api/src/routes/tenants.ts` | Crea un tenant junto con su primer usuario, rechaza el tenant interno y filtra tenants comerciales. |
| `apps/api/src/app.ts` | Entrega el administrador de cuentas de Better Auth a las rutas de tenants. |
| `apps/api/src/routes/data-domains.ts`, `apps/api/src/crm/auto-sync.ts`, `apps/api/src/crm/repository.ts`, `apps/api/src/assistant/configuration-routes.ts`, `apps/api/src/assistant/configuration.ts`, `apps/api/src/routes/dynamic-crm.ts` | Excluyen `kind='platform'` de selectores y operaciones comerciales. |
| `apps/admin/src/api/identity-user-data-provider.ts`, `apps/admin/src/api/identity-client.ts` | Tipan el primer usuario de un tenant y la transferencia obligatoria. |
| `apps/admin/src/features/tenants/index.tsx`, `apps/admin/src/features/users/user-pages.tsx` | Solicitan el primer usuario al crear tenant y reemplazan “Quitar” por transferencia. |
| `apps/api/test/tenant-user-invariant-migration.test.ts` | Ejecuta las migraciones hasta `0045_extensions.sql`, siembra casos previos y verifica `0046` de forma aislada. |
| `apps/api/test/tenant-membership.test.ts`, `apps/api/test/identity.test.ts`, `apps/api/test/tenants.test.ts` | Cubren invariantes en repositorio y HTTP. |
| `apps/api/test/data-domains.test.ts`, `apps/api/test/crm-auto-sync.test.ts`, `apps/admin/src/features/tenants/tenant-pages.test.tsx`, `apps/admin/src/api/identity-user-data-provider.test.ts` | Cubren ocultamiento del tenant interno y contratos de administración. |

## Task 1: Migración local y proyección Drizzle

**Files:**
- Create: `packages/db/migrations/0046_tenant_user_invariant.sql`
- Modify: `packages/db/src/core-schema.ts:22-29`
- Create: `apps/api/test/tenant-user-invariant-migration.test.ts`
- Modify: `apps/api/test/schema.test.ts`

**Interfaces:**
- Produces: `tenants.kind: 'commercial' | 'platform'`, tenant interno con ID `0`, y un estado local en el que ningún `identity_principal` ni tenant comercial carece de la relación exigida.
- Consumes: `identity_principal`, `identity_global_role`, `identity_tenant_membership`, `tenants`, las tablas CRM `tenant_id` y las tablas legadas `agency_id` definidas en las migraciones 0001–0045.

- [ ] **Step 1: Escribir la prueba de migración que debe fallar.**

  Crear un harness que aplique los archivos ordenados hasta `0045_extensions.sql`, siembre dos tenants comerciales (`101`, `102`), un usuario ordinario sin membresía, un superadmin con membresía en `102`, y datos de `102` tanto numéricos como namespace CRM. Aplicar solo `0046_tenant_user_invariant.sql` y afirmar el resultado completo:

  ```ts
  it("creates the platform tenant, normalizes principals, and consolidates an empty tenant", async () => {
    await applyThrough("0045_extensions.sql");
    await env.DB.exec(seedPreInvariantState);
    await applyMigration("0046_tenant_user_invariant.sql");

    expect(await row("SELECT id,kind FROM tenants WHERE id=0")).toEqual({
      id: 0,
      kind: "platform",
    });
    expect(await row("SELECT tenant_id FROM identity_tenant_membership WHERE principal_id='admin'")).toEqual({ tenant_id: 0 });
    expect(await row("SELECT tenant_id FROM identity_tenant_membership WHERE principal_id='orphan'")).toEqual({ tenant_id: 101 });
    expect(await row("SELECT tenant_id FROM crm_records WHERE id='source-record'")).toEqual({ tenant_id: "agency:101" });
    expect(await row("SELECT id FROM tenants WHERE id=102")).toBeNull();
  });
  ```

  Sembrar además una clave duplicada en destino y origen, por ejemplo `crm_studio_settings`, y afirmar que persiste el valor de `agency:101`, no el de `agency:102`, junto con una auditoría `{ source_tenant_id: 102, target_tenant_id: 101, table_name: 'crm_studio_settings' }` en `tenant_consolidation_discards`.

- [ ] **Step 2: Ejecutar la prueba y confirmar el fallo esperado.**

  Run: `pnpm --filter @savia/api test -- tenant-user-invariant-migration.test.ts`

  Expected: FAIL porque no existe `0046_tenant_user_invariant.sql` y la columna `kind` no está disponible.

- [ ] **Step 3: Implementar la migración sin perder el orden de referencias.**

  Añadir `kind` con valor por defecto comercial. Crear el singleton, mover superadmins y asignar huérfanos antes de determinar qué tenants quedan vacíos; así un tenant cuyo único miembro era superadmin también se consolida. Las tablas de consolidación son permanentes para que la migración también sea válida cuando D1 ejecute cada bloque en conexiones separadas:

  ```sql
  ALTER TABLE tenants ADD COLUMN kind TEXT NOT NULL DEFAULT 'commercial'
    CHECK(kind IN ('commercial','platform'));
  INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind)
  VALUES(0,'savia-platform','Plataforma Savia',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'platform');
  ```

  Insertar una membresía ID `platform:` + `principal_id` para cada superadmin que aún no la tenga y después actualizar a `tenant_id=0` sus membresías existentes. Insertar `primary:` + `principal_id` para cada principal no administrador que aún no tenga membresía, usando `SELECT MIN(id) FROM tenants WHERE kind='commercial' AND is_active=1`. Ese `INSERT` falla por `tenant_id NOT NULL` si existe un usuario ordinario sin tenant comercial activo, y no falla en una base recién creada sin usuarios. Nunca asignar un usuario ordinario al tenant `0`. Solo después de estas dos normalizaciones crear el registro permanente de consolidación:

  ```sql
  CREATE TABLE tenant_consolidation_sources(
    source_tenant_id INTEGER PRIMARY KEY,
    target_tenant_id INTEGER NOT NULL,
    consolidated_at TEXT NOT NULL
  );
  INSERT INTO tenant_consolidation_sources(source_tenant_id,target_tenant_id,consolidated_at)
  SELECT t.id,(SELECT MIN(id) FROM tenants WHERE kind='commercial' AND is_active=1),strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM tenants t
  WHERE t.kind='commercial' AND t.is_active=1
    AND t.id<>(SELECT MIN(id) FROM tenants WHERE kind='commercial' AND is_active=1)
    AND NOT EXISTS(
      SELECT 1 FROM identity_tenant_membership m
      JOIN identity_principal i ON i.id=m.principal_id
      WHERE m.tenant_id=t.id AND m.is_active=1 AND i.is_active=1
    );
  ```

  Crear `tenant_consolidation_discards(source_tenant_id INTEGER NOT NULL,target_tenant_id INTEGER NOT NULL,table_name TEXT NOT NULL,record_key TEXT NOT NULL,discarded_at TEXT NOT NULL,PRIMARY KEY(source_tenant_id,table_name,record_key))`. Antes de cada `INSERT OR IGNORE`, insertar una entrada de auditoría por fila fuente que ya tenga una clave equivalente en destino; la prueba debe consultar esta tabla para probar el descarte.

  Copiar primero y borrar después para cada tabla que usa `tenant_id` de texto: `crm_objects`, `crm_records`, `crm_views`, `crm_integrations`, `crm_audit`, `crm_unique_values`, `crm_requests`, `crm_schema_versions`, `crm_schema_data`, `crm_integration_runs`, `crm_notes`, `crm_files`, `crm_file_drafts`, `crm_automations`, `crm_automation_runs`, `crm_tasks`, `crm_collection_sources`, `crm_collection_bindings`, `crm_collection_requests`, `crm_collection_relations`, `crm_record_links`, `crm_native_relation_overrides`, `crm_studio_settings`, `crm_geocoding_settings`, `crm_extension_installations`, `crm_solution_installations`, and `crm_solution_objects`. Para cada fuente usar `agency:` || `source_tenant_id`, para cada destino `agency:` || `target_tenant_id`, y el patrón:

  ```sql
  INSERT OR IGNORE INTO crm_studio_settings(tenant_id,menu_layout,updated_at)
  SELECT 'agency:' || m.target_tenant_id,s.menu_layout,s.updated_at
  FROM crm_studio_settings s JOIN tenant_consolidation_sources m ON s.tenant_id='agency:' || m.source_tenant_id;
  DELETE FROM crm_studio_settings
  WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
  ```

  Aplicar el mismo patrón `INSERT OR IGNORE … SELECT …; DELETE … WHERE columna IN (sources)` a las tablas numéricas con `agency_id`:

  `app_documenttag`, `business_agency_renewal_task_managers`, `agency_branches`, `business_agencycomplementarydata`, `business_agencycompliancemailbox`, `agency_contacts`, `business_allianzconnectionkey`, `business_axaconnectionkey`, `business_bolivarconnectionkey`, `business_chubbconnectionkey`, `business_commercialunit`, `business_defaultcommission`, `business_equidadconnectionkey`, `business_hdiconnectionkey`, `business_mapfreconnectionkey`, `business_previsoraconnectionkey`, `business_qualitasconnectionkey`, `business_renewalconfiguration`, `business_sbsconnectionkey`, `business_seller`, `business_solidariaconnectionkey`, `business_suraconnectionkey`, `business_zurichconnectionkey`, `compliance_complianceprogramtype`, `compliance_compliancerequest`, `compliance_compliancetag`, `compliance_processstepemailtemplate`, `customer_clientagency`, `customer_group`, `customer_prospect`, `financial_statements_accountnormalization`, `financial_statements_agencyauthentication`, `financial_statements_financialreportfile`, `financial_statements_financialreportrequest_agencies`, `financial_statements_financialstatement`, `help_request`, `insurance_agencyshare`, `notification_configuration`, `notification_emailtemplate`, `notification_externalnotification`, `operation_collectionfile`, `operation_payment`, `operation_portfolioreconciliationfile`, `operation_reconciliationfile`, `operation_reimbursementreport`, `operation_task`, `operation_taskassignmentrule`, `operation_tasktag`, `production_data_importproductiondatafile`, `production_data_standardizeinsurer`, `production_data_standardizeramo`, `renewal_initialstepconfig`, `user_user`, `agency_crm_connections`, `agency_crm_connection_audit_events`, `crm_sync_rules`, `assistant_openrouter_settings`, `assistant_active_agencies`, and `assistant_virtual_employees`.

  Mover las filas dependientes de reglas CRM (`crm_sync_jobs`, `crm_sync_mappings`) junto con la regla; borrar primero una regla fuente que choque, lo que elimina sus dependencias, y conservar la regla de destino. Al final borrar los perfiles `agencies` de origen, después sus `tenants`, y ejecutar `PRAGMA foreign_key_check` dentro del test de migración. La sentencia de comprobación debe devolver cero filas.

- [ ] **Step 4: Exponer `kind` en el esquema de aplicación.**

  Añadir la columna al schema con un tipo literal y mantener los demás campos sin cambio:

  ```ts
  export const tenants = sqliteTable("tenants", {
    id: bigint("id").primaryKey().notNull(),
    idSlug: text("id_slug").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["commercial", "platform"] }).notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  });
  ```

  Ampliar `schema.test.ts` para exigir que `tenants` tenga `kind`, que el `CHECK` contenga ambos valores permitidos y que existan `tenant_consolidation_sources` y `tenant_consolidation_discards`; actualizar el total esperado de tablas de `277` a `279`.

- [ ] **Step 5: Ejecutar migración y pruebas locales.**

  Run:

  ```bash
  pnpm --filter @savia/api test -- tenant-user-invariant-migration.test.ts schema.test.ts
  pnpm --filter @savia/api exec wrangler d1 migrations apply savia-agencies --local --config wrangler.jsonc
  pnpm --filter @savia/api exec wrangler d1 execute savia-agencies --local --config wrangler.jsonc --command "PRAGMA foreign_key_check"
  ```

  Expected: pruebas PASS, migración solo local aplicada y la última consulta no devuelve filas.

- [ ] **Step 6: Commit local.**

  ```bash
  git add packages/db/migrations/0046_tenant_user_invariant.sql packages/db/src/core-schema.ts apps/api/test/tenant-user-invariant-migration.test.ts apps/api/test/schema.test.ts
  git commit -m "feat: migrate tenant user invariant"
  ```

## Task 2: Servicio de invariantes de membresía

**Files:**
- Create: `apps/api/src/auth/tenant-membership-invariants.ts`
- Modify: `apps/api/src/auth/identity-repository.ts:1-277`
- Modify: `apps/api/test/tenant-membership.test.ts`

**Interfaces:**
- Produces: `PLATFORM_TENANT_ID`, `TenantMembershipInvariantError`, `assignOrTransferMembership`, `syncPlatformAdministratorMembership`, `assertPrincipalCanLoseActiveMembership`.
- Consumes: `D1Database`, `identity_tenant_membership`, `identity_global_role`, `tenants`.

- [ ] **Step 1: Escribir pruebas de repositorio que fallen.**

  Sustituir los casos que permiten miembros vacíos por pruebas del contrato nuevo:

  ```ts
  it("transfers a member directly without an unassigned state", async () => {
    const principal = await user();
    await grantMembership(env.DB, principal.id, 9101, "viewer");
    await expect(grantMembership(env.DB, principal.id, 9102, "operator"))
      .resolves.toMatchObject({ tenantId: 9102, role: "operator" });
    expect(await listMemberships(env.DB, principal.id)).toEqual([
      expect.objectContaining({ tenantId: 9102 }),
    ]);
  });

  it("rejects removal and deactivation of a tenant's last active member", async () => {
    const principal = await user();
    await grantMembership(env.DB, principal.id, 9101, "tenant_admin");
    await expect(removeMembership(env.DB, principal.id, 9101))
      .rejects.toMatchObject({ code: "LAST_ACTIVE_MEMBER" });
    await expect(setPrincipalActive(env.DB, principal.id, false))
      .rejects.toMatchObject({ code: "LAST_ACTIVE_MEMBER" });
  });
  ```

  Añadir un caso en que una segunda membresía activa permite borrar, y otro donde `syncPlatformAdministratorMembership(d1, principalId, true)` mueve la membresía a `0`.

- [ ] **Step 2: Ejecutar las pruebas y confirmar que fallan.**

  Run: `pnpm --filter @savia/api test -- tenant-membership.test.ts`

  Expected: FAIL porque el repositorio devuelve `TENANT_ALREADY_ASSIGNED` y permite eliminar o suspender al último miembro.

- [ ] **Step 3: Implementar las invariantes y delegar el repositorio.**

  Definir códigos que las rutas puedan convertir en `409`:

  ```ts
  export const PLATFORM_TENANT_ID = 0;
  export class TenantMembershipInvariantError extends Error {
    constructor(
      public readonly code:
        | "LAST_ACTIVE_MEMBER"
        | "PLATFORM_TENANT_RESERVED"
        | "COMMERCIAL_TENANT_REQUIRED"
        | "PRIMARY_TENANT_MISSING",
      message: string,
    ) { super(message); }
  }
  ```

  `assignOrTransferMembership` debe verificar que el destino exista y sea comercial, conservar el ID de membresía al actualizar `tenant_id`, rol, estado y fecha, y ejecutar su lectura y actualización con `d1.batch` para que nunca responda un estado sin tenant. `assertPrincipalCanLoseActiveMembership` contará `identity_tenant_membership` activos del tenant del principal y lanzará `LAST_ACTIVE_MEMBER` si el total es uno. `syncPlatformAdministratorMembership` moverá a `0` al promover, exigirá un destino comercial al revocar y aplicará el mismo guard del último miembro.

  Cambiar `grantMembership`, `removeMembership` y `setPrincipalActive` para usar esas funciones. Mantener `listMemberships` pero devolver siempre el único resultado activo/inactivo del usuario.

- [ ] **Step 4: Ejecutar las pruebas y confirmar que pasan.**

  Run: `pnpm --filter @savia/api test -- tenant-membership.test.ts`

  Expected: PASS; ninguna prueba mantiene la expectativa de usuarios sin tenant o de una transferencia en dos pasos.

- [ ] **Step 5: Commit local.**

  ```bash
  git add apps/api/src/auth/tenant-membership-invariants.ts apps/api/src/auth/identity-repository.ts apps/api/test/tenant-membership.test.ts
  git commit -m "feat: enforce tenant membership invariants"
  ```

## Task 3: Autenticación y API de usuarios obligatorias

**Files:**
- Modify: `apps/api/src/auth/better-auth.ts:220-250`
- Modify: `apps/api/src/routes/identity.ts:96-214, 532-831`
- Modify: `apps/api/test/identity.test.ts:792-810, 1330-1628`
- Modify: `apps/api/test/auth-fixtures.ts`

**Interfaces:**
- Consumes: `syncPlatformAdministratorMembership`, `assignOrTransferMembership`, `assertPrincipalCanLoseActiveMembership`.
- Produces: `POST /v1/identity/users` exige membresía para usuarios ordinarios; `PATCH /v1/identity/users/{principalId}` requiere destino comercial al quitar `platformAdmin`; errores de invariantes usan HTTP 409.

- [ ] **Step 1: Escribir pruebas HTTP que fallen.**

  Añadir estos casos en `identity.test.ts`:

  ```ts
  it("rejects provisioning an ordinary user without a tenant", async () => {
    const response = await app.request("/v1/identity/users", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "no-tenant@test", firstName: "No", lastName: "Tenant", platformAdmin: false }),
    });
    expect(response.status).toBe(400);
  });

  it("moves a promoted administrator to the internal tenant", async () => {
    const response = await app.request(`/v1/identity/users/${memberId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ platformAdmin: true }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.relationships.memberships[0].relationships.tenant.id).toBe("0");
  });
  ```

  Añadir rechazos 409 al eliminar, remover o suspender al único miembro, y un 400 al revocar `platformAdmin` sin `{ membership: { tenantId, role } }`.

- [ ] **Step 2: Ejecutar la prueba y confirmar el fallo.**

  Run: `pnpm --filter @savia/api test -- identity.test.ts`

  Expected: FAIL porque `membership` es opcional, la promoción no mueve membresía y las rutas de cuenta no comprueban el último miembro.

- [ ] **Step 3: Aplicar los contratos y la orquestación mínima.**

  Cambiar el esquema de provisionamiento para requerir `membership` salvo cuando `platformAdmin` sea verdadero; entonces el servidor asigna el tenant `0` e ignora cualquier tenant comercial enviado. Extender PATCH con una membresía opcional y validar la revocación después de cargar el actor destino:

  ```ts
  const updateIdentityUserSchema = z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    platformAdmin: z.boolean().optional(),
    membership: membershipInputSchema.optional(),
  });
  ```

  Después de cargar `targetActor`, si el usuario era superadmin, `input.platformAdmin === false` y no llegó `input.membership`, devolver 400 con `COMMERCIAL_MEMBERSHIP_REQUIRED`; si llegó, ejecutar la transferencia al tenant comercial durante la revocación. En `actorForIdentity`, tras `ensureBootstrapAdministrator`, llamar a `syncPlatformAdministratorMembership(d1, principal.id, hasAdministratorRole(identity.roles))`. En el listado de cuentas, sincronizar cada principal según `account.role === 'admin'` antes de construir su documento. Traducir `TenantMembershipInvariantError` a `{ error: { code, message } }` con estado `409`, proteger `DELETE /memberships`, suspensión y borrado de cuenta antes de llamar a Better Auth, y mantener la regla existente del último superadmin.

- [ ] **Step 4: Ejecutar las pruebas y regenerar contratos.**

  Run:

  ```bash
  pnpm --filter @savia/api test -- identity.test.ts better-auth.test.ts
  pnpm --filter @savia/admin run generate:api
  ```

  Expected: PASS y `apps/admin/src/api/generated/openapi.ts` refleja `membership` obligatorio para usuarios ordinarios y el nuevo `membership` de PATCH.

- [ ] **Step 5: Commit local.**

  ```bash
  git add apps/api/src/auth/better-auth.ts apps/api/src/routes/identity.ts apps/api/test/identity.test.ts apps/api/test/auth-fixtures.ts apps/admin/src/api/generated/openapi.ts
  git commit -m "feat: require a tenant for every user"
  ```

## Task 4: Alta atómica de tenant y primer usuario

**Files:**
- Modify: `apps/api/src/app.ts:27-120`
- Modify: `apps/api/src/routes/tenants.ts:1-280`
- Modify: `apps/api/test/tenants.test.ts`

**Interfaces:**
- Consumes: `IdentityUserAdministrator`, `upsertPrincipal`, `grantMembership`, `deletePrincipal`.
- Produces: `POST /v1/tenants` recibe `{ name, idSlug?, isActive?, initialUser }` y devuelve el tenant comercial creado; no acepta tenants internos ni tenants sin primer usuario.

- [ ] **Step 1: Escribir las pruebas de la nueva ruta.**

  Reemplazar el caso de creación vacía por una creación con primer usuario y una prueba de compensación:

  ```ts
  it("creates a commercial tenant with its first active administrator", async () => {
    const response = await app(identityUserAdministrator()).request("/v1/tenants", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Consultoría", idSlug: "consultoria",
        initialUser: { email: "owner@consultoria.test", firstName: "Ana", lastName: "López", role: "tenant_admin" },
      }),
    });
    expect(response.status).toBe(201);
    const tenant = (await response.json()).data;
    expect(await env.DB.prepare("SELECT role FROM identity_tenant_membership WHERE tenant_id=?").bind(tenant.id).first()).toEqual({ role: "tenant_admin" });
  });
  ```

  Usar un administrador de identidad que lance al crear la cuenta y afirmar que no se insertó tenant; usar uno que falle al asignar la membresía y afirmar que se llamó `deleteUser` y que no queda principal ni tenant.

- [ ] **Step 2: Ejecutar la prueba y confirmar el fallo.**

  Run: `pnpm --filter @savia/api test -- tenants.test.ts`

  Expected: FAIL porque el esquema de tenant no acepta `initialUser` y `registerTenantRoutes` no recibe un administrador de identidad.

- [ ] **Step 3: Implementar la creación compensada.**

  Cambiar la dependencia de la ruta y el cableado de `createApp`:

  ```ts
  export function registerTenantRoutes(
    app: OpenAPIHono,
    db: D1Database,
    userAdministrator?: IdentityUserAdministrator,
  ): void
  ```

  Hacer `initialUser` estricto con `email`, `firstName`, `lastName`, `role` y `temporaryPassword?`; fijar `platformAdmin: false` al llamar `createUser`. Crear la cuenta Better Auth, reservar el ID de tenant, insertar solo `kind='commercial'`, crear el principal y ejecutar `grantMembership`. En el `catch`, eliminar en orden la membresía/principal D1, el tenant y la cuenta Better Auth creada. Eliminar también `initialUser` de la respuesta. Rechazar GET, PATCH, DELETE y CRM dinámico para `kind='platform'`; las consultas de tenants comerciales incluyen `t.kind='commercial'`.

- [ ] **Step 4: Ejecutar pruebas de ruta y contrato.**

  Run:

  ```bash
  pnpm --filter @savia/api test -- tenants.test.ts identity.test.ts
  pnpm --filter @savia/admin run generate:api
  ```

  Expected: PASS; un payload sin `initialUser` obtiene 400 y una ruta con ID `0` no expone el tenant interno.

- [ ] **Step 5: Commit local.**

  ```bash
  git add apps/api/src/app.ts apps/api/src/routes/tenants.ts apps/api/test/tenants.test.ts apps/admin/src/api/generated/openapi.ts
  git commit -m "feat: create tenants with an initial user"
  ```

## Task 5: Excluir el tenant interno de todas las superficies comerciales

**Files:**
- Modify: `apps/api/src/routes/data-domains.ts:96-142`
- Modify: `apps/api/src/crm/auto-sync.ts:51-116`
- Modify: `apps/api/src/crm/repository.ts:157-170`
- Modify: `apps/api/src/assistant/configuration-routes.ts:96-118`
- Modify: `apps/api/src/assistant/configuration.ts:338-395`
- Modify: `apps/api/src/routes/dynamic-crm.ts:35-55`
- Modify: `apps/api/test/data-domains.test.ts`
- Modify: `apps/api/test/crm-auto-sync.test.ts`

**Interfaces:**
- Consumes: `tenants.kind`.
- Produces: todos los selectores y rutas comerciales usan `kind='commercial'`; el permiso global no convierte el tenant interno en un dominio CRM seleccionable.

- [ ] **Step 1: Escribir las pruebas que fallen.**

  Sembrar el tenant ID `0` y comprobar que los administradores de plataforma no lo reciben:

  ```ts
  expect((await domainsResponse.json()).data).not.toContainEqual(
    expect.objectContaining({ id: "tenant:0" }),
  );
  expect((await listSyncRules(env.DB, platformActor)).tenants)
    .not.toContainEqual(expect.objectContaining({ id: 0 }));
  expect((await app.request("/v1/dynamic-crm/0/api/objects")).status).toBe(404);
  ```

- [ ] **Step 2: Ejecutar las pruebas y confirmar el fallo.**

  Run: `pnpm --filter @savia/api test -- data-domains.test.ts crm-auto-sync.test.ts`

  Expected: FAIL porque las consultas actuales filtran solo `is_active`.

- [ ] **Step 3: Añadir el filtro comercial en cada consulta.**

  En cada consulta de lectura, añadir la misma condición antes de los filtros de permisos:

  ```sql
  SELECT t.id,t.name
  FROM tenants t
  WHERE t.kind='commercial' AND t.is_active=1
  ```

  Para rutas que reciben un ID, usar `WHERE id=? AND kind='commercial' AND is_active=1`. No sustituir las comprobaciones de capacidad existentes; solo reducir el conjunto que puede ser seleccionado.

- [ ] **Step 4: Ejecutar las pruebas y typecheck de API.**

  Run:

  ```bash
  pnpm --filter @savia/api test -- data-domains.test.ts crm-auto-sync.test.ts
  pnpm --filter @savia/api exec tsc --noEmit
  ```

  Expected: PASS y cero errores de TypeScript.

- [ ] **Step 5: Commit local.**

  ```bash
  git add apps/api/src/routes/data-domains.ts apps/api/src/crm/auto-sync.ts apps/api/src/crm/repository.ts apps/api/src/assistant/configuration-routes.ts apps/api/src/assistant/configuration.ts apps/api/src/routes/dynamic-crm.ts apps/api/test/data-domains.test.ts apps/api/test/crm-auto-sync.test.ts
  git commit -m "feat: hide the platform tenant from commerce"
  ```

## Task 6: Contratos y pantallas administrativas

**Files:**
- Modify: `apps/admin/src/api/identity-client.ts`
- Modify: `apps/admin/src/api/identity-user-data-provider.ts`
- Modify: `apps/admin/src/api/identity-user-data-provider.test.ts`
- Modify: `apps/admin/src/features/tenants/index.tsx`
- Modify: `apps/admin/src/features/tenants/tenant-pages.test.tsx`
- Modify: `apps/admin/src/features/users/user-pages.tsx`

**Interfaces:**
- Consumes: contratos OpenAPI regenerados y `POST /v1/tenants.initialUser`.
- Produces: formulario de alta de tenant con primer administrador; transferencia de usuario en un solo submit; ningún control ofrece retirar el único tenant ni crear un usuario ordinario sin tenant.

- [ ] **Step 1: Escribir pruebas de cliente y UI que fallen.**

  Añadir al proveedor una expectativa de que `initialUser` se conserva al crear tenant. Cambiar el test de pantalla para afirmar los campos obligatorios y la transferencia:

  ```tsx
  await user.type(await screen.findByLabelText("Correo del primer administrador"), "owner@equipo.test");
  await user.click(screen.getByRole("button", { name: /Guardar/ }));
  await waitFor(() => expect(appServices.dataProvider.create).toHaveBeenCalledWith(
    "tenants",
    expect.objectContaining({ data: expect.objectContaining({ initialUser: expect.objectContaining({ role: "tenant_admin" }) }) }),
  ));
  expect(screen.queryByRole("button", { name: "Quitar" })).not.toBeInTheDocument();
  ```

  Cambiar la prueba del editor de usuario para seleccionar `102` y esperar `grantMembership("principal-one", { tenantId: 102, role: "tenant_admin" })`.

- [ ] **Step 2: Ejecutar las pruebas y confirmar el fallo.**

  Run:

  ```bash
  pnpm --filter @savia/admin test -- tenant-pages.test.tsx
  pnpm --filter @savia/admin test -- identity-user-data-provider.test.ts
  ```

  Expected: FAIL porque el formulario no contiene los campos de primer usuario y el selector de tenant está deshabilitado para usuarios ya asignados.

- [ ] **Step 3: Implementar los formularios obligatorios.**

  En `TenantCreate`, usar un bloque `initialUser.*` con nombres, apellidos, correo, contraseña temporal opcional y `role` cuyo valor inicial es `tenant_admin`. Conservar `TenantEdit` sin esos campos. En `UserInitialAccessFields`, eliminar “opcional”, `emptyText="Sin tenant asignado"` y la opción de no asignar tenant para usuarios ordinarios; al marcar superadmin, mostrar texto de que será asociado a “Plataforma Savia” y no enviar un tenant comercial.

  En `UserMembershipEditor`, habilitar el selector aunque exista membresía, eliminar `removeMembership`, y cambiar el botón a “Transferir tenant” cuando el ID elegido difiera. Mantener “Actualizar rol” cuando el destino sea el mismo. El proveedor conservará `initialUser` al enviar tenants y enviará `membership` en PATCH al revocar `platformAdmin`.

- [ ] **Step 4: Ejecutar pruebas, generación y build local.**

  Run:

  ```bash
  pnpm --filter @savia/admin test -- tenant-pages.test.tsx identity-user-data-provider.test.ts
  pnpm --filter @savia/admin run typecheck
  pnpm --filter @savia/admin run build
  ```

  Expected: PASS, tipos OpenAPI regenerados y build local exitoso.

- [ ] **Step 5: Commit local.**

  ```bash
  git add apps/admin/src/api/identity-client.ts apps/admin/src/api/identity-user-data-provider.ts apps/admin/src/api/identity-user-data-provider.test.ts apps/admin/src/features/tenants/index.tsx apps/admin/src/features/tenants/tenant-pages.test.tsx apps/admin/src/features/users/user-pages.tsx apps/admin/src/api/generated/openapi.ts
  git commit -m "feat: require tenant users in admin"
  ```

## Task 7: Verificación integral local y revisión de migración

**Files:**
- Modify only if a verification exposes a defect in one of the files de Tasks 1–6.
- Create: none.

**Interfaces:**
- Consumes: implementación completa y datos locales desechables.
- Produces: evidencia reproducible de que la migración, invariantes y UI funcionan sin tocar infraestructura remota.

- [ ] **Step 1: Ejecutar las suites específicas completas.**

  Run:

  ```bash
  pnpm --filter @savia/api test -- tenant-user-invariant-migration.test.ts tenant-membership.test.ts identity.test.ts tenants.test.ts data-domains.test.ts crm-auto-sync.test.ts
  pnpm --filter @savia/admin test -- tenant-pages.test.tsx identity-user-data-provider.test.ts
  ```

  Expected: PASS para todos los archivos.

- [ ] **Step 2: Aplicar todas las migraciones únicamente a D1 local.**

  Run:

  ```bash
  pnpm --filter @savia/api exec wrangler d1 migrations apply savia-agencies --local --config wrangler.jsonc
  pnpm --filter @savia/api exec wrangler d1 execute savia-agencies --local --config wrangler.jsonc --command "SELECT id,name,kind FROM tenants ORDER BY id"
  pnpm --filter @savia/api exec wrangler d1 execute savia-agencies --local --config wrangler.jsonc --command "SELECT t.id FROM tenants t WHERE t.kind='commercial' AND NOT EXISTS(SELECT 1 FROM identity_tenant_membership m JOIN identity_principal p ON p.id=m.principal_id WHERE m.tenant_id=t.id AND m.is_active=1 AND p.is_active=1)"
  pnpm --filter @savia/api exec wrangler d1 execute savia-agencies --local --config wrangler.jsonc --command "PRAGMA foreign_key_check"
  ```

  Expected: aparece exactamente un tenant ID `0` de tipo `platform`; las dos últimas consultas no devuelven filas.

- [ ] **Step 3: Ejecutar la verificación de tipos, formato y conjunto de pruebas del workspace.**

  Run:

  ```bash
  pnpm typecheck
  pnpm lint
  pnpm test:unit
  ```

  Expected: todos los comandos terminan con código `0`.

- [ ] **Step 4: Revisar el diff antes del commit final.**

  Run:

  ```bash
  git diff --check HEAD~6..HEAD
  git status --short
  git log --oneline -6
  ```

  Expected: sin errores de espacios; únicamente los commits locales de esta función; ningún `push` ni modificación remota.

- [ ] **Step 5: Mantener la historia local limpia.**

  No crear un commit vacío. Si una verificación del Task 7 exige una corrección, aplicar el ciclo rojo-verde al archivo de su tarea de origen y crear un commit concreto con `fix:` que nombre esa conducta; volver a ejecutar los Steps 1–4 de este task después del commit.
