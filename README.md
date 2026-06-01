# Olympus

Olympus is a Hermes dashboard plugin for agent tuning.

It reads local Hermes state and shows what to tune next across profiles, routes,
skills, sessions, cron, gateways, Kanban work, and runtime health. It does not
run agents or replace Hermes admin pages.

## What It Does

- Ranks agent optimization items.
- Shows the evidence behind each item.
- Links to the Hermes page that owns the fix.
- Compares profile readiness, route metadata, skill coverage, gateway state, and work load.
- Summarizes Kanban pressure, blocked work, active workers, and assignee load.
- Keeps v1 read-only.

## What It Does Not Do

- Create or move Kanban tasks.
- Spawn workers.
- Edit profiles, cron, gateways, routes, memory, MCP, keys, or config.
- Show secrets.
- Expose private local labels unless explicitly enabled.

## Layout

```text
.
|-- dashboard/
|   |-- manifest.json
|   |-- plugin_api.py
|   |-- dist/index.js
|   |-- dist/style.css
|   `-- docs/BUILD_PLAN.md
|-- scripts/install-dashboard-link.sh
|-- OLYMPUS_GOAL.md
|-- TODO.md
`-- SECURITY.md
```

## Install For Local Hermes

Link the dashboard plugin into Hermes:

```bash
scripts/install-dashboard-link.sh
```

Hermes loads the plugin from:

```text
$HERMES_HOME/plugins/olympus/dashboard/
```

## Run

Start Hermes:

```bash
hermes dashboard --no-open --skip-build
```

Open:

```text
http://127.0.0.1:9119/olympus
```

## API

Hermes mounts Olympus at:

```text
/api/plugins/olympus/
```

Routes:

- `GET /health`
- `GET /overview`
- `GET /tuning`

## Privacy

Olympus hides session titles, Kanban task titles, cron names, exact route labels,
and local paths by default.

To show richer local labels on a private machine:

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=1 hermes dashboard --no-open --skip-build
```

## Verify

```bash
python3 -m py_compile dashboard/plugin_api.py
node --check dashboard/dist/index.js
git diff --check
```

## Project Files

- `OLYMPUS_GOAL.md`: product boundary
- `TODO.md`: active work
- `SECURITY.md`: security and privacy notes
- `dashboard/docs/BUILD_PLAN.md`: implementation plan
