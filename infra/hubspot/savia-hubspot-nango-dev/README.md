# Aplicación OAuth de HubSpot para pruebas de Savia

Este proyecto corresponde a `savia-hubspot-nango-dev` en la cuenta desarrolladora
`51971251`, aplicación `51788399`. La cuenta CRM de pruebas es `51969008`.
Los identificadores públicos se conservan para actualizar la aplicación existente.

La configuración se recuperó de la compilación 1 y se amplió para el CRM conectado.
La compilación 3 se publicó correctamente. El permiso antiguo `tickets` fue
reemplazado por `crm.objects.tickets.read` y `crm.objects.tickets.write`.

Desde este directorio, con la cuenta desarrolladora autenticada:

```sh
npx --yes --package @hubspot/cli hs project validate --account=51971251
npx --yes --package @hubspot/cli hs project upload --account=51971251
```

Los permisos de `src/app/app-hsmeta.json` deben coincidir con los solicitados por
la integración `hubspot` del entorno `dev` de Nango. Publicar permisos no actualiza
tokens existentes: el usuario debe reconectar desde Savia y autorizar la cuenta
CRM correcta. Verificar después los permisos realmente concedidos y consultas
del proveedor; no deducir permisos de escritura a partir de una lectura exitosa.

Las credenciales de la CLI viven fuera del repositorio. No guardar claves,
tokens ni secretos OAuth en estos archivos.
