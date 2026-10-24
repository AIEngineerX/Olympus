---
name: Olympus
description: Manage your Hermes agents.
colors:
  surface: "inherited from the Hermes page"
  panel: "var(--color-card)"
  text: "var(--color-card-foreground)"
  muted-text: "var(--color-muted-foreground)"
  hairline: "var(--color-border)"
  accent: "var(--color-primary)"
  waiting: "var(--color-warning)"
  failure: "var(--color-destructive)"
  success: "var(--color-success)"
  focus: "var(--color-ring)"
typography:
  wordmark:
    fontFamily: "Charter, Iowan Old Style, Palatino Linotype, Georgia, ui-serif, serif"
    fontSize: "26px"
    fontWeight: 600
  heading:
    fontFamily: "inherit (Hermes theme fontSans)"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "inherit (Hermes theme fontSans)"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "inherit (Hermes theme fontSans)"
    fontSize: "12px"
    fontWeight: 600
  numerals: "font-variant-numeric: tabular-nums"
rounded:
  base: "var(--radius)"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
---

# Design System: Olympus

## 1. Overview

**North star: "The Quiet Roster."** One calm list of your agents, each saying in
a word what it is doing, with the ones that need you lifted to the top. It
should feel like Linear's issue list with Stripe's precision, sitting inside
Hermes as if Hermes had shipped it.

## 2. Color

Olympus has no palette of its own. It reads the active Hermes theme through
`--color-*` tokens, so it is native in Hermes Teal, Midnight, Ember, Mono, Rosé
and Nous Blue.

Hermes builds its CSS with Tailwind v4, which emits only the theme variables
Hermes itself uses. `--color-foreground` and `--color-background` do not exist
at runtime: text is `--color-card-foreground` (as `--olympus-fg`) and the page
background is inherited. Use only tokens the Hermes page defines; the visual
tests run against exactly that set.

- **Accent** (`--color-primary`): the live dot, selection, primary buttons.
- **Waiting** (`--color-warning`): "Waiting on you" and the Needs-you banner.
- **Failure** (`--color-destructive`): Failed, Stalled, errors.
- **Success** (`--color-success`): confirmations and "fixed" verdicts only.
- Everything else is foreground, muted foreground and hairline borders.

**The One Signal Rule.** A colour appears only when a state needs attention.
Healthy and idle are plain text.

## 3. Typography

The Hermes theme font for everything except the wordmark. Tabular numerals for
every number. Scale steps of about 1.2: 12 / 14 / 15 / 18 / 26 (wordmark).

## 4. Surfaces and elevation

Flat. Panels are `--color-card` with a 1px `--color-border` hairline and
`--radius` corners. No gradients, glows, glass or shadows. Depth comes only from
the inspector sitting beside the roster.

## 5. Components

- **Roster row:** avatar (initial on a soft tint derived from the profile name),
  name and role, status pill, what it is doing now (task, live tool, elapsed
  time), helper counts, last active, runs per day for 7 days with the
  unsuccessful part marked plus the success rate, and issue count. The row
  opens the inspector.
- **Status pill:** a word plus a dot. Working (accent dot, pulsing), Idle (no
  colour), Waiting on you (warning), Failed (destructive), Stalled
  (destructive), Offline (muted, outlined).
- **Needs-you banner:** warning-tinted panel, top three items with avatar,
  reason and one action, "+N more" to expand.
- **Inspector:** side panel with title row, setup line and controls; Needs
  you, Now (timeline), Scheduled, Kanban, How it's working; a footer of tokens
  per day, Kanban worker success and your fixes.
- **Performance:** a fleet line, runs per day by outcome, one row per agent
  (worst success first), and a run view that lists every step.
- **Confirmation popover:** anchored to the button, states the exact effect,
  Confirm and Cancel. Never a modal.
- **Charts:** hairline axes, tabular labels, one accent plus two muted tints.
  No chart without a labelled unit.

## 6. Identity

- **Laurel mark** beside the serif wordmark in the header.
- **One Greek-key hairline** under the header, drawn in `--color-border`.
- Nothing else decorative.

## 7. Do's and Don'ts

Do keep agents as the subject of every screen; state status in words; confirm
every action with its exact effect; inherit the Hermes theme.

Don't build tile grids of label/number/chip; add colour for decoration; use
gradients, glows, glass or shadows; act without confirmation; show private
labels by default.
