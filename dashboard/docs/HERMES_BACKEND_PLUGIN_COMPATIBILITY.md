# Hermes Backend Plugin Compatibility

Olympus is a dashboard tab (`dashboard/dist/*`) plus a FastAPI router
(`dashboard/plugin_api.py`) that Hermes mounts at `/api/plugins/olympus/`.

## When Hermes mounts the Olympus API

Verified against Hermes v0.22.5 (`hermes_cli/web_server_dashboard.py`,
`_plugin_api_mount_skip_reason`):

| Plugin source | Python `api` imported? |
| --- | --- |
| `user` (`$HERMES_HOME/plugins/olympus/`, including catalog installs) | Only when `olympus` is in `plugins.enabled` and not in `plugins.disabled` (GHSA-mcfc-hp25-cjv7). |
| `bundled` (`hermes-agent/plugins/`) | Yes, unless explicitly disabled. |
| `project` (`./.hermes/plugins/`) | Never; project plugins ship with the working directory and are untrusted (GHSA-5qr3-c538-wm9j). |

`hermes plugins enable olympus` writes `plugins.enabled`. The check repeats on
every request, and a newly enabled plugin is mounted on its first request.

With `plugins.isolation: host`, non-bundled plugin APIs run in the profile's
plugin host process and Hermes forwards `/api/plugins/olympus/*` to it through
an ASGI bridge. Responses are buffered, which suits Olympus' JSON routes.

The earliest SemVer release with this behaviour is v0.21.6, which is the
`requires_hermes` floor in `plugin.yaml`.

## Diagnose the active mode

```bash
npm run test:compat
```

It reports whether Hermes discovered the Olympus manifest, whether the plugin
source is `user`, `bundled` or `project`, and the HTTP status of
`/api/plugins/olympus/health` and `/overview`. A `404` from those routes with a
`user` source almost always means the plugin is not in `plugins.enabled`.

## Without the backend

If the API is not mounted, the tab renders a reduced view from Hermes' own
dashboard APIs. See [`STATIC_USER_PLUGIN_MODE.md`](STATIC_USER_PLUGIN_MODE.md).
