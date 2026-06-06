# Product

## Register

product

## Users

Olympus is used by HermesOS operators and builders who need to understand how multiple agents, profiles, skills, sessions, Kanban workers, cron jobs, and gateways are behaving. They are usually scanning for the next operational action: tune, route, unblock, or review.

## Product Purpose

Olympus is HermesOS Agent HQ. It reads local Hermes runtime evidence, ranks what needs attention, explains the reason, and links to the Hermes page that owns the fix. The v1 product remains read-only: it does not mutate tasks, profiles, cron, gateways, routes, memory, credentials, or config.

Success means an operator can answer the core question in one pass: what should I tune, route, unblock, or review so my HermesOS agents perform better?

## Brand Personality

Calm, exact, operational.

The interface should feel like a serious command surface for real agent work: confident, evidence-led, and readable under pressure. It can have a distinctive Olympus identity, but the identity must serve diagnosis rather than decoration.

## Anti-references

- Generic AI tool marketing, including vague promises, buzzwords, and feature theater.
- Decorative visual elements that do not clarify operational state.
- A shrunk network diagram with unreadable SVG labels.
- SaaS landing-page composition, oversized hero copy, and card grids that look like marketing blocks.
- Dark purple or blue gradient dashboards used as a one-note theme.
- Hidden local paths, secrets, or raw private labels unless explicitly enabled.

## Design Principles

1. Evidence first. Every recommendation should show the signal behind it.
2. Read-only until approved. Olympus recommends, explains, and links before it writes.
3. Operator scanability. The page should reveal risk, workload, and ownership without requiring a diagram decoder.
4. Hermes owns the fix. Actions should link back to Hermes-owned pages unless a future write action is explicitly approved.
5. Local privacy by default. Labels and paths stay redacted unless the operator opts in on a private machine.

## Accessibility & Inclusion

Target WCAG 2.2 AA for contrast, keyboard access, focus states, and responsive behavior. The Agent View must remain readable on mobile and desktop without microscopic text. Motion must be nonessential and respect reduced-motion preferences.
