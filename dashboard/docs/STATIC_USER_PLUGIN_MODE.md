# Static / Backend-Unavailable Mode

Current Hermes main mounts Python backends for bundled and user-installed
dashboard plugins when `manifest.api` is safe. Project plugins remain
static-only, and older/stale Hermes dashboard processes may also leave
`/api/plugins/olympus/*` unavailable. In those cases `/olympus` can render while
the Olympus backend routes return `404`.

## Frontend fallback

When `dashboard/dist/index.js` cannot load `/api/plugins/olympus/overview`, it switches to a frontend-only compatibility view. The fallback only calls existing Hermes dashboard APIs through `window.__HERMES_PLUGIN_SDK__.fetchJSON` so dashboard auth/session handling stays owned by Hermes.

| Existing Hermes API | Static mode use | Olympus panel |
| --- | --- | --- |
| `GET /api/dashboard/plugins` | Confirm Olympus manifest discovery, source, and `has_api` status. | Backend-unavailable notice, Diagnostics evidence source |
| `GET /api/status` | Show Hermes version/auth/gateway count shape when available. | Diagnostics evidence source |
| `GET /api/profiles` | Count profiles without showing local profile names. | Agent Monitor count, Profile Fitness placeholder |
| `GET /api/skills` | Count installed skills without showing skill names. | Skill Coverage/Hygiene count placeholders |
| `GET /api/sessions/stats` | Count sessions without reading transcript bodies. | Performance Tracking session lane |
| `GET /api/cron/jobs` | Count cron jobs without mutating schedule state. | Performance Tracking cron lane |

## Hidden or labelled in static mode

These panels require mounted Olympus backend synthesis and are hidden, empty, or explicitly labelled as unavailable in the fallback:

- Readiness scoring and score deductions.
- Kanban board synthesis, Trace Spine, and worker attention items.
- Skill hygiene/audit synthesis and profile fitness scoring.
- Tool policy, config risk, and auxiliary cost recommendations.
- Operational evals and production diagnostics from Olympus evidence collectors.

## Why not synthesize everything in the browser?

The first-party Hermes dashboard APIs are page APIs, not Olympus' redacted operations model. Rebuilding Olympus synthesis in browser JavaScript would either duplicate backend collectors, increase local-label/privacy risk, or start inspecting config/env/session details directly from the plugin frontend. Static mode therefore stays deliberately narrow: counts, compatibility status, links to Hermes-owned pages, and a clear recommendation to use a mounted user/bundled backend for full Olympus.

## Verification

Run:

```bash
npm run verify
npm run test:compat
npx playwright test tests/visual/olympus.spec.js -g "backend-unavailable mode"
```

`npm run test:compat` identifies whether the live Hermes instance mounted Olympus backend routes, is blocked by project-plugin source, or needs a dashboard restart/version update.
