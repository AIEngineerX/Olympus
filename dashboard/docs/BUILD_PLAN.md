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
- computes health, attention, tuning recommendations, score deductions, and Agent HQ opportunities
- redacts secrets and hides local labels by default

Frontend: `dist/index.js` and `dist/style.css`

- renders the score explanation, Agent HQ, tuning queue, Party View, conditional Kanban intelligence, and activity events
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

## Ordered Implementation Plan

Complete and test each item before starting the next.

### 1. Skill Coverage

Backend:

- Add `skill_coverage` to `/overview` and `/tuning`.
- Use local profile skill counts, session tool/message pressure, Kanban forced
  skill counts, and task/status patterns.
- Recommend skill bundles only from observed repeated work patterns.
- Keep skill names and local labels redacted unless local-label exposure is
  enabled.

Frontend:

- Add a compact Skill Coverage panel.
- Show coverage state, repeated-work signals, and top recommendations.
- Link to `/skills`, `/sessions`, and `/kanban`.
- Hide the panel when there is no useful signal.

### 2. Profile Fitness

Backend:

- Add `profile_fitness` to `/overview` and `/tuning`.
- Score each profile from workload, gateway state, route metadata, skill count,
  cron load, active Kanban work, blocked work, session failures, loop pressure,
  and context pressure.
- Return a concise top issue and fix link for each profile.

Frontend:

- Add a Profile Fitness panel.
- Show each profile as stable, watch, or needs review.
- Explain the top issue without exposing private local labels by default.
- Link to the Hermes page that owns the fix.

### 3. Kanban Worker Inspector

- Correlate Kanban `session_id` and `task_runs` to Hermes sessions.
- Add dispatcher/orchestration settings evidence.
- Rank task-level tuning recommendations from blocked, stale, retry,
  tool-heavy, unassigned, and unhealthy-assignee signals.
- Keep action buttons as handoff links unless a write action is explicitly
  approved.

### 4. Curator and Skill Hygiene

- Surface unused, heavily used, stale, or recently changed skills if Hermes
  exposes the evidence locally.
- Link to Hermes Skills or Curator surfaces.
- Do not install, delete, or mutate skills from Olympus v1.

### 5. Auxiliary Cost Watch

- Detect background or auxiliary work causing token pressure.
- Highlight expensive routes used for background tasks.
- Stay provider and model agnostic.

## Bug-Test Gate

Run after each implemented item:

```bash
python3 -m py_compile dashboard/plugin_api.py
node --check dashboard/dist/index.js
git diff --check
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
