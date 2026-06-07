# Olympus Goal

Olympus is HermesOS Agent HQ.

It is not a new orchestrator, Kanban clone, or admin dashboard. Hermes runs the
agents. Kanban coordinates durable work. The Hermes dashboard owns admin pages.
Olympus explains how the agent system is performing and what to tune next.

## Core Question

What should I tune, route, unblock, or review so my HermesOS agents perform
better?

## Own

- Cross-surface recommendations.
- Evidence from profiles, routes, skills, sessions, cron, gateways, Kanban, MCP,
  memory, tools, and runtime health.
- Agent/profile workload and readiness signals.
- Handoff links to the Hermes page that owns each action.
- Read-only diagnostics until a write action is approved.
- A visual Olympus layer that clarifies live state.

## Do Not Own

- Kanban board mechanics, task creation, comments, drag/drop, or worker drawers.
- Sessions, Analytics, Cron, Skills, Models, Logs, Profiles, Config, Keys, MCP,
  Webhooks, Memory, or System admin clones.
- Profile CRUD, skill install/toggle, toolset editing, gateway start/stop, cron
  edit/trigger, or config mutation in v1.
- Visual elements that do not clarify operational state.

## Useful Signals

- failed or stale runs
- blocked or unassigned ready work
- overloaded or idle profiles
- missing route metadata
- missing skill coverage
- long threads and tool-heavy sessions
- cron failures and noisy schedules
- gateway health and delivery errors
- repeated Kanban retries, crashes, stale heartbeats, and orphaned runs

## Product Boundary

If a feature mutates tasks, profiles, cron, gateway, memory, credentials, or
config, first check whether an existing Hermes page or API owns it. If Hermes
already owns it, Olympus should recommend, explain, and link rather than
duplicate the control.

## Next Direction

Build Trace Spine V0 from first-party Hermes evidence:

1. Correlate sessions, messages, Kanban tasks, task runs, and task events.
2. Summarize tool sequences and failure points without transcript content.
3. Rank task-level recommendations by blocked, stale, retry, tool-heavy,
   unassigned, handoff failure, and unhealthy-assignee signals.
4. Keep action buttons as handoff links unless a write action is approved.
