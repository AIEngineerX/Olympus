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
| Performance tracking | Budgets now have a live smoke gate; thresholds still need release history. | Track render time, API response time, payload size, tool-call pressure, context pressure, cost risk, loop count, and worker failures. |
| Desktop compatibility | Hermes Desktop has Command Center Usage but does not yet expose dashboard plugin tabs. | Olympus must stay an operations monitor, link to Usage/Analytics for ledgers, and pass Desktop preflight before an upstream PR. |
| Evidence source contract | Evidence Sources now shows source presence and safe fields, but each new source must stay pathless and read-only. | Every panel cites Hermes-owned evidence without raw paths, raw IDs, prompt text, or secret-like values. |
| Config policy | Tool Policy & Aux Cost reads safe config structure only. | No prompt/personality text, base URLs, API keys, env values, local paths, or exact route labels in public payloads. |
| Security/privacy gate | Static and live payload checks exist, but publishing still needs human review. Skills.sh audit fields are shown only if Hermes stores them locally. | Keep read-only routes, redacted session IDs, no local paths, no shell execution, hidden labels, and skill-hub scan/trust signals as merge blockers where applicable. |
| Hidden operational IDs | Session, cron, Kanban run, worker, and event identifiers now use public refs by default. | `npm run verify` and `npm run test:security` fail on raw session/worker/current-run/run ID keys in hidden-label payloads. |
| Trace Spine privacy | Task, session, run, and event correlations now render as safe refs. | Trace Spine must not expose raw ID keys, messages, handoff errors, or transcript content in `/overview`. |
| Health recency | Log warnings are based on log-tail scans, not timestamp parsing. | Health copy must say log tail unless timestamp parsing is added. |
| First-screen density | Agent Monitor collapses secondary signals and extra tuning items. | Visual tests keep default Agent Monitor to six metric tiles and three full tuning cards. |
| Touch targets | Disclosure summaries are part of the interactive scan path. | Visual tests fail if visible buttons, links, or summaries render below the control-size floor. |
| Browser console gate | Fixture console checks run in CI. Live smoke is a local release gate because it depends on a Hermes dashboard. | Visual and live smoke tests fail on console/page errors. |
| Design source | Keep PRODUCT.md and DESIGN.md current when the surface changes. | Maintain a Viewport strategy, fixture screenshots, and a small set of accepted states. |

## Release Gate

Run before shipping or opening a PR:

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:performance
npm run test:security
npm run test:desktop
npm audit --audit-level=moderate
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
- Pantheon is legible at desktop and mobile widths.
- Pantheon controls remain accessible buttons, not an interactive subtree hidden
  behind an image role.
- The Performance Tracking panel shows Production Diagnostics with API build,
  payload, fetch, render, board, and Hermes-version signals.
- The Trace Spine panel links task, session, run, and event evidence without
  transcript content or raw ID keys.
- The Operational Evals panel shows deterministic reliability, routing,
  skill-use, and efficiency checks from Hermes evidence. It must not present
  answer-quality or benchmark claims.
- The Evidence Sources strip shows Hermes state, Kanban, config, skill usage,
  and hub lock metadata without local paths or raw IDs.
- The Tool Policy & Aux Cost panel shows only safe config counts, browser
  privacy flags, route audit presence, and cost visibility. It must not expose
  prompt text, base URLs, API keys, env values, or local paths.
- The Skill Hygiene panel shows activity, stale/archive/patch counts, and hub
  trust/scan gaps without raw skill names unless labels are explicitly enabled.

`npm run test:live` performs the render smoke check automatically. `npm run
test:security` fetches the live `/overview` payload through the Hermes
session-token flow and fails on local paths, raw database filenames, cwd or
workspace keys, and secret-like strings. Both commands reuse an existing Hermes
dashboard only when the served HTML includes the Hermes session token. If the
plugin target already points somewhere else, set `OLYMPUS_SMOKE_RELINK=1`
before using the smoke runner to replace it.

`npm run test:desktop` is a read-only preflight. It checks the Olympus plugin
manifest and link, Hermes web plugin support, local Hermes Desktop presence,
Command Center Usage ownership, Desktop Python dashboard dependencies, and
whether Desktop already exposes dashboard plugin-tab route signals.

`npm run test:performance` is a live local budget gate. It calls `/overview` and
`/tuning` through the Hermes session-token flow several times and fails on
non-2xx responses, response-time budget breaches, backend diagnostic warnings,
or payloads over the documented byte budget.

## Rollback Path

For local deployment, rollback is the previous Git revision plus the Hermes
plugin symlink:

1. Stop the dashboard process.
2. Check out the last known-good Olympus commit or branch.
3. Re-run `scripts/install-dashboard-link.sh` so
   `$HERMES_HOME/plugins/olympus/dashboard` points at that checkout.
4. Start `hermes dashboard --no-open --skip-build`.
5. Run `npm run test:live`, `npm run test:performance`, and
   `npm run test:security`.

The plugin has no write routes, migrations, task mutations, profile edits, or
external data stores, so rollback does not require data restoration.

## Monitoring And Alerts

Olympus monitoring is local and dashboard-owned:

- Production Diagnostics reports backend generation time, payload size, client
  budget status, scanned profiles, scanned sessions, Kanban board read failures,
  and Hermes home detection.
- Evidence Sources reports which Hermes sources were present and which had read
  failures.
- Attention, Trace Spine, Operational Evals, Skill Hygiene, and Tool Policy
  panels surface warning or critical states from Hermes evidence.
- `npm run test:live`, `npm run test:performance`, and
  `npm run test:security` act as release alerts by exiting non-zero when the
  monitor disappears, budgets are exceeded, or privacy checks fail.

## Compatibility Notes

| Date | Hermes version | Check | Result |
| --- | --- | --- | --- |
| 2026-06-06 | Hermes Agent v0.16.0 (2026.6.5), upstream `1c218983`, OpenAI SDK 2.24.0 | `npm run test:live` | Passed on desktop and mobile. |
| 2026-06-07 | Local Hermes dashboard on `127.0.0.1:9119` | `npm run test:live`, `npm run test:performance`, `npm run test:security`, `npm audit --audit-level=moderate` | Passed on desktop/mobile live smoke, API budget smoke, overview payload redaction, and dependency audit. |

## Production Metrics To Track

Backend:

- `/overview` response time and response payload size.
- Number of sessions scanned.
- Number of Kanban boards scanned.
- Number of SQLite read failures by table or board.
- Redaction count for secret-like strings.
- Evidence source presence, safe fields used, and read failures.
- Hermes version under test.

Agent performance:

- Median and p90 session duration.
- Total and per-session tool calls.
- Looping sessions at `RUNAWAY_TOOLS_THRESHOLD`.
- Tool-heavy sessions below runaway threshold.
- Average input tokens per API call.
- Cost-risk concentration when Hermes exposes cost fields. Hermes Usage/Analytics
  owns raw cost totals.
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

Operational evals:

- Reliability check state and score.
- Routing check state and score.
- Skill-use check state and score.
- Efficiency check state and score.
- Count of warnings and failures across fixed operational checks.

Skill performance:

- Zero-skill profiles.
- Forced-skill task count.
- Tool-heavy sessions by profile.
- Repeated task/session patterns that suggest a reusable skill.
- Skill usage/provenance from `~/.hermes/skills/.usage.json`.
- Hub-installed skill trust level and install scan verdict from
  `~/.hermes/skills/.hub/lock.json`.
- Stored skills.sh security audit status when Hermes has recorded it locally.
- Skill recommendation acceptance once write actions are approved outside v1.

Config policy:

- Root and profile config presence.
- Highest safe `agent.max_turns` or Kanban goal turn limit.
- Visible tool-loop guardrail presence.
- Fallback provider count.
- Toolset count.
- Compression presence.
- Browser private URL and recording flags.
- Auxiliary route presence.
- Sessions with visible cost data.

## Production Follow-Ups

1. Add screenshots or approvals for any new fixture state before it becomes part
   of the release gate.
2. Add a dedicated API unit test around the diagnostics object once the Hermes
   plugin test harness exists.
3. Track release history for API build time, payload size, client fetch time,
   and render time so the current budgets can be tightened from evidence.
4. Add a compatibility note for each Hermes version tested.
5. Add a Curator-specific handoff route once Hermes exposes one. Do not trigger
   hub scans, installs, archives, restores, or deletes from Olympus v1.
6. Decide whether Olympus needs D3, visx, React Flow, PixiJS, or
   Three.js for richer visuals. Do not add one until the target visual behavior is
   clear enough to test.
