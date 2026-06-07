# Olympus Build Plan

## Goal

Build a HermesOS Agent HQ dashboard that answers:

- what needs attention
- which agent/profile owns it
- what evidence supports the finding
- what Hermes page owns the next action

Olympus stays read-only until a control has a clear side-effect contract.

## Current Build

Backend: `plugin_api.py`

- reads Hermes profile, cron, session, gateway, log, and Kanban metadata
- computes health, attention, tuning recommendations, score deductions, Agent HQ tuning items, and skill hygiene signals
- redacts secrets and hides local labels by default
- returns an Evidence Sources contract for the Hermes stores and safe fields used in each scan

Frontend: `dist/index.js` and `dist/style.css`

- renders the score explanation, Agent HQ, tuning queue, Pantheon, conditional Kanban intelligence, and activity events
- renders Evidence Sources inside Performance Tracking so operators can see the first-party source basis for each scan
- renders Skill Hygiene from local skill usage and hub provenance metadata
- links actions to existing Hermes pages
- avoids duplicating Kanban, Sessions, Cron, Profiles, Logs, Models, Config, Keys, MCP, or Memory admin surfaces

## Hermes Dashboard Finding

Hermes Dashboard already manages agents, profiles, skills, sessions, cron,
models, gateways, logs, Kanban, and plugin pages. Olympus should not rebuild
those controls.

Olympus should add the missing tuning layer:

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

Frontend:

- Render Evidence Sources in the Performance Tracking diagnostics area.
- Keep it compact and link only to Hermes-owned pages.
- Fixture and live smoke checks require the strip to render.

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

### 3. Kanban Worker Inspector (open)

- Correlate Kanban `session_id` and `task_runs` to Hermes sessions.
- Add dispatcher/orchestration settings evidence.
- Rank task-level tuning recommendations from blocked, stale, retry,
  tool-heavy, unassigned, and unhealthy-assignee signals.
- Keep action buttons as handoff links unless a write action is explicitly
  approved.

### 4. Pantheon V2 Visual Restoration (shipped)

- Restores the Pantheon identity as a real operational control, not a decorative
  diagram.
- Impeccable product-UI gate was run against the live `/olympus` surface. The
  repo-local helper was missing, so the installed Impeccable skill, product
  register, this build plan, `VIEWPORT_STRATEGY.md`, existing CSS, and live
  browser screenshots were used.
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
- Remaining: show stored skills.sh audit fields when Hermes persists them and add a Curator-specific route once Hermes exposes one.

### 6. Auxiliary Cost Watch (open)

- Detect background or auxiliary work causing token pressure.
- Highlight expensive routes used for background tasks.
- Stay provider and model agnostic.

## Bug-Test Gate

Run after each implemented item:

```bash
python3 -m py_compile dashboard/plugin_api.py
node --check dashboard/dist/index.js
git diff --check
npm run test:security
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
6. Where should I go to fix it?
