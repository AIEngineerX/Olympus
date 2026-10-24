# Contributing to Olympus

Thanks for helping improve Olympus. This guide covers the local development loop,
the rules that keep Olympus safe, and how to get a change merged.

Before starting, read [`PRODUCT.md`](PRODUCT.md). It lists the problems Olympus
exists to solve, with the Hermes issues that show people have them, and what
Olympus owns versus what Hermes owns. A change that does not trace to one of
those problems, or that blurs that boundary, will be sent back.

## Prerequisites

- A working [Hermes Agent](https://github.com/NousResearch/hermes-agent) install (v0.21.6+) (`$HERMES_HOME`, default `~/.hermes`).
- Python 3.10+ and Node.js.
- For visual QA: run `npm install` once, then `npx playwright install chromium`
  if Chromium is not already installed for Playwright.
- Optional but recommended: a local clone of `hermes-agent` to validate
  assumptions (schemas, env vars, plugin SDK) against the real source.

## Repository layout

| Path | What it is |
| --- | --- |
| `dashboard/plugin_api.py` | The FastAPI backend. It reads Hermes stores read-only; most logic lives here. |
| `dashboard/dist/index.js` | The frontend, **hand-authored** SDK React on the Hermes plugin SDK. |
| `dashboard/dist/style.css` | `olympus-*` styles. |
| `dashboard/manifest.json` | Plugin metadata (tab path, assets, api module, icon). |
| `desktop/plugin.js` | The Hermes Desktop page (Desktop does not render web-dashboard tabs). |
| `scripts/build-fixture-agents.py` | Regenerates the browser fixture's agents, queue and performance data from real scans of a seeded Hermes home. |
| `scripts/install-dashboard-link.sh` | Symlinks the plugin into `$HERMES_HOME`. |

## Local development loop

1. **Link the plugin into Hermes and enable it** (once). Hermes mounts user
   plugin APIs only for names in `plugins.enabled`:
   ```bash
   scripts/install-dashboard-link.sh
   hermes plugins enable olympus
   ```
2. **Run the dashboard:**
   ```bash
   npm run dev
   ```
   Open `http://127.0.0.1:9119/olympus`.
3. **Iterate.** Important reload rules:
   - **Backend (`plugin_api.py`):** the module is imported when its routes are
     first mounted. After editing the backend, **fully restart
     `hermes dashboard`** so the new code is imported.
   - **Frontend (`dist/*`):** reload the browser; the script is re-injected.
   - There is **no build step** — `dist/index.js` and `dist/style.css` are edited
     by hand. Do not add a bundler or a `src/` tree without discussion.

## Safety & privacy rules (non-negotiable)

Every change must keep these invariants:

- **Olympus never writes Hermes files or databases.** Changes to Hermes happen
  only through Hermes' own HTTP endpoints, from a control the operator
  confirmed, recorded in Olympus' action log, and only while
  `dashboard.olympus.controls` is on. A new control needs a reported problem in
  `PRODUCT.md` and a Hermes endpoint that already does the work.
- **Olympus' own storage** lives in `$HERMES_HOME/plugin-data/olympus/` only.
- **No secrets in responses.** Run untrusted text through `redact_text`.
- **No local paths** in public responses; no shell execution from request paths.
- **SQLite is opened read-only** (`?mode=ro`) and defensively (tolerate missing
  tables/columns — see the `collect_kanban` / `collect_sessions` pattern).
- **Local labels stay hidden by default.** Session/task/cron names and exact
  routes are only shown when `dashboard.olympus.expose_local_labels` is true. Anything stripped
  internally is keyed with a leading `_` and removed by `strip_internal`.

If you change anything that reads Hermes internals (schemas, env vars, paths,
the plugin SDK), validate it against the actual `hermes-agent` source rather than
assuming — Hermes details are version-dependent.

## Code style

- **Python:** match the existing style — type hints, small pure helpers, and
  `try/except` only at real I/O boundaries (no defensive wrapping of code that
  cannot fail). Keep new logic in `plugin_api.py` unless it clearly warrants a
  new module.
- **JavaScript:** hand-authored SDK React via the injected
  `window.__HERMES_PLUGIN_SDK__` (React, hooks, a small component set,
  `fetchJSON`). No new runtime
  dependencies. Use `el(...)`/`cx(...)` helpers already in the file.
- Keep diffs scoped to the change. No drive-by reformatting.

## Verify before every commit

```bash
npm run verify       # backend compiles, frontend parses, whitespace is clean
npm run test:visual  # fixture-backed desktop/mobile visual smoke
```

When you touch a live data path, security boundary, or route allowlist, also run:

```bash
npm run test:live
npm run test:security
```

Exercise changed data paths against a live `$HERMES_HOME` or a fixture that
matches Hermes evidence shape. No mocks as proof of completion.

The visual fixture intentionally uses fixed evidence states. It is not a
substitute for a live Hermes check, but it catches the most common regressions:
console errors, horizontal overflow, unresolved Hermes theme colours, private
label leaks, and broken desktop/mobile layout.

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/) with a short,
plain subject:

```
feat: short feature
fix: short fix
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
4. Keep the safety and privacy invariants intact. Call out any new control
   explicitly, with the problem it solves and the Hermes endpoint it calls.

## Security

Please do not open public issues for security or privacy problems. See
[`SECURITY.md`](SECURITY.md) for the current posture and how to report.
