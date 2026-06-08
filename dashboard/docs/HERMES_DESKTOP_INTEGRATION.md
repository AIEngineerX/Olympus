# Hermes Desktop Integration

Olympus is a read-only Hermes operations plugin. It should be visible from
Hermes Dashboard and Hermes Desktop, but it should not replace Desktop controls.

## Desktop Build Location

A local Hermes Desktop build typically runs from the Hermes home, for example:

```text
$HERMES_HOME/hermes-agent/apps/desktop/release/<platform>/Hermes.app
```

(`$HERMES_HOME` defaults to `~/.hermes`; `<platform>` is e.g. `mac-arm64`.)

The Desktop app has a Command Center Usage section backed by
`/api/analytics/usage?days=...`. The source at
`apps/desktop/src/app/command-center/index.tsx` renders sessions, API calls,
input/output tokens, estimated and actual cost, daily token bars, top models,
and top skills.

This means Olympus should not build another usage ledger. Olympus can use usage
evidence only to explain operational risk, routing pressure, skill hygiene, or
where the operator should go next.

## Boundary

Hermes Desktop owns chat, agents, profiles, skills, toolsets, providers, keys,
sessions, cron, messaging, artifacts, settings, and Command Center Usage.

Hermes web Dashboard owns admin pages and Analytics.

Olympus owns readiness, evidence, risk, skill hygiene, safe config policy,
Kanban intelligence, Pantheon, Trace Spine, and deterministic ops evals.

## Current State

The Hermes web dashboard supports dashboard plugin manifests and routes. Olympus
loads there through `dashboard/manifest.json`.

Hermes Desktop currently has a native route set and does not expose dashboard
plugin tabs such as `/olympus` as first-class Desktop pages.

Run the local preflight before preparing an upstream PR:

```bash
npm run test:desktop
```

The current expected result is a passing preflight with a warning that Desktop
has native routes but no dashboard plugin route signal yet.

## Target

Desktop should surface installed dashboard plugin tabs from the same
`GET /api/dashboard/plugins` manifest contract as the web dashboard.

## Preferred Upstream Change

Add Desktop plugin-tab parity:

1. Fetch dashboard plugin manifests from the Desktop backend.
2. Add visible plugin nav items for non-hidden plugin tabs.
3. Route each plugin tab to a safe plugin host.
4. Keep plugin APIs behind the same dashboard session-token flow.
5. Preserve plugin asset loading, CSS, and path constraints.

## Fallback

If Desktop maintainers do not want plugin-page parity yet, Olympus remains a web
dashboard plugin and Desktop should provide a safe "Open Dashboard Plugin" action
that opens `/olympus` in the local dashboard.

## Olympus Rule

Olympus remains read-only until a specific side-effect contract is approved. All
fixes continue to link to Hermes-owned pages.
