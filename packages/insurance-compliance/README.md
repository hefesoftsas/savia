# Insurance compliance dossiers

This optional solution plugin manages user-configured operational checklists. It does not prescribe legal requirements. Configure a template name and up to 50 distinct requirements, save the versioned template, select a native customer, owner, and due date, then review the missing checklist items before creating them.

Templates persist in backend extension settings with optimistic version checks. Each generated row has a unique customer/template-version/item key. Repeating a preview preserves existing and manually reviewed rows. Execution checks that the template version has not changed; partial failures report the completed count and require another preview. Customer selection and record writes use the current workspace's scoped PluginApi.

Approval requires an evidence reference and review date. Native files can be attached through the saved-record attachment panel. Exemptions require a documented reason and review date. Expired evidence is excluded from readiness and remains visible as overdue; revise the case with renewed evidence and validity. A checklist row records its source template version in the instructions.

Run the package test and typecheck scripts to verify calendar validation, readiness, and checklist keys.
