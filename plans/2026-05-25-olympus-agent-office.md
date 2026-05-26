# Olympus Agent Office Implementation Plan

> For Hermes: use `hermes-agent`, `writing-plans`, and later `subagent-driven-development` if this plan is executed task-by-task.

Goal: Build Olympus, a Hermes-native agent office similar in spirit to Pixel Agents: a visual workspace where Hermes agents, subagents, cron jobs, kanban workers, gateway sessions, and long-running terminal processes appear as live characters with visible state.

Architecture: Do not fork Pixel Agents as the first move. Build Olympus as a Hermes dashboard plugin plus backend plugin API routes. Use Hermes' existing dashboard plugin system, session DB, logs, process registry, gateway status, kanban board, and cron scheduler as data sources. If the MVP proves useful, graduate the event model into core Hermes later.

Tech stack:
- Hermes dashboard plugin: `~/.hermes/plugins/olympus/dashboard/`
- Frontend: plain IIFE JS using `window.__HERMES_PLUGIN_SDK__`, React from SDK, CSS file, optional canvas/grid renderer
- Backend: FastAPI router in `dashboard/plugin_api.py`
- Storage: plugin-local JSON/SQLite for layout state under `~/.hermes/plugins/olympus/state/`
- Runtime data sources: `SessionDB`, process registry, gateway status, cron jobs, kanban state, logs

Sources checked:
- Pixel Agents GitHub repo and README: VS Code extension, Claude Code oriented, pixel office, characters reflect activity, layout editor, speech bubbles, sound, sub-agent visualization.
- Hermes dashboard extension docs: plugins live under `~/.hermes/plugins/<name>/dashboard/`, backend routes mount under `/api/plugins/<name>/`, SDK exposes React, shadcn components, `SDK.api`, and `SDK.fetchJSON`.
- Hermes dashboard REST API: `/api/status`, `/api/sessions`, `/api/sessions/{id}/messages`, `/api/logs`, `/api/cron/jobs`, `/api/tools/toolsets`.

Non-goals for MVP:
- No VS Code dependency.
- No external service.
- No profile/config mutation.
- No process control beyond safe read-only visibility until explicit approval.
- No custom asset marketplace.
- No attempt to perfectly clone Pixel Agents.

Core product shape:
1. Olympus tab in Hermes dashboard.
2. Pixel/isometric office canvas.
3. Agent cards/characters for:
   - active CLI/dashboard/gateway sessions
   - running background processes from Hermes process registry
   - kanban workers/tasks
   - cron jobs, especially running or failed jobs
4. Character states:
   - idle
   - thinking
   - tool-use
   - terminal/process running
   - waiting-for-approval/input
   - failed/error
   - completed/recently active
5. Click a character to show details:
   - session title/source/model
   - recent messages or log excerpt
   - current tool/process/task
   - timestamps
6. Layout persistence:
   - seats/desks/rooms saved locally
   - agents auto-assigned to desks if no saved seat exists

Phase 0: Validate plugin substrate

Task 0.1: Create an empty Olympus dashboard plugin
Objective: Add a visible Olympus tab with no backend behavior.
Files:
- Create: `/Users/ghost/.hermes/plugins/olympus/dashboard/manifest.json`
- Create: `/Users/ghost/.hermes/plugins/olympus/dashboard/dist/index.js`
- Create: `/Users/ghost/.hermes/plugins/olympus/dashboard/dist/style.css`
Verification:
- Run `hermes dashboard --no-open`
- Open `http://127.0.0.1:9119`
- Confirm an Olympus tab appears.
- If dashboard is already running, call `curl http://127.0.0.1:9119/api/dashboard/plugins/rescan`.

Task 0.2: Add plugin backend health route
Objective: Prove frontend-to-plugin API calls work.
Files:
- Create: `/Users/ghost/.hermes/plugins/olympus/dashboard/plugin_api.py`
- Modify: manifest to include `"api": "plugin_api.py"`
Endpoint:
- `GET /api/plugins/olympus/health` returns `{ "ok": true, "name": "olympus" }`
Verification:
- `curl http://127.0.0.1:9119/api/plugins/olympus/health`
- Olympus frontend displays backend health.

Phase 1: Read-only live data MVP

Task 1.1: Add `/overview` backend route
Objective: Return normalized Olympus entities from Hermes data sources.
Endpoint:
- `GET /api/plugins/olympus/overview`
Response shape:
```json
{
  "entities": [
    {
      "id": "session:<id>",
      "kind": "session",
      "label": "Zeus CLI",
      "source": "cli|telegram|discord|cron|dashboard|unknown",
      "state": "idle|active|tool_use|waiting|error|complete",
      "last_seen": "ISO timestamp",
      "meta": {}
    }
  ],
  "generated_at": "ISO timestamp"
}
```
Data sources, in order:
1. `SessionDB().list_sessions(limit=50)` for recent sessions.
2. Built-in dashboard status logic or equivalent imports for gateway/platform state.
3. Cron job store for enabled/running/error jobs.
4. Kanban board if configured.
5. Process registry if safe and available.
Verification:
- Route returns JSON with at least recent sessions.
- Missing optional systems degrade to empty lists, not errors.

Task 1.2: Render entity cards before canvas
Objective: Avoid premature graphics work. First prove useful data mapping.
Frontend:
- Fetch `/api/plugins/olympus/overview` every 5 seconds.
- Render cards grouped by kind.
- Show state badge and last_seen.
Verification:
- Dashboard updates without refresh.
- Browser console has no plugin errors.

Task 1.3: State classifier v1
Objective: Map raw Hermes data into simple visual states.
Rules:
- Recent activity < 60s -> active
- Recent tool call / process marker -> tool_use or terminal
- Error log/session marker -> error
- Approval/waiting marker -> waiting
- Otherwise idle
Verification:
- Unit-test classifier as pure Python or JS function.
- Manually compare against recent session/log data.

Phase 2: Office visual MVP

Task 2.1: Build simple office grid
Objective: Render a fixed office with desks and characters.
Frontend:
- CSS grid or canvas, 16x10 tiles.
- Fixed desk coordinates.
- Assign entities to seats deterministically by stable hash.
Verification:
- Entities appear as characters on desks.
- Refresh preserves position mapping.

Task 2.2: Add state animations
Objective: Make characters visibly reflect state.
States:
- idle: breathing/pulse
- active: walking/typing loop
- tool_use: terminal glow
- waiting: speech bubble
- error: red alert bubble
- complete: green check pulse
Verification:
- Force local fixture states and confirm each animation renders.

Task 2.3: Add detail drawer
Objective: Clicking a character opens useful details.
Frontend:
- Show entity label, kind, state, metadata, recent excerpt.
Backend:
- Optional `GET /api/plugins/olympus/entity/{id}` for deeper details.
Verification:
- Click opens drawer.
- Bad/missing IDs fail cleanly.

Phase 3: Layout persistence

Task 3.1: Add layout state file
Objective: Persist desks/seats/agent assignments locally.
Storage:
- `/Users/ghost/.hermes/plugins/olympus/state/layout.json`
Endpoints:
- `GET /api/plugins/olympus/layout`
- `PUT /api/plugins/olympus/layout`
Verification:
- Save layout, refresh dashboard, layout survives.

Task 3.2: Add drag-to-seat reassignment
Objective: Let Ghost move agents manually.
Frontend:
- Drag character to desk tile.
- Save assignment by entity stable ID prefix where possible.
Verification:
- Moved entity stays put after refresh.

Phase 4: Hermes-native control, gated

Task 4.1: Add safe actions only after approval
Candidate actions:
- Open session detail in dashboard.
- Trigger cron job.
- Pause/resume cron job.
- Tail logs for entity.
- Stop background process.
Boundary: process stop, cron mutation, profile/gateway changes need explicit Ghost approval before implementation.

Task 4.2: Add spawn Hermes agent action only after approval
Candidate:
- Start a new Hermes CLI/dashboard session tied to an Olympus desk.
Boundary: This mutates runtime state and can spawn agents. Do not implement until Ghost approves exact behavior.

Implementation notes:
- Use `get_hermes_home()` for any plugin paths if code is promoted into repo. For user plugin code, resolve from environment/profile safely.
- Keep Olympus user/private under Zeus/default unless Ghost later asks to package it for other profiles.
- Plugin backend routes are reachable if dashboard is exposed beyond localhost. Keep dashboard bound to localhost.
- Avoid bundling React. Use `SDK.React` and `SDK.components`.
- Start with read-only visibility. Control comes later.

Recommended first build:
1. Phase 0 plugin skeleton.
2. Phase 1 `/overview` with sessions + cron only.
3. Entity cards.
4. Fixed office grid.
5. Detail drawer.

Open decisions for Ghost:
1. Visual style: Greek Olympus marble/pixel temple, modern office, or direct pixel-office clone style?
2. Scope: dashboard-only first, or also VS Code panel later?
3. Agent model: visualize only running Hermes sessions first, or include all historical/recent sessions?
4. Control surface: read-only MVP, or allow spawn/stop/trigger actions once the office renders?
