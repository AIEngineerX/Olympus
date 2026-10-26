# Product

## Register

product

## Users

Hermes operators who run several agents (profiles) with cron jobs, Kanban
workers, subagents and messaging gateways, much of it unattended. They keep
Olympus open on a second monitor and glance at it to see whether any agent is
stuck or waiting on them, then stop to deal with one.

## Problem and evidence

Every feature must trace to one of these. Evidence is from the open
NousResearch/hermes-agent issues (all 17,003 read by title and body on
2026-10-24; counts are distinct authors and are upper bounds).

| Problem | Evidence | Olympus today |
| --- | --- | --- |
| Agents and their helpers fail or stall, and nobody sees it | #6779, #107310, #131648, #137466, #88580 (about 128 people) | Roster, Needs-you queue, inspector |
| Cron runs fail, skip, or report success silently | #20302, #20353, #127723, #134858, #143960 (about 96) | Failed and overdue jobs in Needs you; run history and incidents planned |
| Kanban tasks are held back or stuck with no reason shown | #29458, #119070, #83047, #35986, #137597 (about 61) | Stalled, blocked and failing tasks with Answer, Retry, Reclaim, Reassign; held-back tasks planned |
| Which runs succeed, how long they take, which tools fail | #6642 (1 clear request) | Performance view; no further investment until a real user uses it |
| Cost per job or task | #106615, #107744, #131119 (7 people) | Spend per cron job in Checks |

Not possible as a plugin: approvals nobody sees (#133514, about 73 people).
Hermes keeps pending approvals in gateway memory, with no table or API to read.

Status: **useful: unproven.** No operator outside this project has used
Olympus on their own agents yet.

## Product Purpose

Olympus is where you manage your Hermes agents. It shows every agent with what
it is doing, what it is waiting on and what went wrong, gathers everything that
needs a person into one queue, shows how reliably each agent's runs succeed,
and lets you act safely through Hermes' own APIs.

Success means an operator can answer, in one glance: which agent needs me, and
what do I do about it?

## Own

- The agent roster: one row per agent (Hermes profile) with live state, current
  task and tool, helpers, last activity and a week of runs.
- One Needs-you queue: questions waiting on an answer, failed or overdue cron,
  stalled or failing workers, blocked or unassigned work, offline gateways,
  looping or expensive runs.
- The agent inspector: recent activity, scheduled jobs, Kanban work, how the
  agent works, and whether your fixes worked.
- Performance: run success, run time, tool failures and cost per agent, with
  every run open step by step.
- Controls, each confirmed and logged and executed by Hermes' own endpoints:
  pause, resume or run a cron job; answer, retry, reclaim or reassign a Kanban
  task. `dashboard.olympus.controls: false` turns them off.
- Checks that are not about one agent: findings, backlog triage, skill hygiene,
  policy, where spend goes.
- Opt-in alerts through a Hermes no-agent cron job.

## Do Not Own

- Writing Hermes files or databases. Every store is opened read-only; every
  change goes through a Hermes endpoint.
- Creating or deleting agents, cron jobs or tasks; editing prompts, models,
  skills, toolsets, keys or config. Olympus links to the Hermes page that owns
  them.
- Usage ledgers and model leaderboards. Hermes Analytics owns those.
- Scores, decoration, or anything that does not trace to a problem above.

## Brand Personality

Calm, certain, exact. Like an oracle that is always right and never loud.

The interface is quiet product UI in the spirit of Linear and Stripe: flat,
precise, legible at a distance. Its Olympus identity is a whisper: a laurel
mark beside a serif wordmark and a single Greek-key rule.

## Anti-references

- A tokens or spend dashboard. Usage is per-agent evidence, not the page.
- A readiness or health score. Nobody asked for one, and it hides the reason.
- Generic AI-tool marketing, buzzwords, feature theater.
- Decorative visuals that do not show an agent's state (constellations,
  glows, gradients, glass, drop shadows).
- A shrunk network diagram with unreadable labels.
- Rows of identical label/number/chip tiles.
- Controls that act without saying exactly what will happen.
- Hidden local paths, secrets or raw private labels unless explicitly enabled.

## Design Principles

1. Agents first. Every screen is organised around the agents; everything else
   is a detail of an agent or a check.
2. One queue. Anything that needs a person appears once, in Needs you, with
   its action.
3. Safe hands. Controls are few, always confirmed, always logged, and always
   executed by Hermes, never by Olympus writing files.
4. Native to Hermes. Colours, radius and fonts come from the active Hermes
   theme.
5. Evidence on demand. The main view states; the inspector explains.
6. Private by default. Labels and content stay hidden unless the operator opts
   in on a private machine.

## Accessibility & Inclusion

WCAG 2.2 AA for contrast, keyboard and focus. The roster is fully keyboard
operable (arrows, Enter, Esc). Status is never colour alone: every pill has a
word. Motion is limited to the live dot and short state transitions, and
respects reduced-motion preferences.
