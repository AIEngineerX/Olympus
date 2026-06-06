# Olympus Production Readiness

Olympus is not production-ready until it proves the dashboard is safe,
observable, visually legible, and compatible with the Hermes dashboard version it
is mounted into.

## Current Gaps

| Area | Missing | Production bar |
| --- | --- | --- |
| Visual QA | Keep screenshots and fixture coverage current as the dashboard changes. | Desktop and mobile fixture tests run in CI and attach screenshots. |
| Hermes compatibility | Hermes dashboard, Kanban, skill, and plugin behavior is moving quickly. | Track the Hermes version tested and rerun plugin smoke tests after each Hermes upgrade. |
| Fixture coverage | Add more edge cases as new panels ship. | Fixture states cover noisy, healthy, empty, overloaded, stale/blocked, high-cost, and hidden-label cases. |
| Performance tracking | Budgets are lightweight and need real release history. | Track render time, API response time, payload size, tool-call pressure, token pressure, loop count, and worker failures. |
| Security/privacy gate | Static checks exist, but publishing checks are manual. | Keep read-only routes, redacted session IDs, no local paths, no shell execution, and hidden labels as merge blockers. |
| Browser console gate | CI should keep both fixture and live smoke outputs visible. | Visual and live smoke tests fail on console/page errors. |
| Design source | Keep PRODUCT.md and DESIGN.md current when the surface changes. | Maintain a Viewport strategy, fixture screenshots, and a small set of accepted states. |

## Release Gate

Run before shipping or opening a PR:

```bash
npm run verify
npm run test:visual
npm run test:live
```

For live Hermes validation:

```bash
scripts/install-dashboard-link.sh
hermes dashboard --no-open --skip-build
```

Then open:

```text
http://127.0.0.1:9119/olympus
```

Confirm:

- `/olympus` renders with no browser console errors.
- Empty evidence hides instead of filling the UI with fake state.
- No panel uses mock data in the live dashboard.
- All action links go to Hermes-owned pages.
- Local labels, session IDs, and paths stay hidden unless `OLYMPUS_EXPOSE_LOCAL_LABELS=1`.
- The Agent View is legible at desktop and mobile widths.
- Agent View controls remain accessible buttons, not an interactive subtree hidden
  behind an image role.
- The Performance Tracking panel shows Production Diagnostics with API build,
  payload, fetch, render, board, and Hermes-version signals.

`npm run test:live` performs this smoke check automatically. It reuses an
existing Hermes dashboard only when the served HTML includes the Hermes session
token, then checks desktop and mobile render state. If the plugin target already
points somewhere else, set `OLYMPUS_SMOKE_RELINK=1` before using the smoke
runner to replace it.

## Compatibility Notes

| Date | Hermes version | Check | Result |
| --- | --- | --- | --- |
| 2026-06-06 | Hermes Agent v0.15.1 (2026.5.29), OpenAI SDK 2.24.0 | `npm run test:live` plus manual Browser smoke | Passed on desktop and mobile. |

## Production Metrics To Track

Backend:

- `/overview` response time and response payload size.
- Number of sessions scanned.
- Number of Kanban boards scanned.
- Number of SQLite read failures by table or board.
- Redaction count for secret-like strings.
- Hermes version under test.

Agent performance:

- Median and p90 session duration.
- Total and per-session tool calls.
- Looping sessions at `RUNAWAY_TOOLS_THRESHOLD`.
- Tool-heavy sessions below runaway threshold.
- Average input tokens per API call.
- Cost concentration when Hermes exposes cost fields.
- Handoff errors.
- Stale sessions.

Kanban and worker performance:

- Open, ready, running, blocked, and review counts.
- Active workers.
- Stale workers.
- Failed task runs.
- Ready-unassigned work.
- Repeated retries per task.
- Assignee concentration.

Skill performance:

- Zero-skill profiles.
- Forced-skill task count.
- Tool-heavy sessions by profile.
- Repeated task/session patterns that suggest a reusable skill.
- Skill recommendation acceptance once write actions are approved outside v1.

## Production Follow-Ups

1. Add screenshots or approvals for any new fixture state before it becomes part
   of the release gate.
2. Add a dedicated API unit test around the diagnostics object once the Hermes
   plugin test harness exists.
3. Track release history for API build time, payload size, client fetch time,
   and render time so the current budgets can be tightened from evidence.
4. Add a compatibility note for each Hermes version tested.
5. Decide whether Olympus should eventually use D3, visx, React Flow, PixiJS, or
   Three.js for richer visuals. Do not add one until the target visual behavior is
   clear enough to test.
