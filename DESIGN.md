---
name: Olympus
description: Read-only HermesOS Agent Monitor for operational tuning.
colors:
  surface-night: "#08070b"
  surface-panel: "#151923"
  surface-panel-deep: "#0f1119"
  text-primary: "#f6f0df"
  accent-cyan: "#43c9bf"
  accent-gold: "#efc45c"
  warning-red: "#ef6b5a"
  muted-warm: "#b9aa8b"
typography:
  display:
    fontFamily: "Charter, Iowan Old Style, Palatino Linotype, Georgia, ui-serif, serif"
    fontSize: "56px"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "0"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  action-link:
    backgroundColor: "{colors.accent-gold}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  command-card:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "12px"
---

# Design System: Olympus

## 1. Overview

**Creative North Star: "Operator Evidence Console"**

Olympus uses a dense dark command surface with warm text, restrained gold controls, and cyan operational highlights. The visual system feels specific to Hermes agent operations while staying quiet enough for repeated diagnostic use.

The system explicitly rejects generic AI tool marketing, decorative visual elements that do not clarify operational state, a shrunk network diagram with unreadable SVG labels, SaaS landing-page composition, oversized hero copy, dark purple or blue gradient dashboards used as a one-note theme, and any treatment that exposes private local labels by default.

**Key Characteristics:**
- Dark operational canvas with warm readable text.
- Cyan for active or successful runtime signals.
- Gold for ownership links and important controls.
- Red only for warning and failure states.
- Compact cards, clear headings, and stable responsive grids.

## 2. Colors

The palette is a dark operational base with two restrained accents: cyan for live state and gold for action ownership.

### Primary
- **Signal Cyan** (#43c9bf): active work, success, selected cards, and live runtime emphasis.
- **Action Gold** (#efc45c): links, refresh control borders, and important affordances.

### Tertiary
- **Warning Red** (#ef6b5a): failed, stale, blocked, critical, and high-risk states only.

### Neutral
- **Surface Night** (#08070b): page depth and outer background.
- **Panel Night** (#151923): primary card and panel bodies.
- **Panel Deep** (#0f1119): inset panels and dense metrics.
- **Warm Text** (#f6f0df): primary text.
- **Muted Warm** (#b9aa8b): secondary labels, quiet evidence, and metadata.

### Named Rules

**The Evidence Color Rule.** Cyan, gold, and red must map to state or action ownership. Do not add accent colors unless they carry a real data role.

## 3. Typography

**Display Font:** Charter or the platform serif fallback, used only for the Olympus wordmark
**Body Font:** the system UI sans stack
**Label/Mono Font:** no separate mono family in the current dashboard

**Character:** The type is practical and product-native. The Olympus wordmark carries a small amount of identity; dashboard headings, labels, controls, and data use the system UI stack.

### Hierarchy
- **Display** (700, 56px desktop and 42px mobile, 0.95): page title only.
- **Headline** (700, 21px, 1.2): section titles such as Agent Monitor and Agent View.
- **Title** (700, 16px to 24px, 1.15): panel titles, selected profile names, and operational state labels.
- **Body** (400, 13px to 16px, 1.45): explanatory copy, evidence, and panel text.
- **Label** (700, 12px, 0, uppercase): short metric labels only.

### Named Rules

**The Readable Agent Rule.** Never render agent or profile labels as SVG text that scales below 10px. Use HTML text with responsive layout instead.

## 4. Elevation

Olympus uses bordered tonal layering with hard offset shadows on dense cards. Soft floating-card shadows are rare; depth is carried by surface contrast, 1px borders, and compact spacing.

### Shadow Vocabulary
- **Command Offset** (`box-shadow: 4px 4px 0 rgba(8, 7, 11, 0.34)`): repeated operational cards and panes.
- **Hero Depth** (`box-shadow: 0 18px 55px rgba(0, 0, 0, 0.34)`): first-screen hero only.

### Named Rules

**The Flat Workbench Rule.** Panels look placed on the dashboard, not floating as marketing cards.

## 5. Components

### Buttons
- **Shape:** compact rounded rectangle with 6px radius.
- **Primary:** warm gold border, translucent gold background, warm text, and at least 44px practical click height when possible.
- **Hover / Focus:** increase contrast through border or background shift; always preserve a visible focus outline.

### Chips
- **Style:** small state pills with semantic color, compact padding, and readable labels.
- **State:** state names are short and operational: ok, warning, running, idle, active, unknown.

### Cards / Containers
- **Corner Style:** 4px to 8px depending on density.
- **Background:** dark tonal panels, not plain black.
- **Shadow Strategy:** use the Command Offset shadow for dense dashboard panes.
- **Border:** 1px warm or cyan-tinted borders.
- **Internal Padding:** 10px to 16px for dashboard cards; avoid oversized marketing spacing.

### Inputs / Fields
- **Style:** no dedicated input system exists yet.
- **Focus:** future fields use a clear cyan or gold focus outline.
- **Error / Disabled:** use Warning Red for error text and reduced contrast for disabled states.

### Navigation

Navigation is inherited from the Hermes dashboard shell. Olympus does not clone Hermes admin navigation. Handoff links are short, explicit, and point to Hermes-owned routes.

### Pantheon / Agent View

The Agent View uses trigger lanes, agent cards, a selected profile inspector, and an activity feed. It answers which profiles are active, idle, blocked, or risky without shrinking a graph. Mobile stacks the view rather than compressing the whole surface.

## 6. Do's and Don'ts

### Do:
- **Do** show the evidence behind tuning recommendations.
- **Do** keep action links specific to Hermes-owned pages.
- **Do** preserve the dark operational canvas with warm text, cyan state, and gold action ownership.
- **Do** keep Agent View labels readable on desktop and mobile.
- **Do** use real fixture states before adding visual complexity.
- **Do** treat tokens, model usage, and spend as evidence for risk, not as a replacement for Hermes Usage.

### Don't:
- **Don't** use generic AI tool marketing, buzzwords, or feature theater.
- **Don't** add decorative visual elements that do not clarify operational state.
- **Don't** return to a shrunk network diagram with unreadable SVG labels.
- **Don't** rebuild Desktop Command Center Usage or web Analytics.
- **Don't** use SaaS landing-page composition, oversized hero copy, or marketing card grids.
- **Don't** make the dashboard a dark purple or blue gradient one-note theme.
- **Don't** expose hidden local paths, secrets, or raw private labels by default.
