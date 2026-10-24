# Security and Privacy

Olympus is a local Hermes dashboard plugin. It is designed to run behind the
Hermes dashboard session-token middleware and should not be exposed directly to
the public internet.

## Current posture

- Olympus never writes Hermes files or databases; every Hermes store is opened
  with a read-only SQLite connection or read as a file.
- Controls (pause, resume or run a cron job; answer, retry, reclaim or reassign
  a Kanban task) are executed by Hermes' own HTTP endpoints, called from the
  browser through the Hermes plugin SDK with the dashboard session token. Each
  one is confirmed by the operator first and recorded in Olympus' action log.
- `dashboard.olympus.controls: false` in `config.yaml` turns every control off.
  `GET /resolve`, which turns a hashed ref into the id Hermes needs, then
  refuses, and the controls fail closed if the config cannot be read.
- Olympus' own routes write only to `$HERMES_HOME/plugin-data/olympus/`
  (`POST /actions` for the action log, `POST`/`DELETE /fixes` for fix tracking).
- No credential reveal routes.
- No direct shell execution from HTTP requests.
- SQLite reads use read-only connections.
- Secret-like error text is redacted before it is returned.
- Full local filesystem paths are not returned by public plugin responses.
- Session titles, Kanban task titles, cron names, and exact model/provider labels
  are hidden by default.
- Skill names from usage and hub metadata are hashed by default.
- Config policy responses expose only safe counts, booleans, and generic route
  evidence. Prompt text, personality text, base URLs, API keys, env values, and
  local paths are not returned.

## Local label opt-in

Operators who want richer local labels can enable them in `config.yaml`:

```yaml
# $HERMES_HOME/config.yaml
dashboard:
  olympus:
    expose_local_labels: true
```

Only use this on a private machine. With this setting enabled, Olympus may show
local session titles, task titles, cron names, and model/provider labels in the
dashboard.

## OSS review checklist

Before publishing or opening a PR:

1. Run `npm run verify`.
2. Run `npm run test:visual`.
3. Run `npm run test:live` for live route, layout, or plugin mounting changes.
4. Run `npm run test:performance` for live `/overview` and `/performance`
   response budget checks.
5. Run `npm run test:security` for payload, redaction, labels, config, skills,
   or evidence-source changes.
6. Run `npm audit --audit-level=moderate`.
7. Search for private paths, tokens, usernames, private model names, and old
   project-specific references.
8. Confirm generated files such as `.DS_Store`, `__pycache__`, screenshots, and
   local database files are not staged.
9. Confirm Olympus still uses Hermes dashboard auth and does not add direct
   unauthenticated routes.
10. Confirm any new control goes through a Hermes endpoint, is confirmed,
    logged and covered by `dashboard.olympus.controls`, and is documented here.
