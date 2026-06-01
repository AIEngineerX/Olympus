# Contributing to Olympus

Thanks for helping improve Olympus. This guide covers the local development loop,
the rules that keep Olympus safe and read-only, and how to get a change merged.

Before starting, please skim [`OLYMPUS_GOAL.md`](OLYMPUS_GOAL.md) — it defines what
Olympus owns (recommend, explain, link) versus what HermesOS owns (the actual
controls). Changes that blur that boundary will be sent back.

## Prerequisites

- A working [HermesOS / Hermes Agent](https://github.com/NousResearch/hermes-agent) install (`$HERMES_HOME`, default `~/.hermes`).
- Python 3.10+ and Node.js (Node is only used for the `node --check` step).
- Optional but recommended: a local clone of `hermes-agent` to validate
  assumptions (schemas, env vars, plugin SDK) against the real source.

## Repository layout

| Path | What it is |
| --- | --- |
| `dashboard/plugin_api.py` | The read-only FastAPI backend. Most logic lives here. |
| `dashboard/dist/index.js` | The frontend, **hand-authored** vanilla JS on the Hermes plugin SDK. |
| `dashboard/dist/style.css` | `olympus-*` styles. |
| `dashboard/manifest.json` | Plugin metadata (tab path, assets, api module, icon). |
| `dashboard/docs/BUILD_PLAN.md` | Implementation plan. |
| `scripts/install-dashboard-link.sh` | Symlinks the plugin into `$HERMES_HOME`. |
| `docs/reference/` | Vendored HermesOS docs for reference. Not shipped with the plugin. |

## Local development loop

1. **Link the plugin into Hermes** (once):
   ```bash
   scripts/install-dashboard-link.sh
   ```
2. **Run the dashboard:**
   ```bash
   hermes dashboard --no-open --skip-build
   ```
   Open `http://127.0.0.1:9119/olympus`.
3. **Iterate.** Important reload rules:
   - **Backend (`plugin_api.py`):** routes are mounted **once at startup**. After
     editing the backend you must **fully restart `hermes dashboard`** — the
     plugin rescan only refreshes the UI manifest, not the Python routes.
   - **Frontend (`dist/*`):** reload the browser; the script is re-injected.
   - There is **no build step** — `dist/index.js` and `dist/style.css` are edited
     by hand. Do not add a bundler or a `src/` tree without discussion.

## Read-only & privacy rules (non-negotiable)

Olympus is a diagnostic surface. Every change must keep these invariants:

- **No mutation.** No routes that write Hermes state (tasks, profiles, cron,
  gateways, memory, keys, config). Recommend and link instead.
- **No secrets in responses.** Run untrusted text through `redact_text`.
- **No local paths** in public responses; no shell execution from request paths.
- **SQLite is opened read-only** (`?mode=ro`) and defensively (tolerate missing
  tables/columns — see the `collect_kanban` / `collect_sessions` pattern).
- **Local labels stay hidden by default.** Session/task/cron names and exact
  routes are only shown when `OLYMPUS_EXPOSE_LOCAL_LABELS=1`. Anything stripped
  internally is keyed with a leading `_` and removed by `strip_internal`.

If you change anything that reads HermesOS internals (schemas, env vars, paths,
the plugin SDK), validate it against the actual `hermes-agent` source rather than
assuming — Hermes details are version-dependent.

## Code style

- **Python:** match the existing style — type hints, small pure helpers, and
  `try/except` only at real I/O boundaries (no defensive wrapping of code that
  cannot fail). Keep new logic in `plugin_api.py` unless it clearly warrants a
  new module.
- **JavaScript:** vanilla JS via the injected `window.__HERMES_PLUGIN_SDK__`
  (React, hooks, a small component set, `fetchJSON`). No new runtime
  dependencies. Use `el(...)`/`cx(...)` helpers already in the file.
- Keep diffs scoped to the change. No drive-by reformatting.

## Verify before every commit

```bash
python3 -m py_compile dashboard/plugin_api.py   # backend compiles
node --check dashboard/dist/index.js            # frontend parses
git diff --check                                 # no whitespace/conflict errors
```

When you touch a data path, exercise it for real against a live `$HERMES_HOME`
(or a temporary SQLite DB / fixture). No mocks — integration against real code
only.

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/) with an em dash:

```
feat: short feature — what changed
fix: short fix — what changed
chore: ...
docs: ...
```

Keep commits focused and the body explaining the *why*.

## Pull requests

1. Run the verify commands above (and any data-path testing).
2. Fill out the PR template.
3. Confirm the [pre-publish checklist in `SECURITY.md`](SECURITY.md) — no
   `.DS_Store`/`__pycache__`/local DB files, no private paths, tokens, or
   usernames staged.
4. Keep the read-only/privacy invariants intact, or call out explicitly (and
   document) any new write action that has been approved.

## Security

Please do not open public issues for security or privacy problems. See
[`SECURITY.md`](SECURITY.md) for the current posture and how to report.
