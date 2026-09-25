# Application navigation

Owner: Platform UI team. Reviewed: 2026-09-19.

The default sidebar separates daily work, application building, workspace administration, and platform administration. Industry-specific pages remain configurable solution content; the platform does not assume insurance or CRM entities.

| Area           | Default destinations                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Work           | My day, available solution pages, reports                                                                         |
| Build          | Screens, data sources, workflows, integrations/API, Savia Request, AI employees, connections, packages/extensions |
| Administration | Users, roles and permissions, keys/services, workspace identity, domain history                                   |
| Platform       | Tenants, when permitted                                                                                           |

Personal account actions include profile, personal connections, appearance, language, installation and sign-out. Installation has one persistent location. Appearance uses the existing server-backed preferences. The data-domain selector displays the current domain name and truncates on narrow screens.

## Visibility and search

Three independent controls determine discoverability:

1. Domain screen metadata determines whether a screen is eligible for the menu. Screens outside the menu remain available through authorized links.
2. Personal `hiddenItems` controls which eligible destinations the member sees in their sidebar.
3. Existing authorization determines which destinations enter the navigation registry. Menu visibility is not an access-control mechanism.

Menu search includes authorized, personally hidden destinations. These results are labeled as hidden from the personal menu and can be opened without changing preferences. The explicit Show action restores the destination using the preferences API; failed saves restore the last confirmed state. Search also indexes domain tool aliases such as automations, collections and audit. Domain-hidden screens are still managed from Screens rather than added to personal search results.

## Existing preferences

The layout schema remains version 2 and accepts optional `presetVersion: 2`. A legacy personal layout is upgraded once in the client, and only source groups whose built-in item sequence still matches the old default are eligible: My day moves from the former Productivity group to Work, Savia Request moves from Administration to Build, Users moves from Management to Administration, and screen administration moves from Management to Build. Explicitly reordered built-in source groups, items placed in other groups, custom groups, hidden items and collapse state are retained. Customized layouts can opt into the complete new grouping with Reset. The preset marker is saved through the backend with the next explicit preference change; no browser-storage fallback is added. Reset uses the new default grouping.

The historical section IDs remain stable: `operation` = Work, `productivity` = Build, `administration` = Administration, `management` = Platform. Screen configuration and spreadsheet import use the same display labels.

## Return speed (in-memory only)

Studio keeps one query client in memory per session+domain and reuses it when
returning to the same domain; it is cleared on logout, user change, lost
authorization or domain deletion. `/bootstrap` runs on the first entry per
domain (again after reload, failure or domain change), never blocking a
return. Savia Request keeps folders, summaries, the open flow and the step in
memory when leaving the route, and revalidates them in the background on
return; tenant, permission or session changes clear them immediately. Studio
and Savia Request modules preload when the browser is idle and the user has
access. The API stays the source of truth; compare returns with
`scripts/navigation-perf/measure-navigation.mjs` and
`scripts/navigation-perf/baseline.json`.

## Direct destinations

Domain tool links retain the current domain. Workflows and reports open specific operations tabs, packages open their administration tab, and AI employees open their integrations tab. Tab selection is URL-addressable and browser Back/Forward restores it. See [screen administration](runbooks/screen-administration.md#addressable-navigation-tabs) for supported query parameters.

Deploy the API preference contract together with the admin changes so newly addressable tool IDs and the preset marker round-trip correctly. Insurance cotizadores and quote record models are unchanged; consolidation requires a separate functional comparison.
