# Olympus Review — 2026-06-07

## Verdict

Olympus is a strong v0 agent-ops dashboard. It has the right boundary: read-only diagnostics, first-party Hermes evidence, safe handoff links, and no attempt to become another Kanban/admin surface.

The Hermes Desktop app also has Command Center Usage. That section already owns sessions, API calls, input/output tokens, cost, daily token charts, top models, and top skills. Olympus should not compete with it. Olympus should use usage data only as evidence for risk, routing, skill hygiene, and handoff links.

Overall rating: 8.4 / 10

Ready for local operator use: yes.
Ready for wider/public release: close, but settle Desktop plugin-tab parity and run a fresh release audit first.

## Ratings

| Area | Rating | Notes |
| --- | ---: | --- |
| Product boundary | 9.0 | Clear read-only scope. Good separation from Hermes-owned admin pages. |
| Hermes plugin fit | 8.5 | Manifest/API/frontend shape matches Hermes dashboard plugin model. Routes sit under `/api/plugins/olympus`; Desktop still needs plugin-tab parity. |
| Backend correctness | 8.0 | Solid read-only collectors, SQLite RO mode, schema-aware column checks, useful diagnostics. Some heuristics need tightening. |
| Security/privacy posture | 8.6 | Hidden-label payloads now use public refs for cron, Kanban run, worker, and event IDs. Security smoke checks raw operational ID keys. |
| Frontend/UI | 8.3 | Strong visual identity and hierarchy. Agent Monitor now collapses secondary signals and extra tuning items. Deeper sections are still tall on mobile. |
| Test coverage | 9.0 | Verify, fixture visual tests, live smoke, and security smoke all pass. Good release gate discipline. |
| Operational usefulness | 8.5 | Surfaces score, tuning queue, performance, policy, skills, profiles, Kanban, evidence sources. Useful immediately. |

## Verification Run

Commands executed from `/Users/ghost/olympus`:

```text
npm run verify
# exit 0
# python compile, node syntax check, git diff whitespace check passed

npm run test:visual
# exit 0
# 14 passed

npm run test:live
# exit 0
# ok true; desktop/mobile rendered; no console errors; no bad links; no tiny text; no horizontal overflow

npm run test:security
# exit 0
# ok true; evidenceSources 5; skillHygieneSignals 2; configPolicyFindings 2; failures []
```

Direct backend import check:

```json
{
  "score": 44,
  "health": "warning",
  "payload_bytes": 63706,
  "generated_ms": 31.22,
  "budget_status": {
    "api_response": "ok",
    "payload": "ok",
    "client_render": "reported_by_browser"
  },
  "profiles": 2,
  "sessions": 60,
  "kanban_attention": 1,
  "evidence_sources": 5
}
```

## What Works

1. Clear product shape
   - `README.md` and `OLYMPUS_GOAL.md` define Olympus as a read-only HermesOS Agent Monitor.
   - The boundary is right: recommend, explain, link. Do not mutate.

2. Good Hermes integration
   - `dashboard/manifest.json` is minimal and correct.
   - Backend exposes `/health`, `/overview`, `/tuning` under plugin API.
   - Frontend uses Hermes plugin SDK `fetchJSON`, not raw credential/session handling.

3. Backend design is pragmatic
   - SQLite connections use `mode=ro`.
   - Collectors tolerate missing columns and missing sources.
   - Evidence Sources make the dashboard auditable instead of magical.
   - Diagnostics report API build time, payload size, source counts, and budgets.

4. Security direction is sound
   - No mutation routes found.
   - No frontend `innerHTML`, `eval`, `Function`, localStorage/sessionStorage patterns found.
   - Security smoke checks payload redaction and failed with zero findings.
   - Local labels are hidden by default and opt-in via `OLYMPUS_EXPOSE_LOCAL_LABELS=1`.

5. Test gate is unusually good for a dashboard plugin
   - Fixture states cover noisy, healthy, empty, overloaded, stale, high-cost, and no-labels.
   - Live smoke covers desktop/mobile render, console errors, links, overflow, and required sections.
   - Security smoke validates the live `/overview` payload through the Hermes token flow.

6. Desktop Usage boundary is now clear
   - Hermes Desktop Command Center Usage owns usage totals and charts.
   - Olympus now labels cost as risk, not spend.
   - Skill Hygiene labels its local signal list as Skill Activity, not Usage.

## Findings

### P1 — Align privacy contract with payload reality (fixed locally)

Docs say raw IDs/paths/local labels stay hidden by default. The payload still includes some raw operational identifiers:

- `collect_cron()` returns `job_id: job.get("id")` and `id: cron:<raw id>`.
- `collect_kanban()` returns `worker_pid` and `current_run_id` in recent task/run structures.
- Active workers include `run_id` and `worker_pid`.

These are not credential leaks, but they violate the stated privacy posture if interpreted strictly.

Recommendation:
- Hash or omit raw cron job IDs, run IDs, and worker PIDs unless `OLYMPUS_EXPOSE_LOCAL_LABELS=1`.
- Keep stable public IDs using `safe_id(raw, "cron" | "run" | "pid")`.
- Add explicit security-smoke assertions for raw `job_id`, `worker_pid`, `current_run_id`, `run_id`, and PID-like fields if hidden-label mode is active.

Status:
- Implemented stable public refs for cron IDs, task run IDs, current run IDs, worker PIDs, and event IDs.
- Added `tests/test_privacy_contract.py`.
- Added privacy regression coverage to `npm run verify`.
- Added live security smoke patterns for raw worker/current-run/run ID keys.

### P1 — Health log signal is not actually time-bounded (fixed locally)

`collect_health()` scans tails of `agent.log`, `gateway.log`, and `errors.log` for failure terms and reports them as recent. It does not parse timestamps or enforce a freshness window. A stale error inside the tail can keep Olympus in warning state.

Recommendation:
- Rename to “log tail contains failure terms” or parse timestamps and limit to last N minutes/hours.
- Include `log_window` in evidence: e.g. `last 8KB tail`, `last 60m parsed`, or `unknown freshness`.

Status:
- Health summary now says “Log tail contains failure terms.”
- `health.log_scan_window` reports `last 8KB per log file`.
- Tuning recommendation basis says timestamp recency is not inferred.

### P2 — Live UI is operationally useful but too tall/dense (first pass fixed locally)

Live smoke passes, but the current live page is very tall:

- Desktop: Agent Monitor section ~1188px, Performance ~1302px, Pantheon ~1408px.
- Mobile: Agent Monitor ~1990px, Performance ~3334px, Policy ~2485px, Skill Hygiene ~2629px, Pantheon ~2484px.

The first viewport looks good, but the operator must scroll through a lot of repeated cards before reaching deeper context.

Recommendation:
- Make top sections more collapsible or progressive:
  - Above fold: score, health reason, top 3 tuning items, top 5 metric tiles.
  - Collapse evidence/method details by default.
  - Consider tabs/anchors for Performance, Skills, Kanban, Profiles.
- Keep “Evidence Sources” but move it lower or make it compact unless a source warning exists.

Status:
- Agent Monitor now shows at most six metric tiles by default.
- Tuning Queue now shows at most three full cards by default.
- Secondary monitor signals and extra tuning items collapse into backlog details.
- Visual tests assert the density limits on desktop and mobile.

### P2 — `/overview` and `/tuning` duplicate almost all collector work

Both endpoints run most of the same collectors and builders. That is fine now because direct import measured ~31ms and ~64KB payload, but it creates drift risk.

Recommendation:
- Create `build_read_model(include_inventory=True|False)` or shared `collect_snapshot()`.
- Keep route-specific payload shaping separate, but collect once.

### P2 — Security smoke is strong, but pattern coverage should match promises

Current security smoke catches paths, database filenames, secret-like strings, prompt/personality keys, and local-label state. It does not catch raw IDs/PIDs or exact model/provider labels beyond obvious keys.

Recommendation:
- Add payload assertions for hidden-label mode:
  - no `worker_pid`
  - no `current_run_id`
  - no raw `job_id`
  - no `session:` raw UUID-like strings unless hashed
  - no explicit model/provider labels unless `OLYMPUS_EXPOSE_LOCAL_LABELS=1`

### P3 — Visual identity is strong, but dashboard shell + Olympus both compete

The Hermes sidebar and Olympus dark/gold command surface visually stack well, but the first viewport is busy. The left sidebar also appears visually clipped/overlaid around lower nav/system controls in the screenshot, though that is likely Hermes shell behavior rather than Olympus.

Recommendation:
- Keep Olympus branding; it works.
- Reduce card count above the fold.
- Add a sticky local section nav or compact “jump to” row if the page remains long.

## Specific Next Fixes

1. Refactor read-model collection
   - Add one shared snapshot builder used by `/overview` and `/tuning`.
   - This prevents feature drift and makes future Trace Spine work easier.

2. Scope Desktop plugin-tab parity
   - Add a local Desktop preflight script.
   - Prepare an upstream Hermes PR that surfaces dashboard plugin tabs in Desktop.
   - Keep Usage/Analytics as the ledger and Olympus as the action layer.

3. Add Trace Spine
   - The privacy contract is now safer for deeper task/session correlation.
   - Keep transcript content hidden and use hashed refs by default.

## Simple Summary

Olympus is good. The core idea is right, the plugin boundary is clean, and the test gates are strong. It passed verify, visual, live, and security checks.

Main fixes before broader release:

1. Share backend collection between `/overview` and `/tuning`.
2. Push Desktop plugin-tab parity upstream, without duplicating Desktop Usage.
3. Run another release audit after Trace Spine lands.

After those, Olympus is a credible local Hermes operator console.
