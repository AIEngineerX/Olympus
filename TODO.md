# Olympus TODO

## Shipped

- Grounded Olympus in Hermes dashboard/plugin reality.
- Packaged Olympus as a read-only Hermes dashboard plugin with `/health`, `/overview`, and `/tuning`.
- Added Agent Monitor, readiness score, tuning queue, Evidence Sources, Performance Tracking, Trace Spine, Pantheon, Kanban Intelligence, Skill Coverage, Skill Hygiene, Profile Fitness, Tool Policy, and Aux Cost.
- Redacted local labels, paths, raw IDs, prompt text, and secret-like values by default.
- Added visual, live, and security smoke gates.
- Kept actions as links to Hermes-owned pages.
- Tightened hidden-ID privacy for session, cron, Kanban run, worker, and event refs.
- Changed log health wording to report log-tail scanning instead of inferred recency.
- Reduced Agent Monitor first-screen density with collapsed secondary signals.

## Phase Ledger

Complete each item in order and test before starting the next.

0. Production QA Gate (ongoing)
   - Keep `npm run verify`, `npm run test:visual`, `npm run test:live`, and `npm run test:security` passing.
   - Maintain fixture states for noisy, healthy, empty, overloaded, stale/blocked, high-cost, and hidden-label systems.
   - Track production gaps in `dashboard/docs/PRODUCTION_READINESS.md`.
   - Static checks and fixture visual smoke now run in CI; live Hermes smoke remains a local release gate.
   - Privacy regression checks now run in `npm run verify`.

1. Kanban Worker Inspector (partial)
   - Shipped: board pressure, blocked work, active workers, stale workers, failed runs, and assignee load.
   - Shipped: Trace Spine V0 links tasks to sessions, task runs, and task events with safe refs.
   - Remaining: dispatcher/orchestration settings evidence.

2. Curator and Skill Hygiene (partial)
   - Shipped: usage/provenance, stale/archive/patch counts, hub trust, and scan gaps.
   - Remaining: stored skills.sh audit status when Hermes records it, plus a Curator route when Hermes exposes one.

3. Trace Spine V0 (shipped)
   - Correlates sessions, Kanban tasks, task runs, and task events.
   - Shows failure points without transcript content.
   - Keep transcript content hidden and use hashed refs by default.
   - `npm run verify` and `npm run test:security` fail if Trace Spine exposes raw ID, message, or transcript keys.

4. Hermes Desktop Integration (upstream packaging track)
   - Add a Desktop preflight script in this repo.
   - Prepare an upstream Hermes Desktop PR for dashboard plugin-tab parity.
   - Keep Olympus read-only and avoid duplicating Desktop Command Center Usage.
   - Fallback: document browser-dashboard access if Desktop plugin parity is not accepted.

5. Deterministic Eval Signals
   - Add local reliability, efficiency, routing, and skill-use eval signals.
   - Keep them labeled as operational evals, not answer-quality judgments.

## Bug-Test Gate

Run after each implemented item:

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:security
```

Then verify the live dashboard:

- `/olympus` renders without browser console errors.
- No panel renders with mock, fake, or placeholder data.
- Empty evidence hides instead of adding noise.
- Links go to Hermes-owned pages.
- Evidence Sources renders without local paths, raw database paths, raw IDs, or secret-like values.
- Local names and paths stay hidden unless `OLYMPUS_EXPOSE_LOCAL_LABELS=1`.

Browser check:

```text
http://127.0.0.1:9119/olympus
```

Visual fixture:

```bash
npm run test:visual
npm run test:live
```
