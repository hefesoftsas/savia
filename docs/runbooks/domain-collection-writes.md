# Escritura de colecciones enlazadas

Las colecciones `agency-network/agency-profiles` y `customer-portfolio/customer-profiles` del dominio Plataforma anuncian crear, actualizar y eliminar. El adaptador usa una lista explícita de comandos y mapea los campos del CRM a sus parámetros. Otros dominios conservan sus capacidades de lectura; un diseño no puede habilitar escrituras arbitrarias.

`domain-collection-writes.ts` actualiza los enlaces existentes de forma transaccional, conserva etiquetas y distribución, agrega los campos de escritura ausentes y aumenta la versión del objeto. Las colecciones nuevas reciben el mismo contrato al enlazarse. Los campos técnicos y derivados siguen siendo de solo lectura.

El CRM envía POST, PATCH y DELETE sobre `/api/records/:coleccion/:id`. Las ediciones de formularios enlazados solo envían campos modificados. Clientes reutiliza la preparación de cambios parciales del dominio para conservar información importada; agencias acepta parámetros parciales en su comando de actualización. Las creaciones siguen validándose con los esquemas completos de los comandos existentes.

Eliminar es permanente y requiere confirmación en el editor. Las dependencias existentes impiden eliminar una agencia. La eliminación de la agencia y de su información de propiedad ocurre en una transacción, que se revierte si hay dependencias. No se copian los registros a `crm_records`.

Validación: pruebas de API para agencias y clientes naturales/jurídicos, restricciones de dependencias, formularios y TypeScript. Prueba de navegador con creación, edición y eliminación de un cliente temporal, seguida de comprobación de limpieza en D1.
