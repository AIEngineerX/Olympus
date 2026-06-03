# Olympus TODO

## Done

- Grounded Olympus in Hermes dashboard/plugin reality.
- Removed old office/product-clone framing.
- Packaged Olympus as a Hermes dashboard plugin.
- Added read-only `/health`, `/overview`, and `/tuning` routes.
- Added Agent HQ, Party View, tuning queue, score breakdown, Kanban intelligence, and activity events.
- Kept actions as links to Hermes-owned pages.
- Added privacy defaults for local labels, private paths, route labels, and secrets.
- Kept copy model/provider agnostic and HermesOS-native.
- Confirmed the Hermes Dashboard already owns agent, profile, skill, cron, session, model, and gateway management.

## Active Backlog

Complete each item in order and test before starting the next.

1. Skill Coverage
   - Show profile skill counts, forced-skill Kanban work, and missing-skill risk.
   - Recommend skill bundles when repeated work patterns appear.
   - Link fixes to Hermes Skills instead of duplicating skill management.
   - Done when `/overview` returns `skill_coverage` and the UI renders it without mock data.

2. Profile Fitness
   - Rank profiles by workload, routing metadata, gateway state, cron load, failures, loop pressure, and context pressure.
   - Show the reason each profile is stable, overloaded, underconfigured, or needs review.
   - Link fixes to Hermes Profiles, Sessions, Cron, Kanban, or Skills.
   - Done when `/overview` returns `profile_fitness` and the UI explains the top issue for each profile.

3. Kanban Worker Inspector
   - Correlate Kanban `session_id`, `task_runs`, worker heartbeat, retry, stale, and model override data.
   - Show stuck or risky work only when there is real evidence.
   - Link to Hermes Kanban and Sessions.

4. Curator and Skill Hygiene
   - Surface unused, heavily used, stale, or recently changed skills if Hermes exposes the evidence locally.
   - Keep the panel read-only and link to Hermes Skills or Curator surfaces.

5. Auxiliary Cost Watch
   - Detect background or auxiliary work causing token pressure.
   - Show when expensive routes are being used for background tasks.

## Bug-Test Gate

Run after each implemented item:

```bash
python3 -m py_compile dashboard/plugin_api.py
node --check dashboard/dist/index.js
git diff --check
```

Then verify the live dashboard:

- `/olympus` renders without browser console errors.
- No panel renders with mock, fake, or placeholder data.
- Empty evidence hides instead of adding noise.
- Links go to Hermes-owned pages.
- Local names and paths stay hidden unless `OLYMPUS_EXPOSE_LOCAL_LABELS=1`.

## Verification

```bash
python3 -m py_compile dashboard/plugin_api.py
node --check dashboard/dist/index.js
git diff --check
```

Browser check:

```text
http://127.0.0.1:9119/olympus
```
