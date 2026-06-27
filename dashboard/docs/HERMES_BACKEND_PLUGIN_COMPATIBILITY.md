# Hermes Backend Plugin Compatibility

Olympus uses a static dashboard tab plus an optional Python FastAPI backend in
`dashboard/plugin_api.py`.

## Current Hermes behavior

Current Hermes main imports dashboard-plugin Python backends for:

- bundled plugins under the Hermes source tree
- user-installed plugins under `$HERMES_HOME/plugins`

Hermes blocks backend auto-import for project plugins under `./.hermes/plugins`.
That is the security boundary: a repository checkout can supply static plugin
assets, but it must not cause the dashboard server to import arbitrary Python
from the working tree.

The relevant guard in `hermes_cli/web_server.py` is source-specific:

```python
if plugin.get("source") == "project":
    # project plugins may not auto-import Python code
    continue
```

The manifest `api` value must also resolve to a safe file inside the plugin's
`dashboard/` directory.

## Supported Modes

| Mode | Static tab | `/api/plugins/olympus/*` backend | Status |
| --- | --- | --- | --- |
| User dashboard plugin under `$HERMES_HOME/plugins` | Yes | Yes, when `api` is safe | Current local development path |
| Bundled Hermes plugin under `hermes-agent/plugins/olympus/dashboard` | Yes | Yes | Preferred upstream integration path |
| Project plugin under `./.hermes/plugins` | Yes | No | Static UI only; Python import is blocked |
| Separate local service + static plugin | Yes | External only | Possible, but adds auth/daemon burden |
| Future trusted backend-plugin API | Yes | Yes | Optional if Hermes wants explicit trust controls |

## Smoke-Test Interpretation

Run:

```bash
npm run test:compat
```

Expected result for a current user-plugin install:

```text
backendMounted: true
likelyReason: backend routes mounted
```

If `/olympus` loads but `/api/plugins/olympus/*` returns `404`:

1. Check `pluginSource` in `npm run test:compat`.
2. If the source is `project`, the backend is intentionally blocked.
3. If the source is `user`, inspect manifest discovery, safe API-path validation,
   dashboard process freshness, and Hermes version drift.

A `404` backend route does **not** by itself mean `dashboard/plugin_api.py`
failed to compile.

## Product Boundary

Olympus should keep linking to Hermes-owned pages for actual mutations:
profiles, skills, cron, gateways, MCP, memory, config, and keys. Backend support
is for read-only synthesis, scoring, privacy-redacted evidence, and tuning
recommendations.

Olympus should not be pitched as a replacement for Hermes Analytics. Use it as
an operational tuning layer that links to Analytics/Usage for ledgers.
