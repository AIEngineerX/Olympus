# Backend-off mode

Hermes serves a user plugin's dashboard assets before it imports the plugin's
Python API. The API is mounted only once `olympus` is in `plugins.enabled`
(`hermes plugins enable olympus`), and project plugins never get one. Until
then `/olympus` renders while `/api/plugins/olympus/*` returns `404`.

## What the tab shows

When `/api/plugins/olympus/overview` cannot be loaded, the page:

- says the Olympus backend is off and gives the command that turns it on;
- lists your agents from Hermes' own `GET /api/profiles`, called through
  `window.__HERMES_PLUGIN_SDK__.fetchJSON` so Hermes keeps owning auth. Names
  are shown as "Default", "Profile 1", … so no local label leaks;
- hides the views, the queue and every control, which all need the backend.

## Why not rebuild Olympus in the browser?

Hermes' dashboard APIs are page APIs, not Olympus' redacted model. Rebuilding
the roster, queue or performance in browser JavaScript would duplicate the
backend, raise the risk of leaking local labels, and mean reading config and
sessions directly from the frontend. The fallback stays narrow on purpose.

## Verification

```bash
npm run test:compat
npx playwright test tests/visual/olympus.spec.js -g "backend off"
```

`npm run test:compat` reports whether the live Hermes mounted the Olympus API.
