// Olympus for Hermes Desktop: findings, fixes, spend and backlog as a native page.
//
// Loaded uncompiled by Hermes Desktop, so it uses jsx()/jsxs() instead of JSX
// and imports only @hermes/plugin-sdk, react and react/jsx-runtime. All data
// comes from Olympus' own backend through ctx.rest (the same
// plugin_api.py the web dashboard tab uses).
import { Badge, Button, ROUTES_AREA, SIDEBAR_NAV_AREA, host } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ROUTE = '/olympus'
const POLL_MS = 30000

// Desktop pages a finding can hand off to. Only allow-listed app actions are
// used; findings owned by other pages keep their text without a button.
const VIEW_ACTIONS = {
  '/cron': ['nav.cron', 'Open Cron'],
  '/profiles': ['nav.profiles', 'Open Profiles'],
  '/skills': ['nav.capabilities', 'Open Capabilities'],
  '/config': ['nav.settings', 'Open Settings']
}

const SEVERITY_BADGE = { critical: 'destructive', warning: 'warn', info: 'muted', ok: 'success' }
const VERDICT_BADGE = { cleared: 'success', improved: 'success', unchanged: 'warn', worse: 'destructive', 'still present': 'warn' }

const text = {
  primary: { color: 'var(--ui-text-primary)' },
  secondary: { color: 'var(--ui-text-secondary)' },
  tertiary: { color: 'var(--ui-text-tertiary)' }
}
const card = {
  border: '1px solid var(--ui-stroke-secondary)',
  borderRadius: 6,
  padding: 12
}

function money(value) {
  const n = Number(value || 0)
  return n > 0 ? '$' + n.toFixed(2) : 'unpriced'
}

function Fact({ label, value }) {
  return jsxs('div', {
    style: { ...card, minWidth: 0 },
    children: [
      jsx('div', { style: { ...text.tertiary, fontSize: 11, textTransform: 'uppercase', fontWeight: 600 }, children: label }),
      jsx('div', { style: { ...text.primary, fontSize: 14, fontWeight: 600, marginTop: 2 }, children: value })
    ]
  })
}

function SessionButton({ ctx, target }) {
  const [state, setState] = useState('idle')
  const open = () => {
    setState('opening')
    ctx.rest('/open/session?ref=' + encodeURIComponent(target.ref))
      .then(result => {
        if (result && result.session_id) {
          setState('idle')
          return host.openSession(result.session_id, { profile: result.profile })
        }
        setState('missing')
      })
      .catch(() => setState('missing'))
  }
  return jsx(Button, {
    variant: 'outline',
    size: 'xs',
    disabled: state !== 'idle',
    onClick: open,
    children: state === 'missing' ? 'Session no longer available' : state === 'opening' ? 'Opening…' : 'Open ' + (target.label || 'session') + ' session'
  })
}

function FixButton({ ctx, item, tracked, onFixes }) {
  const [state, setState] = useState('idle')
  if (!item.key || item.severity === 'ok') return null
  if (tracked) return jsx('span', { style: { ...text.secondary, fontSize: 12 }, children: 'Tracking your fix' })
  const track = () => {
    setState('saving')
    ctx.rest('/fixes?key=' + encodeURIComponent(item.key), { method: 'POST' })
      .then(result => {
        if (result && result.tracked) {
          setState('idle')
          onFixes(result.fixes)
          return
        }
        setState('gone')
      })
      .catch(() => setState('failed'))
  }
  return jsx(Button, {
    variant: 'secondary',
    size: 'xs',
    disabled: state !== 'idle',
    onClick: track,
    children: state === 'saving' ? 'Saving…' : state === 'gone' ? 'Already cleared' : state === 'failed' ? 'Could not save' : 'I fixed this'
  })
}

function Finding({ ctx, item, tracked, onFixes }) {
  const action = VIEW_ACTIONS[item.recommended_view]
  const sessions = (item.targets || []).filter(target => target.kind === 'session' && target.ref)
  return jsxs('article', {
    style: { ...card, display: 'grid', gap: 6 },
    children: [
      jsxs('div', {
        style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
        children: [
          jsx('div', { style: { ...text.primary, fontWeight: 600 }, children: item.title }),
          jsx(Badge, { variant: SEVERITY_BADGE[item.severity] || 'muted', children: item.severity })
        ]
      }),
      jsx('div', { style: { ...text.secondary, fontSize: 13 }, children: item.detail }),
      item.evidence ? jsx('div', { style: { ...text.tertiary, fontSize: 12 }, children: item.evidence }) : null,
      jsxs('div', {
        style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 },
        children: [
          ...sessions.map(target => jsx(SessionButton, { ctx, target }, target.ref)),
          jsx(FixButton, { ctx, item, tracked, onFixes }, 'fix'),
          action ? jsx(Button, { variant: 'textStrong', size: 'xs', onClick: () => ctx.runAction(action[0]), children: action[1] }, 'view') : null
        ]
      })
    ]
  })
}

function Section({ title, subtitle, children }) {
  return jsxs('section', {
    style: { display: 'grid', gap: 8 },
    children: [
      jsxs('div', {
        children: [
          jsx('h2', { style: { ...text.primary, fontSize: 15, fontWeight: 600, margin: 0 }, children: title }),
          subtitle ? jsx('div', { style: { ...text.tertiary, fontSize: 12 }, children: subtitle }) : null
        ]
      }),
      children
    ]
  })
}

function OlympusPage({ ctx }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const inFlight = useRef(false)

  const load = () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    ctx.rest('/overview')
      .then(next => {
        setData(next)
        setError(null)
      })
      .catch(err => setError(String((err && err.message) || err)))
      .finally(() => {
        inFlight.current = false
        setLoading(false)
      })
  }

  useEffect(() => {
    let stopped = false
    let cancelTimer = () => {}
    const tick = () => {
      if (stopped) return
      load()
      cancelTimer = ctx.setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      stopped = true
      cancelTimer()
    }
  }, [])

  if (!data) {
    return jsx('div', {
      style: { padding: 16, ...text.secondary },
      children: error
        ? 'Olympus could not reach its backend: ' + error + '. Enable it with `hermes plugins enable olympus` and restart the gateway.'
        : 'Reading local Hermes state…'
    })
  }

  const tuning = data.tuning || {}
  const hq = tuning.agent_hq || {}
  const metrics = hq.metrics || {}
  const findings = hq.recommendations || []
  const urgent = findings.filter(item => item.severity === 'critical' || item.severity === 'warning')
  const fixes = data.fixes || []
  const fixKeys = new Set(fixes.map(fix => fix.key))
  const setFixes = next => setData(prev => ({ ...prev, fixes: next }))
  const cron = (data.cost_attribution && data.cost_attribution.cron) || {}
  const background = (data.cost_attribution && data.cost_attribution.background) || {}
  const backlog = (data.backlog && data.backlog.groups) || []

  return jsxs('div', {
    style: { height: '100%', overflowY: 'auto', padding: 16, display: 'grid', gap: 18, alignContent: 'start', maxWidth: 980 },
    children: [
      jsxs('header', {
        style: { display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' },
        children: [
          jsxs('div', {
            children: [
              jsx('h1', { style: { ...text.primary, fontSize: 20, fontWeight: 600, margin: 0 }, children: 'Olympus' }),
              jsx('div', { style: { ...text.tertiary, fontSize: 12 }, children: (data.health && data.health.summary) || '' })
            ]
          }),
          jsx(Button, { variant: 'outline', size: 'xs', disabled: loading, onClick: load, children: loading ? 'Refreshing' : 'Refresh' })
        ]
      }),
      jsxs('div', {
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 },
        children: [
          jsx(Fact, { label: 'Needs you', value: urgent.length ? urgent.length + (urgent.length === 1 ? ' item' : ' items') : 'Nothing urgent' }),
          jsx(Fact, { label: 'Spend, last 24h', value: metrics.sessions_24h ? money(metrics.spend_24h_usd) + ' across ' + metrics.sessions_24h + ' sessions' : 'No sessions' }),
          jsx(Fact, { label: 'Session window', value: (metrics.window && metrics.window.label) || 'No sessions yet' })
        ]
      }),
      jsx(Section, {
        title: urgent.length ? 'Needs you (' + urgent.length + ')' : 'Nothing urgent',
        subtitle: 'Ranked by severity, with the evidence behind each finding.',
        children: jsx('div', {
          style: { display: 'grid', gap: 8 },
          children: findings.slice(0, 5).map(item => jsx(Finding, { ctx, item, tracked: fixKeys.has(item.key), onFixes: setFixes }, item.key || item.title))
        })
      }),
      fixes.length ? jsx(Section, {
        title: 'Did your fixes work?',
        children: jsx('div', {
          style: { display: 'grid', gap: 6 },
          children: fixes.map(fix => jsxs('div', {
            style: { ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
            children: [
              jsxs('div', {
                children: [
                  jsx('div', { style: { ...text.primary, fontSize: 13, fontWeight: 600 }, children: fix.title }),
                  jsx('div', { style: { ...text.tertiary, fontSize: 12 }, children: (fix.baseline == null ? '' : fix.baseline + ' → ' + fix.current + ' · ') + 'tracked ' + fix.days_tracked + ' days' })
                ]
              }),
              jsx(Badge, { variant: VERDICT_BADGE[fix.verdict] || 'muted', children: fix.verdict })
            ]
          }, fix.key))
        })
      }) : null,
      cron.jobs && cron.jobs.length ? jsx(Section, {
        title: 'Where spend goes',
        subtitle: 'Last ' + (data.cost_attribution.window_days || 7) + ' days: cron ' + money(cron.total_cost_usd) + ', background tasks ' + money(background.total_cost_usd) + '.',
        children: jsx('div', {
          style: { display: 'grid', gap: 4 },
          children: cron.jobs.slice(0, 5).map(job => jsxs('div', {
            style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, ...text.secondary },
            children: [
              jsx('span', { children: job.label + (job.schedule ? ' · ' + job.schedule : '') }),
              jsx('span', { children: job.fires + ' runs · ≈ ' + money(job.est_cost_usd) })
            ]
          }, job.job_ref))
        })
      }) : null,
      backlog.length ? jsx(Section, {
        title: 'Backlog triage',
        subtitle: 'Stuck Kanban tasks, grouped by who has to act.',
        children: jsx('div', {
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 },
          children: backlog.map(group => jsxs('div', {
            style: { ...card, display: 'grid', gap: 4 },
            children: [
              jsx('div', { style: { ...text.primary, fontWeight: 600, fontSize: 13 }, children: group.count + ' · ' + group.label }),
              jsx('div', { style: { ...text.tertiary, fontSize: 12 }, children: group.action })
            ]
          }, group.kind))
        })
      }) : null,
      error ? jsx('div', { style: { ...text.tertiary, fontSize: 12 }, children: 'Last refresh failed: ' + error }) : null
    ]
  })
}

export default {
  id: 'olympus',
  name: 'Olympus',
  register(ctx) {
    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => jsx(OlympusPage, { ctx }) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: ROUTE, label: 'Olympus', codicon: 'pulse' } }
    ])
  }
}
