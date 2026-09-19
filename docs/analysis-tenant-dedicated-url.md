# URL dedicada por tenant estilo Slack — Análisis de viabilidad

Worktree: `.worktrees/tenant-dedicated-url`
Branch: `feat/tenant-dedicated-url-analysis`
Base: `main @ 6bc371b`
Fecha: 2026-09-17
Pregunta: ¿podemos tener `https://savia.merkaseguros.app.hefesoft.com/#/my-day` como URL dedicada del tenant `merkaseguros`?

## 1. Veredicto corto

**Sí, es viable, pero NO con ese formato exacto tal cual.** El formato propuesto `savia.<tenant>.app.hefesoft.com` es el punto más débil de la propuesta, no el código de Savia.

Problema: `savia.merkaseguros.app.hefesoft.com` son **dos niveles** por debajo de `app.hefesoft.com`. Un wildcard Cloudflare `*.app.hefesoft.com` solo cubre **un nivel** (`merkaseguros.app.hefesoft.com`, pero no `savia.merkaseguros.app.hefesoft.com`). Para soportar el formato propuesto necesitarías:

- un wildcard de segundo nivel (`*.*.app.hefesoft.com`, no soportado como custom domain simple en Workers), o
- Cloudflare for SaaS (custom hostnames por tenant + certificados por hostname), o
- crear un DNS + custom domain manual por cada tenant.

Las tres son posibles, pero convierten un feature barato en uno caro/operativo.

**Recomendación:** si quieres “como Slack” (`<workspace>.slack.com`), usa:

```
https://merkaseguros.savia.app.hefesoft.com/#/my-day
```

en lugar de:

```
https://savia.merkaseguros.app.hefesoft.com/#/my-day   ← evitar
```

Con `*.savia.app.hefesoft.com` cubres todos los tenants con **un solo registro DNS + un solo custom domain wildcard + un solo certificado**, sin aprovisionar nada por tenant. Es el patrón Slack real.

Alternativa cero-DNS si hay prisa:

```
https://savia.app.hefesoft.com/#/t/merkaseguros/my-day
```

## 2. Estado actual (por qué hoy no funciona)

Verificado en este worktree:

1. **Un solo dominio público.** `apps/admin/wrangler.production.jsonc:6-11` y `scripts/render-cloudflare-production-config.mjs:134-156` fijan un único `pattern: savia.app.hefesoft.com`. `apps/api/wrangler.production.jsonc:36-40` fija `SAVIA_PUBLIC_ORIGIN / SAVIA_API_RESOURCE / SAVIA_OAUTH_ISSUER = https://savia.app.hefesoft.com`.
2. **Frontend same-origin.** `apps/admin/src/app-services.ts:14` hace `VITE_SAVIA_API_URL ?? window.location.origin`. `apps/admin/src/app.tsx:119,178` igual. Esto es bueno: si el gateway responde en el subdominio, el frontend ya llamaría al API del mismo origen sin CORS. Pero hoy el gateway solo escucha en el dominio canónico.
3. **Gateway sin noción de tenant.** `apps/admin/src/edge-gateway.ts:10-28` solo bifurca por path (`/api/*`, `/v1/*`, … → `env.API`, resto → `ASSETS`). Nunca mira `Host`. El hash `#/my-day` ni siquiera llega al Worker (los fragmentos no se envían al servidor), así que todo el routing tenant tiene que resolverse en el JS con `window.location.hostname`.
4. **Auth anclada a un solo origen.**
   - `apps/auth/src/index.ts:149`: `trustedOrigins: [origin de SAVIA_ADMIN_REDIRECT_URI]`. Un solo origen.
   - `apps/auth/src/oauth.ts:496-519` (`oauthRuntime`): exige `SAVIA_SCALAR_REDIRECT_URI` en el mismo origen que `BETTER_AUTH_URL`, y `SAVIA_ADMIN_REDIRECT_URI` es un único valor. El cliente OAuth `Savia Admin` se crea con `redirect_uris: [único]` (`ensureAdminOAuthClient`, `ensureFixedClientRedirectUri` sobrescribe a 1 valor).
   - `apps/api/src/auth/admin-oauth.ts:131-141` (`corsHeaders`): solo responde `access-control-allow-origin` si `Origin === origin exacto de client.redirectUri`. Con N subdominios, N-1 fallarían el refresh/callback/logout.
   - Cookies: `savia.admin_refresh_token` (`Path=/api/auth/admin`, `SameSite=Lax`, sin `Domain`, sin partición por tenant) y `savia.session_token*` (`Path=/`). Sin `Domain=.savia.app.hefesoft.com` no hay SSO entre subdominios; con `Domain` compartido hay que pensar hijacking entre tenants.
5. **Tenant ya tiene slug, pero no es DNS-safe ni reservado.** `packages/db/src/core-schema.ts:22-30`: `tenants.id_slug UNIQUE NOT NULL`. `apps/api/src/routes/tenants.ts:226`: si no se envía `idSlug`, se guarda `crypto.randomUUID()` — inservible como subdominio. No hay normalización (minúsculas, `^[a-z0-9-]`, longitud, punycode), ni lista de reservados (`api`, `auth`, `www`, `admin`, `savia`, `next`, `docs`…), ni bloqueo de cambio una vez en uso como hostname.
6. **Autorización ya es por membership, no por hostname.** `apps/api/src/routes/tenants.ts:144-164`, invariante tenant-usuario (un usuario → un solo tenant). Esto simplifica: el hostname sería *hint* + enforcement UX, la seguridad real sigue en el access token. Pero hoy nadie valida `Host` vs `tenantId` del token, hay que añadirlo para evitar que `merkaseguros.` muestre datos de otro tenant por error de navegación / phishing.

## 3. Opciones comparadas

### Opción 0 — Path por tenant (sin DNS)
`https://savia.app.hefesoft.com/#/t/merkaseguros/my-day`

- Pros: 0 cambios DNS/TLS/Auth. Solo frontend + redirect. Funciona mañana.
- Contras: no es “como Slack”. La URL no es dedicada a nivel DNS.
- Esfuerzo: S (1–2 días). Buen paso intermedio aunque se quiera subdominio después.

### Opción A (recomendada) — Subdominio Slack-like con wildcard de un nivel
`https://merkaseguros.savia.app.hefesoft.com/#/my-day`

- DNS: un `CNAME *.savia.app.hefesoft.com → savia.app.hefesoft.com` (o A/AAAA). Un certificado wildcard `*.savia.app.hefesoft.com`.
- Cloudflare Workers: una ruta wildcard o custom domain `*.savia.app.hefesoft.com` en el Worker `savia` (gateway). `wrangler.jsonc` + `render-cloudflare-production-config.mjs` deben emitirla.
- Gateway: leer `new URL(request.url).hostname`, extraer `<tenant>`, añadir header `x-savia-tenant-hint` al binding `API`, y servir los mismos assets para todos.
- Frontend: `resolveTenantFromHostname()` → si hostname termina en `.savia.app.hefesoft.com` y tiene 4 labels, slug = labels[0]; si es `savia.app.hefesoft.com` → sin hint (flujo actual); validar contra `/v1/identity/me` + `/v1/tenants`; si mismatch → pantalla “Estás en el espacio de X, tu cuenta pertenece a Y” + botón ir a canónica.
- Auth: pasar a cookies con `Domain=.savia.app.hefesoft.com` (SSO) o mantener host-only (login por subdominio, más aislado pero más fricción). Ampliar `trustedOrigins` y `corsHeaders` a “origen termina en `.savia.app.hefesoft.com` + https”. Registrar `redirect_uris` por subdominio o relajar `ensureFixedClientRedirectUri` a lista (hoy sobrescribe a 1).
- Esfuerzo: M (1–2 semanas con pruebas auth + e2e). Costo operativo ~0 por tenant nuevo.

### Opción B — Formato literal pedido `savia.<tenant>.app.hefesoft.com`
- Técnicamente posible solo con Cloudflare for SaaS (custom hostnames bajo demanda, validación TXT/CNAME por tenant, emisión ACM por hostname, webhook de estado) o alta manual por tenant.
- Cada tenant nuevo = llamada API Cloudflare + espera de certificado (minutos-horas) + reintentos + observabilidad + runbook. Falla el “crear tenant = INSERT en D1”.
- Además `SAVIA_API_RESOURCE` como `resource` OAuth dejaría de ser único por entorno; hay que decidir si el `aud` del access token es el canónico o el del subdominio (rompe validación actual en `betterAuthAuthenticator` / `oauthResource` si no se toca).
- Esfuerzo: L (3–5 semanas + costo SaaS + mantenimiento). No aporta nada UX vs Opción A.
- Solo elegir si marketing/contrato exige ese string exacto.

### Opción C — Custom domains propios del cliente (`app.merkaseguros.com`)
- Es el paso natural después de A. Requiere for SaaS de todos modos. No mezclar con este análisis; dejar tabla `tenant_domains` preparada desde ahora (`tenant_id, hostname, status, verified_at`) aunque A no la necesite.

## 4. Cambios concretos si se aprueba A

1. **Datos:** migración D1: normalizar `tenants.id_slug` existentes (lowercase, slugify, resolver colisiones), añadir `CHECK(id_slug GLOB '[a-z0-9-]*')`, tabla `tenant_domains` futura, reservados en código + test. Decidir si `idSlug` es inmutable una vez usado como hostname (recomendado: inmutable o con redirect 301 de 30 días).
2. **`render-cloudflare-production-config.mjs` + `wrangler.*.jsonc`:** emitir `*.savia.app.hefesoft.com` como custom domain del gateway; mantener `savia.app.hefesoft.com` como canónica. Variables `SAVIA_PUBLIC_ORIGIN` (canónica) + nueva `SAVIA_TENANT_BASE_SUFFIX=.savia.app.hefesoft.com`.
3. **`edge-gateway.ts`:** parsear hostname, propagar `x-savia-tenant-hint`, añadir `Vary: Host`, no cachear HTML por host de forma cruzada, tests unitarios (`isServicePath` ya tiene tests; añadir `tenantFromHostname`).
4. **Admin:** nuevo módulo `tenant-host.ts` + banner de mismatch + branding por tenant (nombre/logo) + `finishCallback` (`app.tsx:111-114` hoy hace `replaceState /#/my-day` perdiendo el host — debe preservar `window.location.origin`). Cuidado con `admin.tsx:53` (telemetría con hostname, bien).
5. **API:** middleware que compara `tenant-hint` vs `actor.memberships[0].tenantId → slug`; si hay hint y no coincide → 403 con `TENANT_HOST_MISMATCH` + `canonicalUrl`. Logging con hostname.
6. **Auth:** `trustedOrigins: [/\.savia\.app\.hefesoft\.com$/]` o lista dinámica; `corsHeaders` con sufijo en vez de igualdad exacta; `redirect_uris` múltiples; cookies con `Domain` compartido + `__Host-` reconsiderado; `adminLoginUrl`/`passwordResetEmail` deben construir URLs con el host de entrada, no con el canónico fijo. Revisar `oauth.ts:223-226` (prohíbe `*` en redirect — bien, habrá que registrar cada subdominio o cambiar a validación por sufijo, decisión de seguridad explícita).
7. **Local:** `*.localhost` no resuelve sin `/etc/hosts` o `lvh.me`; documentar `merkaseguros.localhost:5173` + `VITE_SAVIA_API_URL` en `scripts/dev-local.sh`.
8. **Seguridad:** rate-limit por host, anti-enumeración de slugs (responder igual en 404 tenant inexistente vs sin acceso), cabeceras `Content-Security-Policy: frame-ancestors` por host, recordar que `*.workers.dev` no debe exponerse.

## 5. Riesgos / no-go si no se resuelven

- Sesión cruzada entre tenants si se comparte `Domain` sin `TENANT_HOST_MISMATCH` estricto.
- Phishing `merkaseguroz.savia...` — mitigar con brand check + lista de slugs oficiales en login.
- OAuth: si se permite cualquier subdominio como redirect sin allowlist contra D1, se abre redirect-uri confusion. Debe validarse contra `tenants.id_slug` activos.
- Renombrar `idSlug` rompe URLs bookmarkeadas. Hacer inmutable o tabla de alias.

## 6. Plan sugerido (en este worktree si se aprueba)

1. Fase 0 (esta semana, sin DNS): implementar `/t/:slug` + `tenant-host.ts` + mismatch banner detrás de flag. Valida 80% del UX.
2. Fase 1: wildcard `*.savia.app.hefesoft.com` en staging (`savia-next`), e2e auth cross-subdomain, cookies `Domain`, CORS por sufijo.
3. Fase 2: prod + comunicar canónica permanente `savia.app.hefesoft.com` como fallback + docs de onboarding (“tu espacio vive en `<slug>.savia.app.hefesoft.com`”).
4. Fase 3 (solo si el negocio lo pide): Cloudflare for SaaS para `savia.<tenant>.app...` literal o dominios propios.

## 7. Respuesta a “¿y merkaseguros?”

- Hoy `merkaseguros` no existe como `id_slug` reservado/validado; primero hay que crear/normalizar el tenant con `idSlug=merkaseguros` (único, minúsculas).
- Con Opción A quedaría `https://merkaseguros.savia.app.hefesoft.com/#/my-day` en ~1 sprint.
- Con el formato literal `https://savia.merkaseguros.app.hefesoft.com/#/my-day` quedaría igual UX pero con costo SaaS + aprovisionamiento por tenant. Si el requisito es contractual, decirlo explícito y presupuestar Opción B.

---
*Análisis solo-lectura. Ningún cambio de prod aplicado desde este worktree.*

## 8. Auditoría de autenticación para subdominios (2026-09-17)

Flujo actual verificado:

1. Frontend (`BetterAuthOAuthSession.login`) redirige a `GET /api/auth/admin/authorize` en el mismo origen.
2. API crea transacción PKCE (`admin_oauth_transactions`, 5 min) y redirige a Better Auth (`/api/auth/oauth2/authorize`).
3. Usuario hace login + MFA en páginas de `apps/auth` (`oauth-pages.ts`, `credentials: same-origin`).
4. Better Auth devuelve `code+state` al `redirectUri` único (`SAVIA_ADMIN_REDIRECT_URI`).
5. Frontend hace `POST /api/auth/admin/callback` con `credentials: include` → API cambia code por tokens y fija cookie `savia.admin_refresh_token` (`Path=/api/auth/admin`, `SameSite=Lax`, host-only).
6. Access token (5 min, en memoria JS) + refresh vía `POST /api/auth/admin/refresh` con CORS exacto (`corsHeaders` compara `Origin === origin de redirectUri`).

Puntos que se rompen con `*.savia.app.hefesoft.com` si no se tocan (archivos entre paréntesis):

- **E1. Callback con redirect_uri desconocido.** `apps/auth/src/oauth.ts:ensureAdminOAuthClient + ensureFixedClientRedirectUri` deja un solo `redirect_uris`. Login desde `merkaseguros.` → Better Auth rechaza (`redirect_uri_mismatch`). Síntoma: bucle login → error OAuth.
- **E2. CORS bloquea callback/refresh/logout.** `apps/api/src/auth/admin-oauth.ts:131-141` solo permite el origen exacto canónico. Síntoma en consola: `CORS Missing Allow Origin`, refresh 401 aunque la cookie exista.
- **E3. Cookie de refresh no viaja entre subdominios.** Hoy es host-only (sin `Domain`). Login en canónica no sirve en `merkaseguros.` y viceversa. Síntoma: pide login en cada subdominio. Si se pone `Domain=.savia.app.hefesoft.com` sin enforcement, E9.
- **E4. Cookie de sesión Better Auth (`savia.session_token*`) igual que E3.** Afecta `/api/auth/get-session`, avatar, `sign-out`, MFA (`same-origin` en `oauth-pages.ts:153`).
- **E5. `trustedOrigins` único.** `apps/auth/src/index.ts:149`. Peticiones desde subdominio → CSRF rechazado.
- **E6. `resource`/`aud` único.** `SAVIA_API_RESOURCE=https://savia.app.hefesoft.com` se valida como `audience` en `oauth-resource.ts:121`. Si el token se emite para el canónico y la API del subdominio espera el subdominio (o al revés) → `AUTHENTICATION_REQUIRED` en todos los `/v1/*`.
- **E7. Links de email con origen equivocado.** `sendPasswordReset` (`apps/auth/src/index.ts:451-454`) y `adminLoginUrl` (`:82-91`) construyen URLs con el canónico fijo. Usuario pide reset desde `merkaseguros.` y recibe link a la canónica → confusión + pierde contexto tenant.
- **E8. Callback frontend pierde el host.** `apps/admin/src/app.tsx:111-114` hace `replaceState /#/my-day` (bien, preserva host) pero `PasswordResetPage` y botón error usan `window.location.origin` como vuelta — revisar cada `replace/assign` para no mandar al canónico.
- **E9. Sesión cruzada entre tenants.** Con `Domain` compartido, la cookie de A se envía a B. Sin chequeo `Host vs membership` en API, un bookmark malicioso `otro.savia...` podría mostrar datos equivocados o filtrar por `Referer/Origin`. Mitigación obligatoria: middleware `TENANT_HOST_MISMATCH` (403 + URL canónica correcta) + `Vary: Host`.
- **E10. Transacción PKCE reutilizada en otro host.** `admin_oauth_transactions` guarda `redirect_uri` pero no `host de inicio`. Atacante podría iniciar en su subdominio y canjear en otro. Guardar `initiated_host` y exigir igualdad en `consumeTransaction`.
- **E11. Enumeración de tenants.** Si el error distingue “subdominio no existe” vs “sin acceso”, se puede cosechar clientes. Responder idéntico + login genérico sin brandear existencia.
- **E12. Slugs peligrosos.** Sin normalización hay `Admin.savia...` vs `admin.savia...`, `api`, `auth`, `docs`, `www`, guiones inicial/final, IDN homógrafos. Bloquear reservados + `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` + inmutable tras primer uso (o tabla alias).
- **E13. Logout parcial.** `POST /api/auth/admin/logout` limpia `Max-Age=0` solo en el host que responde. Con `Domain` compartido hay que limpiar con el mismo `Domain/Path`; si no, queda sesión fantasma en el otro subdominio. Además `revokeUserSessions` es global — definir si “salir” es por dispositivo o global.
- **E14. MFA/consent con `same-origin`.** Los `fetch(..., credentials: same-origin)` de `oauth-pages.ts` fallan si login y API quedan en orígenes distintos (p.ej. auth centralizado). Mantener login bajo el mismo subdominio o pasar a `include` + CORS.
- **E15. Scalar/docs.** Cliente `Savia Scalar` tiene su propio `redirectUri` único; si se expone docs por subdominio, repetir E1 para ese cliente.
- **E16. `.well-known` y `openapi.json`.** Devuelven `issuer/resource/authorizationUrl` canónicos (`publicAuthUrls(request.url, SAVIA_PUBLIC_ORIGIN)` en `apps/api/src/index.ts:188`). Clientes externos cachean el canónico: correcto, pero documentar que el canónico sigue siendo el issuer oficial aunque la UI sea por subdominio.
- **E17. Rate-limit y lockout por host.** El lockout MFA (5 intentos/15 min) y el `DELETE admin_oauth_transactions expiradas` son globales; un atacante puede rotar subdominios para evadir límites por host. Límites por cuenta + IP, no solo por host.
- **E18. Localhost.** `*.localhost` no resuelve; documentar `lvh.me` o entradas hosts + `SAVIA_ADMIN_REDIRECT_URI` múltiple en `scripts/dev-local.sh:71`.

Decisiones mínimas antes de implementar:

1. Cookie compartida (`Domain=.savia.app.hefesoft.com`, SSO) + E9/E10/E13 implementados, o host-only (login por subdominio, más fricción, menos riesgo cruzado).
2. `redirect_uris` = allowlist contra `tenants.id_slug` activos (nunca `*`), validación por sufijo + lookup D1.
3. `aud/resource` = canónico único siempre; el subdominio es solo hint UX, no cambia el token.
4. `id_slug` inmutable + reservados + normalización en migración.
