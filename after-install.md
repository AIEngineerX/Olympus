# After Install

Use this checklist after linking Olympus into a local HermesOS install.

## 1. Start Hermes Dashboard

```bash
npm run dev
```

Or run the commands manually:

```bash
scripts/install-dashboard-link.sh
hermes dashboard --no-open --skip-build
```

Open:

```text
http://127.0.0.1:9119/olympus
```

## 2. Confirm The Plugin Loaded

The Olympus tab should open in Brief mode with:

- hero status
- score details
- Agent Monitor
- tabs for Agents, Skills, Kanban, Policy, and Diagnostics

If the tab is missing, confirm:

```bash
ls -la "${HERMES_HOME:-$HOME/.hermes}/plugins/olympus/dashboard"
```

The path should point at this repository's `dashboard/` directory.

## 3. Run The Local Checks

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:performance
npm run test:security
```

Run the Desktop preflight when you want to check Hermes Desktop readiness:

```bash
npm run test:desktop
```

The Desktop preflight may warn that Hermes Desktop has no dashboard plugin-tab
route yet. That is expected until Hermes Desktop adds plugin-tab parity.

## 4. Check The First Screen

Brief mode should answer:

- What is the current agent readiness score?
- What state needs review?
- What is the next action owner?
- Which Agent Monitor metrics are unusual?

Deep inspection should stay behind the mode tabs:

- Agents: Performance Tracking, Profile Fitness, Pantheon
- Skills: Skill Coverage, Skill Hygiene
- Kanban: Trace Spine, Kanban Intelligence
- Policy: Tool Policy & Aux Cost
- Diagnostics: Operational Evals, Production Diagnostics, Evidence Sources

## 5. Privacy Defaults

Olympus hides local labels, paths, and raw IDs by default. To show local labels
on a private machine only:

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=1 hermes dashboard --no-open --skip-build
```

Do not expose the Hermes dashboard or Olympus plugin directly to the public
internet.

## 6. Troubleshooting

Backend changes require a full Hermes dashboard restart because Python plugin
routes are mounted at startup.

Frontend changes only need a browser reload because Hermes injects
`dashboard/dist/index.js` and `dashboard/dist/style.css` on page load.

If the dashboard shows stale data, use the Refresh button in Olympus, then run:

```bash
npm run test:live
```

If the live smoke fails on plugin linking, set this only when you intend to
replace the current Olympus dashboard link:

```bash
OLYMPUS_SMOKE_RELINK=1 npm run test:live
```
