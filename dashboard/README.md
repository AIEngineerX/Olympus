# Olympus Dashboard Package

This directory is the Hermes dashboard plugin package for Olympus: one
read-only FastAPI router, one hand-authored frontend, and the package metadata
Hermes uses to mount the tab.

## Files

- `manifest.json`: plugin metadata, tab path, frontend assets, backend module.
- `plugin_api.py`: read-only FastAPI router mounted by Hermes.
- `dist/index.js`: hand-authored SDK React frontend registered with the Hermes plugin SDK.
- `dist/style.css`: `olympus-*` styles for the dashboard surface.
- `docs/BUILD_PLAN.md`: implementation plan and product boundary notes.
- `docs/HERMES_DESKTOP_INTEGRATION.md`: Desktop plugin parity and Usage boundary notes.
- `docs/PRODUCTION_READINESS.md`: production gates, risks, and compatibility.
- `docs/VIEWPORT_STRATEGY.md`: visual QA strategy for Pantheon and mobile.
- `docs/FRONTEND_SKILL_RESEARCH.md`: design/QA skill decision record.

## Routes

Hermes mounts the backend at `/api/plugins/olympus/`.

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness and coarse runtime health. |
| `GET /overview` | Full dashboard read model: health, tuning, profiles, gateways, cron, sessions, Kanban, performance, skill hygiene, config policy, and evidence sources. |
| `GET /tuning` | Tuning-focused read model with score details, Kanban intelligence, skill hygiene, config policy, performance, and evidence sources. |

Routes sit behind Hermes dashboard session-token middleware. The frontend calls
them through the Hermes plugin SDK.

## Data Rules

- Read-only: no task moves, profile edits, gateway changes, shell actions, or
  config writes from HTTP routes.
- No secret values in responses.
- No local paths in public responses.
- Session IDs and private labels are redacted unless local labels are explicitly
  enabled.
- Gateway configuration detection reads `.env` variable names only, never values.
- Config policy reports safe counts and flags only. It must not return prompt
  text, base URLs, API keys, env values, or local paths.
- Unknown state stays `unknown`.
- Attention items are severity-sorted before truncation.

## Local Labels

Default behavior hides local session titles, Kanban task titles, cron names,
exact route labels, paths, and session IDs.

Private-machine opt-in:

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=1 hermes dashboard --no-open --skip-build
```

## Frontend Rules

- Pantheon uses HTML text and accessible profile buttons, not SVG text or an image-role
  wrapper around interactive controls.
- Empty evidence sections stay hidden instead of rendering filler panels.
- Refresh and interval loads ignore stale responses so older `/overview` calls
  cannot overwrite newer data.
- Operational Evals are deterministic checks from Hermes evidence. They do not
  claim answer quality or benchmark quality.
- Usage and cost totals stay in Hermes Command Center Usage or Analytics.
  Olympus shows cost only as risk, policy, or handoff evidence.
- Action links point to Hermes-owned routes: `/analytics`, `/config`, `/cron`,
  `/kanban`, `/logs`, `/profiles`, `/sessions`, or `/skills`.

## Verify

For local development:

```bash
npm run dev
```

Run from the repository root:

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:performance
npm run test:security
npm run test:desktop
npm audit --audit-level=moderate
```

`npm run test:visual` runs fixture-backed desktop/mobile checks across noisy,
healthy, empty, overloaded, stale, high-cost, and no-labels states.

`npm run test:live` opens the real Hermes dashboard route. It will reuse an
existing Hermes dashboard only when the served HTML includes the Hermes session
token. If it needs to start Hermes and your plugin target already points
somewhere else, set `OLYMPUS_SMOKE_RELINK=1`.

`npm run test:security` fetches the live `/overview` payload through the Hermes
session-token flow and fails on local paths, raw database filenames,
workspace/cwd keys, or secret-like strings.

`npm run test:performance` fetches the live `/overview` and `/tuning` payloads
several times through the Hermes session-token flow and fails on non-2xx
responses, slow local response time, backend diagnostic budget warnings, or
payloads above the documented budget.

`npm run test:desktop` checks the local Hermes Desktop app, Command Center Usage
ownership, web dashboard plugin support, and Desktop plugin-tab parity status.
