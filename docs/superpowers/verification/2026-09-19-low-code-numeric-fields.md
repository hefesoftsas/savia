# Low-code numeric fields verification

The Percentage and Rating changes passed full repository type checking and
contract checks. Focused verification passed:

- CRM shared: 157 tests.
- CRM server: 158 tests.
- Dynamic CRM API, including generated field schemas: 10 tests.
- Numeric controls, filters, form saving and designer palette: 8 tests.
- Role editor, including numeric permission literals: 5 tests.

Browser verification used the real controls with synthetic data. A percentage
edit persisted 35.25, arrow-key navigation changed a rating from 3 to 4, and
clearing it produced null. Desktop and mobile layouts were inspected. Temporary
preview files were removed. A read-only review confirmed fixes for numeric
permission serialization and generated schema types.

The global `pnpm test` run was stopped after these seven admin failures. A clean
baseline comparison was not performed, so their cause is not established:

`src/components/admin/app-sidebar.test.tsx`:

- reorders individual pages and restores their saved section
- shows dynamic pages as direct menu links without synthetic agencies or CRM group
- shows page administration under Gestión with the current domain
- finds a CRM object when searching the menu

`src/app.test.tsx`:

- opens the unified service credentials screen from its protected route
- changes the signed-in user's password with their current password
- lets the signed-in user disable their active MFA with their current password

The global suite is not green. No merge, push or deployment was performed for
these field changes.
