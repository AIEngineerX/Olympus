# Changelog

All notable changes to Olympus are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] - 2026-10-27

### Added

- Two more alerts, both things the Needs-you queue already showed but only
  while the tab was open: a Kanban task blocked on a question for you
  ("... is waiting on your answer", with the question when local labels are
  exposed), and an agent's gateway not running while scheduled jobs or ready
  tasks wait on it (with the start command). An overdue cron job whose
  gateway is offline is no longer alerted on separately; the gateway alert
  explains it.

- Performance shows the trend: each agent's success rate, run time, cost and
  run count for the window are compared with the equal window before it
  (`previous` and `trend` on every agent and on the fleet in `GET /performance`),
  and the table carries a thin success-rate-per-day line beside the comparison
  in words. "96% of 25, was 100% the 7 days before" and "7% faster than
  before" are sentences the view could not say before. With the panel open the table keeps
  Agent, Runs, Succeeded, Trend and Cost.

### Changed

- The visual fixture seeds its history at noon UTC on each day, so rebuilding
  it at a different hour no longer moves runs across the window boundary and
  changes the counts the tests assert. Coder now has a prior week of runs.

- Olympus no longer opens a profile's `.env` file for any reason. Which
  messaging platforms a profile has configured now comes from Hermes' own
  `channel_platforms_configured` helper (its read of the env file and
  config.yaml); a standalone load without `hermes_cli` falls back to
  config.yaml alone. The auxiliary-route policy signal is config-only, and the
  unused `has_env` field left the agent setup summary. This follows plugin
  catalog rule 11 (credentials come through Hermes, never from files).

## [2.0.0] - 2026-10-26

Olympus is now organised around your agents, and keeps only what traces to a
problem Hermes operators have reported (see `PRODUCT.md`). The 1.1.0 entry
below was never released; this supersedes its Brief, Fleet and readiness parts.
The major version marks the removals: the readiness score and `GET /tuning`
are gone, and the Brief, Fleet and readiness views are replaced.

This is the first release of the agent-centred Olympus. It has been exercised
on one test install with three agents, not yet on anyone else's; if something
on your own install reads wrong, please open an issue. Known issues are listed
in the README.

### Added

- Agents view: a roster with one row per agent (status in a word, current task
  and live tool, helpers, last activity, a week of runs with the unsuccessful
  ones marked), one Needs-you queue, and an inspector per agent.
- Controls through Hermes' own APIs, each confirmed and logged: pause, resume
  or run a cron job (and pause all of an agent's jobs); answer, retry, reclaim,
  reassign or assign a Kanban task. `dashboard.olympus.controls: false` turns
  them off.
- Performance view: run success, run time, tool failures and cost per agent
  over 7 or 30 days, and any run step by step. Outcomes follow Hermes' own
  session status and tool-failure rules.
- Routes: `GET /agent`, `GET /performance`, `GET /run`, `GET /resolve`,
  `POST /actions`.
- A cron run Hermes booked as OK but in which every tool call failed now
  counts as failed: the job goes into Needs you ("ran, but every tool call
  failed", with the first failure) and the run counts against success rates.
  Found in a live test where a digest read a missing file three runs in a row.
- Answer shows the question the agent asked (the reason on Hermes' `blocked`
  event), in Needs you and in the Answer box. It is hidden, like other task
  text, unless `expose_local_labels` is on.

### Changed

- Olympus uses only the Hermes theme variables the Hermes page actually
  defines, so text and borders resolve in every theme.
- `/overview` carries only what a screen reads: 13 sections and 23 KB on the
  test install, down from 30 sections and 95 KB.
- The live smoke checks the Agents, Performance and Checks views; the
  performance smoke measures `/overview` and `/performance`.

### Fixed

- The agent timeline shows a logged control's task or job name, and Hermes'
  reply to it, only while `expose_local_labels` is on; entries recorded while
  it was on are hidden once it is off.
- Performance's median run time is the standard median (the lower middle
  value was used before).
- A cron job's last run is matched only to a session that ended before Hermes
  stamped the run.

### Removed

- The readiness score, its trend and its breakdown.
- Operational evals, Metrics Spine, Trace Spine, Pantheon, Fleet and profile
  fitness, and the old performance lanes.
- `GET /tuning`.

## [1.1.0] - 2026-10-24

### Added

- Hermes Desktop page (`desktop/plugin.js`): the Brief inside Desktop, with
  native session opening and hand-offs to Desktop pages.
- Fleet: one row per profile with its role from `profile.yaml`, route, gateway
  (own, multiplexed, stopped), work, sessions and spend over 7 days, last
  activity, and top issue; a finding asks for role descriptions when work is
  routed between profiles.
- Backlog triage: stuck Kanban tasks grouped by Hermes' block kind (waiting on
  a human, missing capability, transient, untyped, sent to triage, waiting on
  parents), with findings for unanswered and capability-blocked work.
- Opt-in alerts: `hermes olympus install-alerts --deliver <target>` sets up a
  Hermes no-agent cron job that reports failed or overdue cron jobs, stalled or
  failed Kanban workers, looping sessions and spend spikes, once per issue.
- "Where spend goes": cost per cron job (shared by token share from
  `cron/usage_audit.jsonl`) and per background task, over the last 7 days.
- History: a 14-day readiness sparkline and 7-day change, and "Did your fixes
  work?" tracking for findings you mark fixed, stored in Olympus' own plugin
  data.
- Brief answers "what needs me?" first: a Needs-you list with evidence, owning
  Hermes page, and "Open session" buttons that open the sessions behind a
  finding in Hermes chat; hero facts for spend in the last 24h and the session
  window; the readiness score's top deductions inline.
- `GET /api/plugins/olympus/open/session?ref=` resolves a hashed session ref to
  its Hermes chat URL at click time.
- Session signals cover a stated window: the last 7 days, capped at the 200 most
  recent sessions.
- `plugin.yaml` and a no-op `__init__.py`, so Olympus installs with
  `hermes plugins install` and passes `hermes plugins validate`.

### Changed

- Profile Fitness is folded into the Fleet table.
- One headline score: Operational Evals and Profile Fitness no longer show
  competing score numbers.
- Metric chips appear only for values that need attention.
- Pantheon is now Live Work (profile cards, current task, activity); Metrics
  Spine, payload budgets and evidence sources sit under Diagnostics' "Debug
  details".
- Evidence copy names what was measured in plain language instead of database
  column names.

- The local-label opt-in moved from the `OLYMPUS_EXPOSE_LOCAL_LABELS` environment
  variable to `dashboard.olympus.expose_local_labels` in `config.yaml`. It is
  re-read on every request and fails closed when the config cannot be read.
- Error and log text now has absolute paths and URLs scrubbed alongside
  secret-like values.
- Cron schedules stored as plain strings no longer break the scan.
- Metrics Spine reads stale workers and auxiliary routes from the fields their
  producers actually emit.

### Fixed

- Error text (cron, session handoff, Kanban worker and board errors) is
  returned only as a failure class by default; quoted multi-word secret values
  are redacted whole.
- Log-tail scans read only the last bytes of each log, and routes no longer
  block the dashboard event loop.
- Token totals and context pressure follow Hermes' usage buckets (cache read
  and cache write are part of the prompt; reasoning is not added twice).
- Session freshness and ordering use `last_activity_at`, so long-running
  active sessions are no longer flagged stale.
- Cost coverage counts each session once and reports `partial` whenever
  token-bearing sessions carry no cost.
- Launching the dashboard from a named profile (`profiles/<name>`) keeps that
  profile's identity and still discovers the root `default` profile.
- Cron jobs and sessions are read from every profile's own stores and
  attributed to the profile they came from (no more substring matching that
  let a profile named `li` claim `cli` sessions).
- A missing Kanban database is reported as missing and an unreadable one as an
  error with an attention item, instead of a healthy empty board.
- Kanban scans read every open task and every in-flight run on every board;
  only closed history is sampled, so older running or failed work is no longer
  hidden behind newer completed tasks or the default board.
- Loop-stop policy follows Hermes' `tool_loop_guardrails` semantics: unattended
  gateway/cron sessions hard-stop by default, so default configs no longer
  report a missing loop stop. Disabling `non_interactive_hard_stop_enabled`
  with a high turn limit is a warning; warn-only interactive sessions are info.
- Operational evals score only checks with observed evidence; unobserved checks
  show as unknown (`n/a`) instead of passing, and an empty Hermes home no longer
  scores 100.
- Profiles served by the default gateway's multiplexer (no `gateway.pid` of
  their own) read as running, and gateway liveness inside Hermes uses
  `gateway.status.live_gateway_pid_for_home`, so launch-service gateways
  without a pid file are detected.
- Median duration uses the standard median and p90 uses nearest rank (the
  upper middle value and the maximum of ten were used before).
- Trace Spine reports "Trace incomplete" when a task's session, runs and events
  cannot be found, and only counts resolved evidence as correlated.
- The dashboard polls one request at a time, so a backend slower than the
  poll interval no longer discards every response.
- Links keep the reverse-proxy base path (`__HERMES_BASE_PATH__`) and the
  current `?profile=` scope.
- Mode tabs support arrow keys, Home and End with a roving tab stop.
- Pantheon switches to a grid beyond seven profiles so cards never overlap, and
  its status badges fit their cells at desktop widths.
- Profile Fitness reasons show labelled points ("−14 pts") instead of a bare
  score delta.

## [1.0.3] - 2026-06-08

### Fixed

- Prevent malformed skill usage timestamps from breaking `/overview` or `/tuning`.
- Prevent malformed skill and session numeric metadata from breaking the scan.
- Redact JSON-style secret assignments in local error strings.

## [1.0.2] - 2026-06-08

### Added

- Public README screenshot of the live Olympus dashboard.

### Changed

- Rewrote the install path as a clone, dependency install, dashboard launch, and
  post-install check flow.

## [1.0.1] - 2026-06-08

### Added

- `after-install.md` with the post-install checks for linking, smoke tests,
  privacy defaults, and common troubleshooting.

### Changed

- Aligned dashboard manifest and package metadata with the public release line.

## [1.0.0] - 2026-06-07

First public release. Olympus is a read-only HermesOS Agent Monitor dashboard
plugin: it reads local Hermes runtime evidence, ranks what needs attention,
explains the reason, and links to the Hermes page that owns each fix. It stays
read-only — it never mutates tasks, profiles, cron, gateways, routes, memory,
credentials, or config.

### Added

- Read-only plugin API: `GET /health`, `GET /overview`, `GET /tuning`, mounted
  by Hermes at `/api/plugins/olympus/` behind the dashboard session-token flow.
- Transparent readiness **score** with a full deduction breakdown and methodology.
- **Agent Monitor**: speed, tokens, loop pressure, context pressure, reliability
  risk, and the top tuning actions.
- **Tuning queue**: ranked recommendations, each with the evidence behind it and
  a handoff link to the Hermes-owned page.
- **Skill Coverage** and **Skill Hygiene**: zero-skill profiles, forced-skill
  work, stale / never-used / recently-patched skills, hub trust and install-scan
  gaps, and stored skill audit status when Hermes records it locally.
- **Profile Fitness**: per-profile readiness from workload, routing, gateway
  state, cron load, failures, loop and context pressure.
- **Pantheon** (accessible): keyboard-operable profile map with trigger lanes
  and an activity feed.
- **Kanban Intelligence** and **Trace Spine**: board pressure, workers, retries,
  assignee load, and correlation across sessions, tasks, runs, and events using
  hashed refs (no transcript content).
- **Tool Policy & Aux Cost**: config-posture security signals (browser privacy
  flags, loop-stop guardrails, auxiliary route cost visibility, fallback route
  audit) from safe config structure only.
- **Performance Tracking**, **Evidence Sources**, and **Production Diagnostics**
  for an auditable, budgeted read model.
- **Deterministic ops evals**: reliability, routing, skill-use, and efficiency
  signals labeled as operational evals (not answer-quality judgments).

### Security & privacy

- Read-only by default; no mutation, credential-reveal, or shell-execution routes.
- SQLite opened read-only; secret-like text redacted before it is returned.
- Session, cron, Kanban run, worker, and event identifiers use hashed public refs
  by default. Local labels and paths are hidden unless
  `OLYMPUS_EXPOSE_LOCAL_LABELS=1` is set on a private machine.

### Tests & CI

- Python unit tests: privacy contract, skill hygiene, trace spine, and ops evals
  (real SQLite fixtures, no mocks).
- Smoke suites: visual fixtures, live render, payload security, response-budget
  performance, and a Hermes Desktop preflight.
- `verify` workflow runs backend compile, backend unit tests, frontend parse,
  whitespace check, and the visual smoke on push and pull request.

[2.0.1]: https://github.com/AIEngineerX/Olympus/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/AIEngineerX/Olympus/compare/v1.0.3...v2.0.0
[1.0.3]: https://github.com/AIEngineerX/Olympus/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/AIEngineerX/Olympus/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/AIEngineerX/Olympus/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/AIEngineerX/Olympus/releases/tag/v1.0.0
