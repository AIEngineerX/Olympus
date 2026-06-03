(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React } = SDK;
  const { useEffect, useMemo, useRef, useState } = SDK.hooks;
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

  function Hero({ health, score, loading, onRefresh }) {
    const status = health.status || (loading ? "checking" : "unknown");
    const statusLabel = health.status_label || status;
    return el("section", { className: "olympus-hero" },
      el("div", { className: "olympus-hero-copy" },
        el("div", { className: "olympus-kicker" }, "HermesOS Agent HQ"),
        el("h1", null, "Olympus"),
        el("p", null, "Read-only operations for multiple Hermes agents: speed, token pressure, tool loops, workload, reliability risks, and the next tuning move."),
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
    const opportunities = asList(data.opportunities);
    const cost = Number(summary.total_cost_usd || 0);
    const failedRuns = Number(metrics.failed_kanban_runs || 0);
    const medianDuration = Number(metrics.median_duration_seconds || 0);
    const p90Duration = Number(metrics.p90_duration_seconds || 0);
    const tiles = [
      { label: "Agents", value: summary.agents || agents.length || 0, state: agents.length ? "active" : "unknown" },
      { label: "Opportunities", value: summary.opportunities || opportunities.length || 0, state: opportunities.length ? "warning" : "ok" },
      { label: "Median Speed", value: formatDuration(medianDuration), state: medianDuration > 900 ? "warning" : medianDuration ? "active" : "idle" },
      { label: "P90 Speed", value: formatDuration(p90Duration), state: p90Duration > 1800 ? "warning" : p90Duration ? "active" : "idle" },
      { label: "Token Volume", value: formatCount(summary.total_tokens || metrics.total_tokens), state: (summary.total_tokens || metrics.total_tokens) ? "active" : "idle" },
      { label: "Tool Calls", value: formatCount(metrics.total_tool_calls), state: metrics.total_tool_calls ? "active" : "idle" },
      { label: "Looping", value: summary.looping_sessions || 0, state: summary.looping_sessions ? "warning" : "ok" },
      { label: "Context Pressure", value: summary.context_pressure_sessions || 0, state: summary.context_pressure_sessions ? "warning" : "ok" },
      { label: "Outcome Risks", value: failedRuns || 0, state: failedRuns ? "warning" : "ok" },
      { label: "Spend", value: formatMoney(cost), state: cost > 0 ? "active" : "unknown" },
    ];

    return el("section", { className: "olympus-section olympus-agent-hq" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Agent HQ"),
          el("p", null, "The no-fluff panel: speed, tokens, loops, context pressure, reliability risk, and what to tune next.")
        )
      ),
      el("div", { className: "olympus-hq-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-hq-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(StatePill, { state: item.state })
        ))
      ),
      el("div", { className: "olympus-hq-grid" },
        el("div", { className: "olympus-hq-pane olympus-hq-opportunities" },
          el("h3", null, "What To Tune"),
          opportunities.length ? opportunities.map((item, idx) => el("article", { key: idx, className: cx("olympus-opportunity", "olympus-opportunity-" + String(item.severity || "info").toLowerCase()) },
            el("div", { className: "olympus-opportunity-head" },
              el("div", null,
                el("span", null, "Tune " + String(item.kind || "agent")),
                el("h4", null, item.title || "Opportunity")
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
            item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || "Open view") : null
          )) : el("p", { className: "olympus-muted" }, "No improvement opportunities detected.")
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
          el("p", null, "Where Hermes skills can reduce loops, repeated tool work, long context, or implicit profile behavior.")
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
          el("h3", null, "Coverage Moves"),
          suggestions.map((item, idx) => el("article", { key: idx, className: cx("olympus-skill-suggestion", "olympus-skill-suggestion-" + String(item.severity || "info").toLowerCase()) },
            el("div", { className: "olympus-opportunity-head" },
              el("div", null,
                el("span", null, "Tune " + String(item.kind || "skill")),
                el("h4", null, item.title || "Skill recommendation")
              ),
              el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
            ),
            el("p", null, item.detail || ""),
            item.evidence ? el("small", null, item.evidence) : null,
            item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || "Open view") : null
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
            profile.recommended_view ? el("a", { className: "olympus-link", href: routeLink(profile.recommended_view) }, "Open owner") : null
          ))
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
            profile.recommended_view ? el("a", { className: "olympus-link", href: routeLink(profile.recommended_view) }, "Open owner") : null
          );
        })
      )
    );
  }

  function statusColor(state) {
    const k = String(state || "").toLowerCase();
    if (["error", "critical", "stale", "failed", "warning"].includes(k)) return "var(--color-warning)";
    if (["running", "active", "recent", "ready", "scheduled"].includes(k)) return "var(--color-success)";
    return "var(--midground, #ffe6cb)";
  }

  function nodePulse(state) {
    const k = String(state || "").toLowerCase();
    if (["error", "critical", "stale", "failed", "warning"].includes(k)) return "olympus-party-node-watch";
    if (["running", "active", "recent"].includes(k)) return "olympus-party-node-live";
    return "olympus-party-node-calm";
  }

  function eventState(kind, fallback) {
    const k = String(kind || "").toLowerCase();
    if (k.includes("blocked") || k.includes("timed_out") || k.includes("crashed") || k.includes("failed") || k.includes("reclaimed")) return "warning";
    if (k.includes("heartbeat") || k.includes("claimed") || k.includes("running")) return "running";
    return fallback || "active";
  }

  function PartyView({ party, orchestration, events }) {
    const data = party || {};
    const members = asList(data.members);
    const summary = data.summary || {};
    const orch = orchestration || {};
    const orchSummary = orch.summary || {};
    const [selectedId, setSelectedId] = useState(members[0] && members[0].id);
    const selected = members.find((m) => m.id === selectedId) || members[0] || {};
    const activity = asList(events).slice(0, 8);
    const W = 1000, H = 420, CX = 500, CY = 210;
    const lanes = [
      { key: "kanban", label: "Kanban", x: 170, y: 70, value: orchSummary.open || 0, state: (orchSummary.active_workers || orchSummary.open) ? "running" : "idle" },
      { key: "cron", label: "Cron", x: 500, y: 48, value: members.reduce((n, m) => n + Number(m.cron_jobs || 0), 0), state: "scheduled" },
      { key: "gateway", label: "Gateway", x: 830, y: 70, value: members.reduce((n, m) => n + Number(m.gateway_count || 0), 0), state: "running" },
    ];
    const tiles = [
      { label: "Party", value: summary.members || members.length || 0, state: members.length ? "active" : "unknown" },
      { label: "Working", value: summary.working || 0, state: summary.working ? "running" : "idle" },
      { label: "Queued", value: summary.queued || 0, state: summary.queued ? "active" : "idle" },
      { label: "Workers", value: summary.workers || orchSummary.active_workers || 0, state: (summary.workers || orchSummary.active_workers) ? "running" : "idle" },
      { label: "Blocked", value: summary.blocked || orchSummary.blocked || 0, state: (summary.blocked || orchSummary.blocked) ? "warning" : "ok" },
      { label: "Stale", value: orchSummary.stale_workers || 0, state: orchSummary.stale_workers ? "warning" : "ok" },
    ];

    return el("section", { className: "olympus-section olympus-party" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Party View"),
          el("p", null, "Real Hermes profiles, their trigger lanes, and current orchestration health. Nodes pulse only from local runtime state.")
        ),
        el("a", { className: "olympus-link", href: "/kanban" }, "Open Kanban")
      ),
      el("div", { className: "olympus-party-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-party-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(StatePill, { state: item.state })
        ))
      ),
      el("div", { className: "olympus-party-grid" },
        el("div", { className: "olympus-party-map", role: "img", "aria-label": "Party View map showing real Hermes profiles and trigger lanes." },
          el("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid meet", className: "olympus-party-svg" },
            el("defs", null,
              el("linearGradient", { id: "olympus-party-line", x1: "0%", y1: "0%", x2: "100%", y2: "0%" },
                el("stop", { offset: "0%", stopColor: "rgba(67,201,191,0.16)" }),
                el("stop", { offset: "100%", stopColor: "rgba(239,196,92,0.34)" })
              )
            ),
            el("g", { className: "olympus-party-gridlines" },
              Array.from({ length: 9 }).map((_, i) => el("line", { key: "v" + i, x1: 40 + i * 115, y1: 28, x2: 40 + i * 115, y2: H - 28 })),
              Array.from({ length: 5 }).map((_, i) => el("line", { key: "h" + i, x1: 36, y1: 70 + i * 72, x2: W - 36, y2: 70 + i * 70 }))
            ),
            lanes.map((lane) => el("g", { key: lane.key, className: "olympus-party-lane", style: { color: statusColor(lane.state) } },
              el("line", { x1: lane.x, y1: lane.y, x2: CX, y2: CY, className: "olympus-party-signal" }),
              el("circle", { cx: lane.x, cy: lane.y, r: 26, className: "olympus-party-lane-node" }),
              el("text", { x: lane.x, y: lane.y + 4, textAnchor: "middle", className: "olympus-party-lane-value" }, String(lane.value || 0)),
              el("text", { x: lane.x, y: lane.y + 45, textAnchor: "middle", className: "olympus-party-lane-label" }, lane.label)
            )),
            members.map((member, idx) => {
              const pos = member.position || {};
              const x = Math.max(90, Math.min(910, Number(pos.x || (28 + idx * 28)) * 10));
              const y = Math.max(120, Math.min(360, Number(pos.y || 50) * 4));
              return el("g", {
                key: member.id || idx,
                className: cx("olympus-party-node", nodePulse(member.state), selected.id === member.id && "olympus-party-node-selected"),
                style: { color: statusColor(member.state) },
                onClick: () => setSelectedId(member.id)
              },
                el("title", null, [member.label, member.state, (member.open_work || 0) + " open", (member.running_work || 0) + " running"].join(" / ")),
                el("line", { x1: CX, y1: CY, x2: x, y2: y, className: "olympus-party-member-line" }),
                el("circle", { cx: x, cy: y, r: 27, className: "olympus-party-node-halo" }),
                el("circle", { cx: x, cy: y, r: 16, className: "olympus-party-node-core" }),
                el("text", { x: x, y: y + 5, textAnchor: "middle", className: "olympus-party-node-name" }, member.label || "Agent"),
                (member.running_work || member.blocked_work) ? el("text", { x: x, y: y - 36, textAnchor: "middle", className: "olympus-party-node-count" }, String((member.running_work || 0) + (member.blocked_work || 0))) : null
              );
            }),
            el("g", { className: "olympus-party-core" },
              el("circle", { cx: CX, cy: CY, r: 44, className: "olympus-party-core-halo" }),
              el("circle", { cx: CX, cy: CY, r: 26, className: "olympus-party-core-dot" }),
              el("text", { x: CX, y: CY - 2, textAnchor: "middle", className: "olympus-party-core-title" }, "HQ"),
              el("text", { x: CX, y: CY + 14, textAnchor: "middle", className: "olympus-party-core-sub" }, String(orchSummary.active_workers || 0) + " workers")
            )
          )
        ),
        el("aside", { className: "olympus-party-inspector" },
          el("div", { className: "olympus-party-inspector-head" },
            el("div", null,
              el("span", null, "Selected Agent"),
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
        )) : el("p", { className: "olympus-muted" }, "No recent agent activity events detected.")
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
    const hasSignal = open || blocked || ready || workers.length || attention.length;

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
          el("p", null, "Read-only orchestration health: board pressure, blocked work, worker activity, and assignee load.")
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

    function load() {
      setLoading(true);
      SDK.fetchJSON(API + "/overview?ts=" + encodeURIComponent(String(Date.now())))
        .then((next) => { setData(next); setError(null); })
        .catch((err) => setError(String(err && err.message ? err.message : err)))
        .finally(() => setLoading(false));
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
      el(SkillCoverage, { coverage: data && data.skill_coverage }),
      el(ProfileFitness, { fitness: data && data.profile_fitness }),
      el(PartyView, { party: data && data.party, orchestration: data && data.orchestration, events: data && data.activity_events }),
      el(KanbanIntelligence, { kanban: data && data.kanban }),
      el(ScoreExplainer, { tuning })
    );
  }

  window.__HERMES_PLUGINS__.register("olympus", OlympusPage);
})();
