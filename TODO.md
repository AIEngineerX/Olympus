# Olympus TODO

## Done

- Grounded Olympus in Hermes dashboard/plugin reality.
- Removed old office/product-clone framing.
- Packaged Olympus as a Hermes dashboard plugin.
- Added read-only `/health`, `/overview`, and `/tuning` routes.
- Added Agent HQ, tuning queue, score breakdown, Kanban intelligence, profile matrix, and evidence rail.
- Kept actions as links to Hermes-owned pages.
- Added privacy defaults for local labels, private paths, route labels, and secrets.
- Kept copy model/provider agnostic and HermesOS-native.

## Active Backlog

- Correlate Kanban `session_id` and `task_runs` to Hermes sessions.
- Add dispatcher/orchestration settings evidence.
- Improve task-level tuning ranks for blocked, stale, retry, tool-heavy, unassigned, and unhealthy-assignee cases.
- Keep writes out of Olympus until a specific control is approved.

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
