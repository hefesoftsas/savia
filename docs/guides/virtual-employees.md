# Virtual AI employees

Virtual employees belong to one commercial tenant. Their instructions,
knowledge files, and collection allowlists stay within that tenant. Employees
created by a platform administrator in the platform workspace are platform
defaults; Savia does not automatically share them with commercial tenants.

Employee discovery, detail, edits, deletion, file upload and removal, chat, and
MCP invocation all resolve against the same tenant scope. A caller with one
active commercial membership can use that tenant when no active tenant has been
saved. A caller with multiple or no active memberships must select an authorized
tenant. Platform administrators without a selected tenant operate on platform
employees and platform collections.

The employee's collection allowlist is checked in addition to tenant ownership.
Employees cannot grant access to another tenant's collections. Invoking an
unknown, inactive, or out-of-scope employee ID returns an unavailable/not-found
result without substituting another employee.

See [Remote MCP](../remote-mcp.md) for connecting external clients and the
employee discovery and invocation tools.
