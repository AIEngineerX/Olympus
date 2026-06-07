# Security and Privacy

Olympus is a local Hermes dashboard plugin. It is designed to run behind the
Hermes dashboard session-token middleware and should not be exposed directly to
the public internet.

## Current posture

- Read-only by default.
- No mutation routes.
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

Operators who want richer local labels can start Hermes with:

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=1 hermes dashboard --no-open --skip-build
```

Only use this on a private machine. With this setting enabled, Olympus may show
local session titles, task titles, cron names, and model/provider labels in the
dashboard.

## OSS review checklist

Before publishing or opening a PR:

1. Run `npm run verify`.
2. Run `npm run test:visual`.
3. Run `npm run test:live` for live route, layout, or plugin mounting changes.
4. Run `npm run test:security` for payload, redaction, labels, config, skills,
   or evidence-source changes.
5. Search for private paths, tokens, usernames, private model names, and old
   project-specific references.
6. Confirm generated files such as `.DS_Store`, `__pycache__`, screenshots, and
   local database files are not staged.
7. Confirm Olympus still uses Hermes dashboard auth and does not add direct
   unauthenticated routes.
8. Confirm any new write action is gated, explicit, and documented.
