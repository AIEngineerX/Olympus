(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React } = SDK;
  const { useEffect, useRef, useState } = SDK.hooks;
  const C = SDK.components || {};
  const Badge = C.Badge || "span";
  const Button = C.Button || "button";

  const API = "/api/plugins/olympus";

  function el(type, props, ...children) {
    return React.createElement(type, props || null, ...children);
  }

  function cx(...parts) {
    return parts.filter(Boolean).join(" ");
  }

  function asList(value) {
    return Array.isArray(value) ? value : [];
  }

  function stateClass(state) {
    return "olympus-state olympus-state-" + String(state || "unknown").toLowerCase();
  }

  function StatePill({ state, label }) {
    return el("span", { className: stateClass(state) }, label || state || "unknown");
  }

  function severityClass(severity) {
    return "olympus-severity olympus-severity-" + String(severity || "info").toLowerCase();
  }

  function routeLink(path) {
    if (!path) return "#";
    return path.startsWith("/") ? path : "/" + path;
  }

  function routeLabel(path) {
    const route = routeLink(path);
    const labels = {
      "/analytics": "Open Analytics",
      "/config": "Open Config",
      "/cron": "Open Cron",
      "/kanban": "Open Kanban",
      "/logs": "Open Logs",
      "/profiles": "Open Profiles",
      "/sessions": "Open Sessions",
      "/skills": "Open Skills"
    };
    return labels[route] || "Open Route";
  }

  function formatCount(value) {
    const n = Number(value || 0);
    return n.toLocaleString();
  }

  function formatDuration(seconds) {
    const n = Number(seconds || 0);
    if (!Number.isFinite(n) || n <= 0) return "none";
    if (n < 60) return Math.round(n) + "s";
    if (n < 3600) return Math.round(n / 60) + "m";
    return (n / 3600).toFixed(1) + "h";
  }

  function formatMoney(value) {
    const n = Number(value || 0);
    return n > 0 ? "$" + n.toFixed(2) : "unpriced";
  }

  function formatBytes(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    if (n < 1024) return Math.round(n) + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function Hero({ health, score, loading, onRefresh }) {
    const status = health.status || (loading ? "checking" : "unknown");
    const statusLabel = health.status_label || status;
    return el("section", { className: "olympus-hero" },
      el("div", { className: "olympus-hero-copy" },
        el("div", { className: "olympus-kicker" }, "HermesOS Agent Monitor"),
        el("h1", null, "Olympus"),
        el("p", null, "Live read-only view of agent health, workload, tool pressure, context pressure, and the next action owner."),
        el("div", { className: "olympus-hero-actions" },
          el(StatePill, { state: status, label: statusLabel }),
          el(Button, { className: "olympus-refresh", onClick: onRefresh, disabled: loading }, loading ? "Refreshing" : "Refresh")
        ),
        health.summary ? el("p", { className: "olympus-health-summary" }, health.summary) : null
      ),
      el("div", { className: "olympus-oracle" },
        el("span", null, "Agent readiness"),
        el("strong", null, String(score)),
        el("small", null, "local evidence")
      )
    );
  }

  function ScoreExplainer({ tuning }) {
    const breakdown = (tuning && tuning.score_breakdown) || {};
    const methodology = (tuning && tuning.methodology) || {};
    const deductions = asList(breakdown.deductions);
    const thresholds = asList(methodology.thresholds);
    const sources = asList(methodology.sources);
    return el("section", { className: "olympus-section olympus-score-card" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "What the Score Means"),
          el("p", null, breakdown.explanation || "A transparent heuristic readiness score from local Hermes evidence.")
        ),
        el(StatePill, { state: (breakdown.score || 0) >= 85 ? "ok" : (breakdown.score || 0) >= 55 ? "warning" : "error", label: breakdown.label || "Score" })
      ),
      el("div", { className: "olympus-score-grid" },
        el("div", { className: "olympus-score-pane" },
          el("h3", null, "Breakdown"),
          el("div", { className: "olympus-score-total" },
            el("span", null, "Starts at"),
            el("strong", null, String(breakdown.base || 100)),
            el("span", null, "Current"),
            el("strong", null, String(breakdown.score || 0))
          ),
          deductions.length ? deductions.map((item, idx) => el("div", { key: idx, className: "olympus-score-deduction" },
            el("div", null,
              el("strong", null, item.label || "Deduction"),
              el("small", null, item.reason || "")
            ),
            el("span", null, "-" + String(item.points || 0)),
            el("em", null, [item.evidence, item.source].filter(Boolean).join(" / "))
          )) : el("p", { className: "olympus-muted" }, "No deductions in this scan.")
        ),
        el("div", { className: "olympus-score-pane" },
          el("h3", null, "Method"),
          el("details", { className: "olympus-details olympus-method-list" },
            el("summary", null, "Why these signals are used"),
            thresholds.map((item, idx) => el("div", { key: idx, className: "olympus-method-row" },
              el("strong", null, item.signal || "Signal"),
              el("span", null, item.threshold || ""),
              el("small", null, item.why || "")
            ))
          ),
          sources.length ? el("details", { className: "olympus-details olympus-source-list" },
            el("summary", null, "Source basis"),
            sources.map((item, idx) => el("div", { key: idx, className: "olympus-source-row" },
              el("strong", null, item.label || "Source"),
              el("small", null, item.detail || "")
            ))
          ) : null
        )
      )
    );
  }

  function AgentHQ({ hq }) {
    const data = hq || {};
    const summary = data.summary || {};
    const metrics = data.metrics || {};
    const agents = asList(data.agents);
    const tuningItems = asList(data.opportunities);
    const costRisks = Number(summary.expensive_sessions || metrics.expensive_sessions || 0);
    const failedRuns = Number(metrics.failed_kanban_runs || 0);
    const medianDuration = Number(metrics.median_duration_seconds || 0);
    const p90Duration = Number(metrics.p90_duration_seconds || 0);
    const tiles = [
      { label: "Agents", value: summary.agents || agents.length || 0, state: agents.length ? "active" : "unknown" },
      { label: "Tuning Items", value: summary.opportunities || tuningItems.length || 0, state: tuningItems.length ? "warning" : "ok" },
      { label: "Median Speed", value: formatDuration(medianDuration), state: medianDuration > 900 ? "warning" : medianDuration ? "active" : "idle" },
      { label: "P90 Speed", value: formatDuration(p90Duration), state: p90Duration > 1800 ? "warning" : p90Duration ? "active" : "idle" },
      { label: "Tool Calls", value: formatCount(metrics.total_tool_calls), state: metrics.total_tool_calls ? "active" : "idle" },
      { label: "Looping", value: summary.looping_sessions || 0, state: summary.looping_sessions ? "warning" : "ok" },
      { label: "Context Pressure", value: summary.context_pressure_sessions || 0, state: summary.context_pressure_sessions ? "warning" : "ok" },
      { label: "Outcome Risks", value: failedRuns || 0, state: failedRuns ? "warning" : "ok" },
      { label: "Cost Risks", value: costRisks, state: costRisks ? "warning" : "ok" },
    ];
    const primaryTiles = tiles.slice(0, 6);
    const secondaryTiles = tiles.slice(6);
    const primaryTuningItems = tuningItems.slice(0, 3);
    const backlogTuningItems = tuningItems.slice(3);

    function renderTuningItem(item, idx) {
      return el("article", { key: idx, className: cx("olympus-tuning-item", "olympus-tuning-item-" + String(item.severity || "info").toLowerCase()) },
        el("div", { className: "olympus-item-head" },
          el("div", null,
            el("span", null, String(item.kind || "signal")),
            el("h4", null, item.title || "Tuning item")
          ),
          el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
        ),
        el("p", null, item.detail || ""),
        (item.evidence || item.threshold || item.basis) ? el("details", { className: "olympus-details" },
          el("summary", null, "Evidence"),
          item.evidence ? el("small", null, "Observed: " + item.evidence) : null,
          item.threshold ? el("small", { className: "olympus-threshold" }, "Trigger: " + item.threshold) : null,
          item.basis ? el("small", { className: "olympus-basis" }, item.basis) : null
        ) : null,
        item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
      );
    }

    return el("section", { className: "olympus-section olympus-agent-hq" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Agent Monitor"),
          el("p", null, "Profiles, sessions, Kanban work, tool pressure, context risk, and reliability in one operational scan.")
        )
      ),
      el("div", { className: "olympus-hq-tiles" },
        primaryTiles.map((item) => el("div", { key: item.label, className: "olympus-hq-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(StatePill, { state: item.state })
        ))
      ),
      secondaryTiles.length ? el("details", { className: "olympus-details olympus-backlog-details olympus-metric-backlog" },
        el("summary", null, "More monitor signals (" + secondaryTiles.length + ")"),
        el("div", { className: "olympus-hq-mini-grid" },
          secondaryTiles.map((item) => el("div", { key: item.label, className: "olympus-hq-mini-tile" },
            el("span", null, item.label),
            el("strong", null, String(item.value)),
            el(StatePill, { state: item.state })
          ))
        )
      ) : null,
      el("div", { className: "olympus-hq-grid" },
        el("div", { className: "olympus-hq-pane olympus-hq-tuning-items" },
          el("h3", null, "Tuning Queue"),
          primaryTuningItems.length ? primaryTuningItems.map(renderTuningItem) : el("p", { className: "olympus-muted" }, "No tuning items in this scan."),
          backlogTuningItems.length ? el("details", { className: "olympus-details olympus-backlog-details" },
            el("summary", null, "More tuning items (" + backlogTuningItems.length + ")"),
            backlogTuningItems.map((item, idx) => el("div", { key: idx, className: "olympus-mini-row" },
              el("span", null, item.title || "Tuning item"),
              el("small", null, [item.severity, item.kind, item.evidence].filter(Boolean).join(" / ")),
              item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
            ))
          ) : null
        )
      )
    );
  }

  function EvidenceSources({ evidenceSources }) {
    const data = evidenceSources || {};
    const summary = data.summary || {};
    const items = asList(data.items);
    if (!items.length) return null;

    function countLine(counts) {
      if (!counts || typeof counts !== "object") return "";
      return Object.entries(counts)
        .filter((entry) => Number(entry[1] || 0) > 0)
        .slice(0, 3)
        .map((entry) => entry[0].replaceAll("_", " ") + ": " + formatCount(entry[1]))
        .join(" / ");
    }

    return el("div", { className: "olympus-evidence-sources" },
      el("div", { className: "olympus-evidence-sources-head" },
        el("div", null,
          el("h3", null, "Evidence Sources"),
          el("p", null, "Source health, safe fields, and redaction status for this scan.")
        ),
        el(StatePill, { state: summary.warnings ? "warning" : summary.missing ? "info" : "ok", label: [
          formatCount(summary.available || 0),
          "of",
          formatCount(summary.sources || items.length),
          "available"
        ].join(" ") })
      ),
      el("div", { className: "olympus-evidence-source-grid" },
        items.map((item) => el("article", { key: item.id || item.label, className: "olympus-evidence-source" },
          el("div", { className: "olympus-evidence-source-title" },
            el("div", null,
              el("span", null, item.type || "source"),
              el("strong", null, item.label || "Evidence source")
            ),
            el(StatePill, { state: item.state || "unknown" })
          ),
          countLine(item.counts) ? el("small", null, countLine(item.counts)) : null,
          asList(item.fields).length ? el("em", null, asList(item.fields).slice(0, 4).join(" / ")) : null,
          item.redaction ? el("p", null, item.redaction) : null,
          item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, routeLabel(item.recommended_view)) : null
        ))
      )
    );
  }

  function PerformanceTracking({ performance, diagnostics, clientDiagnostics, evidenceSources }) {
    const data = performance || {};
    const summary = data.summary || {};
    const lanes = asList(data.lanes);
    const signals = asList(data.signals);
    const diag = diagnostics || {};
    const client = clientDiagnostics || {};
    if (!lanes.length && !signals.length && !diag.generated_ms && !client.fetch_ms) return null;

    function laneValue(item) {
      if (item.unit === "seconds") return formatDuration(item.value);
      if (item.unit === "usd") return formatMoney(item.value);
      return formatCount(item.value);
    }

    return el("section", { className: "olympus-section olympus-performance" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Performance Tracking"),
          el("p", null, "Latency, tool pressure, context risk, reliability, and diagnostic payloads from the latest scan.")
        ),
        el(StatePill, { state: summary.state || "unknown" })
      ),
      el("div", { className: "olympus-performance-grid" },
        lanes.map((item) => el("article", { key: item.id || item.label, className: cx("olympus-performance-lane", "olympus-performance-lane-" + String(item.state || "unknown").toLowerCase()) },
          el("div", { className: "olympus-performance-lane-head" },
            el("span", null, item.label || "Signal"),
            el(StatePill, { state: item.state || "unknown" })
          ),
          el("strong", null, laneValue(item)),
          el("p", null, item.detail || ""),
          item.source ? el("small", null, item.source) : null,
          item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, routeLabel(item.recommended_view)) : null
        ))
      ),
      signals.length ? el("div", { className: "olympus-performance-signals" },
        signals.map((item, idx) => el("div", { key: idx, className: "olympus-mini-row" },
          el("span", null, item.label || "Signal"),
          el("small", null, item.detail || ""),
          el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
        ))
      ) : null,
      (diag.generated_ms || client.fetch_ms) ? el("div", { className: "olympus-performance-diagnostics" },
        el("h3", null, "Production Diagnostics"),
        el("div", { className: "olympus-diagnostic-grid" },
          [
            { label: "API Build", value: diag.generated_ms ? Math.round(Number(diag.generated_ms)) + "ms" : "unknown", state: diag.budget_status && diag.budget_status.api_response || "unknown" },
            { label: "Payload", value: diag.payload_bytes ? formatBytes(diag.payload_bytes) : "unknown", state: diag.budget_status && diag.budget_status.payload || "unknown" },
            { label: "Fetch", value: client.fetch_ms ? Math.round(Number(client.fetch_ms)) + "ms" : "pending", state: client.fetch_state || "unknown" },
            { label: "Render", value: client.render_ms ? Math.round(Number(client.render_ms)) + "ms" : "pending", state: client.render_state || "unknown" },
            { label: "Boards", value: String(diag.counts && diag.counts.kanban_boards_scanned || 0), state: diag.counts && diag.counts.kanban_board_read_failures ? "warning" : "ok" },
            { label: "Hermes", value: diag.hermes && diag.hermes.version || "unknown", state: diag.hermes && diag.hermes.version && diag.hermes.version !== "unknown" ? "ok" : "unknown" },
          ].map((item) => el("div", { key: item.label, className: "olympus-diagnostic-tile" },
            el("span", null, item.label),
            el("strong", null, item.value),
            el(StatePill, { state: item.state })
          ))
        )
      ) : null,
      el(EvidenceSources, { evidenceSources })
    );
  }

  function TraceSpine({ trace }) {
    const data = trace || {};
    const summary = data.summary || {};
    const items = asList(data.items);
    const hasEvidence = items.length || summary.tasks || summary.sessions || summary.runs || summary.events;
    if (!hasEvidence) return null;

    const tiles = [
      { label: "Tasks", value: formatCount(summary.tasks || 0), state: summary.tasks ? "active" : "idle" },
      { label: "Linked", value: formatCount(summary.correlated_tasks || 0), state: summary.correlated_tasks ? "active" : "idle" },
      { label: "Failures", value: formatCount(summary.failure_points || 0), state: summary.failure_points ? "warning" : "ok" },
      { label: "Sessions", value: formatCount(summary.sessions || 0), state: summary.sessions ? "active" : "idle" },
      { label: "Runs", value: formatCount(summary.runs || 0), state: summary.runs ? "active" : "idle" },
      { label: "Events", value: formatCount(summary.events || 0), state: summary.events ? "active" : "idle" },
    ];
    const visibleItems = items.slice(0, 4);

    function refLine(label, refs) {
      const safeRefs = asList(refs).slice(0, 3);
      if (!safeRefs.length) return null;
      return el("small", null, label + ": " + safeRefs.join(" / "));
    }

    return el("section", { className: "olympus-section olympus-trace-spine" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Trace Spine"),
          el("p", null, "Task, session, run, and event correlation without transcript content.")
        ),
        el(StatePill, { state: summary.state || "unknown" })
      ),
      el("div", { className: "olympus-trace-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-trace-tile" },
          el("span", null, item.label),
          el("strong", null, item.value),
          el(StatePill, { state: item.state })
        ))
      ),
      visibleItems.length ? el("div", { className: "olympus-trace-list" },
        visibleItems.map((item, idx) => el("article", { key: item.task_ref || idx, className: cx("olympus-trace-item", "olympus-trace-item-" + String(item.severity || "info").toLowerCase()) },
          el("div", { className: "olympus-item-head" },
            el("div", null,
              el("span", null, [item.board || "board", item.status || "task"].filter(Boolean).join(" / ")),
              el("h3", null, item.title || "Trace item")
            ),
            el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
          ),
          el("p", null, item.recommendation || item.detail || "Review the linked Hermes view."),
          el("div", { className: "olympus-trace-signals" },
            asList(item.signals).slice(0, 5).map((signal) => el("span", { key: signal }, signal.replaceAll("_", " ")))
          ),
          el("div", { className: "olympus-trace-refs" },
            item.task_ref ? el("small", null, "Task ref: " + item.task_ref) : null,
            item.session_ref ? el("small", null, "Session ref: " + item.session_ref) : null,
            refLine("Runs", item.run_refs),
            refLine("Events", item.event_refs),
            item.basis ? el("small", null, item.basis) : null
          ),
          item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
        ))
      ) : el("p", { className: "olympus-muted" }, "No correlated task failures in this scan."),
      items.length > visibleItems.length ? el("p", { className: "olympus-trace-more" }, "Showing the top " + visibleItems.length + " traces by severity.") : null
    );
  }

  function ToolPolicy({ policy }) {
    const data = policy || {};
    const summary = data.summary || {};
    const settings = asList(data.settings);
    const findings = asList(data.findings);
    if (!settings.length && !findings.length && !summary.root_config_present && !summary.profile_configs) return null;

    function settingValue(item) {
      if (item.unit === "usd") return formatMoney(item.value);
      if (typeof item.value === "number") return formatCount(item.value);
      return String(item.value || "none");
    }

    const tiles = [
      { label: "Config", value: summary.root_config_present ? "root" : summary.profile_configs ? "profile" : "missing", state: summary.root_config_present || summary.profile_configs ? "active" : "unknown" },
      { label: "Findings", value: summary.findings || 0, state: summary.findings ? "warning" : "ok" },
      { label: "Max Turns", value: summary.max_turns || 0, state: summary.max_turns >= 80 && !summary.hard_loop_stop ? "warning" : summary.max_turns ? "active" : "unknown" },
      { label: "Loop Stop", value: summary.hard_loop_stop ? "visible" : "not visible", state: summary.hard_loop_stop ? "ok" : summary.max_turns >= 80 ? "warning" : "unknown" },
      { label: "Fallbacks", value: summary.fallback_providers || 0, state: summary.fallback_providers ? "active" : "idle" },
      { label: "Aux Signals", value: summary.auxiliary_routes || 0, state: summary.auxiliary_routes ? "active" : "idle" },
      { label: "Costed Runs", value: summary.costed_sessions || 0, state: summary.costed_sessions ? "active" : summary.auxiliary_routes ? "warning" : "unknown" },
      { label: "Browser Flags", value: summary.browser_private_flags || 0, state: summary.browser_private_flags ? "warning" : "ok" },
    ];

    return el("section", { className: "olympus-section olympus-policy" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Tool Policy & Aux Cost"),
          el("p", null, "Config limits, route audit, browser privacy, and background cost visibility.")
        ),
        el("div", { className: "olympus-section-actions" },
          el(StatePill, { state: summary.state || "unknown" }),
          el("a", { className: "olympus-link", href: "/config" }, "Open Config")
        )
      ),
      el("div", { className: "olympus-policy-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-policy-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(StatePill, { state: item.state })
        ))
      ),
      el("div", { className: "olympus-policy-grid" },
        el("div", { className: "olympus-policy-pane" },
          el("h3", null, "Policy Signals"),
          settings.length ? settings.map((item) => el("div", { key: item.id || item.label, className: "olympus-policy-setting" },
            el("div", null,
              el("span", null, item.label || "Policy"),
              el("strong", null, settingValue(item)),
              el("small", null, [item.detail, item.source].filter(Boolean).join(" / "))
            ),
            el(StatePill, { state: item.state || "unknown" })
          )) : el("p", { className: "olympus-muted" }, "No config policy evidence in this scan.")
        ),
        el("div", { className: "olympus-policy-pane" },
          el("h3", null, "Findings"),
          findings.length ? findings.map((item, idx) => el("article", { key: idx, className: cx("olympus-policy-finding", "olympus-policy-finding-" + String(item.severity || "info").toLowerCase()) },
            el("div", { className: "olympus-item-head" },
              el("div", null,
                el("span", null, String(item.kind || "policy")),
                el("h4", null, item.title || "Policy finding")
              ),
              el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
            ),
            el("p", null, item.detail || ""),
            item.evidence ? el("small", null, item.evidence) : null,
            item.threshold ? el("small", null, "Trigger: " + item.threshold) : null,
            item.basis ? el("small", null, item.basis) : null,
            item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
          )) : el("p", { className: "olympus-muted" }, "No config policy risks in this scan.")
        )
      )
    );
  }

  function SkillCoverage({ coverage }) {
    const data = coverage || {};
    const summary = data.summary || {};
    const suggestions = asList(data.suggestions);
    const profiles = asList(data.profiles);
    if (!suggestions.length && !profiles.length) return null;
    const tiles = [
      { label: "Skills", value: formatCount(summary.total_skills), state: summary.total_skills ? "active" : "idle" },
      { label: "Bare Profiles", value: summary.zero_skill_profiles || 0, state: summary.zero_skill_profiles ? "warning" : "ok" },
      { label: "Forced Skill Tasks", value: summary.forced_skill_tasks || 0, state: summary.forced_skill_tasks ? "active" : "idle" },
      { label: "Looping", value: summary.looping_sessions || 0, state: summary.looping_sessions ? "warning" : "ok" },
      { label: "Tool Heavy", value: summary.tool_heavy_sessions || 0, state: summary.tool_heavy_sessions ? "warning" : "ok" },
      { label: "Context", value: summary.context_pressure_sessions || 0, state: summary.context_pressure_sessions ? "warning" : "ok" },
    ];

    return el("section", { className: "olympus-section olympus-skill-coverage" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Skill Coverage"),
          el("p", null, "Skill signals from repeated tool use, loops, long context, and profiles without skill coverage.")
        ),
        el("a", { className: "olympus-link", href: "/skills" }, "Open Skills")
      ),
      el("div", { className: "olympus-skill-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-skill-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(StatePill, { state: item.state })
        ))
      ),
      el("div", { className: "olympus-skill-grid" },
        el("div", { className: "olympus-skill-pane" },
          el("h3", null, "Skill Recommendations"),
          suggestions.map((item, idx) => el("article", { key: idx, className: cx("olympus-skill-suggestion", "olympus-skill-suggestion-" + String(item.severity || "info").toLowerCase()) },
            el("div", { className: "olympus-item-head" },
              el("div", null,
                el("span", null, String(item.kind || "skill")),
                el("h4", null, item.title || "Skill item")
              ),
              el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
            ),
            el("p", null, item.detail || ""),
            item.evidence ? el("small", null, item.evidence) : null,
            item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
          ))
        ),
        el("div", { className: "olympus-skill-pane" },
          el("h3", null, "Profiles"),
          profiles.map((profile) => el("div", { key: profile.id || profile.label, className: "olympus-skill-profile" },
            el("div", null,
              el("strong", null, profile.label || "Profile"),
              el("small", null, [
                (profile.skill_count || 0) + " skills",
                (profile.open_work || 0) + " open",
                (profile.forced_skill_tasks || 0) + " forced-skill tasks",
              ].join(" / "))
            ),
            el(StatePill, { state: profile.state || "unknown" }),
            el("p", null, profile.top_issue || "No current skill signal."),
            profile.recommended_view ? el("a", { className: "olympus-link", href: routeLink(profile.recommended_view) }, routeLabel(profile.recommended_view)) : null
          ))
        )
      )
    );
  }

  function SkillHygiene({ hygiene }) {
    const data = hygiene || {};
    const summary = data.summary || {};
    const signals = asList(data.signals);
    const usage = asList(data.usage);
    const hub = asList(data.hub);
    if (!signals.length && !usage.length && !hub.length && !summary.total_skills && !summary.hub_installed) return null;
    const tiles = [
      { label: "Total Skills", value: summary.total_skills || 0, state: summary.total_skills ? "active" : "idle" },
      { label: "Issues", value: summary.issues || 0, state: summary.issues ? "warning" : "ok" },
      { label: "Stale", value: summary.stale || 0, state: summary.stale ? "warning" : "ok" },
      { label: "Never Used", value: summary.never_used || 0, state: summary.never_used ? "info" : "ok" },
      { label: "Patched", value: summary.recently_patched || 0, state: summary.recently_patched ? "info" : "ok" },
      { label: "Hub Skills", value: summary.hub_installed || 0, state: summary.hub_installed ? "active" : "idle" },
      { label: "Trust Gaps", value: (summary.hub_missing_trust || 0) + (summary.hub_missing_scan || 0), state: (summary.hub_missing_trust || summary.hub_missing_scan) ? "warning" : "ok" },
    ];

    return el("section", { className: "olympus-section olympus-skill-hygiene" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Skill Hygiene"),
          el("p", null, "Activity, archive, patch, hub trust, and scan gaps from local skill metadata.")
        ),
        el("div", { className: "olympus-section-actions" },
          el(StatePill, { state: summary.state || "unknown" }),
          el("a", { className: "olympus-link", href: "/skills" }, "Open Skills")
        )
      ),
      el("div", { className: "olympus-skill-hygiene-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-skill-hygiene-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(StatePill, { state: item.state })
        ))
      ),
      el("div", { className: "olympus-skill-hygiene-grid" },
        el("div", { className: "olympus-skill-hygiene-pane" },
          el("h3", null, "Hygiene Signals"),
          signals.length ? signals.map((item, idx) => el("article", { key: idx, className: cx("olympus-skill-suggestion", "olympus-skill-suggestion-" + String(item.severity || "info").toLowerCase()) },
            el("div", { className: "olympus-item-head" },
              el("div", null,
                el("span", null, String(item.kind || "skill")),
                el("h4", null, item.title || "Skill hygiene item")
              ),
              el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
            ),
            el("p", null, item.detail || ""),
            item.evidence ? el("small", null, item.evidence) : null,
            item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
          )) : el("p", { className: "olympus-muted" }, "No skill hygiene issues in this scan.")
        ),
        el("div", { className: "olympus-skill-hygiene-pane" },
          el("h3", null, "Skill Activity"),
          usage.length ? usage.slice(0, 6).map((item) => el("div", { key: item.id || item.label, className: "olympus-mini-row" },
            el("span", null, item.label || "Skill"),
            el("small", null, [
              (item.use_count || 0) + " uses",
              (item.patch_count || 0) + " patches",
              item.pinned ? "pinned" : "unpinned",
              item.stale ? "stale" : null,
            ].filter(Boolean).join(" / ")),
            el(StatePill, { state: item.archived ? "warning" : item.stale ? "info" : "active" })
          )) : el("p", { className: "olympus-muted" }, "No usage metadata recorded.")
        ),
        el("div", { className: "olympus-skill-hygiene-pane" },
          el("h3", null, "Hub Provenance"),
          hub.length ? hub.slice(0, 6).map((item) => el("div", { key: item.id || item.label, className: "olympus-mini-row" },
            el("span", null, item.label || "Hub skill"),
            el("small", null, [
              item.trust_level ? "trust: " + item.trust_level : "trust missing",
              item.scan_verdict ? "scan: " + item.scan_verdict : "scan missing",
            ].join(" / ")),
            el(StatePill, { state: item.state || "unknown" })
          )) : el("p", { className: "olympus-muted" }, "No hub lock metadata recorded.")
        )
      )
    );
  }

  function ProfileFitness({ fitness }) {
    const data = fitness || {};
    const summary = data.summary || {};
    const profiles = asList(data.profiles);
    if (!profiles.length) return null;
    const tiles = [
      { label: "Profiles", value: summary.profiles || profiles.length || 0, state: profiles.length ? "active" : "unknown" },
      { label: "Needs Review", value: summary.needs_review || 0, state: summary.needs_review ? "warning" : "ok" },
      { label: "Average", value: summary.average_score || 0, state: Number(summary.average_score || 0) >= 90 ? "ok" : "warning" },
      { label: "Lowest", value: summary.lowest_score || 0, state: Number(summary.lowest_score || 0) >= 90 ? "ok" : "warning" },
    ];

    return el("section", { className: "olympus-section olympus-profile-fitness" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Profile Fitness"),
          el("p", null, "Which Hermes profiles are ready for work, overloaded, missing setup, or carrying risky tasks.")
        ),
        el("a", { className: "olympus-link", href: "/profiles" }, "Open Profiles")
      ),
      el("div", { className: "olympus-fitness-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-fitness-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(StatePill, { state: item.state })
        ))
      ),
      el("div", { className: "olympus-fitness-list" },
        profiles.map((profile) => {
          const metrics = profile.metrics || {};
          const reasons = asList(profile.reasons);
          return el("article", { key: profile.id || profile.label, className: "olympus-fitness-row" },
            el("div", { className: "olympus-fitness-head" },
              el("div", null,
                el("h3", null, profile.label || "Profile"),
                el("small", null, [
                  (metrics.skills || 0) + " skills",
                  (metrics.cron || 0) + " cron",
                  (metrics.gateways || 0) + " gateways",
                  (metrics.open || 0) + " open",
                  (metrics.failed_runs || 0) + " failed runs",
                ].join(" / "))
              ),
              el("div", { className: "olympus-fitness-score" },
                el("strong", null, String(profile.score || 0)),
                el(StatePill, { state: profile.state || "unknown" })
              )
            ),
            el("p", null, profile.top_issue || "No current profile issue."),
            reasons.length ? el("div", { className: "olympus-fitness-reasons" },
              reasons.map((reason, idx) => el("small", { key: idx },
                [reason.label, reason.detail, reason.points ? "-" + String(reason.points) : null].filter(Boolean).join(" / ")
              ))
            ) : null,
            profile.recommended_view ? el("a", { className: "olympus-link", href: routeLink(profile.recommended_view) }, routeLabel(profile.recommended_view)) : null
          );
        })
      )
    );
  }

  function eventState(kind, fallback) {
    const k = String(kind || "").toLowerCase();
    if (k.includes("blocked") || k.includes("timed_out") || k.includes("crashed") || k.includes("failed") || k.includes("reclaimed")) return "warning";
    if (k.includes("heartbeat") || k.includes("claimed") || k.includes("running")) return "running";
    return fallback || "active";
  }

  function PartyView({ party, orchestration, events, score }) {
    const data = party || {};
    const members = asList(data.members);
    const summary = data.summary || {};
    const orch = orchestration || {};
    const orchSummary = orch.summary || {};
    const [selectedId, setSelectedId] = useState(members[0] && members[0].id);
    const selected = members.find((m) => m.id === selectedId) || members[0] || {};
    const activity = asList(events).slice(0, 8);
    const hasOrchestrationSignal = Boolean(
      orchSummary.open || orchSummary.running || orchSummary.ready || orchSummary.blocked ||
      orchSummary.active_workers || orchSummary.stale_workers
    );
    useEffect(() => {
      if (members.length && !members.some((member) => member.id === selectedId)) {
        setSelectedId(members[0].id);
      }
    }, [members.map((member) => member.id).join("|"), selectedId]);
    if (!members.length && !activity.length && !hasOrchestrationSignal) return null;
    const lanes = [
      { key: "kanban", label: "Kanban", value: orchSummary.open || 0, detail: (orchSummary.running || 0) + " running / " + (orchSummary.ready || 0) + " ready", state: (orchSummary.active_workers || orchSummary.open) ? "running" : "idle" },
      { key: "cron", label: "Cron", value: members.reduce((n, m) => n + Number(m.cron_jobs || 0), 0), detail: "scheduled triggers", state: "scheduled" },
      { key: "gateway", label: "Gateway", value: members.reduce((n, m) => n + Number(m.gateway_count || 0), 0), detail: (summary.working || 0) + " working profiles", state: "running" },
    ];
    const status = [
      { label: "Profiles", value: summary.members || members.length || 0, state: members.length ? "active" : "unknown" },
      { label: "Workers", value: summary.workers || orchSummary.active_workers || 0, state: (summary.workers || orchSummary.active_workers) ? "running" : "idle" },
      { label: "Blocked", value: summary.blocked || orchSummary.blocked || 0, state: (summary.blocked || orchSummary.blocked) ? "warning" : "ok" },
      { label: "Stale", value: orchSummary.stale_workers || 0, state: orchSummary.stale_workers ? "warning" : "ok" },
    ];
    const nodePositions = [
      ["18%", "28%"], ["50%", "14%"], ["80%", "30%"], ["70%", "72%"],
      ["32%", "74%"], ["12%", "60%"], ["88%", "60%"], ["50%", "52%"],
    ];

    return el("section", { className: "olympus-section olympus-party olympus-pantheon" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Pantheon"),
          el("p", null, "Clickable profile map for workload, trigger lanes, and current operational risk.")
        ),
        el("a", { className: "olympus-link", href: "/kanban" }, "Open Kanban")
      ),
      el("div", { className: "olympus-command-viewport" },
        el("div", { className: "olympus-viewport-main", role: "group", "aria-label": "Pantheon showing trigger lanes, profile workload, and current operational risk." },
          members.length ? el("div", { className: "olympus-pantheon-map", role: "group", "aria-label": "Clickable Pantheon profile map." },
            el("div", { className: "olympus-pantheon-score", "aria-hidden": "true" },
              el("span", null, "Readiness"),
              el("strong", null, String(score || 0))
            ),
            members.map((member, idx) => {
              const pos = nodePositions[idx % nodePositions.length];
              return el("button", {
                key: member.id,
                type: "button",
                style: { "--x": pos[0], "--y": pos[1] },
                "aria-pressed": selected.id === member.id,
                "aria-label": "Select profile " + (member.label || "Agent"),
                className: cx(
                  "olympus-agent-card",
                  "olympus-pantheon-node",
                  "olympus-agent-card-" + String(member.state || "unknown").toLowerCase(),
                  selected.id === member.id && "olympus-agent-card-selected",
                  selected.id === member.id && "olympus-pantheon-node-selected"
                ),
                onClick: () => setSelectedId(member.id)
              },
                el("span", { className: "olympus-pantheon-node-kicker" }, "Profile"),
                el("strong", null, member.label || "Agent"),
                el("small", null, [
                  (member.open_work || 0) + " open",
                  (member.running_work || 0) + " running",
                  (member.blocked_work || 0) + " blocked",
                ].join(" / ")),
                el(StatePill, { state: member.state || "unknown" })
              );
            })
          ) : el("p", { className: "olympus-muted" }, "No Hermes profiles detected."),
          el("div", { className: "olympus-viewport-head" },
            el("div", null,
              el("span", null, "Live Monitor"),
              el("h3", null, "Operational State")
            ),
            el("div", { className: "olympus-viewport-status" },
              status.map((item) => el("div", { key: item.label, className: "olympus-viewport-stat" },
                el("span", null, item.label),
                el("strong", null, String(item.value)),
                el(StatePill, { state: item.state })
              ))
            )
          ),
          el("div", { className: "olympus-trigger-lanes" },
            lanes.map((lane) => el("div", { key: lane.key, className: cx("olympus-trigger-card", "olympus-trigger-" + lane.key) },
              el("span", null, lane.label),
              el("strong", null, String(lane.value || 0)),
              el("small", null, lane.detail),
              el(StatePill, { state: lane.state })
            ))
          )
        ),
        el("aside", { className: "olympus-party-inspector" },
          el("div", { className: "olympus-party-inspector-head" },
            el("div", null,
              el("span", null, "Selected Profile"),
              el("h3", null, selected.label || "No profile")
            ),
            el(StatePill, { state: selected.state || "unknown" })
          ),
          selected.id ? [
            el("div", { key: "stats", className: "olympus-party-stat-grid" },
              [
                ["Open", selected.open_work || 0],
                ["Running", selected.running_work || 0],
                ["Ready", selected.ready_work || 0],
                ["Blocked", selected.blocked_work || 0],
                ["Skills", selected.skill_count || 0],
                ["Cron", selected.cron_jobs || 0],
              ].map((pair) => el("div", { key: pair[0], className: "olympus-party-stat" },
                el("span", null, pair[0]),
                el("strong", null, String(pair[1]))
              ))
            ),
            el("div", { key: "current", className: "olympus-party-current" },
              el("strong", null, "Current Work"),
              selected.current_task ? el("p", null, [selected.current_task.title, selected.current_task.status, selected.current_task.goal_mode ? "goal mode" : null].filter(Boolean).join(" / ")) : el("p", null, "No active Kanban task on this scan."),
              selected.current_task && selected.current_task.forced_skill_count ? el("small", null, "Forced skills: " + String(selected.current_task.forced_skill_count)) : null,
              selected.current_task && selected.current_task.model_override ? el("small", null, "Model override: " + selected.current_task.model_override) : null
            ),
            el("div", { key: "flags", className: "olympus-flags" },
              asList(selected.flags).map((flag) => el("span", { key: flag }, flag))
            )
          ] : el("p", { className: "olympus-muted" }, "No Hermes profiles detected.")
        )
      ),
      el("div", { className: "olympus-party-feed" },
        el("h3", null, "Activity"),
        activity.length ? activity.map((item, idx) => el("div", { key: idx, className: "olympus-party-event" },
          el("div", null,
            el("strong", null, item.label || item.kind || "Event"),
            el("small", null, [item.source, item.profile, item.detail].filter(Boolean).join(" / "))
          ),
          el(StatePill, { state: eventState(item.kind, item.state), label: item.state || eventState(item.kind) })
        )) : el("p", { className: "olympus-muted" }, "No recent activity in this scan.")
      )
    );
  }

  function KanbanIntelligence({ kanban }) {
    const data = kanban || {};
    const totals = data.totals || {};
    const boards = asList(data.boards);
    const attention = asList(data.attention);
    const assignees = asList(data.assignee_load);
    const workers = asList(data.active_workers);
    const totalBoards = boards.length;
    const open = Number(data.open || 0);
    const blocked = Number(totals.blocked || 0);
    const ready = Number(totals.ready || 0);
    const hasSignal = totalBoards || open || blocked || ready || workers.length || attention.length;

    if (!hasSignal) return null;

    const summary = [
      { label: "Boards", value: String(totalBoards), state: totalBoards ? "active" : "unknown" },
      { label: "Open Work", value: String(open), state: open ? "active" : "idle" },
      { label: "Ready", value: String(ready), state: ready ? "running" : "idle" },
      { label: "Blocked", value: String(blocked), state: blocked ? "warning" : "ok" },
      { label: "Workers", value: String(workers.length), state: workers.length ? "running" : "idle" },
    ];

    return el("section", { className: "olympus-section olympus-kanban" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Kanban Intelligence"),
          el("p", null, "Board pressure, blocked work, worker activity, and assignee load.")
        ),
        el("a", { className: "olympus-link", href: "/kanban" }, "Open Kanban")
      ),
      el("div", { className: "olympus-kanban-summary" },
        summary.map((item) => el("div", { key: item.label, className: "olympus-kanban-tile" },
          el("span", null, item.label),
          el("strong", null, item.value),
          el(StatePill, { state: item.state })
        ))
      ),
      el("div", { className: "olympus-kanban-grid" },
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Boards"),
          boards.length ? boards.map((board) => el("div", { key: board.slug, className: "olympus-mini-row" },
            el("span", null, (board.name || board.slug) + (board.is_current ? " / current" : "")),
            el("small", null, [
              (board.open || 0) + " open",
              (board.counts && board.counts.running || 0) + " running",
              (board.counts && board.counts.blocked || 0) + " blocked"
            ].join(" / ")),
            el(StatePill, { state: board.error ? "warning" : (board.open ? "active" : "idle") })
          )) : el("p", { className: "olympus-muted" }, "No Kanban boards detected.")
        ),
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Assignee Load"),
          assignees.length ? assignees.slice(0, 6).map((agent) => el("div", { key: agent.assignee, className: "olympus-mini-row" },
            el("span", null, agent.assignee || "unassigned"),
            el("small", null, [
              (agent.open || 0) + " open",
              (agent.running || 0) + " running",
              (agent.ready || 0) + " ready",
              (agent.blocked || 0) + " blocked"
            ].join(" / ")),
            el(StatePill, { state: Number(agent.blocked || 0) ? "warning" : Number(agent.running || 0) ? "running" : "active" })
          )) : el("p", { className: "olympus-muted" }, "No assigned Kanban work right now.")
        ),
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Kanban Attention"),
          attention.length ? attention.slice(0, 6).map((item, idx) => el("div", { key: idx, className: "olympus-mini-row" },
            el("span", null, item.label || "Kanban issue"),
            el("small", null, [item.board, item.detail].filter(Boolean).join(" / ")),
            el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
          )) : el("p", { className: "olympus-muted" }, "No blocked, stale, failed, or unassigned Kanban work detected.")
        )
      )
    );
  }

  function OlympusPage() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [clientDiagnostics, setClientDiagnostics] = useState(null);
    const requestSeq = useRef(0);

    function load() {
      const requestId = requestSeq.current + 1;
      requestSeq.current = requestId;
      setLoading(true);
      const started = window.performance && performance.now ? performance.now() : Date.now();
      SDK.fetchJSON(API + "/overview?ts=" + encodeURIComponent(String(Date.now())))
        .then((next) => {
          if (requestId !== requestSeq.current) return;
          const received = window.performance && performance.now ? performance.now() : Date.now();
          setData(next);
          setError(null);
          window.requestAnimationFrame(() => {
            if (requestId !== requestSeq.current) return;
            const rendered = window.performance && performance.now ? performance.now() : Date.now();
            const budgets = next && next.diagnostics && next.diagnostics.budgets || {};
            const renderBudget = Number(budgets.client_render_ms || 150);
            setClientDiagnostics({
              fetch_ms: Math.round(received - started),
              fetch_state: received - started > Number(budgets.api_response_ms || 750) ? "warning" : "ok",
              render_ms: Math.round(rendered - received),
              render_state: rendered - received > renderBudget ? "warning" : "ok",
              total_ms: Math.round(rendered - started)
            });
          });
        })
        .catch((err) => {
          if (requestId === requestSeq.current) setError(String(err && err.message ? err.message : err));
        })
        .finally(() => {
          if (requestId === requestSeq.current) setLoading(false);
        });
    }

    useEffect(() => {
      load();
      const id = setInterval(load, 10000);
      return () => clearInterval(id);
    }, []);

    const health = (data && data.health) || {};
    const tuning = (data && data.tuning) || {};
    const score = typeof tuning.score === "number" ? tuning.score : 0;

    return el("div", { className: "olympus-page" },
      el(Hero, { health, score, loading, onRefresh: load }),
      error ? el("div", { className: "olympus-error" }, error) : null,
      el(AgentHQ, { hq: tuning.agent_hq }),
      el(PerformanceTracking, { performance: data && data.performance, diagnostics: data && data.diagnostics, clientDiagnostics, evidenceSources: data && data.evidence_sources }),
      el(TraceSpine, { trace: data && data.trace_spine }),
      el(ToolPolicy, { policy: data && data.config_policy }),
      el(SkillCoverage, { coverage: data && data.skill_coverage }),
      el(SkillHygiene, { hygiene: data && data.skill_hygiene }),
      el(ProfileFitness, { fitness: data && data.profile_fitness }),
      el(PartyView, { party: data && data.party, orchestration: data && data.orchestration, events: data && data.activity_events, score }),
      el(KanbanIntelligence, { kanban: data && data.kanban }),
      el(ScoreExplainer, { tuning })
    );
  }

  window.__HERMES_PLUGINS__.register("olympus", OlympusPage);
})();
