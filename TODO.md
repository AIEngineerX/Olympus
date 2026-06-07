# Olympus TODO

## Done

- Grounded Olympus in Hermes dashboard/plugin reality.
- Removed old office/product-clone framing.
- Packaged Olympus as a Hermes dashboard plugin.
- Added read-only `/health`, `/overview`, and `/tuning` routes.
- Added Agent HQ, Agent View, tuning queue, score breakdown, Kanban intelligence, and activity events.
- Added Skill Coverage from profile skill counts, forced-skill Kanban work, session tool pressure, long threads, and context pressure.
- Added Profile Fitness scoring from workload, route metadata, gateway state, skill count, cron load, blocked work, failed runs, and stale workers.
- Added Evidence Sources so each scan shows which Hermes stores, metadata files, and safe fields grounded the result.
- Kept actions as links to Hermes-owned pages.
- Added privacy defaults for local labels, private paths, route labels, and secrets.
- Kept copy model/provider agnostic and HermesOS-native.
- Confirmed the Hermes Dashboard already owns agent, profile, skill, cron, session, model, and gateway management.

## Open Phases

Complete each item in order and test before starting the next.

0. Production QA Gate (ongoing)
   - Keep `npm run verify`, `npm run test:visual`, and `npm run test:live` passing.
   - Maintain fixture states for noisy, healthy, empty, overloaded, stale/blocked, high-cost, and hidden-label systems.
   - Track production gaps in `dashboard/docs/PRODUCTION_READINESS.md`.
   - Static checks and fixture visual smoke now run in CI; live Hermes smoke remains a local release gate.

1. Kanban Worker Inspector
   - Correlate Kanban `session_id`, `task_runs`, worker heartbeat, retry, stale, and model override data.
   - Show stuck or risky work only when there is real evidence.
   - Link to Hermes Kanban and Sessions.
   - Remaining: add dispatcher/orchestration settings evidence and deeper task-to-session correlation.

2. Curator and Skill Hygiene
   - Read Hermes skill usage/provenance from `~/.hermes/skills/.usage.json` and hub install metadata from `~/.hermes/skills/.hub/lock.json`.
   - Surface unused, heavily used, stale, archived, or recently changed skills if the evidence exists locally.
   - Surface hub trust level, install scan verdict, and stored skills.sh security audit status when available.
   - Keep the panel read-only and link to Hermes Skills or Curator surfaces.

3. Auxiliary Cost Watch
   - Detect background or auxiliary work causing token pressure.
   - Show when expensive routes are being used for background tasks.

## Bug-Test Gate

Run after each implemented item:

```bash
npm run verify
npm run test:visual
npm run test:live
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
