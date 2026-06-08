# Changelog

All notable changes to Olympus are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.1]: https://github.com/AIEngineerX/Olympus/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/AIEngineerX/Olympus/releases/tag/v1.0.0
