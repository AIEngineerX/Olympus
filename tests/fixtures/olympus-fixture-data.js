window.__OLYMPUS_FIXTURE_DATA__ = {
  generated_at: "2026-06-06T12:00:00Z",
  backlog: {
    summary: { groups: 3, tasks: 14, needs_you: 11 },
    groups: [
      { kind: "needs_input", label: "Waiting on a human answer", action: "These tasks are blocked on a decision or answer only a person can give. Answer them in Kanban, oldest first.", severity: "critical", count: 9, oldest_days: 6, stale: 4, repeat_blocks: 1, assignees: [{ assignee: "default", count: 7 }, { assignee: "profile_1", count: 2 }], samples: [{ title: "task:51c0aa93be", board: "default" }, { title: "task:0d2e7bb81f", board: "default" }] },
      { kind: "capability", label: "Missing a tool, skill or permission", action: "The assignee could not do the work with what it has. Give it the tool, skill or permission, or reassign the task.", severity: "warning", count: 2, oldest_days: 1, stale: 0, repeat_blocks: 0, assignees: [{ assignee: "profile_1", count: 2 }], samples: [{ title: "task:77aa10c3e9", board: "default" }] },
      { kind: "dependency", label: "Waiting on parent tasks", action: "Not actionable yet: these start when the tasks they depend on finish.", severity: "info", count: 3, oldest_days: 2, stale: 0, repeat_blocks: 0, assignees: [{ assignee: "default", count: 3 }], samples: [] }
    ],
    recommended_view: "/kanban"
  },
  cost_attribution: {
    window_days: 7,
    window_cost_usd: 7.42,
    cron: {
      total_cost_usd: 3.1,
      jobs: [
        { job_ref: "cron:1d4f2a9b3c", label: "cron:1d4f2a9b3c", profile: "default", schedule: "every 30m", fires: 14, tokens: 412000, avg_duration_seconds: 48, errors: 2, silent_runs: 3, est_cost_usd: 2.48 },
        { job_ref: "cron:7e0b5c1d22", label: "cron:7e0b5c1d22", profile: "profile_1", schedule: "0 * * * *", fires: 28, tokens: 103000, avg_duration_seconds: 9, errors: 0, silent_runs: 21, est_cost_usd: 0.62 }
      ],
      allocation: "Each profile's cron-session cost is shared across its jobs by token share from cron/usage_audit.jsonl."
    },
    background: {
      total_cost_usd: 1.04,
      tasks: [
        { task: "background_review", calls: 38, tokens: 91000, cost_usd: 0.88 },
        { task: "title_generation", calls: 52, tokens: 26000, cost_usd: 0.16 }
      ],
      note: "Background task cost is part of the session cost it ran in."
    },
    recommended_view: "/analytics"
  },
  fixes: [
    {
      key: "memory-runs-are-averaging-a-very-large-context-per-call",
      title: "Runs are averaging a very large context per call",
      kind: "memory",
      baseline: 3,
      current: 1,
      verdict: "improved",
      marked_at: "2026-06-02T09:00:00+00:00",
      days_tracked: 4
    }
  ],
  health: {
    status: "warning",
    status_label: "Needs review",
    summary: "Log tail contains failure terms. Inspect logs."
  },
  tuning: {
    agent_hq: {
      summary: {
        agents: 5,
        recommendations: 4,
        total_tokens: 1842200,
        looping_sessions: 2,
        context_pressure_sessions: 1,
        total_cost_usd: 7.42
      },
      metrics: {
        window: { days: 7, sessions: 42, capped: false, label: "last 7 days, 42 sessions" },
        spend_24h_usd: 2.36,
        sessions_24h: 9,
        median_duration_seconds: 420,
        p90_duration_seconds: 2880,
        total_tokens: 1842200,
        total_tool_calls: 438,
        failed_kanban_runs: 1
      },
      agents: [],
      recommendations: [
        {
          key: "skill-create-a-repeatable-browser-qa-skill",
          count: 2,
          kind: "skill",
          severity: "warning",
          title: "Create a repeatable browser QA skill",
          detail: "Two recent sessions repeated viewport checks and screenshot interpretation.",
          evidence: "2 tool-heavy sessions",
          threshold: ">= 20 tool calls",
          basis: "Tool-call counts come straight from Hermes' own session records.",
          targets: [
            { kind: "session", ref: "session:3f9a1c2b7d", label: "cli" },
            { kind: "session", ref: "session:91be04d6aa", label: "telegram" }
          ],
          recommended_view: "/skills",
          action_label: "Open Skills"
        },
        {
          key: "route-move-visual-work-to-a-specialist-profile",
          count: 6,
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
  skill_hygiene: {
    summary: {
      state: "warning",
      issues: 4,
      total_skills: 48,
      archived: 2,
      stale: 9,
      never_used: 6,
      recently_patched: 3,
      hub_installed: 8,
      hub_missing_trust: 2,
      hub_missing_scan: 1,
      hub_audit_pass: 1,
      hub_audit_warn: 1,
      hub_audit_fail: 1,
      forced_skill_metadata_gaps: 1
    },
    signals: [
      {
        kind: "skill",
        severity: "warning",
        title: "Pin heavily used skills",
        detail: "Frequently used skills are part of the operating surface. Pinning or reviewing them makes drift easier to spot.",
        evidence: "skill:3c9a18f042: 21 uses, skill:90ff0d121b: 14 uses",
        recommended_view: "/skills",
        action_label: "Open Skills"
      },
      {
        kind: "skill",
        severity: "warning",
        title: "Hub skills are missing trust or scan metadata",
        detail: "Hub-installed skills need trust and scan evidence when Hermes has recorded it locally.",
        evidence: "skill:60cf2824b9, skill:ac52bb9910",
        recommended_view: "/skills",
        action_label: "Open Skills"
      },
      {
        kind: "skill",
        severity: "warning",
        title: "Stored skill audit needs review",
        detail: "Hermes has stored a warn or fail audit result for installed hub skills.",
        evidence: "skill:60cf2824b9: socket warn, skill:ac52bb9910: snyk fail",
        recommended_view: "/skills",
        action_label: "Open Skills"
      },
      {
        kind: "skill",
        severity: "warning",
        title: "Kanban tasks require skills this machine does not have",
        detail: "Kanban references skills that do not appear in local usage or hub metadata.",
        evidence: "skill:4c823a88b1",
        recommended_view: "/kanban",
        action_label: "Open Kanban"
      }
    ],
    usage: [
      { id: "skill:3c9a18f042", label: "skill:3c9a18f042", state: "active", use_count: 21, view_count: 28, patch_count: 1, pinned: false, archived: false, stale: false, recently_patched: false },
      { id: "skill:90ff0d121b", label: "skill:90ff0d121b", state: "active", use_count: 14, view_count: 19, patch_count: 4, pinned: false, archived: false, stale: false, recently_patched: true },
      { id: "skill:7d0ff89435", label: "skill:7d0ff89435", state: "archived", use_count: 2, view_count: 8, patch_count: 0, pinned: false, archived: true, stale: true, recently_patched: false },
      { id: "skill:f1b094399e", label: "skill:f1b094399e", state: "active", use_count: 0, view_count: 1, patch_count: 0, pinned: false, archived: false, stale: true, recently_patched: false }
    ],
    hub: [
      { id: "skill:3c9a18f042", label: "skill:3c9a18f042", trust_level: "local", scan_verdict: "pass", audit_summary: "agent-trust-hub: pass", state: "ok" },
      { id: "skill:60cf2824b9", label: "skill:60cf2824b9", trust_level: null, scan_verdict: "warn", audit_summary: "socket: warn", state: "warning" },
      { id: "skill:ac52bb9910", label: "skill:ac52bb9910", trust_level: "community", scan_verdict: null, audit_summary: "snyk: fail", state: "critical" }
    ]
  },
  config_policy: {
    summary: {
      state: "warning",
      findings: 3,
      root_config_present: true,
      profile_configs: 5,
      max_turns: 120,
      hard_loop_stop: false,
      fallback_providers: 2,
      toolsets: 6,
      compression_enabled: true,
      browser_private_flags: 1,
      auxiliary_routes: 2,
      costed_sessions: 0,
      total_cost_usd: 0,
      route_audit_profiles: 4,
      model_override_tasks: 1
    },
    settings: [
      {
        id: "max_turns",
        label: "Max Turns",
        value: 120,
        state: "warning",
        detail: "Highest configured agent or goal turn limit.",
        source: "agent.max_turns and Kanban goal_max_turns",
        recommended_view: "/config"
      },
      {
        id: "loop_guard",
        label: "Loop Stop",
        value: "off",
        state: "warning",
        detail: "Sessions where repeated failing tool calls hard-stop instead of only warning.",
        source: "tool_loop_guardrails",
        recommended_view: "/config"
      },
      {
        id: "fallbacks",
        label: "Fallbacks",
        value: 2,
        state: "active",
        detail: "Fallback provider routes configured in safe config structure.",
        source: "fallback_providers",
        recommended_view: "/config"
      },
      {
        id: "aux_cost",
        label: "Aux Cost",
        value: 0,
        unit: "usd",
        state: "warning",
        detail: "2 auxiliary route signals, 0 costed sessions.",
        source: "auxiliary route presence and estimated/actual_cost_usd",
        recommended_view: "/analytics"
      }
    ],
    findings: [
      {
        kind: "policy",
        severity: "warning",
        title: "Unattended sessions have no loop hard stop",
        detail: "tool_loop_guardrails.non_interactive_hard_stop_enabled is off, so gateway and cron sessions only warn on tool loops while a high turn limit lets them run long. Nobody is present to stop them.",
        evidence: "max_turns 120 / unattended hard stop off",
        threshold: "max_turns >= 80 and non_interactive_hard_stop_enabled false",
        basis: "Hermes agent.max_turns plus tool_loop_guardrails",
        recommended_view: "/config",
        action_label: "Open Config"
      },
      {
        kind: "browser",
        severity: "warning",
        title: "Browser private URL access is enabled",
        detail: "Private or local browser targets widen the data boundary. Keep this enabled only when local automation needs it.",
        evidence: "browser private URL flag enabled",
        basis: "Hermes browser privacy flags",
        recommended_view: "/config",
        action_label: "Open Config"
      },
      {
        kind: "cost",
        severity: "warning",
        title: "Auxiliary route cost is not visible",
        detail: "Auxiliary or background provider routes are configured, but recent sessions do not expose cost.",
        evidence: "2 auxiliary route signals / 0 costed sessions",
        basis: "Auxiliary model routes and session costs",
        recommended_view: "/analytics",
        action_label: "Open Analytics"
      }
    ]
  },
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
    data.tuning.agent_hq.summary.recommendations = 1;
    data.tuning.agent_hq.summary.looping_sessions = 0;
    data.tuning.agent_hq.summary.context_pressure_sessions = 0;
    data.tuning.agent_hq.summary.total_cost_usd = 0.18;
    data.tuning.agent_hq.metrics.median_duration_seconds = 180;
    data.tuning.agent_hq.metrics.p90_duration_seconds = 540;
    data.tuning.agent_hq.metrics.total_tool_calls = 72;
    data.tuning.agent_hq.metrics.failed_kanban_runs = 0;
    data.tuning.agent_hq.recommendations = [{
      kind: "review",
      severity: "ok",
      title: "No current agent tuning gap",
      detail: "Fixture state has no overloaded assignees, failed worker runs, blocked tasks, looping, or context pressure.",
      evidence: "Healthy fixture scan",
      recommended_view: "/analytics",
      action_label: "Open Analytics"
    }];
    data.config_policy = {
      summary: {
        state: "ok",
        findings: 0,
        root_config_present: true,
        profile_configs: 5,
        max_turns: 40,
        hard_loop_stop: true,
        fallback_providers: 1,
        toolsets: 6,
        compression_enabled: true,
        browser_private_flags: 0,
        auxiliary_routes: 1,
        costed_sessions: 6,
        total_cost_usd: 0.18,
        route_audit_profiles: 5,
        model_override_tasks: 0
      },
      settings: [
        {
          id: "max_turns",
          label: "Max Turns",
          value: 40,
          state: "active",
          detail: "Highest configured agent or goal turn limit.",
          source: "agent.max_turns and Kanban goal_max_turns",
          recommended_view: "/config"
        },
        {
          id: "loop_guard",
          label: "Loop Stop",
          value: "unattended only",
          state: "ok",
          detail: "Sessions where repeated failing tool calls hard-stop instead of only warning.",
          source: "tool_loop_guardrails",
          recommended_view: "/config"
        },
        {
          id: "aux_cost",
          label: "Aux Cost",
          value: 0.18,
          unit: "usd",
          state: "active",
          detail: "1 auxiliary route signal, 6 costed sessions.",
          source: "auxiliary route presence and estimated/actual_cost_usd",
          recommended_view: "/analytics"
        }
      ],
      findings: []
    };
    data.skill_hygiene = {
      summary: {
        state: "ok",
        issues: 0,
        total_skills: 48,
        archived: 0,
        stale: 0,
        never_used: 1,
        recently_patched: 1,
        hub_installed: 8,
        hub_missing_trust: 0,
        hub_missing_scan: 0,
        hub_audit_pass: 2,
        hub_audit_warn: 0,
        hub_audit_fail: 0,
        forced_skill_metadata_gaps: 0
      },
      signals: [],
      usage: [
        { id: "skill:3c9a18f042", label: "skill:3c9a18f042", state: "active", use_count: 21, view_count: 28, patch_count: 1, pinned: true, archived: false, stale: false, recently_patched: false },
        { id: "skill:90ff0d121b", label: "skill:90ff0d121b", state: "active", use_count: 14, view_count: 19, patch_count: 1, pinned: true, archived: false, stale: false, recently_patched: false }
      ],
      hub: [
        { id: "skill:3c9a18f042", label: "skill:3c9a18f042", trust_level: "local", scan_verdict: "pass", audit_summary: "agent-trust-hub: pass", state: "ok" },
        { id: "skill:90ff0d121b", label: "skill:90ff0d121b", trust_level: "local", scan_verdict: "pass", audit_summary: "socket: pass", state: "ok" }
      ]
    };
    return data;
  }

  function empty() {
    const data = clone(base);
    data.health = {
      status: "ok",
      status_label: "No evidence",
      summary: "Fixture scan: no Hermes runtime evidence was found."
    };
    data.tuning.agent_hq = {
      summary: { agents: 0, recommendations: 0, total_tokens: 0, looping_sessions: 0, context_pressure_sessions: 0, total_cost_usd: 0 },
      metrics: { median_duration_seconds: 0, p90_duration_seconds: 0, total_tokens: 0, total_tool_calls: 0, failed_kanban_runs: 0 },
      agents: [],
      recommendations: []
    };
    data.config_policy = { summary: {}, settings: [], findings: [] };
    data.skill_hygiene = { summary: {}, signals: [], usage: [], hub: [] };
    return data;
  }

  function overloaded() {
    const data = clone(base);
    data.health.summary = "Fixture scan: workload is concentrated on one profile.";
    data.tuning.agent_hq.metrics.p90_duration_seconds = 3600;
    data.tuning.agent_hq.recommendations.unshift({
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
    return data;
  }

  function staleBlocked() {
    const data = clone(base);
    data.health.status = "warning";
    data.health.status_label = "Needs action";
    data.health.summary = "Fixture scan: blocked work and stale workers need review.";
    return data;
  }

  function highCost() {
    const data = clone(base);
    data.health.summary = "Fixture scan: cost and context pressure are intentionally high.";
    data.tuning.agent_hq.summary.total_cost_usd = 32.75;
    data.config_policy.summary.costed_sessions = 3;
    data.config_policy.summary.total_cost_usd = 32.75;
    data.config_policy.settings = data.config_policy.settings.map((item) => (
      item.id === "aux_cost"
        ? { ...item, value: 32.75, state: "active", detail: "2 auxiliary route signals, 3 costed sessions." }
        : item
    ));
    data.config_policy.findings = data.config_policy.findings.filter((item) => item.kind !== "cost");
    data.config_policy.summary.findings = data.config_policy.findings.length;
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
    return scrubPrivateLabels(data);
  }

  const KANBAN_ATTENTION = { noisy: 1, healthy: 0, empty: 0, overloaded: 1, stale: 2, "high-cost": 1, "no-labels": 1 };

  function withDiagnostics(data, state) {
    const boardCount = state === "empty" ? 0 : 1;
    const sourceState = state === "empty" ? "missing" : "ok";
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
        profiles_scanned: state === "empty" ? 0 : 5,
        sessions_scanned: state === "empty" ? 0 : 12,
        kanban_boards_scanned: state === "empty" ? 0 : 1,
        kanban_board_read_failures: 0,
        kanban_attention_items: KANBAN_ATTENTION[state]
      },
      hermes: {
        version: "fixture",
        home_detected: true
      }
    };
    data.evidence_sources = {
      summary: {
        sources: 5,
        available: state === "empty" ? 3 : 5,
        missing: state === "empty" ? 2 : 0,
        warnings: 0,
        privacy: state === "no-labels" ? "local labels hidden" : "fixture labels"
      },
      items: [
        {
          id: "hermes_state",
          label: "Hermes state store",
          type: "sqlite",
          state: sourceState,
          present: state !== "empty",
          counts: {
            sessions_returned: state === "empty" ? 0 : 12,
            sessions_recorded: state === "empty" ? 0 : 84,
            messages_recorded: state === "empty" ? 0 : 1260
          },
          fields: ["sessions.started_at", "sessions.tool_call_count", "sessions.input_tokens", "sessions.handoff_error"],
          redaction: "Session IDs are hashed and titles are hidden unless local labels are enabled.",
          read_failures: 0,
          recommended_view: "/sessions"
        },
        {
          id: "hermes_kanban",
          label: "Hermes Kanban store",
          type: "sqlite",
          state: boardCount ? "ok" : "missing",
          present: Boolean(boardCount),
          counts: {
            boards_scanned: boardCount,
            open_tasks: state === "empty" ? 0 : state === "overloaded" ? 18 : 9,
            attention_items: KANBAN_ATTENTION[state]
          },
          fields: ["tasks.status", "tasks.assignee", "tasks.skills", "task_runs.outcome"],
          redaction: "Task IDs and board labels are hashed unless local labels are enabled.",
          read_failures: 0,
          recommended_view: "/kanban"
        },
        {
          id: "hermes_config",
          label: "Hermes config",
          type: "yaml",
          state: "ok",
          present: true,
          counts: {
            profiles_scanned: state === "empty" ? 0 : 5,
            cron_jobs: 3,
            gateways: 2
          },
          fields: ["model.provider_presence", "profile.gateway_state", "profile.skill_count", "cron.last_status"],
          redaction: "Secrets, prompt text, local paths, and exact model labels are not returned by default.",
          read_failures: 0,
          recommended_view: "/config"
        },
        {
          id: "skill_usage",
          label: "Skill usage metadata",
          type: "json",
          state: sourceState,
          present: state !== "empty",
          counts: {
            skills_recorded: state === "empty" ? 0 : 48
          },
          fields: ["last_used_at", "last_patched_at", "use_count", "state"],
          redaction: "Skill names are summarized and can be hashed when labels are hidden.",
          read_failures: 0,
          recommended_view: "/skills"
        },
        {
          id: "skill_hub_lock",
          label: "Skill hub lock metadata",
          type: "json",
          state: sourceState,
          present: state !== "empty",
          counts: {
            hub_installed: state === "empty" ? 0 : 8
          },
          fields: ["version", "installed", "optional_trust_metadata", "optional_scan_metadata"],
          redaction: "Only local hub metadata presence and counts are shown in Phase 0.",
          read_failures: 0,
          recommended_view: "/skills"
        }
      ]
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
