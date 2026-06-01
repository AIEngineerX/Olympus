# Olympus

![License: MIT](https://img.shields.io/badge/license-MIT-yellow)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Mode](https://img.shields.io/badge/mode-read--only-brightgreen)

**Olympus is a read-only [HermesOS](https://github.com/NousResearch/hermes-agent) dashboard plugin for agent tuning.**

It reads local Hermes runtime state and shows what to tune next across profiles,
routes, skills, sessions, cron, gateways, Kanban work, and runtime health. It
does not run agents and does not replace Hermes admin pages — it explains how the
agent system is performing and links to the Hermes page that owns each fix.

> Olympus mounts a `/olympus` tab in the Hermes dashboard. See
> [`OLYMPUS_GOAL.md`](OLYMPUS_GOAL.md) for the product boundary (what Olympus owns
> vs. what Hermes owns).

## What It Does

- Ranks agent optimization items with the evidence behind each one.
- Compares profile readiness, route metadata, skill coverage, gateway state, and workload.
- Summarizes Kanban pressure: blocked work, active workers, retries, and assignee load.
- Computes a transparent, heuristic readiness score with a full deduction breakdown.
- Keeps v1 **read-only** — every action is a link to the Hermes page that owns it.

## What It Does Not Do

- Create or move Kanban tasks, or spawn workers.
- Edit profiles, cron, gateways, routes, memory, MCP, keys, or config.
- Show secrets, or expose local labels/paths unless explicitly enabled.

## Requirements

- A working [HermesOS / Hermes Agent](https://github.com/NousResearch/hermes-agent) install (`$HERMES_HOME`, default `~/.hermes`).
- Python 3.10+ (the backend is a FastAPI router loaded by Hermes).
- Node.js (only for the `node --check` verification step — there is no build step).

## Install (local Hermes)

Link the dashboard plugin into your Hermes home:

```bash
scripts/install-dashboard-link.sh
```

Hermes loads the plugin from:

```text
$HERMES_HOME/plugins/olympus/dashboard/
```

## Run

```bash
hermes dashboard --no-open --skip-build
```

Then open:

```text
http://127.0.0.1:9119/olympus
```

## API

Hermes mounts Olympus at `/api/plugins/olympus/`:

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness + a coarse runtime status summary |
| `GET /overview` | Full read model: health, attention, tuning, profiles, gateways, cron, sessions, Kanban |
| `GET /tuning` | Tuning queue, score breakdown, and Kanban intelligence |

Routes sit behind the Hermes dashboard session-token middleware; the frontend
calls them through the plugin SDK's `fetchJSON`, which injects the token.

## Privacy

Olympus hides session titles, Kanban task titles, cron names, exact route labels,
and local paths by default. To show richer local labels on a private machine:

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=1 hermes dashboard --no-open --skip-build
```

See [`SECURITY.md`](SECURITY.md) for the full security and privacy posture.

## Project Layout

```text
.
├── dashboard/
│   ├── manifest.json            # plugin metadata, tab path, assets, api module
│   ├── plugin_api.py            # FastAPI router (read-only backend)
│   ├── dist/index.js            # hand-authored frontend (registered with the Hermes plugin SDK)
│   ├── dist/style.css           # olympus-* styles
│   ├── docs/BUILD_PLAN.md       # implementation plan
│   └── README.md                # package notes
├── scripts/install-dashboard-link.sh
├── docs/reference/              # vendored HermesOS docs (reference only; not part of the plugin)
├── OLYMPUS_GOAL.md              # product boundary
├── TODO.md                      # active backlog
├── SECURITY.md                  # security & privacy notes
├── CONTRIBUTING.md              # development & contribution guide
├── LICENSE                      # MIT
└── README.md
```

> Note: `dashboard/dist/*` is **hand-authored vanilla JS/CSS** — there is no
> bundler or build step. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
> development workflow.

## Verify

```bash
python3 -m py_compile dashboard/plugin_api.py
node --check dashboard/dist/index.js
git diff --check
```

## Contributing

Contributions are welcome — please read [`CONTRIBUTING.md`](CONTRIBUTING.md)
first. It covers the local dev loop, the read-only/privacy rules, the
verification commands, and commit/PR conventions.

## Security

Found a security or privacy issue? See [`SECURITY.md`](SECURITY.md) for the
posture and how to report.

## License

[MIT](LICENSE) © AIEngineerX
