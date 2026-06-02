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

  function Hero({ health, score, loading, onRefresh }) {
    const status = health.status || (loading ? "checking" : "unknown");
    const statusLabel = health.status_label || status;
    return el("section", { className: "olympus-hero" },
      el("div", { className: "olympus-hero-copy" },
        el("div", { className: "olympus-kicker" }, "HermesOS Agent HQ"),
        el("h1", null, "Olympus"),
        el("p", null, "A read-only HermesOS cockpit for deciding what to tune next across routes, profiles, skills, schedules, tools, memory, Kanban, MCP, and gateways."),
        el("div", { className: "olympus-hero-actions" },
          el(StatePill, { state: status, label: statusLabel }),
          el(Button, { className: "olympus-refresh", onClick: onRefresh, disabled: loading }, loading ? "Refreshing" : "Refresh")
        ),
        health.summary ? el("p", { className: "olympus-health-summary" }, health.summary) : null
      ),
      el("div", { className: "olympus-oracle" },
        el("span", null, "Tuning score"),
        el("strong", null, String(score)),
        el("small", null, "read-only scan")
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

  function pantheonRank(state) {
    const k = String(state || "").toLowerCase();
    if (["error", "critical", "stale", "failed"].includes(k)) return 0;
    if (["warning", "checking", "idle", "paused"].includes(k)) return 1;
    return 2;
  }

  function PantheonStatus({ pantheon, score }) {
    const roles = asList(pantheon).slice().sort((a, b) => pantheonRank(a && a.state) - pantheonRank(b && b.state));
    const scoreState = score >= 85 ? "ok" : score >= 55 ? "warning" : "error";
    return el("section", { className: "olympus-section olympus-pantheon" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Pantheon"),
          el("p", null, "Live operational roles across routing, schedules, tools, memory, gateways, and freshness. Sorted so what needs attention comes first.")
        ),
        el(StatePill, { state: scoreState, label: "Readiness " + String(score) })
      ),
      roles.length ? el("div", { className: "olympus-pantheon-grid" },
        roles.map((p, idx) => el("div", { key: (p && p.name) || idx, className: cx("olympus-deity", "olympus-deity-" + String((p && p.state) || "unknown").toLowerCase()) },
          el("div", { className: "olympus-deity-head" },
            el("strong", null, (p && p.name) || "Role"),
            el(StatePill, { state: (p && p.state) || "unknown" })
          ),
          el("span", { className: "olympus-deity-role" }, (p && p.role) || ""),
          (p && p.metric) ? el("div", { className: "olympus-deity-metric" }, p.metric) : null
        ))
      ) : el("p", { className: "olympus-muted" }, "No pantheon roles reported.")
    );
  }

  function AgentHQ({ hq }) {
    const data = hq || {};
    const summary = data.summary || {};
    const agents = asList(data.agents);
    const opportunities = asList(data.opportunities);
    const cost = Number(summary.total_cost_usd || 0);
    const tiles = [
      { label: "Agents", value: summary.agents || agents.length || 0, state: agents.length ? "active" : "unknown" },
      { label: "Opportunities", value: summary.opportunities || opportunities.length || 0, state: opportunities.length ? "warning" : "ok" },
      { label: "Spend (window)", value: "$" + cost.toFixed(2), state: cost > 0 ? "active" : "idle" },
      { label: "Looping", value: summary.looping_sessions || 0, state: summary.looping_sessions ? "warning" : "ok" },
      { label: "Context Pressure", value: summary.context_pressure_sessions || 0, state: summary.context_pressure_sessions ? "warning" : "ok" },
      { label: "Active Sessions", value: summary.active_sessions || 0, state: summary.active_sessions ? "active" : "idle" },
      { label: "Tool Heavy", value: summary.tool_heavy_sessions || 0, state: summary.tool_heavy_sessions ? "warning" : "ok" },
      { label: "Long Threads", value: summary.long_threads || 0, state: summary.long_threads ? "warning" : "ok" },
      { label: "Kanban Open", value: summary.kanban_open || 0, state: summary.kanban_open ? "active" : "idle" },
    ];

    return el("section", { className: "olympus-section olympus-agent-hq" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Optimization Queue"),
          el("p", null, "Ranked tuning moves for agents, routes, skills, memory, schedules, tools, and Kanban work.")
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
        ),
        el("div", { className: "olympus-hq-pane" },
          el("h3", null, "Agent Readiness"),
          agents.length ? agents.map((agent) => {
            const k = agent.kanban || {};
            return el("div", { key: agent.id || agent.label, className: "olympus-agent-row" },
              el("div", null,
                el("strong", null, agent.label || "Agent"),
                el("small", null, [agent.model || "route unset", (agent.skill_count || 0) + " skills", (agent.cron_jobs || 0) + " cron"].join(" / "))
              ),
              el("div", { className: "olympus-agent-metrics" },
                el("span", null, (k.open || 0) + " open"),
                el("span", null, (k.ready || 0) + " ready"),
                el("span", null, (k.running || 0) + " running"),
                el("span", null, (k.blocked || 0) + " blocked")
              ),
              el("div", { className: "olympus-flags" },
                asList(agent.flags).map((flag) => el("span", { key: flag }, flag))
              )
            );
          }) : el("p", { className: "olympus-muted" }, "No agent profiles detected.")
        )
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

  function ProfileMatrix({ profiles }) {
    const list = asList(profiles);
    return el("section", { className: "olympus-section" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Profile Tuning Matrix"),
          el("p", null, "A compact profile comparison for runtime route, skill, gateway, and trust-boundary tuning.")
        )
      ),
      list.length ? el("div", { className: "olympus-profile-table" },
        list.map((p) => el("article", { key: p.id || p.label, className: "olympus-profile-row" },
          el("div", null,
            el("strong", null, p.label || "Profile"),
            el("span", null, p.trust_boundary || "unknown")
          ),
          el("div", null,
            el("small", null, "Route"),
            el("span", null, p.model || "unset")
          ),
          el("div", null,
            el("small", null, "Skills"),
            el("span", null, String(p.skill_count || 0))
          ),
          el("div", null,
            el("small", null, "Gateway"),
            el(StatePill, { state: p.gateway_state || "unknown" })
          ),
          el("div", { className: "olympus-flags" },
            asList(p.tuning_flags).map((flag) => el("span", { key: flag }, flag))
          )
        ))
      ) : el("p", { className: "olympus-muted" }, "No profiles detected.")
    );
  }

  function WorkEvidence({ sessions, cron, attention }) {
    const recentSessions = asList(sessions).slice(0, 5);
    const cronJobs = asList(cron).slice(0, 5);
    const findings = asList(attention).slice(0, 5);
    return el("section", { className: "olympus-section" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Evidence Rail"),
          el("p", null, "Small read-only slices of the data behind the tuning queue.")
        )
      ),
      el("div", { className: "olympus-evidence-grid" },
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Recent Work"),
          recentSessions.length ? recentSessions.map((s) => el("div", { key: s.id, className: "olympus-mini-row" },
            el("span", null, s.label || s.session_id),
            el("small", null, [
              s.model || "route unset",
              (s.tool_call_count || 0) + " tools",
              (s.message_count || 0) + " msgs",
              s.cost_usd ? "$" + Number(s.cost_usd).toFixed(2) : null,
              s.total_tokens ? Number(s.total_tokens).toLocaleString() + " tok" : null
            ].filter(Boolean).join(" / ")),
            el(StatePill, { state: s.state })
          )) : el("p", { className: "olympus-muted" }, "No recent sessions detected.")
        ),
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Schedule Pressure"),
          cronJobs.length ? cronJobs.map((j) => el("div", { key: j.id, className: "olympus-mini-row" },
            el("span", null, j.label || j.job_id),
            el("small", null, [j.schedule, j.profile].filter(Boolean).join(" / ") || "no schedule"),
            el(StatePill, { state: j.state })
          )) : el("p", { className: "olympus-muted" }, "No cron jobs detected.")
        ),
        el("div", { className: "olympus-evidence-pane" },
          el("h3", null, "Watchtower"),
          findings.length ? findings.map((item, idx) => el("div", { key: idx, className: "olympus-mini-row" },
            el("span", null, item.label || "Finding"),
            el("small", null, item.detail || "no detail"),
            el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
          )) : el("p", { className: "olympus-muted" }, "No current attention items.")
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
      el(KanbanIntelligence, { kanban: data && data.kanban }),
      el(ProfileMatrix, { profiles: tuning.profiles }),
      el(ScoreExplainer, { tuning }),
      el(PantheonStatus, { pantheon: tuning.pantheon, score }),
      el(WorkEvidence, { sessions: data && data.sessions, cron: data && data.cron, attention: data && data.attention })
    );
  }

  window.__HERMES_PLUGINS__.register("olympus", OlympusPage);
})();
