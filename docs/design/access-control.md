# Access control editor

## Overview

This is an Operate surface for inspecting and changing workspace access. It
extends the existing React Admin and shadcn interface described in
`apps/admin/PRODUCT.md`. Shared theme tokens and components remain the visual
authority; this scoped record introduces no global design system or new palette.

The composition keeps workspace context visible, separates role definitions from
member assignments, and places record conditions beside the fields they grant.
Copy states the consequences of changes in direct operational language.

## Colors

Use the inherited background, foreground, muted, border, ring, primary, and
destructive roles. Muted text explains constraints; muted fills identify the
selected role and group an action's rules. Primary styling identifies saving.
Destructive styling is reserved for deletion and error text. Status is also
expressed with words, selection attributes, or disabled controls.

## Typography

Inherit the admin font. The page heading uses the shared large semibold treatment
(24px); section headings are smaller (18px). Resource titles and selected role
labels use medium weight. Form labels, explanatory text, and tabular grants use
the compact body treatment (14px); role annotations use smaller text (12px).

## Layout

The centered page has a maximum width of 72rem, with 16px padding increasing to
24px on wider screens. The title and workspace selector share a wrapping header.
Roles and Members tabs precede their content.

At the medium breakpoint, role navigation occupies a 14rem column beside a fluid
editor, separated by 24px. On narrow screens navigation stacks above the editor.
Role name and display name share two columns from the small breakpoint and stack
below it. Actions, fields, and condition controls wrap. Resource sections use
dividers rather than enclosing every section in a card.

The Members view places user selection before custom-role assignments and the
current effective-grants table. The table has a local horizontal overflow region.

## Elevation & Depth

The surface is predominantly flat. Borders divide resources and deletion from
editing; a light muted fill groups each action's conditions and allowed fields.
Inputs, tabs, and buttons retain the shared components' subtle elevation.

## Shapes

Reuse the inherited medium corner radius for inputs, selectors, navigation items,
and rule groups. Nested condition groups use an indented left border to expose
their relationship. Standard labeled checkboxes keep action and field selection
compact and recognizable.

## Components

- **Workspace and navigation:** workspace selection resets the selected role.
  Roles show explicit protected or disabled annotations; the active item exposes
  its current state to assistive technology. The empty editor invites selection
  or creation of a role with no initial access.
- **Role editor:** protected roles remain visible for inspection with disabled
  fields and an explanation. Custom roles expose identity, description, enabled
  state, resource actions, and saving. Deletion sits below a divider and requires
  a second action after explaining assignment removal.
- **Grant editor:** selecting an action reveals its rule group with no initially
  allowed fields. Collection rules support all records, creator scope where
  available, a condition, and nested all/any condition groups. Allowed fields
  remain inside their action's rule so record scope and field access stay linked.
  Restricted sources explain that their existing rules remain in effect.
- **Members:** assign multiple custom roles while keeping protected roles and
  existing membership separate. Disabled unassigned roles cannot be added.
  Assignment controls wait for their current revision before permitting saves.
- **Effective permissions:** display server-returned current grants by resource,
  action, fields, and record scope. This is saved-state evidence, not a preview of
  unsaved checkbox changes. Loading, failure, and no-grant states are explicit.
- **Feedback:** loading and success use status messages; errors use alerts.
  Failed role or assignment saves retain the current draft in the mounted editor.
  Offline and pending states disable mutations; the role editor explains the
  connection requirement. Invalid record conditions prevent saving.

## Do's and Don'ts

- Do preserve inherited themes, shared controls, visible keyboard focus, labels,
  and semantic field groups.
- Do keep the workspace and protected-role constraints visible during inspection.
- Do describe access as additive grants whose fields depend on matching records.
- Don't present unsaved selections as effective server permissions.
- Don't replace the responsive editor with a wide permission grid or introduce
  decorative cards that obscure resource and rule relationships.

Evidence: the five access-control components under
`apps/admin/src/features/access-control/` and desktop/mobile fixture captures at
`/tmp/savia-acl-visual/desktop.png` and `/tmp/savia-acl-visual/mobile.png`.
The captures show the role editor; Members behavior above is recorded from source.
