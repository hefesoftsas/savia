---
name: Savia Insurance Workbench
description: Shared operational worklists for optional insurance solutions within Savia.
colors:
  background: "var(--background, #fff)"
  foreground: "var(--foreground, #172624)"
  muted-foreground: "var(--muted-foreground, #53645e)"
  border: "var(--border, #dce4df)"
  muted: "var(--muted, #f3f6f4)"
  primary: "var(--primary, #21604b)"
  primary-foreground: "var(--primary-foreground, #fff)"
  danger: "#a62a30"
  danger-surface: "#fff0f0"
  warning: "#81520d"
  warning-surface: "#fff5de"
  success: "#236444"
  success-surface: "#eaf5ef"
  danger-dark: "#ffb6b9"
  danger-surface-dark: "#4b2428"
  warning-dark: "#f7d488"
  warning-surface-dark: "#45391e"
  success-dark: "#a9dfbf"
  success-surface-dark: "#213e30"
typography:
  headline:
    fontFamily: inherit
    fontSize: 1.85rem
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: -0.025em
  title:
    fontFamily: inherit
    fontSize: 1.15rem
  body:
    fontFamily: inherit
    fontSize: 0.875rem
    lineHeight: 1.5
  label:
    fontFamily: inherit
    fontSize: 0.75rem
  field-label:
    fontFamily: inherit
    fontSize: 0.8rem
    fontWeight: 550
  metric:
    fontFamily: inherit
    fontSize: 1.45rem
    fontWeight: 650
    letterSpacing: -0.02em
  scale:
    micro: "11px"
    ui: "16px"
    ui-lg: "18px"
    subtitle: "19px"
    display: "26px"
rounded:
  badge: 5px
  control: 7px
  callout: 8px
  editor: 12px
spacing:
  compact: 0.5rem
  standard: 1rem
  section: 1.5rem
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    padding: 0.55rem 0.8rem
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: 0.55rem 0.8rem
  field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: 0.55rem 0.7rem
  filter-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    padding: 0.4rem 0.65rem
  badge:
    backgroundColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.badge}"
    padding: 0.2rem 0.5rem
  editor:
    rounded: "{rounded.editor}"
---

# Design System: Savia Insurance Workbench

## Overview

**Creative North Star: "The Operational Worklist"**

This package extends Savia's established administrative interface with a shared worklist and a drawer editor. It also hosts the shared shells reused by every insurance screen: the operational workbench (`.iw-workbench`), the provider integration shell (`.insurance-integration`) and the finance shell (`.iw-finance`). All three define the same `--iw-*` token aliases on their root and resolve them from host theme roles. It belongs to optional insurance solutions; it does not define a new application identity or impose an insurance identity on the platform. Theme colors and the font family come from the host.

The visual language is compact, direct and quiet: readable record identities, tabular figures, thin rules and explicit action states. The shipped source is the authority for this record, including the compact mobile metrics and stacked table rows. This is an inherited system capture, not a new visual concept.

**Key Characteristics:**

- Host-controlled theme and typography.
- Flat, rule-separated operational information.
- Compact figures and explicit text states.
- Responsive worklist with a right-side drawer editor.

## Colors

Host theme roles supply the base palette; restrained semantic badge colors distinguish operational states.

### Primary

The host primary color marks the main action, selected priority filter and keyboard focus. The primary foreground supplies its text contrast. Fallback green is compatibility behavior when host tokens are absent, not a fixed brand palette.

### Neutral

Background and foreground carry the work surface and record text. Muted foreground recedes descriptions and labels. Muted surface marks table headings, selected rows, editor headings and notices. Border separates information without extra containers.

The sidecar tonal ramps are synthesized previews of the recorded colors or host-token fallbacks; they are not an additional production palette.

Semantic danger, warning and success pairs are used for text-labelled status badges, with explicit dark-theme counterparts. Neutral badges describe stages without suggesting urgency.

**The Host Theme Rule.** Reuse host theme roles for the workbench shell and actions; keep solution-specific status colors scoped to their semantic states.

## Typography

**Body Font:** Inherited from the Savia host, including controls. No additional display or monospace family is introduced.

The hierarchy uses a compact body, small contextual labels and moderately larger operational headings. Headline, title, body, field-label, label and metric roles are recorded in the frontmatter. The `scale` map is the normative type ramp for all three shells; sizes not tied to a named role resolve to the nearest step (micro 11px, ui 16px, ui-lg 18px, subtitle 19px, display 26px). The title role covers editor and empty-state headings; their weights differ in source and are not standardized here.

Metric values and numeric table cells use tabular figures. Identity text is semibold, with supporting customer or policy information below it. Descriptions allow up to (65ch); empty-state guidance allows (48ch). Mobile headlines reduce to (1.6rem), metric values to (1.2rem), and metric labels use the small label role.

**The Comparable Figures Rule.** Use tabular numerals for totals and amounts; right-align numeric table columns on desktop and left-align them within mobile labelled rows.

## Layout

The workbench is centered with a maximum width of (100rem), desktop padding of (1.5rem) and a main grid gap of (1.5rem). A four-column metric strip uses top and bottom rules plus internal vertical separators. Filters and tools wrap naturally.

When open, the editor slides in from the right as a modal drawer: up to (560px) wide, full viewport height, over a dimmed backdrop. The worklist keeps its layout; nothing reflows or resizes behind the drawer. The heading stays pinned at the top while the body scrolls.

At widths up to (640px), outer padding becomes (1rem 0.5rem), the heading stacks, fields return to one column and footer buttons share the available width. Metrics become a compact two-column strip with gaps of (0.75rem 0.5rem), vertical padding of (0.8rem) and no supplemental detail lines. Labels and values remain visible. Search and stage filters occupy full rows.

On mobile, each table record becomes a two-column grid. Identity and action span both columns; the action button fills its row. Other cells show their column label above their value, and long content wraps. The table header is visually hidden. Preserve table markup, caption and column headings alongside these visual labels.

**The Context Retained Rule.** Keep the worklist visible and unmoved while editing; the editor overlays it as a drawer instead of competing for horizontal space.

## Elevation & Depth

The package adds no shadows to inline content. Thin borders and muted surfaces distinguish sections, selection and editing context. The only elevation is the drawer: a side shadow and a dimmed backdrop that mark it as modal above the worklist. Keyboard focus is an accent outline (2px) with an offset of (3px), not an elevation effect.

**The Quiet Separation Rule.** Separate dense information with rules, spacing and tonal surfaces before adding another container.

## Shapes

Controls use softly rounded corners (control 7px, shared by workbench, integration and finance shells), status badges use a tighter radius (5px), callouts and error notices use (8px), and the editor drawer uses the largest recurring radius (12px). The worklist itself is a ruled table, not a grid of elevated cards. Badges include a circular current-color dot; their written labels carry meaning independently of color.

## Components

### Buttons

Primary actions use the host accent, contrast text and semibold weight. Secondary actions use the base surface with a thin border. Buttons have a minimum height of (40px). Secondary hover uses the muted surface; primary hover darkens with brightness (0.92). Disabled buttons reduce opacity to (0.5) and show an unavailable cursor. Background transitions last (160ms) with ease-out; reduced-motion preference removes transitions.

### Inputs / Fields

Inputs, selects and textareas share control corners, a thin border, host surface and ink, and minimum height (40px). Placeholder text uses muted foreground. Visible labels and optional help text accompany editor fields. Textareas resize vertically. All interactive fields share the accent focus outline.

Connected operations adds discovered single-record relation selectors and agreed coverage-date fields to the same labelled editor. Choices come from backend-authorized records; historical customer and policy text remains a separate snapshot. These fields reuse existing controls and layout.

**The Discovered Fields Rule.** Show relation discovery as a loading status or an explicit error with recovery guidance; keep editor fields and save disabled until discovery succeeds.

### Navigation

Priority filters are wrapping buttons with counts and `aria-pressed` state. The selected priority uses the accent fill; inactive filters use muted text and transparent borders. Editor mode buttons use muted surface and semibold text for selection. These are local controls, not replacement application navigation.

### Chips

Small badges pair a dot with a text label. Semantic tones describe urgency or completion; neutral badges describe stages. Badge text wraps on mobile. Preserve the dark-theme semantic pairs.

### Cards / Containers

The editor is a labelled modal drawer with a bordered, rounded container, a muted sticky heading and consistent inner padding (1.1rem). Its footer is separated by a rule. Opening moves focus into the panel and traps it there; Escape closes it and restores focus to the initiating button. The entry animation slides the panel in over (280ms) with easing (cubic-bezier(0.16, 1, 0.3, 1)); reduced-motion preference drops the animation and the panel becomes static, full-width on narrow viewports.

### Operational Worklist

Identity is the strongest text within each row. Secondary information sits below it. Selected and hovered rows share a muted fill. Desktop overflow is contained by a keyboard-focusable table region; mobile uses the labelled stacked rows described above. Metrics summarize the same worklist without becoming decorative cards.

Issuance, document and service workflows reuse this deadline worklist and labelled inline editor. Their configured fields and states supply context without changing the shared visual system.

**The Footer Context Rule.** Match the list footer to its data: nonfinancial lists show calendar-date context for Bogotá; issuance combines that context with COP units.

Loading, empty, filtered-empty, failure and saved states have distinct text. Errors include recovery, saved feedback uses a polite live region, and loading totals use a dash instead of implying a known zero. Form errors retain editable values.

## Do's and Don'ts

### Do:

- **Do** inherit the host theme and font family.
- **Do** keep explicit text labels alongside status color.
- **Do** preserve compact mobile metrics and labelled stacked rows.
- **Do** retain visible keyboard focus and reduced-motion behavior.
- **Do** keep loading, empty and failed states visually and verbally distinct.

### Don't:

- **Don't** promote optional insurance terminology or fallback colors into Savia's core identity.
- **Don't** replace operational figures with decorative metric cards.
- **Don't** hide record values or actions to make mobile rows fit.
- **Don't** introduce shadows as the default separator for this workbench.
