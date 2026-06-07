# Olympus Build Plan

## Goal

Build a HermesOS Agent Monitor dashboard that answers:

- what needs attention
- which agent/profile owns it
- what evidence supports the finding
- what Hermes page owns the next action

Olympus remains read-only until a write action has an approved side-effect contract.

## Current Build

Backend: `plugin_api.py`

- reads Hermes profile, cron, session, gateway, log, and Kanban metadata
- computes health, attention, tuning recommendations, score deductions, Agent Monitor tuning items, and skill hygiene signals
- computes safe config policy, browser privacy, fallback, toolset, and auxiliary cost visibility signals
- redacts secrets and hides local labels by default
- returns an Evidence Sources contract for the Hermes stores and safe fields used in each scan

Frontend: `dist/index.js` and `dist/style.css`

- renders the score explanation, Agent Monitor, tuning queue, Pantheon, conditional Kanban intelligence, and activity events
- renders Evidence Sources inside Performance Tracking so operators can see the first-party source basis for each scan
- renders Tool Policy & Aux Cost from safe Hermes config fields and session cost-visibility metadata
- renders Skill Hygiene from local skill usage and hub provenance metadata
- links actions to existing Hermes pages
- avoids duplicating Kanban, Sessions, Cron, Profiles, Logs, Models, Config, Keys, MCP, or Memory admin surfaces

## Hermes Dashboard Finding

Hermes Dashboard already manages agents, profiles, skills, sessions, cron,
models, gateways, logs, Kanban, and plugin pages. Olympus does not rebuild
those controls.

Hermes Desktop also has Command Center Usage. It shows sessions, API calls,
input/output tokens, daily token bars, top models, top skills, and cost. Olympus
must not become a second Usage page. It may use usage evidence only to flag
operator risk and link to Hermes Usage/Analytics for the ledger.

Olympus adds the missing tuning layer:

- Which profile is weak, overloaded, or underconfigured?
- Which skill coverage gap is causing repeated tool use or slow work?
- Which Kanban worker is stuck, stale, retrying, or routed poorly?
- Which signal proves the recommendation?
- Which Hermes page owns the fix?

## Phase Status

Complete and test each item before starting the next.

### 0. Evidence Contract (shipped)

Backend:

- `evidence_sources` is returned from `/overview` and `/tuning`.
- Sources include Hermes state, Kanban, config, skill usage metadata, and skill hub lock metadata.
- The contract reports presence, read state, counts, safe field names, redaction policy, and Hermes-owned fix links.
- Raw paths, raw session IDs, raw task IDs, prompt text, and secret-like values remain hidden by default.
- Cron IDs, Kanban run IDs, worker PIDs, and event IDs use public refs by default.
- Health log warnings identify the scan as a log-tail check unless timestamp
  parsing is added.

Frontend:

- Render Evidence Sources in the Performance Tracking diagnostics area.
- Keep it compact and link only to Hermes-owned pages.
- Fixture and live smoke checks require the strip to render.
- Agent Monitor keeps first-screen density bounded: six metric tiles and three
  full tuning cards by default, with secondary signals collapsed.

### 1. Skill Coverage (shipped)

Backend:

- `skill_coverage` is returned from `/overview` and `/tuning`.
- Use local profile skill counts, session tool/message pressure, Kanban forced
  skill counts, and task/status patterns.
- Recommend skill bundles only from observed repeated work patterns.
- Keep skill names and local labels redacted unless local-label exposure is
  enabled.

Frontend:

- Render a compact Skill Coverage panel.
- Show coverage state, repeated-work signals, and top recommendations.
- Link to `/skills`, `/sessions`, and `/kanban`.
- Hide the panel when there is no useful signal.

### 2. Profile Fitness (shipped)

Backend:

- `profile_fitness` is returned from `/overview` and `/tuning`.
- Score each profile from workload, gateway state, route metadata, skill count,
  cron load, active Kanban work, blocked work, session failures, loop pressure,
  and context pressure.
- Return a concise top issue and fix link for each profile.

Frontend:

- Add a Profile Fitness panel.
- Show each profile as stable, watch, or needs review.
- Explain the top issue without exposing private local labels by default.
- Link to the Hermes page that owns the fix.

### 3. Kanban Worker Inspector (partially shipped)

- Shipped: Kanban Intelligence summarizes open, ready, running, blocked, review,
  active workers, stale workers, failed runs, assignee load, and attention
  items from Hermes Kanban evidence.
- Shipped: Trace Spine V0 correlates Kanban task refs, task runs, task events,
  and Hermes session refs, then summarizes failure points without transcript
  content.
- Remaining: dispatcher/orchestration settings evidence when Hermes exposes it
  as safe read-only metadata.
- Keep action buttons as handoff links until a write action is approved.

### 4. Pantheon V2 Visual Restoration (shipped)

- Restores Pantheon as an operational control, not a decorative diagram.
- Impeccable product-UI review covered the live `/olympus` surface, product
  register, build plan, `VIEWPORT_STRATEGY.md`, CSS, and browser screenshots.
- Uses current `/overview` evidence: profiles, trigger lanes, workload, profile
  state, selected profile details, orchestration summary, and activity events.
- Keeps agent nodes as accessible HTML buttons with selected state and visible
  focus. Readable labels are HTML text, not SVG text.
- Desktop shows the visual map and selected-profile inspector together.
  Mid-width and mobile use a compact map/node grid with no horizontal overflow.

### 5. Curator and Skill Hygiene (partially shipped)

- Surface unused, heavily used, stale, archived, or recently changed skills from
  local Hermes evidence.
- Read skill usage/provenance from Hermes skill usage metadata.
- Read hub install trust, scan verdict, and stored metadata from Hermes hub lock metadata.
- Treat skills.sh security audit metadata (`agent-trust-hub`, `socket`, `snyk`
  Pass/Warn/Fail) as optional local evidence only when Hermes has already stored
  it.
- Link to Hermes Skills or Curator surfaces.
- Do not install, scan, delete, archive, restore, or mutate skills from Olympus v1.
- Remaining: add a Curator-specific route once Hermes exposes one.

### 6. Tool Policy & Auxiliary Cost Watch (shipped)

- Reads only safe config structure: route presence, fallback counts, toolset
  counts, agent turn limits, loop guardrail presence, compression presence,
  browser privacy flags, and auxiliary route presence.
- Correlates auxiliary route presence with Hermes session cost visibility.
- Flags high turn limits without a visible hard loop stop, browser private URL
  or recording flags, fallback routes without route audit evidence, and
  auxiliary routes without cost evidence.
- Links only to Hermes-owned `/config`, `/analytics`, and `/sessions` routes.
- Does not return prompt text, personality text, base URLs, API keys, env
  values, provider secrets, local paths, or exact route labels by default.

### 7. Hermes Desktop Plugin Parity (planned)

- Keep Olympus Dashboard-first until Desktop exposes dashboard plugin tabs.
- Run `npm run test:desktop` before preparing the upstream PR.
- Prepare an upstream Hermes Desktop PR that reads dashboard plugin manifests,
  shows plugin nav entries, and hosts plugin pages safely.
- Do not duplicate Desktop Command Center Usage. Link to Hermes Usage/Analytics
  for token, model, session, and cost totals.
- The Desktop preflight passes locally with a warning until plugin-tab route
  parity lands.

### 8. Deterministic Operational Evals (shipped)

- Adds `ops_evals` to `/overview` and `/tuning`.
- Uses fixed reliability, routing, skill-use, and efficiency checks from Hermes
  sessions, Kanban, skill metadata, and safe config policy.
- Renders as operational checks with evidence, basis, state, score, and handoff
  links.
- Does not claim answer quality, benchmark quality, or model intelligence.

## Bug-Test Gate

Run after each implemented item:

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:security
npm run test:desktop
```

Live check:

- Open `http://127.0.0.1:9119/olympus`.
- Confirm no browser console warnings or errors.
- Confirm no mock, fake, or placeholder data renders.
- Confirm empty sections hide.
- Confirm action links go to Hermes-owned pages.

## Done Means

An operator can open `/olympus` and answer:

1. What is running?
2. What is broken?
3. What is stale or blocked?
4. Which profile owns the issue?
5. What evidence backs the finding?
6. Where do I go to fix it?
