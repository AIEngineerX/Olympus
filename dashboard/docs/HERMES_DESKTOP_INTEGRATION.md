# Hermes Desktop Integration

Hermes Desktop does not render web-dashboard plugin tabs. It has its own plugin
SDK, so Olympus ships a separate Desktop page, `desktop/plugin.js`, that talks
to the same backend (`dashboard/plugin_api.py`).

## How the page is loaded

- Installing the plugin copies `desktop/plugin.js` into
  `$HERMES_HOME/desktop-plugins/olympus/`; the operator turns it on under
  **Capabilities → Plugins**.
- Desktop loads it uncompiled as an ES module. It may import only
  `@hermes/plugin-sdk`, `react` and `react/jsx-runtime`, so it uses
  `jsx()`/`jsxs()` instead of JSX.

## What the SDK allows (Hermes v0.22.5)

- `ctx.rest(path)` reaches `/api/plugins/olympus/...` only. The page cannot
  call Hermes' own `/api/cron/...` or Kanban routes the way the web tab does.
- `host.request(method, params)` is the gateway's JSON-RPC. `cron.manage`
  supports list, add, remove, pause and resume; it has no "run now".
  `kanban.run` is internal to the dispatcher and not usable from a page.
- `ctx.runAction(id)` opens allow-listed Desktop pages. Olympus uses
  `nav.cron`, `nav.profiles`, `nav.capabilities` and `nav.settings`.

## What the page shows today

The findings that need you (sessions open in Desktop; "I fixed this"), fix
tracking, cron spend and backlog triage. No controls.

## Next

Bring the roster, Needs-you queue and inspector to Desktop, with cron Pause and
Resume through `host.request("cron.manage", …)`. Every other control says to
act in the web dashboard and links to the page that owns it.

## Preflight

```bash
npm run test:desktop
```
