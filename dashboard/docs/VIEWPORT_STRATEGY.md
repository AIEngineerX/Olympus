# Pantheon and Skill Suggestion Strategy

Pantheon exists to clarify live operational state, not decorate the page.

## Pantheon Control

An operator can answer these in one scan:

1. Which profiles are working, idle, blocked, or risky?
2. Which trigger lanes are feeding work: Kanban, Cron, Gateway?
3. Where is work concentrated?
4. Which profile needs inspection first?
5. What Hermes page owns the fix?

Use readable text, stable controls, and clear risk hierarchy. Avoid SVG labels
that shrink with the viewport. If a graph is used, labels must be HTML or sized
independently from the graphic.

## Pantheon V2 Shipped Direction

Pantheon is Olympus' visual identity and an operational control. The previous
constellation proved the direction, then got removed during hardening because
SVG text and image-role wrapping made viewport and accessibility guarantees
fragile.

The Impeccable product-UI pass covered the live `/olympus` page, product
register, existing CSS, this document, and browser screenshots.

Pantheon v2 rules:

- Agent nodes are real HTML buttons.
- Selected state is exposed through ARIA and visible styling.
- Labels are HTML text, not SVG text.
- The visual map uses CSS layout and positioned buttons; interaction stays in
  accessible HTML controls.
- Desktop shows the visual map and selected profile inspector together.
- Mid-width in-app browser views compress to a compact map or node grid,
  with the profile buttons visible at the top of Pantheon.
- Mobile stacks with no horizontal overflow and no tiny text.

## Current Rules

Pantheon is a command-style operational surface:

- Trigger lanes show Kanban, Cron, and Gateway pressure.
- Profile buttons show open, running, ready, and blocked work.
- Flags surface the reason a profile matters.
- The selected profile inspector gives the current task and links the operator back
  to Hermes-owned pages.
- Mobile stacks the view rather than shrinking the whole graphic.
- Profile controls are real buttons with selected state exposed through ARIA.
  Do not wrap interactive Pantheon content in `role="img"`.
- Empty evidence sections stay hidden; do not render filler panels to keep a
  layout shape.

## Better Skill Suggestions

Rank skill suggestions by observed repeatability:

| Signal | Suggestion |
| --- | --- |
| Repeated tool-heavy sessions | Create or preload a skill for that workflow. |
| Runaway tool calls | Add a checklist, loop breaker, or recap skill. |
| Long threads | Add memory, recap, or task-splitting procedure. |
| Cron work with thin skill coverage | Add runbook skills for scheduled agents. |
| Forced-skill Kanban work succeeding | Promote the forced-skill pattern. |
| Same profile repeatedly blocked | Add acceptance-criteria or handoff skills. |

Current backend shape:

```json
{
  "skill_coverage": {
    "summary": {
      "total_skills": 48,
      "zero_skill_profiles": 1,
      "forced_skill_tasks": 3,
      "looping_sessions": 2,
      "tool_heavy_sessions": 4
    },
    "suggestions": [
      {
        "title": "Bundle visual QA workflow",
        "severity": "warning",
        "evidence": "4 tool-heavy sessions / 2 forced-skill tasks",
        "recommended_view": "/skills",
        "action_label": "Open Skills"
      }
    ]
  }
}
```

Next skill-hygiene work adds read-only curator and hub evidence: local
usage/provenance, hub install scan verdicts, trust level, and any stored
skills.sh security audit status. Olympus reports those signals and links
to Hermes Skills or Curator surfaces; it does not install, scan, archive, or
mutate skills in v1.

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
- Fail if Pantheon contains microscopic visible text.
- Fail if hidden-label fixtures expose private profile, task, board, session, or
  path labels.
- Fail if action links point outside the known Hermes-owned routes.
- Run the same pass across noisy, healthy, empty, overloaded, stale/blocked,
  high-cost, and hidden-label fixture states.
- Attach screenshots as test artifacts.
- Add fixture states before adding more visual complexity.

See `FRONTEND_SKILL_RESEARCH.md` for GitHub-hosted skills and references to
evaluate for taste, design critique, production UI engineering, and visual QA.
