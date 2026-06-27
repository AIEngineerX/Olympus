# Frontend Skill Policy

Research date: 2026-06-06. Last trimmed: 2026-06-07.

Olympus uses frontend skills only when they improve the dashboard's operational
clarity, accessibility, or verification. Do not add broad style packs or install
skills because they look useful in the abstract.

## Current Stack

| Need | Tooling | Status |
| --- | --- | --- |
| Product taste and copy | Product UI review and copy register | Adopted |
| Frontend implementation judgment | `frontend-ui-engineering` guidance | Adopted |
| Browser verification | Playwright visual fixture suite and live smoke | Adopted |
| Security/privacy smoke | `scripts/olympus-security-smoke.mjs` | Adopted |

## Rules

- Keep operational labels as readable HTML, not SVG text.
- Do not add decorative maps, gradients, or motion unless they change an operator decision.
- Do not clone Hermes admin pages.
- Keep links route-specific: `Open Sessions`, `Open Skills`, `Open Kanban`, etc.
- Add fixture coverage before adding visual complexity.
- Evaluate new design or QA skills in a branch before committing them to the repo.

## Install Policy

Do not run skill install commands as part of normal Olympus development. If a
new skill is needed, inspect its `SKILL.md`, license, and file layout first, then
document the reason here before adding it under `.codex/skills/`.
