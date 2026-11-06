# Extended localization implementation

Extend the existing ES/EN/PT core contract to shipped insurance extensions,
authored HTML/text/React surfaces and structured external failures. Keep stored
business values and raw provider details unchanged. Retain drafts across language
changes. This implements the user's explicit request to extend the prior scope.

1. Add pure shared translation/content/error primitives and an optional React
   locale context; expose locale and translation through the plugin SDK.
2. Bridge the existing host locale to extension components without remounting.
3. Localize reusable workbench controls and authored insurance configurations.
4. Localize bespoke quote, portfolio and integration extension screens.
5. Add optional authored content translations and sandbox locale/translation API.
6. Expand catalog/source coverage and add switching, fallback, escaping and
   external error tests. Run targeted tests first, then typechecks and affected
   package suites with limited concurrency. Document exact support and limits.
