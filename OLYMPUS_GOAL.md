# Olympus Goal

Olympus is where you manage your Hermes agents.

Hermes runs the agents. Olympus shows every agent you have, what each one is
doing right now, what it is waiting on, and what went wrong, and lets you act on
it safely through Hermes' own APIs.

## Core Question

Which of my agents needs me right now, and what do I do about it?

## Own

- The agent roster: one row per agent (Hermes profile) with live state, current
  task, helpers (subagents, Kanban workers, cron jobs), last activity and
  issues.
- One "Needs you" queue across everything Olympus checks: agents waiting on an
  answer, failed or overdue cron, stalled or failed workers, failed skill
  audits, risky config.
- The agent inspector: recent activity, scheduled jobs, Kanban work, tokens and
  cost per agent, and whether your fixes worked.
- Safe controls, each confirmed and logged, executed by Hermes' own endpoints:
  pause / resume / run a cron job, retry / reclaim / reassign / answer a Kanban
  task.
- Checks that are not about one agent: backlog triage, skill hygiene, policy
  audit, where spend goes, diagnostics.
- Opt-in alerts through a Hermes no-agent cron job.

## Do Not Own

- Writing Hermes files directly. Every change goes through a Hermes endpoint.
- Creating or deleting agents, cron jobs or tasks, editing prompts, models,
  skills, toolsets, keys or config. Those stay on Hermes' pages; Olympus links
  to them.
- Usage ledgers and model leaderboards. Hermes Analytics owns those; Olympus
  shows tokens and cost only per agent, as evidence.
- Decoration that does not clarify an agent's state.

## Boundary

If an action is not one of the safe controls above, Olympus explains it and
links to the Hermes page that owns it. Controls can be turned off with
`dashboard.olympus.controls: false` in `config.yaml`.
