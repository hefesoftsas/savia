# Booking wizards

Scope: tenant booking setup and anonymous customer booking. This extends Savia's established visual system rather than changing its global design tokens or product identity.

## Direction

Replace the long setup form with Details, Team, Services, Hours, and Review and publish. On desktop, use a compact step rail and a focused editor. On mobile, keep all five numbered steps in a compact five-column progress row without horizontal scrolling, and show one step's fields. Public booking progresses through Service and professional, Date and time, and Your details. Keep the tenant's supplied title, description and time zone visible.

Use existing Savia components, semantic theme tokens, typography, borders and primary action color in light and dark themes. Use 44px controls, generous space between field groups, short recovery messages, and explicit forward/back actions. Avoid decorative nested cards, invented booking claims and an unrelated visual identity. Progress numbering communicates sequence. Use the existing Lucide icon system only for actions.

## Behavior

Keep edits across steps. Support removing services and professionals in the draft, atomically cleaning removed professional assignments. Persist only on explicit save, preserve reservation history, and restore saved data with Discard changes. Save draft unpublishes; Save settings retains the selected state; Save and publish enables and publishes after validation. Validate all steps before persistence, keeping the API as the authorization and domain validation authority. Preserve version conflicts and API rejection diagnostics.

Weekly hours are edited within setup and in the existing Availability section with the same responsive editor. Preserve date exceptions and explicit personal calendar consent. Preserve public CAPTCHA, availability refresh, idempotent retries and anonymous API access.

## Verification

Interaction tests cover progress, back navigation, removal, assignment cleanup, drafts and invalid weekly hours. Public tests cover the wizard, changed selections, availability refresh and retries. Inspect the actual React surfaces using a local fixture with explicitly illustrative data, at 390px mobile and 1440px desktop, in inherited themes. Review screenshots and check horizontal overflow before integration. The Impeccable context launcher was unavailable, so context and craft-floor guidance were read directly; no global design documents are overwritten.
