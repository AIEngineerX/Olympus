# Hermes Desktop Olympus Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Olympus a first-class Hermes operations plugin that is packaged, tested, and ready to surface from Hermes Dashboard and Hermes Desktop without duplicating Hermes-owned controls.

**Architecture:** Keep Olympus as a read-only dashboard plugin. Harden the Olympus repo with Desktop-aware preflight checks, compatibility docs, and release gates. In Hermes upstream, add Desktop parity for dashboard plugin tabs by reusing the existing dashboard plugin manifest contract or by opening plugin pages in a sandboxed dashboard webview.

**Tech Stack:** Olympus uses a Python FastAPI plugin router in `dashboard/plugin_api.py`, hand-authored React SDK assets in `dashboard/dist/index.js`, CSS in `dashboard/dist/style.css`, Node smoke scripts, and Playwright. Hermes upstream uses the web dashboard plugin system in `web/src/plugins/*`, the web dashboard shell in `web/src/App.tsx`, and the native Electron Desktop app in `apps/desktop/src/*` and `apps/desktop/electron/main.cjs`.

---

## Current Evidence

- Olympus is already a valid Hermes dashboard plugin with `dashboard/manifest.json`, `dashboard/plugin_api.py`, `dashboard/dist/index.js`, and `dashboard/dist/style.css`.
- Hermes web dashboard already supports plugin manifests, plugin navigation, plugin routes, CSS/JS asset injection, and plugin pages through:
  - `web/src/plugins/types.ts`
  - `web/src/plugins/usePlugins.ts`
  - `web/src/plugins/PluginPage.tsx`
  - `web/src/App.tsx`
- Hermes Desktop currently has its own native route set in `apps/desktop/src/app/routes.ts`: chat, settings, command center, skills, messaging, artifacts, cron, profiles, agents.
- Hermes Desktop does not currently expose a first-class route for dashboard plugin tabs such as `/olympus`.
- Hermes Desktop Command Center already has a Usage section backed by `/api/analytics/usage?days=...`. It renders sessions, API calls, input/output tokens, estimated and actual cost, daily token bars, top models, and top skills.
- Hermes Desktop can launch on this Mac with `HERMES_DESKTOP_PYTHON=/Users/ghost/.hermes/hermes-agent/venv/bin/python npm run dev`; without the override it selects `.venv`, which lacks `fastapi`.

## Product Decision

Olympus should not become a Hermes Desktop replacement. Hermes Desktop owns execution and control surfaces. Olympus owns read-only operations intelligence:

- readiness score
- Pantheon map
- evidence sources
- skill hygiene
- safe config policy
- auxiliary cost visibility
- Kanban intelligence
- trace and deterministic eval signals

Hermes Desktop Usage and Hermes web Analytics own the usage ledger. Olympus may
use those fields only as evidence for risk, routing, skill hygiene, and handoff
links.

The PR posture should be: **Hermes Desktop gives operators controls; Olympus tells them what needs attention, why, and where to fix it.**

## File Structure

### Olympus repo

- Modify `README.md`
  - Add a short "Hermes Desktop" section that says Olympus is Dashboard-first today and Desktop-visible once Desktop plugin-tab parity lands.
- Modify `TODO.md`
  - Add Desktop integration as an active phase before Trace Spine.
- Modify `dashboard/docs/BUILD_PLAN.md`
  - Add a phase for Desktop plugin parity and upstream PR.
- Modify `dashboard/docs/PRODUCTION_READINESS.md`
  - Add Desktop compatibility rows and the `npm run test:desktop-preflight` gate.
- Create `dashboard/docs/HERMES_DESKTOP_INTEGRATION.md`
  - Record the product boundary, installation flow, Desktop gap, upstream PR plan, and fallback.
- Create `scripts/olympus-desktop-preflight.mjs`
  - Validate local Hermes CLI, plugin link, dashboard plugin manifest, web dashboard plugin API, Desktop source route state, and Desktop Python backend readiness.
- Modify `package.json`
  - Add `test:desktop-preflight`.

### Hermes upstream repo

- Modify `apps/desktop/src/app/routes.ts`
  - Add a Desktop route for plugin pages if using native plugin parity.
- Modify `apps/desktop/src/app/desktop-controller.tsx`
  - Lazy-load the plugin host view and route it.
- Create `apps/desktop/src/app/plugins/plugin-host.tsx`
  - Render dashboard plugin pages in a safe webview or native bridge.
- Modify `apps/desktop/src/app/chat/sidebar/index.tsx`
  - Show dashboard plugin tabs or an "Ops" item sourced from plugin manifests.
- Modify `apps/desktop/src/app/command-palette/index.tsx`
  - Include dashboard plugin tabs in navigation search.
- Modify `apps/desktop/src/hermes.ts`
  - Add typed helpers for `GET /api/dashboard/plugins`.
- Modify `apps/desktop/src/types/hermes.ts`
  - Add `DashboardPluginManifest`.
- Add tests under `apps/desktop/src/app/plugins/*.test.tsx`
  - Route rendering, manifest filtering, hidden tabs, path safety, and navigation.
- Consider `apps/desktop/electron/main.cjs`
  - If using webview, add a narrowly scoped URL builder for authenticated local dashboard plugin pages.

---

## Task 1: Olympus Desktop Integration Documentation

**Files:**
- Create: `dashboard/docs/HERMES_DESKTOP_INTEGRATION.md`
- Modify: `README.md`
- Modify: `dashboard/docs/BUILD_PLAN.md`
- Modify: `TODO.md`

- [ ] **Step 1: Create the Desktop integration doc**

Create `dashboard/docs/HERMES_DESKTOP_INTEGRATION.md` with:

```markdown
# Hermes Desktop Integration

Olympus is a read-only Hermes operations plugin. It should be visible from Hermes Dashboard and Hermes Desktop, but it should not replace Desktop controls.

## Boundary

Hermes Desktop owns chat, agents, profiles, skills, toolsets, providers, keys, sessions, cron, messaging, artifacts, and settings.

Olympus owns readiness, evidence, risk, skill hygiene, safe config policy, Kanban intelligence, Pantheon, Trace Spine, and deterministic ops evals.

## Current State

The Hermes web dashboard already supports dashboard plugin manifests and routes. Olympus loads there through `dashboard/manifest.json`.

Hermes Desktop currently has a native route set and does not expose dashboard plugin tabs such as `/olympus` as first-class Desktop pages.

## Target

Desktop should surface installed dashboard plugin tabs from the same `GET /api/dashboard/plugins` manifest contract as the web dashboard.

## Preferred Upstream Change

Add Desktop plugin-tab parity:

1. Fetch dashboard plugin manifests from the Desktop backend.
2. Add visible plugin nav items for non-hidden plugin tabs.
3. Route each plugin tab to a safe plugin host.
4. Keep plugin APIs behind the same dashboard session-token flow.
5. Preserve plugin asset loading, CSS, and path constraints.

## Fallback

If Desktop maintainers do not want full plugin-page parity yet, Olympus remains a web dashboard plugin and Desktop should provide a safe "Open Dashboard Plugin" action that opens `/olympus` in the local dashboard.

## Olympus Rule

Olympus remains read-only until a specific side-effect contract is approved. All fixes continue to link to Hermes-owned pages.
```

- [ ] **Step 2: Update `README.md`**

Add this section after `Run`:

```markdown
## Hermes Desktop

Hermes Desktop is the native control surface for Hermes Agent. Olympus is the read-only operations plugin that should live beside those controls.

Today Olympus is verified through the Hermes web dashboard at `/olympus`. Desktop visibility requires Hermes Desktop plugin-tab parity for dashboard plugins. See [`dashboard/docs/HERMES_DESKTOP_INTEGRATION.md`](dashboard/docs/HERMES_DESKTOP_INTEGRATION.md).
```

- [ ] **Step 3: Update `TODO.md`**

Add this item before Trace Spine:

```markdown
3. Hermes Desktop Integration
   - Add a Desktop preflight script in this repo.
   - Prepare an upstream Hermes Desktop PR for dashboard plugin-tab parity.
   - Keep Olympus read-only and avoid duplicating Desktop controls.
   - Fallback: document browser-dashboard access if Desktop plugin parity is not accepted.
```

- [ ] **Step 4: Commit**

```bash
git add README.md TODO.md dashboard/docs/BUILD_PLAN.md dashboard/docs/HERMES_DESKTOP_INTEGRATION.md
git commit -m "docs: scope hermes desktop integration"
```

---

## Task 2: Olympus Desktop Preflight Script

**Files:**
- Create: `scripts/olympus-desktop-preflight.mjs`
- Modify: `package.json`
- Modify: `dashboard/docs/PRODUCTION_READINESS.md`

- [ ] **Step 1: Create `scripts/olympus-desktop-preflight.mjs`**

```javascript
#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const hermesHome = process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes')
const hermesSource = process.env.HERMES_SOURCE || path.join(hermesHome, 'hermes-agent')

const checks = []

function ok(name, detail = '') {
  checks.push({ name, state: 'ok', detail })
}

function warn(name, detail) {
  checks.push({ name, state: 'warning', detail })
}

function fail(name, detail) {
  checks.push({ name, state: 'fail', detail })
}

function exists(file) {
  return fs.existsSync(file)
}

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...options })
}

const manifestPath = path.join(root, 'dashboard', 'manifest.json')
if (exists(manifestPath)) {
  const manifest = JSON.parse(read(manifestPath))
  if (manifest.name === 'olympus' && manifest.tab?.path === '/olympus') {
    ok('olympus manifest', 'name=olympus tab=/olympus')
  } else {
    fail('olympus manifest', 'expected name=olympus and tab.path=/olympus')
  }
} else {
  fail('olympus manifest', 'dashboard/manifest.json is missing')
}

const linkedDashboard = path.join(hermesHome, 'plugins', 'olympus', 'dashboard')
if (exists(linkedDashboard)) {
  ok('hermes plugin link', linkedDashboard)
} else {
  warn('hermes plugin link', `missing ${linkedDashboard}; run scripts/install-dashboard-link.sh`)
}

const hermes = run('hermes', ['--version'])
if (hermes.status === 0) {
  ok('hermes cli', hermes.stdout.trim() || hermes.stderr.trim())
} else {
  fail('hermes cli', 'hermes --version failed')
}

const webPluginFiles = [
  'web/src/plugins/usePlugins.ts',
  'web/src/plugins/PluginPage.tsx',
  'web/src/App.tsx'
]

for (const rel of webPluginFiles) {
  const file = path.join(hermesSource, rel)
  if (exists(file)) ok(`hermes web ${rel}`)
  else warn(`hermes web ${rel}`, 'file missing in local Hermes source')
}

const desktopRoutes = path.join(hermesSource, 'apps', 'desktop', 'src', 'app', 'routes.ts')
if (exists(desktopRoutes)) {
  const text = read(desktopRoutes)
  if (text.includes('/olympus') || text.includes('plugins')) {
    ok('desktop plugin route signal', 'Desktop source includes plugin route signal')
  } else {
    warn('desktop plugin route signal', 'Desktop has native routes but no dashboard plugin route signal yet')
  }
} else {
  warn('desktop source', 'apps/desktop/src/app/routes.ts not found')
}

const pythonCandidates = [
  process.env.HERMES_DESKTOP_PYTHON,
  path.join(hermesSource, 'venv', 'bin', 'python'),
  path.join(hermesSource, '.venv', 'bin', 'python')
].filter(Boolean)

for (const python of pythonCandidates) {
  if (!exists(python)) continue
  const probe = run(python, ['-c', 'import fastapi, uvicorn; print("dashboard deps ok")'])
  if (probe.status === 0) {
    ok(`desktop python ${python}`, probe.stdout.trim())
    break
  }
  warn(`desktop python ${python}`, probe.stderr.trim() || probe.stdout.trim() || 'missing dashboard deps')
}

for (const check of checks) {
  const symbol = check.state === 'ok' ? '✓' : check.state === 'warning' ? '!' : '✗'
  console.log(`${symbol} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
}

if (checks.some(check => check.state === 'fail')) {
  process.exit(1)
}
```

- [ ] **Step 2: Add the package script**

In `package.json`, add:

```json
"test:desktop-preflight": "node scripts/olympus-desktop-preflight.mjs"
```

- [ ] **Step 3: Run the preflight**

```bash
npm run test:desktop-preflight
```

Expected:

- `olympus manifest` passes.
- `hermes cli` passes.
- `hermes web web/src/plugins/usePlugins.ts` passes.
- `desktop plugin route signal` warns until the Hermes upstream Desktop PR lands.
- At least one Desktop Python candidate passes, or the script prints the exact missing dependency.

- [ ] **Step 4: Update Production Readiness**

Add `npm run test:desktop-preflight` to the release gate in `dashboard/docs/PRODUCTION_READINESS.md`.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/olympus-desktop-preflight.mjs dashboard/docs/PRODUCTION_READINESS.md
git commit -m "test: add hermes desktop preflight"
```

---

## Task 3: Upstream Hermes Desktop Plugin Parity Proposal

**Files:**
- Create in Hermes upstream branch: `docs/desktop-dashboard-plugin-parity.md` or PR description.
- Modify in Hermes upstream: no code in this task.

- [ ] **Step 1: Create an upstream issue/PR proposal**

Use this proposal body:

```markdown
## Summary

Hermes web dashboard already supports dashboard plugin tabs through `GET /api/dashboard/plugins`, manifest-driven nav insertion, asset loading, and `PluginPage`.

Hermes Desktop has native routes for core surfaces, but installed dashboard plugin tabs are not currently first-class Desktop routes. This means plugins such as Olympus are visible in the web dashboard but not in Desktop.

## Proposed Change

Add Desktop parity for dashboard plugin tabs.

Options:

1. Native Desktop plugin host: Desktop fetches plugin manifests from the dashboard backend, adds plugin nav items, and renders each plugin in a dedicated host.
2. Sandboxed dashboard webview: Desktop opens the local dashboard plugin path in a constrained webview while preserving dashboard auth/session-token behavior.

## Non-goals

- Do not hardcode Olympus.
- Do not give plugins direct Node/Electron access.
- Do not bypass dashboard auth.
- Do not replace Desktop-native pages.

## Why

Hermes Desktop is the control surface. Dashboard plugins are the extension surface. Desktop should expose installed dashboard plugins without every plugin needing a Desktop-specific implementation.
```

- [ ] **Step 2: Attach evidence**

Mention these files in the PR:

```text
web/src/plugins/usePlugins.ts
web/src/plugins/PluginPage.tsx
web/src/App.tsx
apps/desktop/src/app/routes.ts
apps/desktop/src/app/desktop-controller.tsx
apps/desktop/src/app/chat/sidebar/index.tsx
```

- [ ] **Step 3: Decide implementation option**

Choose one:

- Option A: native plugin bridge, more work, better Desktop feel.
- Option B: sandboxed dashboard plugin webview, faster, lower risk, preserves existing dashboard plugin runtime.

Recommended first PR: Option B.

---

## Task 4: Hermes Upstream Option B, Sandboxed Dashboard Plugin Webview

**Files in Hermes upstream:**
- Modify: `apps/desktop/src/types/hermes.ts`
- Modify: `apps/desktop/src/hermes.ts`
- Create: `apps/desktop/src/app/plugins/plugin-routes.ts`
- Create: `apps/desktop/src/app/plugins/plugin-webview.tsx`
- Modify: `apps/desktop/src/app/routes.ts`
- Modify: `apps/desktop/src/app/desktop-controller.tsx`
- Modify: `apps/desktop/src/app/chat/sidebar/index.tsx`
- Modify: `apps/desktop/src/app/command-palette/index.tsx`
- Test: `apps/desktop/src/app/plugins/plugin-routes.test.ts`
- Test: `apps/desktop/src/app/plugins/plugin-webview.test.tsx`

- [ ] **Step 1: Add manifest type**

Add to `apps/desktop/src/types/hermes.ts`:

```ts
export interface DashboardPluginManifest {
  name: string
  label: string
  description?: string
  icon?: string
  version?: string
  tab: {
    path: string
    position?: string
    override?: string
    hidden?: boolean
  }
  entry?: string
  css?: null | string
  has_api?: boolean
  source?: string
}
```

- [ ] **Step 2: Add API helper**

Add to `apps/desktop/src/hermes.ts`:

```ts
export function getDashboardPlugins(): Promise<DashboardPluginManifest[]> {
  return window.hermesDesktop.api<DashboardPluginManifest[]>({
    path: '/api/dashboard/plugins'
  })
}
```

- [ ] **Step 3: Add route helper tests**

Create `apps/desktop/src/app/plugins/plugin-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { visibleDashboardPluginRoutes } from './plugin-routes'

describe('visibleDashboardPluginRoutes', () => {
  it('keeps non-hidden dashboard plugin tabs', () => {
    const routes = visibleDashboardPluginRoutes([
      { name: 'olympus', label: 'Olympus', tab: { path: '/olympus', position: 'end' } },
      { name: 'hidden', label: 'Hidden', tab: { path: '/hidden', hidden: true } }
    ])

    expect(routes).toEqual([{ name: 'olympus', label: 'Olympus', path: '/olympus', position: 'end' }])
  })

  it('rejects unsafe plugin paths', () => {
    const routes = visibleDashboardPluginRoutes([
      { name: 'bad', label: 'Bad', tab: { path: 'https://example.com' } },
      { name: 'also-bad', label: 'Bad', tab: { path: '/../x' } }
    ])

    expect(routes).toEqual([])
  })
})
```

- [ ] **Step 4: Implement route helper**

Create `apps/desktop/src/app/plugins/plugin-routes.ts`:

```ts
import type { DashboardPluginManifest } from '@/types/hermes'

export interface DesktopPluginRoute {
  name: string
  label: string
  path: string
  position?: string
}

function safePluginPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (!path.startsWith('/')) return false
  if (path.startsWith('//')) return false
  if (path.includes('..')) return false
  return /^\/[a-zA-Z0-9/_-]+$/.test(path)
}

export function visibleDashboardPluginRoutes(manifests: DashboardPluginManifest[]): DesktopPluginRoute[] {
  return manifests
    .filter(manifest => !manifest.tab?.hidden && !manifest.tab?.override && safePluginPath(manifest.tab?.path))
    .map(manifest => ({
      name: manifest.name,
      label: manifest.label || manifest.name,
      path: manifest.tab.path,
      position: manifest.tab.position
    }))
}
```

- [ ] **Step 5: Add plugin webview**

Create `apps/desktop/src/app/plugins/plugin-webview.tsx`:

```tsx
import { useEffect, useRef } from 'react'

interface PluginWebviewProps {
  path: string
  title: string
}

export function PluginWebview({ path, title }: PluginWebviewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const webview = document.createElement('webview')
    webview.className = 'flex h-full w-full flex-1 bg-background'
    webview.setAttribute('partition', 'persist:hermes-dashboard-plugins')
    webview.setAttribute('src', path)
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')
    webview.setAttribute('aria-label', title)
    host.replaceChildren(webview)

    return () => webview.remove()
  }, [path, title])

  return <div className="flex h-full min-h-0 w-full min-w-0 flex-1" ref={hostRef} />
}
```

- [ ] **Step 6: Wire routes and nav**

Add a plugin route container to `apps/desktop/src/app/desktop-controller.tsx` after fetching manifests with `getDashboardPlugins()`. Use `visibleDashboardPluginRoutes()` to build nav entries and render `PluginWebview` for matching paths.

Keep the first PR small: do not reimplement the web dashboard plugin registry in Desktop. The webview should load the dashboard route served by the existing backend.

- [ ] **Step 7: Run Desktop tests**

```bash
cd /Users/ghost/.hermes/hermes-agent/apps/desktop
npm run type-check
npm run test:ui -- plugin-routes
npm run test:desktop:platforms
```

Expected:

- Type-check passes.
- Plugin route helper tests pass.
- Existing platform tests pass.

- [ ] **Step 8: Manual smoke**

```bash
cd /Users/ghost/.hermes/hermes-agent/apps/desktop
HERMES_DESKTOP_PYTHON=/Users/ghost/.hermes/hermes-agent/venv/bin/python npm run dev
```

Expected:

- Desktop boots.
- Olympus appears as a plugin nav item if installed.
- Opening Olympus renders `/olympus`.
- Plugin cannot access Node integration.

---

## Task 5: Olympus Trace Spine V0 After Desktop Parity

**Files:**
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: `tests/fixtures/olympus-fixture-data.js`
- Modify: `tests/visual/olympus.spec.js`
- Modify: `scripts/olympus-security-smoke.mjs`
- Modify: `dashboard/docs/BUILD_PLAN.md`

- [ ] **Step 1: Add a trace collector test fixture**

Add fixture data with:

- one Kanban task with `session_id`
- two `task_runs`
- one failed run
- session `tool_call_count`
- redacted message/tool sequence summary

- [ ] **Step 2: Add backend collector**

Add `build_trace_spine()` to `dashboard/plugin_api.py` that returns:

```python
{
    "summary": {
        "linked_tasks": 0,
        "linked_sessions": 0,
        "failed_runs": 0,
        "tool_heavy_links": 0
    },
    "items": [
        {
            "id": "trace-...",
            "state": "warning",
            "title": "Task has failed run with linked session",
            "evidence": "1 failed run / 18 tool calls",
            "recommended_view": "/kanban",
            "basis": "Hermes Kanban task_runs plus state sessions"
        }
    ]
}
```

Never return transcript content, raw task IDs, raw session IDs, local paths, or prompt text.

- [ ] **Step 3: Render Trace Spine panel**

Render the panel below Kanban Intelligence. Hide it when `items` is empty.

- [ ] **Step 4: Extend security smoke**

Fail if `trace_spine` contains:

```text
/Users/
.hermes/state.db
.hermes/kanban.db
cwd
workspace_path
sk-
github_pat_
ghp_
```

- [ ] **Step 5: Run gates**

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:security
npm run test:desktop-preflight
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/plugin_api.py dashboard/dist/index.js dashboard/dist/style.css tests scripts dashboard/docs
git commit -m "feat: add olympus trace spine signals"
```

---

## Task 6: Deterministic Ops Eval Signals

**Files:**
- Modify: `dashboard/plugin_api.py`
- Modify: `dashboard/dist/index.js`
- Modify: `dashboard/dist/style.css`
- Modify: `tests/fixtures/olympus-fixture-data.js`
- Modify: `tests/visual/olympus.spec.js`
- Modify: `dashboard/docs/PRODUCTION_READINESS.md`

- [ ] **Step 1: Define eval categories**

Use only deterministic Hermes evidence:

- reliability: failed runs, stale workers, handoff errors
- efficiency: tool-heavy sessions, long sessions, token pressure
- routing: missing model/profile route evidence, model override concentration
- skill use: forced skills, unused skills, heavy unpinned skills

- [ ] **Step 2: Add backend object**

Return:

```python
"ops_evals": {
    "summary": {
        "reliability": "watch",
        "efficiency": "warning",
        "routing": "watch",
        "skill_use": "ok"
    },
    "items": []
}
```

- [ ] **Step 3: Render compact panel**

Panel title: `Ops Evals`.

Copy rule: call them operational evals, not answer-quality judgments.

- [ ] **Step 4: Run gates**

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:security
npm run test:desktop-preflight
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/plugin_api.py dashboard/dist/index.js dashboard/dist/style.css tests dashboard/docs
git commit -m "feat: add deterministic olympus ops evals"
```

---

## Task 7: Release And PR Path

**Files:**
- Modify: `dashboard/docs/PRODUCTION_READINESS.md`
- Modify: `README.md`

- [ ] **Step 1: Run final Olympus gates**

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:security
npm run test:desktop-preflight
```

- [ ] **Step 2: Run security scan**

```bash
rg -n "(sk-[A-Za-z0-9_-]{12,}|github_pat_|ghp_|xox[baprs]-|api[_-]?key\\s*[:=]|token\\s*[:=]|secret\\s*[:=]|password\\s*[:=])" \
  --glob '!node_modules/**' \
  --glob '!test-results/**' \
  --glob '!playwright-report/**' .
```

Expected: no real secrets. Documentation examples are allowed only when clearly fake.

- [ ] **Step 3: PR sequence**

Open PRs in this order:

1. Olympus repo: Desktop integration docs and preflight.
2. Hermes upstream: Desktop dashboard plugin parity.
3. Olympus repo: Trace Spine V0.
4. Olympus repo: deterministic ops evals.

- [ ] **Step 4: Commit final docs**

```bash
git add README.md dashboard/docs/PRODUCTION_READINESS.md
git commit -m "docs: finalize olympus desktop readiness path"
```

---

## Bug And Security Gates After Every Phase

Run:

```bash
npm run verify
npm run test:visual
npm run test:live
npm run test:security
npm run test:desktop-preflight
```

Check manually:

- `/olympus` renders without console errors.
- No mock or placeholder data renders in live Hermes.
- Empty evidence hides.
- Links go only to Hermes-owned pages.
- Local labels, raw IDs, paths, prompt text, and secrets stay hidden unless explicitly enabled.
- Desktop preflight reports the current Desktop plugin parity state.

For Hermes upstream Desktop PRs, also run:

```bash
cd /Users/ghost/.hermes/hermes-agent/apps/desktop
npm run type-check
npm run lint
npm run test:desktop:platforms
```

---

## Self-Review

Spec coverage:

- Makes Olympus visible from Hermes Desktop: covered by Tasks 3 and 4.
- Keeps Olympus grounded and non-duplicative: covered by Product Decision, Task 1, and all later tasks.
- Adds quick wins first: docs and preflight land before upstream code.
- Builds bug and security checks after each phase: covered in every task and final gates.
- Keeps PR path clear: covered by Task 7.

Placeholder scan:

- No `TBD` or `implement later` placeholders.
- Every task has files, commands, and expected outcomes.

Type consistency:

- `DashboardPluginManifest` is used by `getDashboardPlugins()`.
- `visibleDashboardPluginRoutes()` returns `DesktopPluginRoute`.
- `PluginWebview` accepts `path` and `title`.
