# Olympus Dashboard Package

This directory is the Hermes dashboard plugin package for Olympus.

## Files

- `manifest.json`: plugin metadata, tab path, frontend assets, backend module
- `plugin_api.py`: FastAPI router mounted by Hermes
- `dist/index.js`: frontend registered with the Hermes plugin SDK
- `dist/style.css`: `olympus-*` styles
- `docs/BUILD_PLAN.md`: implementation plan

## Routes

Hermes mounts this plugin at:

```text
/api/plugins/olympus/
```

Routes:

- `GET /health`
- `GET /overview`
- `GET /tuning`

## Data Rules

- Read-only.
- No secret values in responses.
- No direct shell execution from HTTP routes.
- No local paths in public responses.
- No cross-profile private content by default.
- Unknown state stays `unknown`.

## Local Labels

Default behavior hides local session titles, Kanban task titles, cron names, and
exact route labels.

Private-machine opt-in:

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=1 hermes dashboard --no-open --skip-build
```

## Verify

Run from this directory:

```bash
python3 -m py_compile plugin_api.py
node --check dist/index.js
```
