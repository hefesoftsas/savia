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

The employee editor has two explicit modes. **Text only** processes the supplied
text and employee instructions without workspace collections, documents, MCP
tools, employee knowledge-file retrieval, or workspace business guidance. The
employee's model and custom instructions remain available. An empty
`allowedCollections` list represents this mode. The editor hides the collection
and knowledge-file tabs and saves that empty list. Chat clients can also request
`responseMode: "text"` for a single-step response with no tools, including when
the selected employee has workspace access. That request keeps trusted attached
context and the credential-safety rule while using task-result-only prompt
handling.

**Workspace tools** enables access to workspace capabilities. Its collection
allowlist is checked in addition to tenant ownership; choose one or more
collections or explicitly enable all collections. Switching from text-only mode
starts with no workspace grants, and the editor asks for an explicit scope before
saving. Employees cannot grant access to another tenant's collections.

Existing employees with a nonempty collection allowlist remain in Workspace tools
mode with their current scope when edited. A Spanish-to-English translator
template in employee management opens a text-only draft with an active status,
the default model, and three translation styles. Review and save it through the
normal creation form; selecting the template never overwrites an existing
employee. Pages lets the reader choose which labeled translation style to show;
its preview shows all three translations under the exact numbered headings.
Replace, insert, and copy use only the selected version and remove its heading.
If the `traductor` handle is unused, Pages can create the employee and select it
for the request.

Invoking an unknown, inactive, or out-of-scope employee ID returns an
unavailable/not-found result without substituting another employee.

See [Remote MCP](../remote-mcp.md) for connecting external clients and the
employee discovery and invocation tools.

Only platform administrators and administrators of the employee's organization
can assign an explicit model when creating an employee or change or clear its
model assignment when editing it. Other users
can keep the inherited model and choose administrator-enabled alternatives in
Pages **Ask AI**. Enabling alternatives does not change the employee's default.

On small screens, the employee editor keeps its title and save/cancel actions
visible while the form scrolls independently. Tabs wrap into complete rows
without covering fields; all access modes and sections remain available.
