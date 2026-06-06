# Agent View and Skill Suggestion Strategy

The Agent View exists to clarify live operational state. It should not be a
decorative diagram.

## Agent View Bar

An operator should be able to answer these in one scan:

1. Which profiles are working, idle, blocked, or risky?
2. Which trigger lanes are feeding work: Kanban, Cron, Gateway?
3. Where is work concentrated?
4. Which profile should I inspect first?
5. What Hermes page owns the fix?

The visual should use readable text, stable cards, and clear risk hierarchy. Avoid
SVG text that scales down with the viewport. If a graph is used, labels should be
HTML or otherwise sized independently from the graphic.

## Current Direction

The current Party View has been reshaped into a command-style Agent View:

- Trigger lanes show Kanban, Cron, and Gateway pressure.
- Agent cards show open, running, ready, and blocked work.
- Flags surface the reason a profile matters.
- The selected profile inspector gives the current task and links the operator back
  to Hermes-owned pages.
- Mobile stacks the view rather than shrinking the whole graphic.
- Profile cards are real buttons with selected state exposed through ARIA. Do not
  wrap interactive Agent View content in `role="img"`.
- Empty evidence sections stay hidden; do not render filler panels just to keep a
  layout shape.

## Better Skill Suggestions

Skill suggestions should be ranked by observed repeatability, not vibes:

| Signal | Suggestion |
| --- | --- |
| Repeated tool-heavy sessions | Create or preload a skill for that workflow. |
| Runaway tool calls | Add a checklist, loop breaker, or recap skill. |
| Long threads | Add memory, recap, or task-splitting procedure. |
| Cron work with thin skill coverage | Add runbook skills for scheduled agents. |
| Forced-skill Kanban work succeeding | Promote the forced-skill pattern. |
| Same profile repeatedly blocked | Add acceptance-criteria or handoff skills. |

Recommended backend shape:

```json
{
  "skill_suggestions": [
    {
      "title": "Bundle visual QA workflow",
      "severity": "warning",
      "profile": "Profile 1",
      "evidence": ["4 tool-heavy sessions", "2 viewport tasks", "1 stale worker"],
      "confidence": 0.82,
      "recommended_view": "/skills",
      "action_label": "Open Skills"
    }
  ]
}
```

## Performance Tracking

The dashboard now has a dedicated Performance Tracking panel for:

- Throughput: completed sessions, completed Kanban runs, worker heartbeats.
- Latency: median and p90 duration.
- Tool pressure: tool calls per session and runaway count.
- Context pressure: average input tokens per API call.
- Cost pressure: total and top expensive sessions when Hermes exposes cost.
- Reliability: handoff errors, failed runs, stale sessions, stale workers.

Keep using windowed rollups and clear thresholds until the backend has a real
time series. Use sparklines only after Olympus can show real historical samples,
not inferred trend decoration.

## Visual QA Rules

- Test desktop and mobile viewports.
- Fail on console and page errors.
- Fail if the page has horizontal overflow.
- Fail if the Agent View contains microscopic visible text.
- Fail if hidden-label fixtures expose private profile, task, board, session, or
  path labels.
- Fail if action links point outside the known Hermes-owned routes.
- Run the same pass across noisy, healthy, empty, overloaded, stale/blocked,
  high-cost, and hidden-label fixture states.
- Attach screenshots as test artifacts.
- Add fixture states before adding more visual complexity.

See `FRONTEND_SKILL_RESEARCH.md` for GitHub-hosted skills and references to
evaluate for taste, design critique, production UI engineering, and visual QA.
