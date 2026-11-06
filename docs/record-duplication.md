# Duplicate a local record

Open a record and choose **Duplicar** beside **Editar**. Savia reloads the source through the current authorized record transport and opens the collection's existing create form (dialog, drawer, or full page). A failed source read leaves the form closed and displays an error; retry the action after resolving access or connectivity.

Only supported local collections with read and create capabilities expose the action. Native database, external CRM, domain adapters, and managed business records are excluded.

The form copies visible, writable scalar fields present in both the current metadata and source response. It excludes identity and version fields, ownership and audit timestamps, unique, hidden, readonly and formula fields, files and attachments, every relationship, arrays, objects, and unsupported field types. Normal field defaults and validation still apply. Required unique fields must be supplied before saving.

Review the copied values and choose **Guardar registro**. Saving follows the normal create operation, generating an independent record ID and using the existing local IndexedDB/offline synchronization when enabled. The source record is never updated by this action. Relationships and attachments can be added explicitly in the create form.

The unsaved copy is temporary: closing, cancelling, or navigating away discards it. It neither restores nor overwrites an ordinary create draft, and opening or cancelling the copy makes no record write. Existing create drafts remain available in the normal new-record workflow.
