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

- renders the score explanation, Agent HQ, signal strip, tuning queue, Kanban intelligence, Olympus state scene, profile matrix, and evidence rail
- links actions to existing Hermes pages
- avoids duplicating Kanban, Sessions, Cron, Profiles, Logs, Models, Config, Keys, MCP, or Memory admin surfaces

## Next Work

1. Correlate Kanban `session_id` and `task_runs` to Hermes sessions.
2. Add dispatcher/orchestration settings evidence.
3. Rank task-level tuning recommendations from blocked, stale, retry, tool-heavy, unassigned, and unhealthy-assignee signals.
4. Keep action buttons as handoff links unless a write action is explicitly approved.

## Done Means

An operator can open `/olympus` and answer:

1. What is running?
2. What is broken?
3. What is stale or blocked?
4. Which profile owns the issue?
5. What evidence backs the finding?
6. Where should I go to fix it?
