# Olympus Phase Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining Olympus phases without drifting from the Agent Monitor boundary.

**Architecture:** Keep Olympus read-only. Extend `dashboard/plugin_api.py` with derived, redacted signals from existing Hermes stores, then render compact panels in `dashboard/dist/index.js` and `dashboard/dist/style.css`. Each phase adds a regression test first, then implementation, docs, and the same bug/security gate before the next phase.

**Tech Stack:** Python FastAPI plugin module, SQLite metadata reads, plain React via `dashboard/dist/index.js`, CSS in `dashboard/dist/style.css`, Playwright visual/live smoke tests, Python unit tests.

---

## Execution Prompt

Complete Olympus phases in documented order. Every phase must add working value, preserve read-only and privacy boundaries, update docs, and pass bug plus security checks before the next phase. Do not add mutations, fake data, usage-ledger duplication, local paths, raw IDs, prompt text, or secret-like values.

## Phase Order

### Task 1: Phase 0 Production Polish

**Files:**
- Modify: `tests/visual/olympus.spec.js`
- Modify: `dashboard/dist/style.css`
- Modify: `dashboard/docs/PRODUCTION_READINESS.md`

- [x] Add a visual regression assertion that visible disclosure summaries are usable touch targets.
- [x] Verify the new assertion fails against the current CSS.
- [x] Increase `.olympus-details summary` vertical hit area and reduce the tallest mobile sections without hiding required evidence.
- [x] Run `npm run test:visual`, `npm run test:live`, and `npm run test:security`.
- [x] Commit the phase.

### Task 2: Trace Spine V0

**Files:**
- Create: `tests/test_trace_spine.py`
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: `tests/fixtures/olympus-fixture-data.js`
- Modify: `tests/visual/olympus.spec.js`
- Modify: `scripts/olympus-security-smoke.mjs`
- Modify: `OLYMPUS_GOAL.md`, `TODO.md`, `dashboard/docs/BUILD_PLAN.md`, `dashboard/docs/PRODUCTION_READINESS.md`

- [x] Add a failing unit test for correlating a Kanban task with a redacted session ref, task run, and task event.
- [x] Add a failing privacy assertion that Trace Spine does not expose raw task IDs, session IDs, run IDs, event IDs, transcript content, or local paths.
- [x] Implement `build_trace_spine(sessions, kanban)` from existing `session_ref`, task, run, and event data.
- [x] Return `trace_spine` from `/overview` and `/tuning`.
- [x] Render a compact Trace Spine panel with task-level recommendations and evidence links.
- [x] Add fixture data and visual smoke coverage.
- [x] Run `python3 -m unittest tests.test_trace_spine`, `npm run verify`, `npm run test:visual`, `npm run test:live`, and `npm run test:security`.
- [x] Commit the phase.

### Task 3: Curator And Skill Hygiene Completion

**Files:**
- Modify: `tests/test_privacy_contract.py` or create `tests/test_skill_hygiene.py`
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `tests/fixtures/olympus-fixture-data.js`
- Modify: docs listed above

- [x] Add a failing unit test for stored skill audit metadata when Hermes has already persisted it locally.
- [x] Parse only local stored audit fields from skill usage or hub lock metadata.
- [x] Surface audit status as read-only hygiene evidence.
- [x] Keep scan/install/archive/delete actions out of Olympus.
- [x] Run the phase gate and commit.

### Task 4: Hermes Desktop Integration Preflight

**Files:**
- Create: `scripts/olympus-desktop-preflight.mjs`
- Modify: `package.json`
- Modify: `dashboard/docs/HERMES_DESKTOP_INTEGRATION.md`
- Modify: `dashboard/docs/PRODUCTION_READINESS.md`

- [x] Add a failing script-level check that expects Desktop status, Desktop route evidence, Command Center Usage ownership, and web dashboard plugin availability.
- [x] Implement the preflight script without mutating Desktop.
- [x] Add `npm run test:desktop`.
- [x] Run the phase gate plus `npm run test:desktop` and commit.

### Task 5: Deterministic Eval Signals

**Files:**
- Create: `tests/test_ops_evals.py`
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: fixtures, visual tests, security smoke, and docs

- [x] Add failing tests for reliability, routing, skill-use, and efficiency eval signals.
- [x] Implement deterministic `ops_evals` from existing sessions, Kanban, skill coverage, skill hygiene, and config policy.
- [x] Render eval signals as operational checks, not answer-quality claims.
- [x] Run the full gate and commit.

## Phase Gate

After each phase:

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:performance
npm run test:security
npm run test:desktop
npm audit --audit-level=moderate
```

Add any phase-specific command to that gate before committing.

## Final Status

- [x] All planned phases completed.
- [x] Final hygiene sweep removed stale Agent Monitor naming and compacted
  Operational Evals without hiding evidence.
- [x] Dashboard mode staging shipped: Brief first, then Agents, Skills, Kanban,
  Policy, and Diagnostics for deeper inspection.
- [x] Final gate passed.
