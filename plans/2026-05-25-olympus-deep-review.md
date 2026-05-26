# Olympus Deep Product Review

Date: 2026-05-25
Owner profile: Zeus/default
Target: Hermes-native dashboard plugin, Greek Olympus pixel-temple style

## Verdict

Olympus should not be "Pixel Agents for Hermes" in the narrow sense.

Pixel Agents is an agent-visualization layer for IDE-bound Claude Code terminals. Its core value is presence: each terminal becomes a character, and each character reflects Claude's current activity.

Olympus can be stronger because Hermes has a richer runtime substrate:

- CLI sessions
- gateway sessions across Telegram/Discord/Slack/etc.
- profiles
- cron jobs
- kanban workers
- subagents/delegation
- process registry
- sessions DB with tool calls
- memory and skills
- plugins
- dashboard APIs
- TUI/PTY bridge

So the unique angle is:

> Olympus is not just an office where agents animate. It is a command temple for Hermes' whole operating system: agents, jobs, rituals, profiles, tools, memory, and work queues visible as one living map.

Use Greek Olympus pixel temple as the identity.

## Pixel Agents reviewed

Pixel Agents architecture, as observed from repo docs and code:

- VS Code extension shell.
- React webview UI.
- Node/Fastify server receives provider hook events.
- Claude Code oriented, though moving toward agent-agnostic provider abstractions.
- One character per Claude terminal/session.
- Status comes from:
  - Claude hooks: SessionStart, SessionEnd, PreToolUse, PostToolUse, PermissionRequest, Notification, subagent events.
  - JSONL transcript polling under `~/.claude/projects/...`.
  - heuristic timers when hooks are unavailable.
- Office engine has real game pieces:
  - canvas renderer
  - character FSM
  - pathfinding/walkability
  - layout editor
  - furniture catalog
  - wall/floor tile systems
  - matrix spawn/despawn effect
  - sound notification
- Strongest product features:
  - visual activity tracking
  - subagent visualization
  - layout editor
  - speech bubbles for waiting/permission states
  - external assets
  - pleasant physical metaphor

Pixel Agents' center of gravity:

> Make IDE agent work visible and charming.

## Hermes substrate reviewed

Hermes has dashboard plugin support already:

- User dashboard plugin path:
  `~/.hermes/plugins/<name>/dashboard/`
- Manifest:
  `manifest.json`
- JS bundle:
  `dist/index.js`
- Optional CSS:
  `dist/style.css`
- Optional backend API:
  `plugin_api.py`
- Backend routes mount under:
  `/api/plugins/<name>/`
- Plugin discovery scans user plugins, bundled plugins, and optionally project plugins.
- Backend plugin import is guarded to user/bundled plugins and safe relative API paths.
- Dashboard frontend exposes:
  - `window.__HERMES_PLUGIN_SDK__`
  - React from SDK
  - UI components
  - `SDK.api`
  - `SDK.fetchJSON`
  - shell slots

Hermes data surfaces useful to Olympus:

1. Sessions DB
   - sessions table includes source, model, message count, tool call count, token/cost fields, timestamps.
   - messages table includes role, content, tool calls, tool name, timestamp.
   - FTS search exists.

2. Dashboard REST
   - `/api/status`
   - `/api/sessions`
   - `/api/sessions/{id}/messages`
   - `/api/logs`
   - `/api/cron/jobs`
   - `/api/tools/toolsets`

3. Process registry
   - tracks Hermes-managed background processes from `terminal(background=true)`.
   - exposes session id, command, cwd, pid, started_at, uptime, status, output preview, exit code.
   - has notify/watch-pattern metadata.

4. Cron
   - jobs stored under profile-scoped `~/.hermes/cron/jobs.json`.
   - supports schedule, state, next run, last run, profile, model override, toolsets, scripts, no-agent mode, context chaining, delivery target.

5. Kanban
   - SQLite board and dispatcher.
   - dashboard plugin exists already.
   - tasks have statuses like triage, todo, scheduled, ready, running, blocked, review, done.
   - task events can be tailed through a WebSocket pattern.

6. Profiles
   - default Zeus, Hestia, and future profiles can be separate rooms or temples.
   - profiles are hard boundaries, not just labels.

7. Gateway
   - Hermes can run through Telegram, Discord, Slack, etc.
   - platform sessions are not IDE-bound.

This means Olympus has enough live operational material to be more than a frontend toy.

## Unique positioning

### 1. Multi-surface, not IDE-bound

Pixel Agents starts inside VS Code.

Olympus starts inside Hermes dashboard and can represent:

- local CLI work
- Telegram/Gateway work
- cron work
- kanban work
- dashboard chat work
- spawned Hermes processes
- background terminal processes
- future ACP/IDE sessions

Unique promise:

> Every Hermes surface lands in the same temple.

This matters because Hermes is not just a coding agent. It is a personal operating layer.

### 2. Profiles as places

Hermes profiles are real boundaries. Olympus can visualize profiles as separate sanctums:

- Zeus/default: command temple, full-power private operator
- Hestia: family-safe hearth, separate room, separate memory boundary
- future profiles: trading lab, ML forge, smart-home observatory, etc.

This gives Olympus a distinctive security-aware spatial model:

- rooms are not cosmetic
- room boundaries reflect profile isolation
- cross-profile leakage can be visible and prevented

Unique feature:

> Spatial security. The map shows capability boundaries.

### 3. Work queues as physical logistics

Hermes has kanban, cron, goals, background processes, and delegation. Olympus can turn abstract queued work into physical motion:

- tasks sit on an altar/board
- workers walk to claim tasks
- blocked tasks get a red seal
- review tasks move to Athena's desk
- cron jobs appear as ritual circles/sundials
- recurring jobs pulse before execution
- failed jobs leave smoke/fire

Unique promise:

> The office shows work moving through the system, not just agents typing.

Pixel Agents shows what a terminal is doing. Olympus can show what the whole agent organization is doing.

### 4. Temporal operations: rituals, not just sessions

Cron is a first-class Hermes system. Pixel Agents does not have an equivalent durable scheduler surface.

Olympus can treat scheduled jobs as temple rituals:

- sunrise briefings
- watchdog sentries
- cleanup rites
- report generation
- polling feeds
- recurring research

Visuals:

- sundial / lunar calendar
- ritual circles that light up before firing
- incense/smoke for long-running jobs
- failed ritual marker requiring attention

Unique feature:

> You can see the future workload, not just current activity.

### 5. Skills and memory as world objects

Hermes' skills and memory are durable systems. Olympus can make them inspectable without making the UI childish.

Examples:

- Library of skills: shelves categorized by domain.
- Active loaded skill appears as a scroll/book on the agent's desk.
- Memories appear as sealed tablets, with profile-scoped access indicators.
- Curator status appears as a librarian/archivist.

Unique promise:

> The agent's reusable knowledge is visible and governable.

This is meaningfully different from a terminal visualizer.

### 6. Tool use as instruments

Instead of generic "typing/running" animations, Hermes tools can map to artifacts:

- terminal: forge/anvil or command console
- file edits: scroll/tablet
- web research: oracle pool
- browser: scrying mirror
- image generation: atelier
- cron: sundial
- kanban: task board
- memory: archive vault
- messaging: messenger Hermes wing icon
- GitHub: laurel seal or forge contract

Unique feature:

> Tool use becomes legible at a glance.

### 7. Safety and approval as first-class visual states

Hermes has approvals, tool gating, profile boundaries, secret redaction, gateway pairing, and disabled toolsets.

Olympus should visibly represent safety posture:

- locked temple doors for disabled toolsets
- approval-required speech bubble for risky command
- red boundary line when a profile/tool cannot cross scopes
- shield icon for secret/PII redaction enabled
- warning icon if dashboard exposed beyond localhost
- yolo/off-approval mode rendered as a visible hazard state

Unique promise:

> It does not hide danger in settings. It shows the operational risk state.

### 8. Retrospective playback

Hermes stores sessions and messages with tool calls. Olympus can replay a session as a path through the temple:

- agent walks from library to forge to messenger to archive
- tool calls appear as actions in sequence
- failures marked in place
- cost/tokens shown as energy usage

Unique feature:

> Debugging becomes timeline replay, not log scrolling.

This could become a killer feature. It ties visualization to actual troubleshooting.

### 9. Commandable map, not just observation

Later, with explicit approval, Olympus can become a control surface:

- click a cron ritual to trigger/pause/resume
- click a worker to inspect/stop process
- drag task to assign profile/worker
- summon a new agent to a desk
- move an entity between rooms only if profile/security boundary allows it

But this must be phased after read-only MVP.

Unique promise:

> The map becomes a safe operations console.

## Greek Olympus design language

Chosen style: Greek Olympus pixel temple.

Not marble realism. Pixel temple, high contrast, readable at dashboard scale.

Visual grammar:

- Mount Olympus as the whole workspace.
- Temple rooms as profile/capability zones.
- Gods are roles, not gimmicks.
- Agent characters can be small pixel avatars with colored cloaks/crests.
- Tools are mythic instruments.

Suggested rooms:

1. Agora
   - main status area
   - active sessions and incoming work

2. Forge of Hephaestus
   - terminal/process/build/test work

3. Athena's Hall
   - planning, code review, kanban review

4. Library of Mnemosyne
   - skills, memory, session search, docs

5. Hermes Gate
   - gateway/messaging platforms

6. Chronos Sundial
   - cron/scheduled jobs

7. Oracle Pool
   - web/search/browser/research

8. Vault Boundary
   - profile/security state, secrets, approvals

9. Hearth of Hestia
   - optional separate-profile room, visible only as a boundary unless explicitly opened through that profile

Do not overdo mythology. It should feel like a tactical ops floor wearing Olympus skin, not a roleplay game.

## Olympus entity model

A useful normalized backend model:

```json
{
  "id": "session:<session_id>",
  "kind": "session|process|cron|kanban_task|profile|gateway|toolset|skill",
  "label": "Zeus CLI",
  "profile": "default",
  "source": "cli|telegram|discord|cron|dashboard|kanban|unknown",
  "state": "idle|active|thinking|tool_use|running|waiting|approval|blocked|error|done|scheduled",
  "location": "agora|forge|athena|library|gate|chronos|oracle|vault",
  "last_seen": "ISO timestamp",
  "attention": "none|info|warning|critical",
  "capabilities": ["terminal", "file", "web"],
  "meta": {}
}
```

Location can be derived from kind/tool/state before custom layout exists.

## State taxonomy

Keep state small and useful.

MVP states:

- idle
- active
- tool_use
- running
- waiting
- approval
- blocked
- error
- done
- scheduled

Avoid dozens of states. Animation can vary by kind/tool.

## What not to copy from Pixel Agents

Do not copy these first:

- Full layout editor
- complex pathfinding
- furniture asset pipeline
- external asset directory management
- per-pixel sprite pipeline
- VS Code terminal binding
- Claude-specific hook assumptions

Those are good but not the differentiator. Olympus' differentiator is Hermes-native operations.

Copy conceptually:

- one entity, one character/object
- live activity visible
- speech bubbles for waiting/approval
- sound only as optional completion signal
- simple persistent layout
- subagent visualization

## MVP recommendation

Build this in four cuts.

### Cut 1: Read-only Olympus tab

- dashboard tab
- `/health`
- `/overview`
- cards grouped by entity kind
- no canvas yet

This validates data extraction.

### Cut 2: Temple map

- fixed pixel temple layout
- deterministic placement by entity kind
- character/object state badges
- no drag/drop yet

This validates the metaphor.

### Cut 3: Detail drawer and attention model

- click entity
- show recent messages/logs/tool calls
- show why it is in that state
- attention queue at top

This creates operational value.

### Cut 4: Persistence and selective control

- saved seat assignments
- drag entity to room/desk
- approved actions: trigger cron, open session, tail logs
- dangerous actions remain gated

## Killer feature candidates

These are the features that can make Olympus genuinely unique:

1. Attention queue
   - A single "what needs Ghost" lane.
   - approvals, errors, blocked tasks, failed cron, dead gateway platform.

2. Profile boundary map
   - Rooms show tool/memory/session boundaries.
   - Hestia stays isolated.
   - Zeus sees boundary status without leaking Hestia content.

3. Session replay
   - Play back tool calls as movement/actions.
   - Debug failures visually.

4. Ritual calendar
   - Cron jobs visible spatially and temporally.
   - Upcoming jobs represented before they run.

5. Kanban workers as logistics
   - Tasks physically move through columns/rooms.
   - Worker profile avatars claim and complete work.

6. Capability heatmap
   - Which profiles/tools are enabled where.
   - Show risky surfaces immediately.

7. Agent summons
   - Later: spawn Hermes agent/process from a desk with chosen profile, model, toolsets, workdir.
   - Needs approval and careful defaults.

## Risks

1. It becomes toy-first
   - Avoid spending early time on sprites/layout editor.
   - Build operational value first.

2. Polling stale state
   - Sessions DB may not indicate real-time thinking without event hooks.
   - Need classifier humility: "recent", not false-live.

3. Dashboard plugin auth/security drift
   - Plugin routes mount into dashboard process.
   - Keep localhost-only default.
   - Avoid public binding.

4. Cross-profile leakage
   - Do not read Hestia/private profile data from Zeus unless explicitly scoped.
   - If multi-profile view exists, use metadata-only by default.

5. Control surface danger
   - Read-only first.
   - Every runtime mutation needs explicit design.

6. Hermes internals shift
   - Start as plugin using public-ish APIs where possible.
   - If useful, upstream a stable event/state API later.

## Strategic recommendation

Olympus should be pitched internally as:

> A Hermes operations temple: live spatial observability and eventually controlled orchestration for agents, jobs, queues, profiles, tools, and memory.

Not:

> A cute pixel office for agents.

The cute layer helps. It is not the product.

## Immediate next action

Build a proof of life with:

- plugin skeleton
- Greek Olympus theme shell
- `/overview` with sessions + cron + process registry
- card view
- fixed temple map

Do not implement spawn/stop/trigger until the read-only state model is credible.
