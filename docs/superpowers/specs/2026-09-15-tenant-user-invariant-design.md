# Tenant–usuario: pertenencia obligatoria

## Objetivo

Hacer que cada usuario de Savia pertenezca a exactamente un tenant y que cada
tenant tenga al menos un usuario activo. La regla incluye a los administradores
de plataforma (superadmins), sin reducir su autorización global.

## Modelo

`identity_tenant_membership` sigue representando la única pertenencia de un
principal. La restricción única de `principal_id` se conserva. La creación,
modificación y autenticación no podrán dejar un principal local sin una fila de
membresía.

La tabla `tenants` distinguirá tenants comerciales de un tenant interno de
plataforma. Este último se crea una vez, no se lista ni se puede editar o borrar
desde la administración comercial, y es el único tenant de los superadmins.
Su membresía expresa pertenencia; el rol global `platform_admin` conserva el
acceso transversal actual.

## Flujos

### Alta de tenant

La creación de un tenant comercial incluirá los datos de su primer usuario y
un rol de tenant. El primer miembro deberá ser activo. La API creará cuenta,
principal, tenant y membresía como una operación compensada: si falla una fase
posterior, eliminará los artefactos creados en las fases anteriores. La UI de
administración presentará estos datos en un solo formulario.

### Gestión de usuarios

Crear un usuario requerirá tenant y rol. El editor ya no permitirá retirar la
única membresía: para cambiar tenant hará una transferencia atómica. El sistema
rechazará eliminar, suspender o remover la membresía del último usuario activo
de un tenant comercial. Antes debe haber otro miembro activo.

Al promover a superadmin, el usuario se mueve al tenant interno. La promoción
falla si sería el último usuario activo de su tenant comercial. Al revocar el
rol de plataforma se exige en la misma solicitud un tenant comercial y su rol;
la cuenta se mueve allí de forma atómica.

## Migración local de datos

La migración se prueba y aplica únicamente contra D1 local durante este trabajo.
No se desplegará ni se hará push.

1. Determinar el tenant comercial activo de menor ID **antes** de crear el
   tenant interno; será el tenant primario de consolidación.
2. Crear idempotentemente el tenant interno de plataforma y trasladar allí las
   membresías de superadmins.
3. Asignar al tenant primario a cada principal ordinario existente que aún no
   tiene membresía.
4. Para cada tenant comercial sin usuarios después del paso anterior, trasladar
   al tenant primario todos los datos asociados a ese tenant y eliminar el
   tenant origen. La migración abarcará cada tabla con clave `tenant_id`,
   incluidas las variantes de namespace `agency:<id>` y sus claves compuestas.
5. Si no existe ningún tenant comercial activo para consolidar, la migración
   fallará con un error explícito y no modificará datos comerciales.

La consolidación preservará el tenant primario, no moverá al tenant interno los
datos comerciales y validará que no queden filas referenciando tenants
eliminados. Si una fila del tenant origen entra en conflicto con una clave
única, un identificador o una definición ya existente en el tenant primario,
prevalece el registro del tenant primario y se descarta el registro origen. La
migración registrará cada descarte en su resultado local de verificación.

## Límites y seguridad

El tenant interno nunca se puede seleccionar para un usuario ordinario, ni
desactivar o eliminar mediante la API de tenants. Los endpoints administrativos
devolverán un conflicto claro para operaciones que romperían los mínimos de
membresía. Los cambios se aplican mediante repositorios y rutas de servidor;
la interfaz solo refleja las reglas y no es la autoridad de validación.

## Verificación

Las pruebas cubrirán:

- migración de superadmins al tenant interno;
- asignación de usuarios sin tenant al tenant primario;
- consolidación de tenants vacíos y de todas sus referencias;
- alta de tenant con su primer usuario y compensación ante fallos;
- rechazo de usuarios sin tenant, de un segundo tenant y de la eliminación o
  suspensión del último miembro;
- transición de entrada y salida del rol superadmin;
- exclusión del tenant interno y obligatoriedad del primer usuario en la UI.

La verificación final ejecutará el conjunto relevante de pruebas de API,
administración y migraciones en local, además de comprobaciones de integridad
referencial posteriores a la migración.
