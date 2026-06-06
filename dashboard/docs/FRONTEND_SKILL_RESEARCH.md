# Frontend Design Skill Decision Record

Research date: 2026-06-06.

This record captures which external design and frontend QA skills are useful for
Olympus work. The goal is practical: keep the dashboard readable, accessible,
visually stable, and specific to Hermes operations.

## Best Skill Candidates

| Priority | Repo | Skill | Why It Matters For Olympus | Status |
| --- | --- | --- | --- | --- |
| 1 | `pbakaus/impeccable` | `impeccable` / `frontend-design` | Strong taste layer: typography, color, spatial design, motion, interaction, responsive design, UX writing, commands, and explicit anti-pattern rules. Useful for keeping Olympus out of generic dashboard patterns. | Adopted for audit |
| 2 | `addyosmani/agent-skills` | `frontend-ui-engineering` | Production UI engineering guidance from a strong frontend authority: accessibility, performance, polish, component architecture, and avoiding generated-looking UI. | Evaluate |
| 3 | `joshuadavidthomas/agent-skills` | `frontend-design-principles` | Good product-specific taste prompt. Pushes domain, color world, signature element, and named defaults to reject. Useful for Olympus because the visual needs Hermes/Olympus-specific identity. | Adapt into local guidance |
| 4 | `currents-dev/playwright-best-practices-skill` | `playwright-best-practices` | Best fit for the visual QA gate already added. Covers visual regression, accessibility, console-error capture, mobile testing, flaky tests, and performance testing. | Strong install candidate |
| 5 | `mblode/agent-skills` | `ui-audit`, `ux-audit`, `typography-audit`, `ui-animation` | Good focused audit skills for motion, typography, layout, UX failure modes, and frontend polish. | Evaluate |
| 6 | `supercent-io/skills-template` | `frontend-design-system`, `design-system`, `web-accessibility`, `responsive-design` | Broad practical frontend pack. Useful if Olympus needs design tokens, component rules, accessibility, and responsive standards as separate skills. | Evaluate |
| 7 | `nextlevelbuilder/ui-ux-pro-max-skill` | `ui-ux-pro-max` | Very broad style and UX reference: many style presets, color palettes, font pairings, chart types, and product-type rules. Useful for ideation, but needs restraint so Olympus does not become style soup. | Reference only unless curated |
| 8 | `am-will/codex-skills` | `frontend-design`, `frontend-responsive-ui`, `vercel-react-best-practices` | Convenient Codex/agent pack with frontend, responsive UI, and React best-practice skills. | Secondary source |
| 9 | `vadimcomanescu/codex-skills` | `design/frontend-design`, `platform/react-best-practices` | Simple installable Codex skill catalog. Useful if we want a lightweight frontend-design and React-basics install. | Secondary source |
| 10 | `vipulgupta2048/codex-skills` | `frontend-design` | Focused Codex frontend design skill with aesthetic directions and implementation patterns. | Secondary source |

## Best Reference Repos For Taste

These are not skills, but they are useful for standards, visual QA, and design
system examples.

| Repo | Why It Matters |
| --- | --- |
| `Correia-jpv/fucking-awesome-design-systems` | Huge design-system index with stars/forks, useful for finding mature references such as Chakra, Fluent, Carbon, Polaris, Elastic UI, Shoelace, Cloudscape, and U.S. Web Design System. |
| `streamich/awesome-styleguides` | Curated styleguide list with references like Primer, Polaris, Radix, Carbon, GitLab Pajamas, and React Aria. |
| `CMSgov/design-system` | Strong production reference for accessibility and Playwright-based visual regression workflows. |
| `greatfrontend/awesome-front-end-system-design` | Useful for frontend system design and component-level tradeoffs. |
| `jbranchaud/awesome-react-design-systems` | React design-system index. Good for examples of component APIs and repeated UI patterns. |

## Recommended Olympus Stack

Use these first:

1. `pbakaus/impeccable` for taste, anti-patterns, typography, color, layout, and
   design critique.
2. `currents-dev/playwright-best-practices-skill` for visual QA and responsive
   testing discipline.
3. `addyosmani/agent-skills/frontend-ui-engineering` for production UI
   engineering rules.
4. `joshuadavidthomas/frontend-design-principles` as a local Olympus taste brief:
   domain, color world, signature element, and defaults to reject.

For Olympus specifically, do not blindly install every design skill. Too many
style packs will conflict. The better path is to install or adapt one taste skill,
one QA skill, and one production UI engineering skill, then encode Olympus-specific
rules in `VIEWPORT_STRATEGY.md`.

## Olympus Taste Rules To Extract

- No tiny SVG text for operational labels.
- No decorative maps unless the visual changes an operator decision.
- No generic gradients or one-note purple/blue palettes.
- No nested card stacks as the main dashboard language.
- Use readable typography and stable density for repeated operational work.
- Give Olympus one signature element: live operational state cards tied to Hermes
  evidence, not abstract constellation diagrams.
- Keep visual QA mandatory: desktop, mobile, console, overflow, and text-size
  checks.

## Candidate Install Commands For Evaluation

These commands are for evaluation, not automatic production adoption:

```bash
npx impeccable skills install
npx skills add currents-dev/playwright-best-practices-skill
npx skills add supercent-io/skills-template --skill frontend-design-system
npx skills add mblode/agent-skills --skill ui-audit
npx skills add mblode/agent-skills --skill typography-audit
npx codex-skills-registry@latest --skill=design/frontend-design --yes
```

Before installing project-local skills, inspect their `SKILL.md`, license, and
install layout. If copied into this repo, keep them under `.codex/skills/` only
after deciding they should be part of Olympus' committed workflow.
