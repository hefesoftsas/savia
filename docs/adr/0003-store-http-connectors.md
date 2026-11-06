# ADR 0003 — Conectores `http` declarativos con secretos del tenant

- Estado: aceptada.
- Fecha: 2026-09-23.
- Continúa a: ADR 0002 (delegación de acciones).

## Contexto

La simulación y la delegación no cubren proveedores directos: un
plugin del store necesita llamar APIs de terceros con credenciales
propias del tenant, sin subir código de servidor.

## Decisión

`store.json` declara `connectors[]` (esquema JSON propio, `secretFields`,
`allowedHosts`) y acciones `kind: "http"` con petición plantilla. El
host:

1. Guarda la conexión cifrada (AES-GCM por tenant, infra existente);
   las lecturas nunca exponen secretos.
2. Al ejecutar, revela en memoria, interpola `{{connection.*}}` y
   `{{input.*}}`, y llama con: solo `https`, sin credenciales en URL,
   sin IP literales/`localhost`/`.local`/`.internal`/metadatos cloud,
   puerto 443, host obligado en `allowedHosts`, `redirect: manual`,
   timeout 20 s, respuesta máxima 1 MB.
3. Devuelve `{ status, data }` con secretos redactados (por nombre de
   clave y valor exacto); persiste runs con input saneado.

## Límites explícitos

- Sin `connectionOptional`, ejecutar exige conexión configurada (422).
- El reenlace DNS hacia IPs privadas no es detectable en el Worker:
  riesgo residual aceptado, mitigado por lo anterior.
- Los secretos no van en la query de la URL (viajan en claro en el
  `fetch` saliente): el validador rechaza `{{connection.<secreto>}}`
  en `request.url`.

## Consecuencias

- Un plugin comprometido solo puede llamar a sus hosts declarados,
  con las credenciales del tenant que lo instaló y dentro de los
  permisos del usuario ejecutor.
- El output persistido nunca contiene secretos con nombres estándar
  ni valores exactos configurados.
