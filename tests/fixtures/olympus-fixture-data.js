window.__OLYMPUS_FIXTURE_DATA__ = {
  generated_at: "2026-06-06T12:00:00Z",
  health: {
    status: "warning",
    status_label: "Needs review",
    summary: "Fixture scan: routing, skill, worker, and context signals are intentionally mixed."
  },
  tuning: {
    score: 68,
    score_breakdown: {
      base: 100,
      score: 68,
      label: "Needs review",
      explanation: "Fixture score generated from local Hermes evidence.",
      deductions: [
        {
          label: "Looping/tool thrash",
          points: 12,
          reason: "Repeated tool calls detected.",
          evidence: "2 sessions",
          source: "Hermes sessions tool_call_count"
        },
        {
          label: "Worker failures",
          points: 10,
          reason: "Kanban worker failures show reliability risk.",
          evidence: "1 failed run",
          source: "Hermes Kanban task_runs"
        }
      ]
    },
    methodology: {
      thresholds: [
        {
          signal: "Looping session",
          threshold: ">= 40 tool calls",
          why: "Runaway tool use is a direct signal for loops, unclear plans, or missing procedures."
        },
        {
          signal: "Overloaded assignee",
          threshold: ">= 8 open or >= 3 running Kanban tasks",
          why: "Load concentration suggests route balancing or a specialist profile may help."
        }
      ],
      sources: [
        {
          label: "Hermes session store",
          detail: "Uses local runtime metadata, message_count, tool_call_count, handoff_error, and timestamps from state.db."
        },
        {
          label: "Hermes Kanban",
          detail: "Uses first-party task status, assignee load, worker heartbeats, retries, and task_runs."
        }
      ]
    },
    agent_hq: {
      summary: {
        agents: 5,
        opportunities: 4,
        total_tokens: 1842200,
        looping_sessions: 2,
        context_pressure_sessions: 1,
        total_cost_usd: 7.42
      },
      metrics: {
        median_duration_seconds: 420,
        p90_duration_seconds: 2880,
        total_tokens: 1842200,
        total_tool_calls: 438,
        failed_kanban_runs: 1
      },
      agents: [],
      opportunities: [
        {
          kind: "skill",
          severity: "warning",
          title: "Create a repeatable browser QA skill",
          detail: "Two recent sessions repeated viewport checks and screenshot interpretation.",
          evidence: "2 tool-heavy sessions",
          threshold: ">= 20 tool calls",
          basis: "Hermes session tool_call_count",
          recommended_view: "/skills",
          action_label: "Open Skills"
        },
        {
          kind: "route",
          severity: "warning",
          title: "Move visual work to a specialist profile",
          detail: "Design-heavy work is concentrated on the default profile.",
          evidence: "6 open visual tasks",
          threshold: ">= 8 open tasks",
          basis: "Kanban assignee load",
          recommended_view: "/profiles",
          action_label: "Open Profiles"
        }
      ]
    }
  },
  skill_coverage: {
    summary: {
      profiles: 5,
      total_skills: 48,
      zero_skill_profiles: 1,
      forced_skill_tasks: 3,
      forced_skill_total: 5,
      looping_sessions: 2,
      tool_heavy_sessions: 4,
      long_threads: 1,
      context_pressure_sessions: 1
    },
    suggestions: [
      {
        kind: "skill",
        severity: "warning",
        title: "Bundle visual QA and browser checks",
        detail: "Repeated browser, screenshot, and layout work should be a named operating procedure.",
        evidence: "4 tool-heavy visual sessions",
        recommended_view: "/skills",
        action_label: "Open Skills"
      },
      {
        kind: "skill",
        severity: "info",
        title: "Add a performance-readiness skill",
        detail: "Token, speed, and loop-pressure review is being repeated manually.",
        evidence: "1 long thread and 1 context-pressure session",
        recommended_view: "/skills",
        action_label: "Open Skills"
      }
    ],
    profiles: [
      {
        id: "profile:default",
        label: "Default",
        state: "warning",
        skill_count: 12,
        open_work: 6,
        forced_skill_tasks: 1,
        top_issue: "Visual QA work is concentrated here.",
        recommended_view: "/skills"
      },
      {
        id: "profile:visual",
        label: "Visual QA",
        state: "ok",
        skill_count: 10,
        open_work: 2,
        forced_skill_tasks: 2,
        top_issue: "Coverage looks healthy.",
        recommended_view: "/profiles"
      }
    ]
  },
  profile_fitness: {
    summary: {
      profiles: 5,
      needs_review: 2,
      average_score: 82,
      lowest_score: 58
    },
    profiles: [
      {
        id: "profile:default",
        label: "Default",
        state: "warning",
        score: 58,
        top_issue: "Open work concentrated",
        recommended_view: "/kanban",
        metrics: {
          skills: 12,
          cron: 3,
          gateways: 1,
          open: 6,
          ready: 2,
          running: 2,
          blocked: 1,
          failed_runs: 1
        },
        reasons: [
          {
            label: "Open work concentrated",
            detail: "6 open Kanban tasks are assigned here.",
            points: 14
          }
        ]
      },
      {
        id: "profile:visual",
        label: "Visual QA",
        state: "ok",
        score: 94,
        top_issue: "No profile fitness issue found.",
        recommended_view: "/profiles",
        metrics: {
          skills: 10,
          cron: 0,
          gateways: 1,
          open: 2,
          ready: 1,
          running: 1,
          blocked: 0,
          failed_runs: 0
        },
        reasons: []
      }
    ]
  },
  performance: {
    summary: {
      state: "warning",
      window_sessions: 12,
      completed_sessions: 8,
      total_tokens: 1842200,
      total_tool_calls: 438,
      avg_tools_per_session: 36.5,
      avg_tokens_per_call: 8200,
      total_cost_usd: 7.42
    },
    lanes: [
      {
        id: "speed",
        label: "Speed",
        value: 2880,
        unit: "seconds",
        state: "warning",
        detail: "median 420s / p90 2880s",
        source: "Hermes sessions duration_seconds",
        recommended_view: "/sessions"
      },
      {
        id: "tools",
        label: "Tool Pressure",
        value: 438,
        state: "warning",
        detail: "2 looping / 4 tool-heavy",
        source: "Hermes sessions tool_call_count",
        recommended_view: "/sessions"
      },
      {
        id: "context",
        label: "Context",
        value: 8200,
        state: "warning",
        detail: "1 pressure session",
        source: "Hermes sessions input_tokens/api_call_count",
        recommended_view: "/sessions"
      },
      {
        id: "reliability",
        label: "Reliability",
        value: 2,
        state: "warning",
        detail: "1 failed run / 1 stale / 0 errored",
        source: "Hermes task_runs and sessions",
        recommended_view: "/kanban"
      },
      {
        id: "cost",
        label: "Cost",
        value: 7.42,
        unit: "usd",
        state: "active",
        detail: "1 expensive session",
        source: "Hermes estimated/actual_cost_usd",
        recommended_view: "/analytics"
      }
    ],
    signals: [
      {
        severity: "warning",
        label: "Looping sessions",
        detail: "session 4: 71 tools",
        recommended_view: "/sessions"
      },
      {
        severity: "info",
        label: "Tool-heavy sessions",
        detail: "4 sessions crossed 20 tools",
        recommended_view: "/skills"
      }
    ],
    metrics: {
      window_sessions: 12,
      total_cost_usd: 7.42,
      total_tokens: 1842200,
      total_tool_calls: 438,
      total_api_calls: 224,
      median_duration_seconds: 420,
      p90_duration_seconds: 2880,
      avg_tools_per_session: 36.5,
      avg_tokens_per_session: 153516,
      avg_tokens_per_call: 8200,
      looping_sessions: 2,
      expensive_sessions: 1,
      context_pressure_sessions: 1,
      completed_sessions: 8,
      stale_sessions: 1,
      errored_sessions: 0,
      failed_kanban_runs: 1
    }
  },
  party: {
    summary: {
      members: 5,
      working: 2,
      queued: 7,
      workers: 2,
      blocked: 1
    },
    members: [
      {
        id: "profile:default",
        label: "Default",
        state: "warning",
        open_work: 6,
        running_work: 2,
        ready_work: 2,
        blocked_work: 1,
        skill_count: 12,
        cron_jobs: 3,
        gateway_count: 1,
        flags: ["load balance", "blocked", "scheduled"],
        current_task: {
          title: "Viewport polish",
          status: "running",
          goal_mode: true,
          forced_skill_count: 1
        }
      },
      {
        id: "profile:visual",
        label: "Visual QA",
        state: "running",
        open_work: 2,
        running_work: 1,
        ready_work: 1,
        blocked_work: 0,
        skill_count: 10,
        cron_jobs: 0,
        gateway_count: 1,
        flags: ["working", "skills"],
        current_task: {
          title: "Mobile visual fixture",
          status: "running",
          forced_skill_count: 2
        }
      },
      {
        id: "profile:backend",
        label: "Backend",
        state: "ready",
        open_work: 1,
        running_work: 0,
        ready_work: 1,
        blocked_work: 0,
        skill_count: 8,
        cron_jobs: 1,
        gateway_count: 1,
        flags: ["ready"]
      },
      {
        id: "profile:curator",
        label: "Curator",
        state: "active",
        open_work: 2,
        running_work: 1,
        ready_work: 0,
        blocked_work: 0,
        skill_count: 16,
        cron_jobs: 0,
        gateway_count: 1,
        flags: ["skill hygiene"]
      },
      {
        id: "profile:ops",
        label: "Ops",
        state: "idle",
        open_work: 0,
        running_work: 0,
        ready_work: 0,
        blocked_work: 0,
        skill_count: 2,
        cron_jobs: 0,
        gateway_count: 0,
        flags: ["idle"]
      }
    ]
  },
  orchestration: {
    summary: {
      boards: 2,
      open: 9,
      ready: 4,
      running: 3,
      blocked: 1,
      review: 1,
      active_workers: 2,
      failed_runs: 1,
      stale_workers: 1,
      goal_mode_tasks: 2,
      forced_skill_tasks: 3,
      model_override_tasks: 1,
      ready_unassigned: 1
    },
    workers: [],
    pressure: [],
    failed_runs: [],
    stale_workers: [],
    attention: []
  },
  activity_events: [
    {
      label: "Worker heartbeat stale",
      kind: "worker_stale",
      source: "Kanban",
      profile: "Default",
      detail: "Viewport polish",
      state: "warning"
    },
    {
      label: "Task claimed",
      kind: "claimed",
      source: "Kanban",
      profile: "Visual QA",
      detail: "Mobile visual fixture",
      state: "running"
    }
  ],
  kanban: {
    open: 9,
    totals: {
      ready: 4,
      running: 3,
      blocked: 1,
      review: 1
    },
    boards: [
      {
        slug: "olympus",
        name: "Olympus",
        open: 9,
        counts: {
          running: 3,
          blocked: 1
        }
      }
    ],
    attention: [
      {
        severity: "warning",
        label: "Ready task is unassigned",
        board: "olympus",
        detail: "Dispatcher cannot claim ready work without an assignee."
      }
    ],
    assignee_load: [
      {
        assignee: "Default",
        open: 6,
        running: 2,
        ready: 2,
        blocked: 1
      },
      {
        assignee: "Visual QA",
        open: 2,
        running: 1,
        ready: 1,
        blocked: 0
      }
    ],
    active_workers: [
      {
        task_id: "task_visual",
        profile: "Visual QA"
      }
    ]
  }
};

(function selectOlympusFixtureState() {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const base = window.__OLYMPUS_FIXTURE_DATA__;

  function healthy() {
    const data = clone(base);
    data.health = {
      status: "ok",
      status_label: "Healthy",
      summary: "Fixture scan: no operational thresholds crossed."
    };
    data.tuning.score = 96;
    data.tuning.score_breakdown = {
      base: 100,
      score: 96,
      label: "Stable",
      explanation: "Fixture score generated from healthy Hermes evidence.",
      deductions: []
    };
    data.tuning.agent_hq.summary.opportunities = 1;
    data.tuning.agent_hq.summary.looping_sessions = 0;
    data.tuning.agent_hq.summary.context_pressure_sessions = 0;
    data.tuning.agent_hq.summary.total_cost_usd = 0.18;
    data.tuning.agent_hq.metrics.median_duration_seconds = 180;
    data.tuning.agent_hq.metrics.p90_duration_seconds = 540;
    data.tuning.agent_hq.metrics.total_tool_calls = 72;
    data.tuning.agent_hq.metrics.failed_kanban_runs = 0;
    data.tuning.agent_hq.opportunities = [{
      kind: "review",
      severity: "ok",
      title: "No current agent tuning gap",
      detail: "Fixture state has no overloaded assignees, failed worker runs, blocked tasks, looping, or context pressure.",
      evidence: "Healthy fixture scan",
      recommended_view: "/analytics",
      action_label: "Open Analytics"
    }];
    data.performance.summary.state = "active";
    data.performance.summary.total_cost_usd = 0.18;
    data.performance.summary.total_tool_calls = 72;
    data.performance.summary.avg_tools_per_session = 6;
    data.performance.summary.avg_tokens_per_call = 1200;
    data.performance.lanes = data.performance.lanes.map((lane) => ({
      ...lane,
      state: lane.id === "reliability" ? "ok" : "active",
      value: lane.id === "speed" ? 540 : lane.id === "tools" ? 72 : lane.id === "context" ? 1200 : lane.id === "reliability" ? 0 : 0.18,
      detail: lane.id === "speed" ? "median 180s / p90 540s" : lane.id === "tools" ? "0 looping / 0 tool-heavy" : lane.id === "context" ? "0 pressure sessions" : lane.id === "reliability" ? "0 failed runs / 0 stale / 0 errored" : "cost below review threshold"
    }));
    data.performance.signals = [];
    data.skill_coverage.summary.zero_skill_profiles = 0;
    data.skill_coverage.summary.looping_sessions = 0;
    data.skill_coverage.summary.tool_heavy_sessions = 0;
    data.skill_coverage.summary.context_pressure_sessions = 0;
    data.skill_coverage.suggestions = [{
      kind: "skill",
      severity: "ok",
      title: "Skill coverage looks healthy",
      detail: "No fixture profile is missing skills or repeating tool-heavy work.",
      evidence: "Healthy fixture scan",
      recommended_view: "/skills",
      action_label: "Open Skills"
    }];
    data.profile_fitness.summary.needs_review = 0;
    data.profile_fitness.summary.average_score = 96;
    data.profile_fitness.summary.lowest_score = 92;
    data.profile_fitness.profiles = data.profile_fitness.profiles.map((profile) => ({
      ...profile,
      state: "ok",
      score: profile.id === "profile:default" ? 92 : 98,
      top_issue: "No profile fitness issue found.",
      reasons: [],
      metrics: { ...profile.metrics, open: Math.min(profile.metrics.open || 0, 2), running: 0, blocked: 0, failed_runs: 0 }
    }));
    data.orchestration.summary.blocked = 0;
    data.orchestration.summary.failed_runs = 0;
    data.orchestration.summary.stale_workers = 0;
    data.orchestration.summary.ready_unassigned = 0;
    data.kanban.totals.blocked = 0;
    data.kanban.attention = [];
    data.activity_events = [{
      label: "Task completed",
      kind: "completed",
      source: "Kanban",
      profile: "Visual QA",
      detail: "Healthy fixture task",
      state: "ok"
    }];
    return data;
  }

  function empty() {
    const data = clone(base);
    data.health = {
      status: "ok",
      status_label: "No evidence",
      summary: "Fixture scan: no Hermes runtime evidence was found."
    };
    data.tuning.score = 100;
    data.tuning.score_breakdown = {
      base: 100,
      score: 100,
      label: "No evidence",
      explanation: "No local Hermes evidence crossed a tuning threshold.",
      deductions: []
    };
    data.tuning.agent_hq = {
      summary: { agents: 0, opportunities: 0, total_tokens: 0, looping_sessions: 0, context_pressure_sessions: 0, total_cost_usd: 0 },
      metrics: { median_duration_seconds: 0, p90_duration_seconds: 0, total_tokens: 0, total_tool_calls: 0, failed_kanban_runs: 0 },
      agents: [],
      opportunities: []
    };
    data.performance = { summary: { state: "unknown" }, lanes: [], signals: [], metrics: {} };
    data.skill_coverage = { summary: {}, suggestions: [], profiles: [] };
    data.profile_fitness = { summary: {}, profiles: [] };
    data.party = { summary: { members: 0, working: 0, queued: 0, workers: 0, blocked: 0 }, members: [] };
    data.orchestration = { summary: { boards: 0, open: 0, ready: 0, running: 0, blocked: 0, review: 0, active_workers: 0, failed_runs: 0, stale_workers: 0, ready_unassigned: 0 }, workers: [], pressure: [], failed_runs: [], stale_workers: [], attention: [] };
    data.activity_events = [];
    data.kanban = { open: 0, totals: { ready: 0, running: 0, blocked: 0, review: 0 }, boards: [], attention: [], assignee_load: [], active_workers: [] };
    return data;
  }

  function overloaded() {
    const data = clone(base);
    data.health.summary = "Fixture scan: workload is concentrated on one profile.";
    data.tuning.score = 52;
    data.tuning.score_breakdown.score = 52;
    data.tuning.score_breakdown.label = "Needs action";
    data.party.members[0].open_work = 14;
    data.party.members[0].running_work = 5;
    data.party.members[0].ready_work = 6;
    data.party.members[0].flags = ["load balance", "route split", "blocked"];
    data.tuning.agent_hq.metrics.p90_duration_seconds = 3600;
    data.tuning.agent_hq.opportunities.unshift({
      kind: "agent",
      severity: "critical",
      title: "Split overloaded visual work",
      detail: "The default profile owns most open and running fixture work.",
      evidence: "Default: 14 open / 5 running",
      threshold: ">= 5 open or >= 2 running",
      basis: "Kanban assignee load",
      recommended_view: "/profiles",
      action_label: "Open Profiles"
    });
    data.profile_fitness.profiles[0].state = "critical";
    data.profile_fitness.profiles[0].score = 38;
    data.profile_fitness.profiles[0].top_issue = "Open work concentrated";
    data.profile_fitness.profiles[0].metrics.open = 14;
    data.profile_fitness.profiles[0].metrics.running = 5;
    data.kanban.open = 18;
    data.kanban.assignee_load[0].open = 14;
    data.kanban.assignee_load[0].running = 5;
    return data;
  }

  function staleBlocked() {
    const data = clone(base);
    data.health.status = "warning";
    data.health.status_label = "Needs action";
    data.health.summary = "Fixture scan: blocked work and stale workers need review.";
    data.tuning.score = 45;
    data.tuning.score_breakdown.score = 45;
    data.tuning.score_breakdown.label = "Needs action";
    data.orchestration.summary.blocked = 3;
    data.orchestration.summary.stale_workers = 2;
    data.orchestration.stale_workers = [
      { task_id: "task:stale-1", title: "Viewport polish", assignee: "Default", detail: "heartbeat stale" },
      { task_id: "task:stale-2", title: "Browser smoke", assignee: "Visual QA", detail: "claim expired" }
    ];
    data.kanban.totals.blocked = 3;
    data.kanban.attention = [
      { severity: "critical", label: "Stale running task", board: "olympus", detail: "A worker heartbeat is stale." },
      { severity: "warning", label: "Blocked task", board: "olympus", detail: "A task needs acceptance criteria." }
    ];
    data.activity_events.unshift({
      label: "Worker heartbeat stale",
      kind: "worker_stale",
      source: "Kanban",
      profile: "Default",
      detail: "Browser smoke",
      state: "warning"
    });
    return data;
  }

  function highCost() {
    const data = clone(base);
    data.health.summary = "Fixture scan: cost and context pressure are intentionally high.";
    data.tuning.score = 61;
    data.tuning.score_breakdown.score = 61;
    data.tuning.score_breakdown.label = "Needs review";
    data.tuning.agent_hq.summary.total_cost_usd = 32.75;
    data.performance.summary.total_cost_usd = 32.75;
    data.performance.summary.avg_tokens_per_call = 64000;
    data.performance.lanes = data.performance.lanes.map((lane) => {
      if (lane.id === "cost") return { ...lane, value: 32.75, state: "warning", detail: "3 expensive sessions" };
      if (lane.id === "context") return { ...lane, value: 64000, state: "warning", detail: "3 pressure sessions" };
      return lane;
    });
    data.performance.signals.push({
      severity: "warning",
      label: "Cost concentration",
      detail: "3 sessions crossed the cost review threshold",
      recommended_view: "/analytics"
    });
    return data;
  }

  function scrubPrivateLabels(value) {
    if (Array.isArray(value)) return value.map(scrubPrivateLabels);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubPrivateLabels(item)]));
    }
    if (typeof value !== "string") return value;
    if (value === "Ops") return "Profile 4";
    return value
      .replaceAll("Visual QA", "Profile 1")
      .replaceAll("Backend", "Profile 2")
      .replaceAll("Curator", "Profile 3")
      .replaceAll("Browser smoke", "Task 1")
      .replaceAll("Split overloaded visual work", "Task 2");
  }

  function noLabels() {
    const data = clone(base);
    data.health.summary = "Fixture scan: private local labels are hidden.";
    data.party.members = data.party.members.map((member, idx) => ({
      ...member,
      label: idx === 0 ? "Default" : "Profile " + idx,
      id: idx === 0 ? "profile:default" : "profile:" + idx,
      current_task: member.current_task ? { ...member.current_task, title: "Task " + idx } : member.current_task
    }));
    data.skill_coverage.profiles = data.skill_coverage.profiles.map((profile, idx) => ({
      ...profile,
      label: idx === 0 ? "Default" : "Profile " + idx
    }));
    data.profile_fitness.profiles = data.profile_fitness.profiles.map((profile, idx) => ({
      ...profile,
      label: idx === 0 ? "Default" : "Profile " + idx
    }));
    data.activity_events = data.activity_events.map((event, idx) => ({
      ...event,
      profile: idx === 0 ? "Default" : "Profile " + idx,
      detail: "Task " + idx
    }));
    data.kanban.boards = data.kanban.boards.map((board, idx) => ({
      ...board,
      slug: idx === 0 ? "default" : "board:" + idx,
      name: idx === 0 ? "Default" : "Board " + idx
    }));
    data.kanban.assignee_load = data.kanban.assignee_load.map((item, idx) => ({
      ...item,
      assignee: idx === 0 ? "Default" : "Profile " + idx
    }));
    return scrubPrivateLabels(data);
  }

  function withDiagnostics(data, state) {
    data.diagnostics = {
      route: "/overview",
      state: state === "empty" ? "ok" : "warning",
      generated_ms: state === "empty" ? 8.4 : 42.7,
      payload_bytes: state === "empty" ? 18400 : 132400,
      budgets: {
        api_response_ms: 750,
        payload_bytes: 250000,
        client_render_ms: 150
      },
      budget_status: {
        api_response: "ok",
        payload: "ok",
        client_render: "reported_by_browser"
      },
      counts: {
        profiles_scanned: data.party && data.party.members ? data.party.members.length : 0,
        sessions_scanned: state === "empty" ? 0 : 12,
        kanban_boards_scanned: data.kanban && data.kanban.boards ? data.kanban.boards.length : 0,
        kanban_board_read_failures: 0,
        kanban_attention_items: data.kanban && data.kanban.attention ? data.kanban.attention.length : 0
      },
      hermes: {
        version: "fixture",
        home_detected: true
      }
    };
    return data;
  }

  const states = {
    noisy: withDiagnostics(base, "noisy"),
    healthy: withDiagnostics(healthy(), "healthy"),
    empty: withDiagnostics(empty(), "empty"),
    overloaded: withDiagnostics(overloaded(), "overloaded"),
    stale: withDiagnostics(staleBlocked(), "stale"),
    "high-cost": withDiagnostics(highCost(), "high-cost"),
    "no-labels": withDiagnostics(noLabels(), "no-labels")
  };
  const params = new URLSearchParams(window.location.search);
  const selected = params.get("state") || "noisy";
  window.__OLYMPUS_FIXTURE_STATES__ = states;
  window.__OLYMPUS_FIXTURE_DATA__ = states[selected] || states.noisy;
})();
