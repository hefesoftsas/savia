# SECOP integration retired

The SECOP tender plugin and source preset have been retired from Savia. New
packages no longer include the plugin. Migration `0061_retire_secop_plugin.sql`
archives its installed package metadata, executable artifacts and authoring
sources before removing them from the active plugin catalog and installations.
Saved business collections, records, documents, notifications and source grants
remain intact. Generic MCP sources, plugin monitors and assistant capabilities
remain available to other plugins.

The separate SECOP infrastructure repository owns the external service. Its
retirement must preserve D1, R2, KV and durable state; no data destruction is part
of this change. Savia's cost guard retains pause protections while that service
is retained. Scheduled Savia cleanup no longer deletes SECOP dossier records.
