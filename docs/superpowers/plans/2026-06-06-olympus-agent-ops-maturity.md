# Olympus Agent Ops Maturity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Olympus from a read-only Hermes dashboard into a stronger local agent operations and trust console, with quick wins first and every feature grounded in concrete Hermes evidence.

**Architecture:** Keep Olympus read-only for Hermes-owned state. Add small evidence collectors and deterministic scoring helpers around existing Hermes data sources, then render compact panels that link back to Hermes-owned pages. Do not add hosted tracing, external eval calls, or write actions until there is an explicit side-effect contract.

**Tech Stack:** Python FastAPI plugin router in `dashboard/plugin_api.py`, SQLite reads from Hermes state/Kanban databases, JSON/YAML reads from Hermes config and skill metadata, hand-authored React-free dashboard code in `dashboard/dist/index.js`, CSS in `dashboard/dist/style.css`, Playwright fixture and live smoke tests.

---

## Grounding Rules

Each phase must use only evidence already present in Hermes or already documented as a Hermes local source:

- `~/.hermes/state.db`
  - `sessions`: `id`, `source`, `model`, `model_config`, `started_at`, `ended_at`, `end_reason`, `message_count`, `tool_call_count`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`, `billing_provider`, `billing_base_url`, `billing_mode`, `estimated_cost_usd`, `actual_cost_usd`, `cost_status`, `cost_source`, `title`, `api_call_count`, `handoff_state`, `handoff_platform`, `handoff_error`, `cwd`, `rewind_count`, `archived`.
  - `messages`: `session_id`, `role`, `content`, `tool_call_id`, `tool_calls`, `tool_name`, `timestamp`, `token_count`, `finish_reason`, `reasoning`, `reasoning_details`, `codex_reasoning_items`, `observed`, `active`.
- `~/.hermes/kanban.db`
  - `tasks`: `id`, `title`, `body`, `assignee`, `status`, `priority`, `skills`, `branch_name`, `model_override`, `session_id`, `goal_mode`, `goal_max_turns`, `workspace_kind`, `workspace_path`, `consecutive_failures`, `last_failure_error`, `worker_pid`, `last_heartbeat_at`, `current_run_id`, `max_retries`.
  - `task_runs`: `id`, `task_id`, `profile`, `step_key`, `status`, `claim_lock`, `claim_expires`, `worker_pid`, `max_runtime_seconds`, `last_heartbeat_at`, `started_at`, `ended_at`, `outcome`, `summary`, `metadata`, `error`.
  - `task_events`, `task_comments`, `task_links`, `task_attachments`, and `kanban_notify_subs` are optional supporting evidence.
- `~/.hermes/skills/.usage.json`
  - Per-skill `created_at`, `last_used_at`, `last_viewed_at`, `last_patched_at`, `use_count`, `view_count`, `patch_count`, `state`, `archived_at`, `pinned`.
- `~/.hermes/skills/.hub/lock.json`
  - `version` and `installed` map. Use optional hub metadata only when keys exist locally.
- `~/.hermes/config.yaml`
  - Use safe config structure only: provider names, model route presence, fallback provider count, toolset names, agent max turns, gateway timeouts, tool loop guardrail settings, compression settings, browser privacy flags, auxiliary provider route presence.
  - Do not return prompt/personality text, API keys, tokens, secret values, local absolute paths, or raw private labels by default.

## Files And Responsibilities

- Modify `dashboard/plugin_api.py`
  - Add collectors for evidence contracts, skill hygiene, config/tool policy, trace summaries, deterministic eval signals, and optional history.
  - Keep routes read-only.
  - Keep SQLite connections read-only.
- Modify `dashboard/dist/index.js`
  - Render new compact panels.
  - Prefer evidence tables and drill-down links over decorative diagrams.
  - Keep action buttons as Hermes-owned links.
  - For Pantheon visuals, use accessible HTML controls for agents; do not put readable labels inside SVG text.
- Modify `dashboard/dist/style.css`
  - Add only necessary panel styles using existing Olympus tokens and dense layout patterns.
- Modify `tests/fixtures/*` or add targeted fixture data
  - Add fixture states for skill hygiene, config risk, trace correlation, eval warnings, and no-label privacy.
- Modify `tests/visual/olympus.spec.js`
  - Add assertions for new panels, no tiny text, no overflow, no bad links, no private labels.
- Modify `scripts/olympus-live-smoke.mjs`
  - Extend live checks for new selectors, allowed routes, privacy leaks, and security-sensitive copy.
- Add `scripts/olympus-security-smoke.mjs` when Phase 1 starts
  - Run deterministic redaction and private-data leak checks against fixture and live payloads.
- Update `TODO.md`, `dashboard/docs/BUILD_PLAN.md`, `dashboard/docs/PRODUCTION_READINESS.md`, and `SECURITY.md`
  - Mark phases accurately.
  - Keep Hermes version and security posture current.

## Universal Gates After Every Phase

Run these commands before committing any phase:

```bash
npm run verify
npm run test:visual
npm run test:live
git diff --check
```

Run this security scan before committing any phase:

```bash
rg -n "(sk-[A-Za-z0-9_-]{12,}|github_pat_|ghp_|xox[baprs]-|api[_-]?key\\s*[:=]|token\\s*[:=]|secret\\s*[:=]|password\\s*[:=])" \
  --glob '!node_modules/**' \
  --glob '!test-results/**' \
  --glob '!playwright-report/**' \
  --glob '!docs/superpowers/plans/2026-06-06-olympus-agent-ops-maturity.md'
```

Phase-specific security gates are listed under each phase. A phase is not done if a panel exposes raw session IDs, raw task IDs, local paths, prompt/personality text, provider secrets, or raw private labels while `OLYMPUS_EXPOSE_LOCAL_LABELS` is unset.

---

### Phase 0: Evidence Contract And Drift Guard

**Why first:** Quick win. Olympus already computes many signals, but the operator cannot see which Hermes sources contributed to each panel. Add an evidence contract so future work cannot drift into guesses.

**Hermes evidence used:** existing collectors in `dashboard/plugin_api.py`; `state.db` table names and selected columns; `kanban.db` table names and selected columns; `config.yaml` safe structure; skill metadata file existence.

**Files:**
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: `tests/visual/olympus.spec.js`
- Modify: `scripts/olympus-live-smoke.mjs`
- Modify: `dashboard/docs/PRODUCTION_READINESS.md`

- [x] Add a read-only `evidence_sources` object to `/overview` and `/tuning`.
  - Include source name, source type, present/missing, safe field names read, item counts, read failures, and redaction policy.
  - Do not include actual file paths in public payloads; use labels such as `Hermes state database` and `Hermes Kanban database`.
- [x] Render an "Evidence Sources" compact diagnostics strip.
  - Show `state.db`, `kanban.db`, `config.yaml`, skill usage metadata, and hub lock metadata as `ok`, `missing`, or `warning`.
  - Link to `/system`, `/sessions`, `/kanban`, `/config`, or `/skills` as appropriate.
- [x] Add fixture coverage where `skills/.usage.json` and `skills/.hub/lock.json` are missing.
- [x] Add live smoke assertions that the Evidence Sources panel exists and does not expose `/Users/`, raw database paths, or raw session IDs.

**Bug gate:**

```bash
npm run verify
npm run test:visual
npm run test:live
```

**Security gate:**

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=0 npm run test:live
rg -n "/Users/ghost|\\.hermes/state\\.db|\\.hermes/kanban\\.db|github_pat_|ghp_|sk-" dashboard tests scripts
```

**Done means:** Every major panel can cite a Hermes source category and no panel returns private source paths by default.

---

### Phase 1: Skill Hygiene And Trust Graph

**Why second:** Quick win with high value. The files already exist locally: `~/.hermes/skills/.usage.json` and `~/.hermes/skills/.hub/lock.json`. This closes the largest gap from the Hermes skills update without adding write actions.

**Hermes evidence used:** skill usage metadata, hub lock metadata, profile skill counts already collected, Kanban `tasks.skills`, session tool pressure from `sessions.tool_call_count`.

**Files:**
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: `tests/fixtures/*`
- Modify: `tests/visual/olympus.spec.js`
- Modify: `scripts/olympus-live-smoke.mjs`
- Add: `scripts/olympus-security-smoke.mjs`
- Modify: `SECURITY.md`
- Modify: `dashboard/docs/BUILD_PLAN.md`

- [x] Add `collect_skill_metadata()` to read `skills/.usage.json` and `skills/.hub/lock.json`.
  - Return counts for total skills, archived, pinned, never used, recently used, stale, recently patched, hub-installed, missing hub lock, and metadata read failures.
  - Return redacted skill item labels unless `OLYMPUS_EXPOSE_LOCAL_LABELS=1`.
- [x] Add `build_skill_hygiene()` to combine skill metadata with existing `skill_coverage`.
  - Flag heavily used but unpinned skills.
  - Flag archived skills with recent use.
  - Flag frequently patched skills.
  - Flag hub-installed skills missing trust or scan metadata when the lock file lacks those keys.
  - Flag forced-skill Kanban tasks whose skill metadata is missing.
- [x] Render a "Skill Hygiene" panel below Skill Coverage.
  - Keep it read-only.
  - Link only to `/skills`, `/kanban`, and `/sessions`.
- [x] Add `scripts/olympus-security-smoke.mjs`.
  - Fetch `/api/plugins/olympus/overview` through the live dashboard session-token flow or reuse the fixture harness.
  - Fail if payload contains `/Users/`, raw `workspace_path`, `cwd`, secret-like tokens, or raw skill names when labels are hidden.
- [x] Update docs to mark Curator and Skill Hygiene as partially shipped, with hub trust/scan shown only when Hermes records those fields.

**Bug gate:**

```bash
npm run verify
npm run test:visual
npm run test:live
node scripts/olympus-security-smoke.mjs
```

**Security gate:**

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=0 node scripts/olympus-security-smoke.mjs
OLYMPUS_EXPOSE_LOCAL_LABELS=1 npm run test:live
```

**Done means:** Olympus can tell the operator whether skill usage, staleness, archive state, hub provenance, and missing skill metadata are contributing to agent friction, without mutating skills or exposing private labels by default.

---

### Phase 1.5: Pantheon V2 Visual Restoration

**Why before config policy:** Olympus lost the memorable Pantheon visual while hardening the dashboard for viewport safety and accessibility. Restore the visual identity before adding more panels, but keep the hardening gains.

**Required design gate before implementation:** Run the Impeccable product-UI workflow against `/olympus` and the proposed Pantheon surface before editing code. If the repo-local `.agents` helper is unavailable, use the installed `impeccable` skill instructions plus the product register, `dashboard/docs/VIEWPORT_STRATEGY.md`, existing CSS, and the live in-app browser. Record the design decision in this plan or `dashboard/docs/VIEWPORT_STRATEGY.md` before implementation.

**Design gate result:** Shipped with the installed Impeccable product-UI guidance because `.agents/skills/impeccable/scripts/context.mjs` is not present in this repo. The live in-app browser pass required the profile map to appear at the top of Pantheon in the narrow app viewport, with real buttons, readable labels, no horizontal overflow, and no SVG text.

**Hermes evidence used:** current `party.members`, `party.summary`, `orchestration.summary`, `activity_events`, profile workload counts, trigger-lane counts, and profile state already returned by `/overview`.

**Files:**
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: `tests/fixtures/olympus-fixture-data.js`
- Modify: `tests/visual/olympus.spec.js`
- Modify: `scripts/olympus-live-smoke.mjs`
- Modify: `dashboard/docs/VIEWPORT_STRATEGY.md`
- Modify: `dashboard/docs/BUILD_PLAN.md`

- [x] Restore Pantheon as a first-class visual section and primary operational view.
  - Use the old Pantheon/Constellation commits as inspiration only: `815a21e` and `d579cbd`.
  - Do not reintroduce SVG text, `role="img"` around interactive content, or labels that scale below readable size.
  - Agent nodes must be real buttons with visible focus, selected state, and ARIA state.
  - The selected agent inspector must remain HTML text with Hermes-owned links.
- [x] Preserve the operational questions from the hardened dashboard.
  - Which profiles are working, idle, blocked, or risky?
  - Which trigger lanes are feeding work: Kanban, Cron, Gateway?
  - Which profile should I inspect first?
  - What evidence and Hermes page own the fix?
- [x] Make responsive behavior explicit.
  - Desktop: Pantheon visual map plus selected-profile inspector.
  - Mid-width in-app browser: compact map or two-column node grid without excessive height.
  - Mobile: stacked controls with no microscopic labels, no horizontal overflow, and no hidden interaction.
- [x] Add visual fixture checks for Pantheon v2.
  - Require `.olympus-pantheon` or the renamed visual section.
  - Require at least five clickable agent controls in non-empty states.
  - Fail if SVG text is used for agent labels.
  - Keep private-label hiding checks intact.
- [x] Update docs to explain why Pantheon v2 is visual identity plus usable control, not decoration.

**Bug gate:**

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:security
```

**Visual gate:**

```bash
# Run before implementation and again before commit.
# Use the installed Impeccable skill/product register if repo-local helpers are missing.
npm run test:visual
npm run test:live
```

**Security gate:**

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=0 npm run test:security
```

**Done means:** Olympus has a recognizable Pantheon visual again, agents are still clickable and accessible, and desktop/mobile/in-app browser viewports remain readable without private label leaks.

---

### Phase 2: Config, Tool Policy & Auxiliary Cost Watch

**Why third:** This is another quick win. Hermes config already exposes agent limits, toolsets, loop guardrails, compression, browser privacy flags, auxiliary providers, and route metadata. Olympus should surface risky settings without revealing secrets.

**Hermes evidence used:** safe structure from `~/.hermes/config.yaml`; existing profile route collection; session cost/token fields.

**Files:**
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: `tests/fixtures/*`
- Modify: `tests/visual/olympus.spec.js`
- Modify: `scripts/olympus-live-smoke.mjs`
- Modify: `scripts/olympus-security-smoke.mjs`
- Modify: `SECURITY.md`

- [x] Add `collect_config_policy()`.
  - Read only safe keys: `model.provider`, `model.default` presence, `fallback_providers` count, `toolsets`, `agent.max_turns`, `agent.gateway_timeout`, `tool_loop_guardrails`, `compression`, `browser.allow_private_urls`, `browser.record_sessions`, auxiliary provider route presence.
  - Do not return prompt/personality text, secret values, `api_key`, `session_key`, `base_url` values, or environment values.
- [x] Add policy findings.
  - High `agent.max_turns` with hard loop stop disabled.
  - Browser private URLs enabled.
  - Browser session recording enabled.
  - Auxiliary provider configured but no cost/usage signal available.
  - Fallback provider configured without visible route audit evidence.
- [x] Render "Tool Policy & Aux Cost" as a compact panel.
  - Link to `/config`, `/models`, `/sessions`, and `/keys` only if these routes are allowed by the smoke tests.
- [x] Keep route allowlists unchanged because the shipped panel uses `/config`, `/analytics`, and `/sessions` only.
- [x] Add fixture states for risky config and healthy config.

**Bug gate:**

```bash
npm run verify
npm run test:visual
npm run test:live
node scripts/olympus-security-smoke.mjs
```

**Security gate:**

```bash
rg -n "personality|api_key|session_key|base_url|password|secret|token" dashboard/plugin_api.py dashboard/dist/index.js tests/fixtures
OLYMPUS_EXPOSE_LOCAL_LABELS=0 node scripts/olympus-security-smoke.mjs
```

**Done means:** Olympus can identify risky agent/tool policy and auxiliary cost uncertainty from Hermes config without leaking credentials, prompts, private URLs, or personality text.

---

### Phase 3: Trace Spine V0

**Why fourth:** This moves Olympus closer to serious agent observability. Do not attempt full OpenTelemetry yet. Build a local, deterministic trace spine from Hermes first-party tables.

**Hermes evidence used:** `sessions`, `messages`, `tasks.session_id`, `task_runs`, and `task_events`.

**Files:**
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: `tests/fixtures/*`
- Modify: `tests/visual/olympus.spec.js`
- Modify: `scripts/olympus-live-smoke.mjs`
- Modify: `scripts/olympus-security-smoke.mjs`
- Modify: `dashboard/docs/PRODUCTION_READINESS.md`

- [ ] Add `collect_trace_summaries(limit=20)`.
  - Join session summaries to Kanban tasks through `tasks.session_id`.
  - Summarize message/tool timeline from `messages` by role, `tool_name`, `tool_call_id`, token count, finish reason, and timestamp.
  - Do not return message content by default.
  - Do not return `cwd` or `workspace_path`.
- [ ] Add deterministic trace health findings.
  - Tool loop: repeated same tool, high `tool_call_count`, or many tool messages in one session.
  - Handoff failure: `handoff_error` or failed task run.
  - Retry pressure: task `consecutive_failures` or repeated `task_runs` failures.
  - Context pressure: high average input tokens per API call.
- [ ] Render "Trace Spine" panel.
  - Show session/task correlation, tool sequence summary, failure points, and recommended Hermes page.
  - Link to `/sessions` and `/kanban`.
- [ ] Add fixture for a correlated Kanban task with a session and failed tool-heavy run.

**Bug gate:**

```bash
npm run verify
npm run test:visual
npm run test:live
node scripts/olympus-security-smoke.mjs
```

**Security gate:**

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=0 node scripts/olympus-security-smoke.mjs
rg -n "content|workspace_path|cwd" dashboard/dist/index.js tests/fixtures
```

**Done means:** Olympus can answer "which session, task, tools, and run outcome produced this problem" without dumping transcript content.

---

### Phase 4: Deterministic Eval Signals V0

**Why fifth:** The project needs evals, but the first version should be deterministic and local. Avoid external LLM judges until the trace spine is stable.

**Hermes evidence used:** sessions, messages metadata, Kanban task outcomes, task comments/events, costs, tokens, tool counts, run outcomes, profile route metadata.

**Files:**
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: `tests/fixtures/*`
- Modify: `tests/visual/olympus.spec.js`
- Modify: `scripts/olympus-live-smoke.mjs`
- Modify: `dashboard/docs/BUILD_PLAN.md`

- [ ] Add `build_eval_signals()`.
  - Success proxy: completed session, completed task run, no handoff error, no task failure.
  - Reliability proxy: task run failure rate, retry count, stale sessions, archived sessions.
  - Efficiency proxy: duration, tool calls, token volume, context pressure, cost.
  - Routing proxy: explicit profile route presence, model override concentration, fallback/provider visibility.
  - Skill proxy: forced-skill task success, tool-heavy work without skill coverage.
- [ ] Render "Eval Signals" panel.
  - Label these as deterministic operational evals, not quality judgments.
  - Show evidence and thresholds for every score.
- [ ] Add fixture states for passing and failing eval signals.
- [ ] Update docs to distinguish deterministic eval signals from future LLM-as-judge or dataset-based evals.

**Bug gate:**

```bash
npm run verify
npm run test:visual
npm run test:live
node scripts/olympus-security-smoke.mjs
```

**Security gate:**

```bash
OLYMPUS_EXPOSE_LOCAL_LABELS=0 node scripts/olympus-security-smoke.mjs
rg -n "LLM judge|quality score|semantic correctness" dashboard docs tests
```

**Done means:** Olympus has repeatable local eval signals that can catch regressions in reliability, cost, routing, and skill use without claiming to judge answer quality.

---

### Phase 5: Trend And Regression Store

**Why later:** Foundry-level tools need trends, but writing history from a read-only plugin changes the contract. Do this only after a storage decision is explicit.

**Hermes evidence used:** current `/overview` diagnostics, sessions, task runs, skill hygiene, config policy, eval signals.

**Files:**
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: `SECURITY.md`
- Modify: `dashboard/docs/PRODUCTION_READINESS.md`
- Modify: `scripts/olympus-security-smoke.mjs`

- [ ] Decide storage contract before implementation.
  - Option A: no writes; use only Hermes existing snapshots and current window.
  - Option B: opt-in plugin-local append-only history with `OLYMPUS_ENABLE_LOCAL_HISTORY=1`.
  - Option C: wait for a Hermes-owned metrics/history surface.
- [ ] If Option B is approved, write only aggregate metrics.
  - Never write message content, prompt text, paths, raw session IDs, raw task IDs, or secrets.
  - Use hashed IDs and aggregate counts.
- [ ] Render trend deltas only when history is present.
  - Show last run, current run, and regression markers.

**Bug gate:**

```bash
npm run verify
npm run test:visual
npm run test:live
node scripts/olympus-security-smoke.mjs
```

**Security gate:**

```bash
OLYMPUS_ENABLE_LOCAL_HISTORY=1 OLYMPUS_EXPOSE_LOCAL_LABELS=0 node scripts/olympus-security-smoke.mjs
test -z "${OLYMPUS_HISTORY_FILE:-}" || node - <<'NODE'
const fs = require("fs");
const path = process.env.OLYMPUS_HISTORY_FILE;
const text = path && fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
const patterns = [/\/Users\//, /workspace_path/, /\bcwd\b/, /"content"\s*:/, /api[_-]?key/i, /token/i, /secret/i, /password/i];
if (patterns.some((pattern) => pattern.test(text))) {
  console.error("Olympus history contains private-data leak patterns");
  process.exit(1);
}
NODE
```

**Done means:** Olympus can show regression over time only under an explicit storage contract.

---

### Phase 6: Controlled Actions RFC

**Why last:** Write actions are useful, but this is where product trust can break. Draft the contract before adding any mutation.

**Hermes evidence used:** current recommended action links, sessions, Kanban task IDs, skill metadata, config policy findings.

**Files:**
- Add: `dashboard/docs/CONTROLLED_ACTIONS_RFC.md`
- Modify: `SECURITY.md`
- Modify: `dashboard/docs/PRODUCTION_READINESS.md`

- [ ] Define allowed action candidates.
  - Archive stale session.
  - Retry failed Kanban task.
  - Open Kanban task with prefilled note.
  - Pin or open a skill in Hermes Skills.
- [ ] For each action, document side effect, required confirmation, audit evidence, rollback path, and failure mode.
- [ ] Do not implement mutation routes in this phase.
- [ ] Add explicit decision gate: Olympus remains link-only until the RFC is approved.

**Bug gate:**

```bash
npm run verify
git diff --check
```

**Security gate:**

```bash
rg -n "@router\\.(post|put|patch|delete)|sqlite3\\.connect\\([^\\n]*mode=rw|subprocess|os\\.system|Popen" dashboard
```

**Done means:** The team has a reviewed action contract before any write path exists.

---

## Suggested Commit Order

1. `docs: add olympus agent ops maturity plan`
2. `feat: expose olympus evidence source contract`
3. `feat: add read-only skill hygiene signals`
4. `feat: surface hermes config policy risks`
5. `feat: add local trace spine summaries`
6. `feat: add deterministic eval signals`
7. `docs: define olympus controlled actions rfc`

## Self-Review

- Spec coverage: The plan addresses quick wins, concrete Hermes grounding, bug gates, security checks, and phased maturity toward trace/eval/governance.
- Placeholder scan: No placeholder markers or unspecified future-work steps are used.
- Drift check: The plan does not propose hosted tracing, external evaluators, enterprise RBAC, or write actions before Hermes has explicit evidence and contracts.
- Privacy check: Every phase includes a hidden-label default and secret/path leak gate.
