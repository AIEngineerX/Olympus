(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React } = SDK;
  const { useEffect, useRef, useState } = SDK.hooks;
  const C = SDK.components || {};
  const Badge = C.Badge || "span";
  const Button = C.Button || "button";

  const API = "/api/plugins/olympus";
  const POLL_INTERVAL_MS = 10000;
  const STATIC_BACKEND_REQUIRED = [
    "Readiness scoring and deductions",
    "Kanban, Trace Spine, and worker synthesis",
    "Skill hygiene and profile fitness scoring",
    "Tool policy and auxiliary cost recommendations",
    "Operational evals and production diagnostics"
  ];
  const OLYMPUS_MODES = [
    { id: "brief", label: "Brief", summary: "Top actions" },
    { id: "agents", label: "Agents", summary: "Profiles" },
    { id: "skills", label: "Skills", summary: "Reuse" },
    { id: "kanban", label: "Kanban", summary: "Work" },
    { id: "policy", label: "Policy", summary: "Risk" },
    { id: "diagnostics", label: "Diagnostics", summary: "Evidence" }
  ];

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

  // Metric tiles show a chip only when the value needs attention; healthy,
  // idle and unknown values stay quiet so warnings keep their meaning.
  const PROBLEM_STATES = new Set(["warning", "critical", "error", "failed", "stale", "blocked"]);

  function MetricPill({ state, label }) {
    return PROBLEM_STATES.has(String(state || "").toLowerCase()) ? el(StatePill, { state, label }) : null;
  }

  function severityClass(severity) {
    return "olympus-severity olympus-severity-" + String(severity || "info").toLowerCase();
  }

  const SAFE_ROUTES = new Set(["/analytics", "/config", "/cron", "/kanban", "/logs", "/profiles", "/sessions", "/skills"]);

  // Hermes serves the dashboard at the host root or under a reverse-proxy
  // prefix it injects as window.__HERMES_BASE_PATH__; page links must carry
  // that prefix (SDK.fetchJSON already adds it to API calls). A ?profile=
  // scope on the current page is kept so links open the same profile.
  function basePath() {
    const raw = window.__HERMES_BASE_PATH__ || "";
    if (!raw) return "";
    return (raw.startsWith("/") ? raw : "/" + raw).replace(/\/+$/, "");
  }

  function profileQuery() {
    const profile = new URLSearchParams(window.location.search).get("profile");
    return profile ? "?profile=" + encodeURIComponent(profile) : "";
  }

  function routeLink(path) {
    if (!path) return "#";
    const route = path.startsWith("/") ? path : "/" + path;
    return SAFE_ROUTES.has(route) ? basePath() + route + profileQuery() : "#";
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

  // Tuning items name sessions by hashed ref. The raw session ID is looked up
  // only when the operator clicks, and opens in Hermes chat.
  function SessionLink({ target }) {
    const [state, setState] = useState("idle");
    function open() {
      setState("opening");
      SDK.fetchJSON(API + "/open/session?ref=" + encodeURIComponent(target.ref))
        .then((result) => {
          if (result && result.href) {
            window.location.assign(basePath() + result.href);
            return;
          }
          setState("missing");
        })
        .catch(() => setState("missing"));
    }
    return el("button", { type: "button", className: "olympus-session-link", onClick: open, disabled: state !== "idle" },
      state === "missing" ? "Session no longer available" : state === "opening" ? "Opening\u2026" : "Open " + (target.label || "session") + " session"
    );
  }

  function SessionLinks({ targets }) {
    const sessions = asList(targets).filter((target) => target && target.kind === "session" && target.ref);
    if (!sessions.length) return null;
    return el("div", { className: "olympus-session-links" },
      sessions.map((target) => el(SessionLink, { key: target.ref, target }))
    );
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

  function toErrorMessage(error) {
    return String(error && error.message ? error.message : error || "request failed");
  }

  function safeFetchJSON(path) {
    return SDK.fetchJSON(path)
      .then((value) => ({ ok: true, path, value }))
      .catch((error) => ({ ok: false, path, error: toErrorMessage(error) }));
  }

  function buildStaticCompatibilityData(reason, results) {
    const plugins = asList(results.plugins && results.plugins.value);
    const olympus = plugins.find((item) => item && item.name === "olympus") || null;
    const status = results.status && results.status.ok && results.status.value || {};
    const profiles = asList(results.profiles && results.profiles.value && results.profiles.value.profiles);
    const skills = asList(results.skills && results.skills.value);
    const sessionStats = results.sessionStats && results.sessionStats.ok && results.sessionStats.value || {};
    const cronJobsRaw = results.cronJobs && results.cronJobs.ok && results.cronJobs.value;
    const cronJobs = Array.isArray(cronJobsRaw) ? cronJobsRaw : asList(cronJobsRaw && cronJobsRaw.jobs);
    const apiResults = [results.plugins, results.status, results.profiles, results.skills, results.sessionStats, results.cronJobs]
      .filter(Boolean);
    const availableCount = apiResults.filter((item) => item.ok).length;
    const frontendApis = apiResults.map((item) => ({
      id: item.path,
      label: item.path,
      type: "Hermes dashboard API",
      state: item.ok ? "ok" : "warning",
      counts: item.ok ? { responses: 1 } : { errors: 1 },
      fields: item.ok ? ["read-only JSON"] : [],
      redaction: item.ok ? "available" : item.error || "unavailable",
      recommended_view: item.path === "/api/dashboard/plugins" ? "/config" : ""
    }));
    const profileRows = profiles.slice(0, 6).map((profile, idx) => ({
      id: "profile:" + idx,
      label: "Profile " + String(idx + 1),
      role_state: null,
      route: "inherited",
      gateway_state: "unknown",
      running: 0,
      open: 0,
      blocked: 0,
      sessions_7d: 0,
      spend_7d_usd: 0,
      last_active_at: null,
      state: "unknown",
      top_issue: null,
      reasons: [],
      recommended_view: "/profiles"
    }));

    return {
      generated_at: new Date().toISOString(),
      static_compatibility: {
        enabled: true,
        reason: reason || "Olympus backend route unavailable",
        frontend_available: ["/api/dashboard/plugins", "/api/status", "/api/profiles", "/api/skills", "/api/sessions/stats", "/api/cron/jobs"],
        backend_required: STATIC_BACKEND_REQUIRED
      },
      health: {
        status: "warning",
        status_label: "Backend unavailable",
        summary: "Olympus backend synthesis is unavailable, so this tab is showing a read-only compatibility view from existing Hermes dashboard APIs."
      },
      tuning: {
        score: 0,
        score_breakdown: {
          base: 0,
          score: 0,
          label: "Backend unavailable",
          explanation: "Readiness scoring requires /api/plugins/olympus/overview. Current user-plugin installs should mount it when manifest.api is safe; project plugins stay static-only.",
          deductions: [{ label: "Olympus backend unavailable", points: 0, reason: reason || "backend unavailable", evidence: "/api/plugins/olympus/overview unavailable", source: "frontend compatibility fallback" }]
        },
        methodology: {
          thresholds: STATIC_BACKEND_REQUIRED.map((item) => ({ signal: item, threshold: "requires mounted Olympus backend", why: "First-party Hermes dashboard APIs expose page data, not Olympus' redacted synthesis model." })),
          sources: frontendApis.map((item) => ({ label: item.label, detail: item.redaction }))
        },
        agent_hq: {
          summary: { agents: profiles.length, recommendations: 2, total_tokens: 0, looping_sessions: 0, context_pressure_sessions: 0, total_cost_usd: 0 },
          metrics: { median_duration_seconds: 0, p90_duration_seconds: 0, total_tokens: 0, total_tool_calls: 0, failed_kanban_runs: 0 },
          agents: [],
          recommendations: [
            { kind: "compatibility", severity: "warning", title: "Backend unavailable", detail: "Hermes served the Olympus tab, but the Olympus backend routes did not mount. Check plugin source, safe API path, dashboard restart state, and Hermes version.", evidence: reason || "backend unavailable", recommended_view: "/config", action_label: "Open Config" },
            { kind: "integration", severity: "info", title: "Fallback APIs are limited", detail: "Existing Hermes dashboard APIs provide counts and links; Olympus scoring and evidence synthesis require mounted backend routes.", evidence: availableCount + " of " + apiResults.length + " fallback APIs responded", recommended_view: "/profiles", action_label: "Open Profiles" }
          ]
        }
      },
      fleet: { summary: { profiles: profiles.length, needs_review: 0, roles_missing: 0, roles_unreviewed: 0 }, profiles: profileRows },
      skill_coverage: {
        summary: { profiles: profiles.length, total_skills: skills.length, zero_skill_profiles: 0, forced_skill_tasks: 0, looping_sessions: 0, tool_heavy_sessions: 0, long_threads: 0, context_pressure_sessions: 0 },
        suggestions: [{ kind: "compatibility", severity: "info", title: "Skill counts available; skill coverage synthesis unavailable", detail: "The frontend can read /api/skills, but repeated-use recommendations require the Olympus backend collectors.", evidence: formatCount(skills.length) + " skills returned by /api/skills", recommended_view: "/skills", action_label: "Open Skills" }],
        profiles: []
      },
      skill_hygiene: { summary: { state: "unknown", issues: 0, total_skills: skills.length, archived: 0, stale: 0, never_used: 0, recently_patched: 0, hub_installed: 0, hub_missing_trust: 0, hub_missing_scan: 0, hub_audit_pass: 0, hub_audit_warn: 0, hub_audit_fail: 0, forced_skill_metadata_gaps: 0 }, signals: [], usage: [], hub: [] },
      performance: {
        summary: { state: "unknown", window_sessions: sessionStats.total || 0, completed_sessions: 0, total_tokens: 0, total_tool_calls: 0, avg_tools_per_session: 0, avg_tokens_per_call: 0, total_cost_usd: 0 },
        lanes: [
          { id: "sessions", label: "Sessions", value: sessionStats.total || 0, unit: "count", state: sessionStats.total ? "active" : "idle", detail: "Count from /api/sessions/stats; no transcript content read.", source: "Hermes dashboard API", recommended_view: "/sessions" },
          { id: "cron", label: "Cron Jobs", value: cronJobs.length, unit: "count", state: cronJobs.length ? "active" : "idle", detail: "Job count from /api/cron/jobs; scheduling synthesis requires backend mode.", source: "Hermes dashboard API", recommended_view: "/cron" }
        ],
        signals: []
      },
      diagnostics: { state: "warning", generated_ms: 0, payload_bytes: 0, budgets: { api_response_ms: 750, client_render_ms: 150 }, budget_status: { api_response: "unknown", payload: "unknown" }, counts: { kanban_boards_scanned: 0, kanban_board_read_failures: 0 }, hermes: { version: status.version || "unknown" } },
      evidence_sources: {
        summary: { sources: frontendApis.length, available: availableCount, warnings: apiResults.length - availableCount, missing: 0 },
        items: [{ id: "olympus-manifest", label: "Olympus manifest", type: "dashboard plugin discovery", state: olympus ? "ok" : "warning", counts: { plugins: plugins.length }, fields: olympus ? ["source: " + (olympus.source || "unknown"), "has_api: " + String(Boolean(olympus.has_api))] : [], redaction: olympus ? "Manifest visible through /api/dashboard/plugins." : "Olympus manifest not found in /api/dashboard/plugins.", recommended_view: "/config" }, ...frontendApis]
      },
      config_policy: {
        summary: { state: "warning", findings: 1, toolsets: 0, enabled_toolsets: 0, risky_toolsets: 0, max_turns: 0, aux_configured: 0, aux_missing: 0, gateway_platforms: Object.keys(status.gateway_platforms || {}).length, browser_privacy_flags: 0 },
        settings: [],
        findings: [{ kind: "compatibility", severity: "warning", title: "Policy synthesis hidden in static mode", detail: "The frontend does not inspect config/env details directly. Use Hermes-owned config pages or bundled Olympus backend mode.", evidence: "Static compatibility fallback", recommended_view: "/config", action_label: "Open Config" }]
      },
      ops_evals: null,
      metrics_spine: null,
      trace_spine: null,
      kanban: null,
      party: null,
      orchestration: null,
      activity_events: []
    };
  }

  function loadStaticCompatibility(reason) {
    return Promise.all([
      safeFetchJSON("/api/dashboard/plugins"),
      safeFetchJSON("/api/status"),
      safeFetchJSON("/api/profiles"),
      safeFetchJSON("/api/skills"),
      safeFetchJSON("/api/sessions/stats"),
      safeFetchJSON("/api/cron/jobs")
    ]).then((items) => buildStaticCompatibilityData(reason, { plugins: items[0], status: items[1], profiles: items[2], skills: items[3], sessionStats: items[4], cronJobs: items[5] }));
  }

  function StaticCompatibilityNotice({ compatibility }) {
    const info = compatibility || {};
    if (!info.enabled) return null;
    return el("section", { className: "olympus-section olympus-static-compatibility" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Backend Unavailable"),
          el("p", null, "Hermes served the Olympus tab, but /api/plugins/olympus/* is unavailable. User-plugin backends should mount on current Hermes when manifest.api is safe; project plugins stay static-only.")
        ),
        el(StatePill, { state: "warning", label: "frontend only" })
      ),
      el("div", { className: "olympus-policy-grid" },
        el("div", { className: "olympus-policy-pane" },
          el("h3", null, "Works with existing Hermes APIs"),
          asList(info.frontend_available).map((item) => el("div", { key: item, className: "olympus-mini-row" }, el("span", null, item), el("small", null, "read-only dashboard API")))
        ),
        el("div", { className: "olympus-policy-pane" },
          el("h3", null, "Requires mounted backend"),
          asList(info.backend_required).map((item) => el("div", { key: item, className: "olympus-mini-row" }, el("span", null, item), el("small", null, "not synthesized in static mode")))
        )
      ),
      info.reason ? el("p", { className: "olympus-muted" }, info.reason) : null
    );
  }

  function needsYou(tuning) {
    const hq = (tuning && tuning.agent_hq) || {};
    return asList(hq.recommendations).filter((item) => item.severity === "critical" || item.severity === "warning");
  }

  // A 14-day readiness trend drawn as a bare polyline: no text inside the SVG
  // (labels stay HTML), hidden from assistive tech because the change is
  // announced in words next to it.
  function Sparkline({ points }) {
    const values = points.filter((value) => typeof value === "number");
    if (values.length < 2) return null;
    const width = 120;
    const height = 28;
    // Scale to the recent range so a few points of movement stay visible.
    const min = Math.max(0, Math.min(...values) - 5);
    const max = Math.min(100, Math.max(...values) + 5);
    const step = width / (values.length - 1);
    const coords = values.map((value, idx) => (idx * step).toFixed(1) + "," + (height - ((value - min) / (max - min || 1)) * height).toFixed(1));
    return el("svg", { className: "olympus-sparkline", viewBox: "0 0 " + width + " " + height, width, height, "aria-hidden": "true", focusable: "false" },
      el("polyline", { points: coords.join(" "), fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" })
    );
  }

  function trendLabel(history) {
    const change = history && history.score_change_7d;
    if (typeof change !== "number") {
      return Number((history && history.recorded_days) || 0) ? "trend after 1 more day" : "trend starts today";
    }
    if (change === 0) return "no change in 7 days";
    return (change > 0 ? "+" : "\u2212") + Math.abs(change) + " in 7 days";
  }

  function Hero({ health, tuning, history, loading, onRefresh }) {
    const status = health.status || (loading ? "checking" : "unknown");
    const statusLabel = health.status_label || status;
    const breakdown = tuning.score_breakdown || {};
    const metrics = (tuning.agent_hq && tuning.agent_hq.metrics) || {};
    const urgent = needsYou(tuning);
    const sessions24h = Number(metrics.sessions_24h || 0);
    const facts = [
      ["Needs you", urgent.length ? urgent.length + (urgent.length === 1 ? " item" : " items") : "Nothing urgent"],
      ["Spend, last 24h", sessions24h ? formatMoney(metrics.spend_24h_usd) + " across " + sessions24h + (sessions24h === 1 ? " session" : " sessions") : "No sessions"],
      ["Session window", (metrics.window && metrics.window.label) || breakdown.window || "No sessions yet"],
    ];
    return el("section", { className: "olympus-hero" },
      el("div", { className: "olympus-hero-copy" },
        el("div", { className: "olympus-hero-title" },
          el("h1", null, "Olympus"),
          el(StatePill, { state: status, label: statusLabel }),
          el(Button, { className: "olympus-refresh", onClick: onRefresh, disabled: loading }, loading ? "Refreshing" : "Refresh")
        ),
        health.summary ? el("p", { className: "olympus-health-summary" }, health.summary) : null,
        el("dl", { className: "olympus-hero-facts" },
          facts.map((fact) => el("div", { key: fact[0] },
            el("dt", null, fact[0]),
            el("dd", null, fact[1])
          ))
        )
      ),
      el("div", { className: "olympus-oracle" },
        el("span", null, "Readiness"),
        el("strong", null, typeof tuning.score === "number" ? String(tuning.score) : "\u2013"),
        el("small", null, breakdown.label || "local evidence"),
        el(Sparkline, { points: asList(history && history.days).map((day) => day.score) }),
        el("small", { className: "olympus-trend" }, trendLabel(history))
      )
    );
  }

  function FixButton({ item, tracked, onFixes }) {
    const [state, setState] = useState("idle");
    if (!item.key || item.severity === "ok") return null;
    if (tracked) return el("span", { className: "olympus-fix-tracked" }, "Tracking your fix");
    function track() {
      setState("saving");
      SDK.fetchJSON(API + "/fixes?key=" + encodeURIComponent(item.key), { method: "POST" })
        .then((result) => {
          if (result && result.tracked) {
            setState("idle");
            onFixes(result.fixes);
            return;
          }
          setState("gone");
        })
        .catch(() => setState("failed"));
    }
    return el("button", { type: "button", className: "olympus-fix-button", onClick: track, disabled: state !== "idle" },
      state === "saving" ? "Saving\u2026" : state === "gone" ? "Already cleared" : state === "failed" ? "Could not save" : "I fixed this"
    );
  }

  function renderTuningItem(item, idx, fixKeys, onFixes) {
    return el("article", { key: idx, className: cx("olympus-tuning-item", "olympus-tuning-item-" + String(item.severity || "info").toLowerCase()) },
      el("div", { className: "olympus-item-head" },
        el("div", null,
          el("span", null, String(item.kind || "signal")),
          el("h4", null, item.title || "Tuning item")
        ),
        el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
      ),
      el("p", null, item.detail || ""),
      (item.evidence || item.basis) ? el("small", { className: "olympus-evidence-line" }, [item.evidence, item.basis].filter(Boolean).join(" \u00b7 ")) : null,
      el("div", { className: "olympus-item-actions" },
        el(SessionLinks, { targets: item.targets }),
        onFixes ? el(FixButton, { item, tracked: fixKeys.has(item.key), onFixes }) : null,
        item.recommended_view ? el("a", { className: "olympus-inline-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
      )
    );
  }

  function NeedsYou({ tuning, fixes, onFixes }) {
    const hq = (tuning && tuning.agent_hq) || {};
    const items = asList(hq.recommendations);
    if (!items.length) return null;
    const urgent = needsYou(tuning);
    const primary = items.slice(0, 3);
    const backlog = items.slice(3);
    return el("section", { className: "olympus-section olympus-needs-you" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, urgent.length ? "Needs you (" + urgent.length + ")" : "Nothing urgent"),
          el("p", null, urgent.length ? "Ranked by severity. Each item names its evidence and the Hermes page that owns the fix." : "No warning or critical findings in this scan.")
        )
      ),
      el("div", { className: "olympus-hq-tuning-items" },
        primary.map((item, idx) => renderTuningItem(item, idx, new Set(asList(fixes).map((fix) => fix.key)), onFixes)),
        backlog.length ? el("details", { className: "olympus-details olympus-backlog-details" },
          el("summary", null, "More findings (" + backlog.length + ")"),
          backlog.map((item, idx) => el("div", { key: idx, className: "olympus-mini-row" },
            el("span", null, item.title || "Tuning item"),
            el("small", null, [item.severity, item.kind, item.evidence].filter(Boolean).join(" / ")),
            item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
          ))
        ) : null
      )
    );
  }

  const VERDICT_STATE = { cleared: "ok", improved: "ok", unchanged: "warning", worse: "critical", "still present": "warning" };

  function StopTrackingButton({ fixKey, rows, onFixes }) {
    const [state, setState] = useState("idle");
    function stop() {
      setState("saving");
      SDK.fetchJSON(API + "/fixes?key=" + encodeURIComponent(fixKey), { method: "DELETE" })
        .then(() => onFixes(rows.filter((row) => row.key !== fixKey)))
        .catch(() => setState("failed"));
    }
    return el("button", { type: "button", className: "olympus-fix-stop", onClick: stop, disabled: state === "saving" },
      state === "failed" ? "Could not stop; retry" : "Stop tracking"
    );
  }

  function FixTracking({ fixes, onFixes }) {
    const rows = asList(fixes);
    if (!rows.length) return null;
    return el("section", { className: "olympus-section olympus-fix-tracking" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Did your fixes work?"),
          el("p", null, "Each finding you marked fixed, compared with the latest scan.")
        )
      ),
      rows.map((row) => el("div", { key: row.key, className: "olympus-fix-row" },
        el("div", null,
          el("strong", null, row.title),
          el("small", null, [
            row.baseline == null ? null : row.baseline + " \u2192 " + row.current,
            row.days_tracked ? "tracked " + row.days_tracked + (row.days_tracked === 1 ? " day" : " days") : "tracked since today",
          ].filter(Boolean).join(" \u00b7 "))
        ),
        el(StatePill, { state: VERDICT_STATE[row.verdict] || "unknown", label: row.verdict }),
        el(StopTrackingButton, { fixKey: row.key, rows, onFixes })
      ))
    );
  }

  function ScoreExplainer({ tuning }) {
    const breakdown = (tuning && tuning.score_breakdown) || {};
    const methodology = (tuning && tuning.methodology) || {};
    const deductions = asList(breakdown.deductions);
    const thresholds = asList(methodology.thresholds);
    const sources = asList(methodology.sources);
    return el("section", { className: "olympus-section olympus-score-card olympus-score-card-compact" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Readiness Score"),
          el("p", null, breakdown.explanation || "Heuristic score from local Hermes evidence.")
        )
      ),
      deductions.length ? el("div", { className: "olympus-score-deductions" },
        deductions.slice(0, 4).map((item, idx) => el("div", { key: idx, className: "olympus-score-deduction" },
          el("span", { className: "olympus-reason-points" }, "\u2212" + String(item.points || 0) + " pts"),
          el("div", null,
            el("strong", null, item.label || "Deduction"),
            el("small", null, [item.evidence, item.reason].filter(Boolean).join(" \u00b7 "))
          )
        )),
        deductions.length > 4 ? el("small", { className: "olympus-muted" }, "+" + (deductions.length - 4) + " smaller deductions under Method and sources") : null
      ) : el("p", { className: "olympus-muted" }, "No deductions in this scan."),
      el("details", { className: "olympus-details olympus-score-details" },
        el("summary", null, "Method and sources"),
        el("div", { className: "olympus-score-grid" },
          el("div", { className: "olympus-score-pane" },
            el("h3", null, "All deductions"),
            deductions.length ? deductions.map((item, idx) => el("div", { key: idx, className: "olympus-method-row" },
              el("strong", null, item.label || "Deduction"),
              el("span", null, "\u2212" + String(item.points || 0) + " pts"),
              el("small", null, [item.reason, item.source].filter(Boolean).join(" \u00b7 "))
            )) : el("p", { className: "olympus-muted" }, "None.")
          ),
          el("div", { className: "olympus-score-pane" },
            el("h3", null, "Thresholds"),
            thresholds.map((item, idx) => el("div", { key: idx, className: "olympus-method-row" },
              el("strong", null, item.signal || "Signal"),
              el("span", null, item.threshold || ""),
              el("small", null, item.why || "")
            )),
            sources.length ? el("h3", null, "Sources") : null,
            sources.map((item, idx) => el("div", { key: "source-" + idx, className: "olympus-source-row" },
              el("strong", null, item.label || "Source"),
              el("small", null, item.detail || "")
            ))
          )
        )
      )
    );
  }

  // WAI-ARIA tabs pattern: only the selected tab is in the Tab order; arrow
  // keys, Home and End move between tabs and select them.
  function ModeTabs({ activeMode, onChange }) {
    function onKeyDown(event) {
      const index = OLYMPUS_MODES.findIndex((mode) => mode.id === activeMode);
      const last = OLYMPUS_MODES.length - 1;
      const targets = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last };
      if (!(event.key in targets)) return;
      event.preventDefault();
      const next = OLYMPUS_MODES[targets[event.key]].id;
      onChange(next);
      document.getElementById("olympus-mode-tab-" + next).focus();
    }

    return el("div", { className: "olympus-mode-shell" },
      el("div", { className: "olympus-mode-tabs", role: "tablist", "aria-label": "Olympus dashboard modes", onKeyDown },
        OLYMPUS_MODES.map((mode) => el("button", {
          key: mode.id,
          id: "olympus-mode-tab-" + mode.id,
          className: cx("olympus-mode-tab", activeMode === mode.id && "olympus-mode-tab-active"),
          type: "button",
          role: "tab",
          tabIndex: activeMode === mode.id ? 0 : -1,
          "aria-label": mode.label,
          "aria-selected": activeMode === mode.id ? "true" : "false",
          "aria-controls": "olympus-mode-panel-" + mode.id,
          onClick: () => onChange(mode.id)
        },
          el("span", null, mode.label),
          el("small", null, mode.summary)
        ))
      )
    );
  }

  function ModePanel({ id, activeMode, children }) {
    const mode = OLYMPUS_MODES.find((item) => item.id === id) || OLYMPUS_MODES[0];
    if (activeMode !== id) return null;
    return el("div", {
      className: cx("olympus-mode-panel", "olympus-mode-panel-" + id),
      id: "olympus-mode-panel-" + id,
      role: "tabpanel",
      "aria-labelledby": "olympus-mode-tab-" + id
    },
      children
    );
  }

  function AgentHQ({ hq }) {
    const data = hq || {};
    const summary = data.summary || {};
    const metrics = data.metrics || {};
    const agents = asList(data.agents);
    const medianDuration = Number(metrics.median_duration_seconds || 0);
    const p90Duration = Number(metrics.p90_duration_seconds || 0);
    const failedRuns = Number(metrics.failed_kanban_runs || 0);
    const costRisks = Number(summary.expensive_sessions || metrics.expensive_sessions || 0);
    const tiles = [
      { label: "Profiles", value: summary.agents || agents.length || 0, state: "ok" },
      { label: "Median run", value: formatDuration(medianDuration), state: medianDuration > 900 ? "warning" : "ok" },
      { label: "P90 run", value: formatDuration(p90Duration), state: p90Duration > 1800 ? "warning" : "ok" },
      { label: "Tool calls", value: formatCount(metrics.total_tool_calls), state: "ok" },
      { label: "Looping", value: summary.looping_sessions || 0, state: summary.looping_sessions ? "warning" : "ok" },
      { label: "Context pressure", value: summary.context_pressure_sessions || 0, state: summary.context_pressure_sessions ? "warning" : "ok" },
      { label: "Failed worker runs", value: failedRuns, state: failedRuns ? "warning" : "ok" },
      { label: "Runs over $1", value: costRisks, state: costRisks ? "warning" : "ok" },
    ];
    // The first screen shows six tiles; the rest stay one click away.
    const primaryTiles = tiles.slice(0, 6);
    const secondaryTiles = tiles.slice(6);
    const window = metrics.window || {};

    return el("section", { className: "olympus-section olympus-agent-hq" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Agent Monitor"),
          el("p", null, window.label ? "Session signals from the " + window.label + "; Kanban counts are live." : "No sessions recorded yet; Kanban counts are live.")
        )
      ),
      el("div", { className: "olympus-hq-tiles" },
        primaryTiles.map((item) => el("div", { key: item.label, className: "olympus-hq-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(MetricPill, { state: item.state })
        ))
      ),
      el("details", { className: "olympus-details olympus-backlog-details olympus-metric-backlog" },
        el("summary", null, "More monitor signals (" + secondaryTiles.length + ")"),
        el("div", { className: "olympus-hq-mini-grid" },
          secondaryTiles.map((item) => el("div", { key: item.label, className: "olympus-hq-mini-tile" },
            el("span", null, item.label),
            el("strong", null, String(item.value)),
            el(MetricPill, { state: item.state })
          ))
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

  function CostAttribution({ attribution }) {
    const data = attribution || {};
    const cron = data.cron || {};
    const background = data.background || {};
    const jobs = asList(cron.jobs);
    const tasks = asList(background.tasks);
    if (!Number(data.window_cost_usd || 0) && !jobs.length && !tasks.length) return null;
    const days = data.window_days || 7;
    const facts = [
      ["Session spend", formatMoney(data.window_cost_usd)],
      ["Scheduled (cron)", formatMoney(cron.total_cost_usd)],
      ["Background tasks", formatMoney(background.total_cost_usd)],
    ];
    return el("section", { className: "olympus-section olympus-cost" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Where spend goes"),
          el("p", null, "Last " + days + " days. Hermes Analytics has the full ledger; this shows which scheduled jobs and background tasks drive it.")
        ),
        el("a", { className: "olympus-link", href: routeLink(data.recommended_view || "/analytics") }, "Open Analytics")
      ),
      el("dl", { className: "olympus-hero-facts olympus-cost-facts" },
        facts.map((fact) => el("div", { key: fact[0] }, el("dt", null, fact[0]), el("dd", null, fact[1])))
      ),
      jobs.length ? el("div", { className: "olympus-cost-table", role: "table", "aria-label": "Cron jobs by estimated cost" },
        el("div", { className: "olympus-cost-row olympus-cost-row-head", role: "row" },
          ["Cron job", "Runs", "Tokens", "Avg run", "Errors", "\u2248 Cost"].map((label) => el("span", { key: label, role: "columnheader" }, label))
        ),
        jobs.map((job) => el("div", { key: job.job_ref, className: "olympus-cost-row", role: "row" },
          el("span", { role: "cell" }, el("strong", null, job.label), el("small", null, [job.profile, job.schedule].filter(Boolean).join(" · "))),
          el("span", { role: "cell" }, formatCount(job.fires)),
          el("span", { role: "cell" }, formatCount(job.tokens)),
          el("span", { role: "cell" }, formatDuration(job.avg_duration_seconds)),
          el("span", { role: "cell" }, job.errors ? el(StatePill, { state: "warning", label: String(job.errors) }) : "0"),
          el("span", { role: "cell" }, formatMoney(job.est_cost_usd))
        ))
      ) : null,
      tasks.length ? el("div", { className: "olympus-cost-tasks" },
        el("h3", null, "Background tasks"),
        tasks.map((task) => el("div", { key: task.task, className: "olympus-cost-task" },
          el("span", null, task.task.replaceAll("_", " ")),
          el("small", null, formatCount(task.calls) + " calls \u00b7 " + formatCount(task.tokens) + " tokens"),
          el("strong", null, formatMoney(task.cost_usd))
        ))
      ) : null,
      cron.allocation && jobs.length ? el("small", { className: "olympus-muted olympus-cost-note" }, cron.allocation) : null
    );
  }

  function PerformanceTracking({ performance }) {
    const data = performance || {};
    const summary = data.summary || {};
    const lanes = asList(data.lanes);
    const signals = asList(data.signals);
    if (!lanes.length && !signals.length) return null;

    function laneValue(item) {
      if (item.unit === "seconds") return formatDuration(item.value);
      if (item.unit === "usd") return formatMoney(item.value);
      return formatCount(item.value);
    }

    return el("section", { className: "olympus-section olympus-performance" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Performance Tracking"),
          el("p", null, "Latency, tool pressure, context risk, and reliability from the latest scan.")
        ),
        el(MetricPill, { state: summary.state || "unknown" })
      ),
      el("div", { className: "olympus-performance-grid" },
        lanes.map((item) => el("article", { key: item.id || item.label, className: cx("olympus-performance-lane", "olympus-performance-lane-" + String(item.state || "unknown").toLowerCase()) },
          el("div", { className: "olympus-performance-lane-head" },
            el("span", null, item.label || "Signal"),
            el(MetricPill, { state: item.state })
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
      ) : null
    );
  }

  function ProductionDiagnostics({ diagnostics, clientDiagnostics, evidenceSources }) {
    const diag = diagnostics || {};
    const client = clientDiagnostics || {};
    if (!diag.generated_ms && !client.fetch_ms && !(evidenceSources && asList(evidenceSources.items).length)) return null;

    return el("section", { className: "olympus-section olympus-diagnostics" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Production Diagnostics"),
          el("p", null, "Payload, fetch, render, board, and source health for this scan.")
        ),
        el(StatePill, { state: diag.state || client.render_state || "unknown" })
      ),
      (diag.generated_ms || client.fetch_ms) ? el("div", { className: "olympus-diagnostic-grid" },
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
          el(MetricPill, { state: item.state })
        ))
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
        el(MetricPill, { state: summary.state || "unknown" })
      ),
      el("div", { className: "olympus-trace-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-trace-tile" },
          el("span", null, item.label),
          el("strong", null, item.value),
          el(MetricPill, { state: item.state })
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

  function OpsEvals({ evals }) {
    const data = evals || {};
    const summary = data.summary || {};
    const items = asList(data.items);
    if (!items.length) return null;

    const tiles = [
      { label: "Checks", value: summary.checks || items.length, state: items.length ? "active" : "idle" },
      { label: "Passed", value: summary.passed || 0, state: summary.passed ? "ok" : "idle" },
      { label: "Warnings", value: summary.warnings || 0, state: summary.warnings ? "warning" : "ok" },
      { label: "Failures", value: summary.failures || 0, state: summary.failures ? "critical" : "ok" },
    ];

    return el("section", { className: "olympus-section olympus-ops-evals" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Operational Evals"),
          el("p", null, "Deterministic reliability, routing, skill-use, and efficiency checks from current Hermes evidence.")
        ),
        el(MetricPill, { state: summary.state || "unknown" })
      ),
      el("div", { className: "olympus-ops-eval-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-ops-eval-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(MetricPill, { state: item.state })
        ))
      ),
      el("div", { className: "olympus-ops-eval-grid" },
        items.map((item) => el("article", { key: item.id || item.label, className: cx("olympus-ops-eval-item", "olympus-ops-eval-item-" + String(item.state || "unknown").toLowerCase()) },
          el("div", { className: "olympus-item-head" },
            el("div", null,
              el("span", null, item.id ? String(item.id).replaceAll("_", " ") : "check"),
              el("h3", null, item.label || "Operational check")
            ),
            el(StatePill, { state: item.state || "unknown" })
          ),
          el("p", null, item.evidence || item.detail || ""),
          asList(item.signals).length || item.basis ? el("small", null, [
            asList(item.signals).length ? "Signals: " + asList(item.signals).slice(0, 4).join(" / ") : null,
            item.basis || null,
          ].filter(Boolean).join(" / ")) : null,
          item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
        ))
      )
    );
  }

  function MetricsSpine({ metrics }) {
    const data = metrics || {};
    if (!data.schema_version) return null;
    const usage = data.usage || {};
    const agents = data.agents || {};
    const skills = data.skills || {};
    const work = data.work || {};
    const coverage = data.coverage || {};
    const signals = asList(data.signals);
    const tiles = [
      {
        id: "usage",
        label: "Usage Visibility",
        state: coverage.cost_visibility === "missing" || coverage.cost_visibility === "partial" ? "warning" : coverage.cost_visibility ? "active" : "unknown",
        rows: [
          ["Sessions", formatCount(usage.sessions)],
          ["API Calls", formatCount(usage.api_calls)],
          ["Tokens", formatCount(usage.total_tokens)],
          ["Cost", usage.cost_confidence || "unknown"]
        ],
        detail: "Operational evidence only. Hermes Analytics owns the ledger.",
        view: usage.recommended_view || "/analytics"
      },
      {
        id: "agents",
        label: "Agent Workload",
        state: agents.needs_review ? "warning" : agents.profiles ? "active" : "unknown",
        rows: [
          ["Profiles", formatCount(agents.profiles)],
          ["Active", formatCount(agents.active_profiles)],
          ["Idle", formatCount(agents.idle_profiles)],
          ["With Skills", formatCount(agents.profiles_with_skills)]
        ],
        detail: "Profile workload and readiness grounded in Hermes profile stores.",
        view: agents.recommended_view || "/profiles"
      },
      {
        id: "skills",
        label: "Skill Lifecycle",
        state: skills.never_used || skills.metadata_gaps ? "warning" : skills.recorded ? "active" : "unknown",
        rows: [
          ["Recorded", formatCount(skills.recorded)],
          ["Created 30d", formatCount(skills.created_30d)],
          ["Used", formatCount(skills.used)],
          ["Never Used", formatCount(skills.never_used)]
        ],
        detail: "Lifecycle counts come from Hermes skill usage metadata across profiles.",
        view: skills.recommended_view || "/skills"
      },
      {
        id: "work",
        label: "Work Reliability",
        state: work.blocked || work.failed_runs || work.stale_workers ? "warning" : work.open ? "active" : "idle",
        rows: [
          ["Open", formatCount(work.open)],
          ["Ready", formatCount(work.ready)],
          ["Blocked", formatCount(work.blocked)],
          ["Failed Runs", formatCount(work.failed_runs)]
        ],
        detail: "Kanban reliability tells whether agent work is actually moving.",
        view: work.recommended_view || "/kanban"
      }
    ];

    return el("section", { className: "olympus-section olympus-metrics-spine" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Metrics Spine"),
          el("p", null, "Operational metrics for tuning. Hermes Analytics owns the usage ledger.")
        ),
        el(StatePill, { state: data.coverage && data.coverage.state_store || "unknown" })
      ),
      el("div", { className: "olympus-metrics-ownership" },
        el("span", null, "Olympus: " + ((data.ownership && data.ownership.olympus) || "operational evidence")),
        el("span", null, "Hermes: " + ((data.ownership && data.ownership.hermes_analytics) || "usage ledger"))
      ),
      el("div", { className: "olympus-metrics-grid" },
        tiles.map((tile) => el("article", { key: tile.id, className: cx("olympus-metrics-card", "olympus-metrics-card-" + String(tile.state || "unknown").toLowerCase()) },
          el("div", { className: "olympus-metrics-card-head" },
            el("h3", null, tile.label),
            el(MetricPill, { state: tile.state })
          ),
          el("div", { className: "olympus-metrics-rows" },
            tile.rows.map((row) => el("div", { key: row[0], className: "olympus-mini-row" },
              el("span", null, row[0]),
              el("small", null, row[1])
            ))
          ),
          el("p", null, tile.detail),
          tile.view ? el("a", { className: "olympus-link", href: routeLink(tile.view) }, routeLabel(tile.view)) : null
        ))
      ),
      signals.length ? el("div", { className: "olympus-metrics-signals" },
        signals.map((item, idx) => el("article", { key: idx, className: cx("olympus-metrics-signal", "olympus-metrics-signal-" + String(item.severity || "info").toLowerCase()) },
          el("div", { className: "olympus-item-head" },
            el("div", null,
              el("span", null, item.kind || "signal"),
              el("h3", null, item.title || "Metrics signal")
            ),
            el(Badge, { className: severityClass(item.severity) }, item.severity || "info")
          ),
          el("p", null, item.detail || ""),
          item.evidence ? el("small", null, item.evidence) : null,
          item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
        ))
      ) : null
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
      { label: "Loop Stop", value: summary.interactive_hard_stop ? "all sessions" : summary.hard_loop_stop ? "unattended only" : "off", state: summary.hard_loop_stop ? "ok" : summary.max_turns >= 80 ? "warning" : "unknown" },
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
          el(MetricPill, { state: summary.state || "unknown" }),
          el("a", { className: "olympus-link", href: routeLink("/config") }, "Open Config")
        )
      ),
      el("div", { className: "olympus-policy-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-policy-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(MetricPill, { state: item.state })
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
            el(MetricPill, { state: item.state })
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
        el("a", { className: "olympus-link", href: routeLink("/skills") }, "Open Skills")
      ),
      el("div", { className: "olympus-skill-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-skill-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(MetricPill, { state: item.state })
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
      { label: "Audit Warn", value: summary.hub_audit_warn || 0, state: summary.hub_audit_warn ? "warning" : "ok" },
      { label: "Audit Fail", value: summary.hub_audit_fail || 0, state: summary.hub_audit_fail ? "critical" : "ok" },
    ];

    return el("section", { className: "olympus-section olympus-skill-hygiene" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Skill Hygiene"),
          el("p", null, "Activity, archive, patch, hub trust, and scan gaps from local skill metadata.")
        ),
        el("div", { className: "olympus-section-actions" },
          el(MetricPill, { state: summary.state || "unknown" }),
          el("a", { className: "olympus-link", href: routeLink("/skills") }, "Open Skills")
        )
      ),
      el("div", { className: "olympus-skill-hygiene-tiles" },
        tiles.map((item) => el("div", { key: item.label, className: "olympus-skill-hygiene-tile" },
          el("span", null, item.label),
          el("strong", null, String(item.value)),
          el(MetricPill, { state: item.state })
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
              item.audit_summary ? "audit: " + item.audit_summary : null,
            ].filter(Boolean).join(" / ")),
            el(StatePill, { state: item.state || "unknown" })
          )) : el("p", { className: "olympus-muted" }, "No hub lock metadata recorded.")
        )
      )
    );
  }

  function formatAgo(iso) {
    if (!iso) return "no sessions this week";
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 60) return minutes + " min ago";
    if (minutes < 60 * 24) return Math.round(minutes / 60) + " h ago";
    return Math.round(minutes / (60 * 24)) + " d ago";
  }

  const ROLE_TEXT = { described: "Role described", auto: "Role auto-generated, not reviewed", missing: "No role description" };

  function Fleet({ fleet }) {
    const data = fleet || {};
    const summary = data.summary || {};
    const rows = asList(data.profiles);
    if (!rows.length) return null;
    return el("section", { className: "olympus-section olympus-fleet" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Fleet"),
          el("p", null, [
            rows.length + (rows.length === 1 ? " profile" : " profiles"),
            summary.needs_review ? summary.needs_review + " need review" : null,
            summary.roles_missing ? summary.roles_missing + " without a role" : null,
          ].filter(Boolean).join(" \u00b7 ") + ". Sessions and spend cover the last 7 days.")
        ),
        el("a", { className: "olympus-link", href: routeLink("/profiles") }, "Open Profiles")
      ),
      el("div", { className: "olympus-fleet-table", role: "table", "aria-label": "Profiles" },
        el("div", { className: "olympus-fleet-row olympus-fleet-row-head", role: "row" },
          ["Profile", "Gateway", "Work", "Sessions", "Spend", "Last active"].map((label) => el("span", { key: label, role: "columnheader" }, label))
        ),
        rows.map((row) => el("div", { key: row.id, className: "olympus-fleet-entry" },
          el("div", { className: "olympus-fleet-row", role: "row" },
            el("span", { role: "cell" },
              el("strong", null, row.label),
              el("small", null, row.role || ROLE_TEXT[row.role_state] || "", row.route === "inherited" ? " \u00b7 inherited route" : "")
            ),
            el("span", { role: "cell" }, row.gateway_state === "running" ? (row.gateway_mode === "multiplexed" ? "via default gateway" : "running") : row.gateway_state || "unknown"),
            el("span", { role: "cell" }, row.running + " running \u00b7 " + row.open + " open" + (row.blocked ? " \u00b7 " + row.blocked + " blocked" : "")),
            el("span", { role: "cell" }, formatCount(row.sessions_7d)),
            el("span", { role: "cell" }, row.sessions_7d ? formatMoney(row.spend_7d_usd) : "–"),
            el("span", { role: "cell" }, formatAgo(row.last_active_at))
          ),
          row.top_issue && row.state !== "ok" ? el("div", { className: "olympus-fleet-issue" },
            el(MetricPill, { state: row.state }),
            el("span", null, row.top_issue),
            asList(row.reasons).map((reason, idx) => el("small", { key: idx },
              reason.points ? el("span", { className: "olympus-reason-points" }, "\u2212" + String(reason.points) + " pts") : null,
              [reason.label !== row.top_issue ? reason.label : null, reason.detail].filter(Boolean).join(": ")
            )),
            row.recommended_view ? el("a", { className: "olympus-inline-link", href: routeLink(row.recommended_view) }, routeLabel(row.recommended_view)) : null
          ) : null
        ))
      )
    );
  }

  function eventState(kind, fallback) {
    const k = String(kind || "").toLowerCase();
    if (k.includes("blocked") || k.includes("timed_out") || k.includes("crashed") || k.includes("failed") || k.includes("reclaimed")) return "warning";
    if (k.includes("heartbeat") || k.includes("claimed") || k.includes("running")) return "running";
    return fallback || "active";
  }

  // Live Work: which profile is running what right now, and the latest Kanban
  // activity. Counts that other panels already own (readiness, Kanban totals,
  // cron, gateways) are not repeated here.
  function PartyView({ party, events }) {
    const data = party || {};
    const members = asList(data.members);
    const [selectedId, setSelectedId] = useState(members[0] && members[0].id);
    const selected = members.find((m) => m.id === selectedId) || members[0] || {};
    const activity = asList(events).slice(0, 8);
    useEffect(() => {
      if (members.length && !members.some((member) => member.id === selectedId)) {
        setSelectedId(members[0].id);
      }
    }, [members.map((member) => member.id).join("|"), selectedId]);
    if (!members.length && !activity.length) return null;

    return el("section", { className: "olympus-section olympus-party olympus-pantheon" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Live Work"),
          el("p", null, "Which profile is running what, and the latest Kanban activity. Select a profile for its current task.")
        ),
        el("a", { className: "olympus-link", href: routeLink("/kanban") }, "Open Kanban")
      ),
      el("div", { className: "olympus-command-viewport" },
        el("div", { className: "olympus-viewport-main" },
          members.length ? el("div", { className: "olympus-pantheon-map olympus-pantheon-map-grid", role: "group", "aria-label": "Profiles" },
            members.map((member) => el("button", {
              key: member.id,
              type: "button",
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
              el("strong", null, member.label || "Agent"),
              el("small", null, [
                (member.running_work || 0) + " running",
                (member.open_work || 0) + " open",
                (member.blocked_work || 0) + " blocked",
              ].join(" / ")),
              el(MetricPill, { state: member.state })
            ))
          ) : el("p", { className: "olympus-muted" }, "No Hermes profiles detected.")
        ),
        el("aside", { className: "olympus-party-inspector" },
          el("div", { className: "olympus-party-inspector-head" },
            el("div", null,
              el("span", null, "Selected profile"),
              el("h3", null, selected.label || "No profile")
            ),
            el(StatePill, { state: selected.state || "unknown" })
          ),
          selected.id ? [
            el("div", { key: "stats", className: "olympus-party-stat-grid" },
              [
                ["Running", selected.running_work || 0],
                ["Ready", selected.ready_work || 0],
                ["Blocked", selected.blocked_work || 0],
                ["Open", selected.open_work || 0],
                ["Skills", selected.skill_count || 0],
                ["Cron", selected.cron_jobs || 0],
              ].map((pair) => el("div", { key: pair[0], className: "olympus-party-stat" },
                el("span", null, pair[0]),
                el("strong", null, String(pair[1]))
              ))
            ),
            el("div", { key: "current", className: "olympus-party-current" },
              el("strong", null, "Current work"),
              selected.current_task ? el("p", null, [selected.current_task.title, selected.current_task.status, selected.current_task.goal_mode ? "goal mode" : null].filter(Boolean).join(" / ")) : el("p", null, "No active Kanban task on this scan."),
              selected.current_task && selected.current_task.forced_skill_count ? el("small", null, "Forced skills: " + String(selected.current_task.forced_skill_count)) : null,
              selected.current_task && selected.current_task.model_override ? el("small", null, "Model override: " + selected.current_task.model_override) : null
            ),
            asList(selected.flags).length ? el("div", { key: "flags", className: "olympus-flags" },
              asList(selected.flags).map((flag) => el("span", { key: flag }, flag))
            ) : null
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

  const BACKLOG_STATE = { critical: "critical", warning: "warning", info: "info" };

  function BacklogTriage({ backlog }) {
    const data = backlog || {};
    const summary = data.summary || {};
    const groups = asList(data.groups);
    if (!groups.length) return null;
    return el("section", { className: "olympus-section olympus-backlog" },
      el("div", { className: "olympus-section-head" },
        el("div", null,
          el("h2", null, "Backlog triage"),
          el("p", null, formatCount(summary.tasks) + " stuck tasks in " + summary.groups + (summary.groups === 1 ? " group" : " groups") + ", sorted by who has to act. " + formatCount(summary.needs_you) + " need a person.")
        ),
        el("a", { className: "olympus-link", href: routeLink(data.recommended_view || "/kanban") }, "Open Kanban")
      ),
      el("div", { className: "olympus-backlog-grid" },
        groups.map((group) => el("article", { key: group.kind, className: cx("olympus-backlog-group", "olympus-backlog-group-" + group.severity) },
          el("div", { className: "olympus-item-head" },
            el("div", null,
              el("span", null, group.count + (group.count === 1 ? " task" : " tasks")),
              el("h3", null, group.label)
            ),
            el(MetricPill, { state: BACKLOG_STATE[group.severity] })
          ),
          el("p", null, group.action),
          el("small", null, [
            group.oldest_days != null ? "oldest " + group.oldest_days + (group.oldest_days === 1 ? " day" : " days") : null,
            group.stale ? group.stale + " older than 3 days" : null,
            group.repeat_blocks ? group.repeat_blocks + " blocked more than once" : null,
            asList(group.assignees).map((a) => a.assignee + " " + a.count).join(", "),
          ].filter(Boolean).join(" \u00b7 ")),
          asList(group.samples).length ? el("ul", { className: "olympus-backlog-samples" },
            asList(group.samples).map((sample, idx) => el("li", { key: idx }, sample.title))
          ) : null
        ))
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
        el("a", { className: "olympus-link", href: routeLink("/kanban") }, "Open Kanban")
      ),
      el("div", { className: "olympus-kanban-summary" },
        summary.map((item) => el("div", { key: item.label, className: "olympus-kanban-tile" },
          el("span", null, item.label),
          el("strong", null, item.value),
          el(MetricPill, { state: item.state })
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
    const [activeMode, setActiveMode] = useState("brief");
    // One request at a time: the next poll is scheduled only after the
    // previous /overview settles. A fixed interval let a slow backend (any
    // response slower than the interval) discard every result it produced.
    const inFlight = useRef(false);
    const mounted = useRef(true);
    const pollTimer = useRef(null);

    function now() {
      return window.performance && performance.now ? performance.now() : Date.now();
    }

    function scheduleNextPoll() {
      window.clearTimeout(pollTimer.current);
      if (mounted.current) pollTimer.current = window.setTimeout(load, POLL_INTERVAL_MS);
    }

    function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      window.clearTimeout(pollTimer.current);
      setLoading(true);
      const started = now();
      SDK.fetchJSON(API + "/overview?ts=" + encodeURIComponent(String(Date.now())))
        .then((next) => {
          if (!mounted.current) return;
          const received = now();
          setData(next);
          setError(null);
          window.requestAnimationFrame(() => {
            if (!mounted.current) return;
            const rendered = now();
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
          const message = toErrorMessage(err);
          return loadStaticCompatibility(message).then((fallback) => {
            if (!mounted.current) return;
            const received = now();
            setData(fallback);
            setError(null);
            setClientDiagnostics({
              fetch_ms: Math.round(received - started),
              fetch_state: "warning",
              render_ms: 0,
              render_state: "warning",
              total_ms: Math.round(received - started)
            });
          }).catch((fallbackErr) => {
            if (mounted.current) setError(toErrorMessage(fallbackErr));
          });
        })
        .finally(() => {
          inFlight.current = false;
          if (!mounted.current) return;
          setLoading(false);
          scheduleNextPoll();
        });
    }

    useEffect(() => {
      mounted.current = true;
      load();
      return () => {
        mounted.current = false;
        window.clearTimeout(pollTimer.current);
      };
    }, []);

    const health = (data && data.health) || {};
    const tuning = (data && data.tuning) || {};
    const fixes = data && data.fixes;
    const setFixes = (next) => setData((prev) => Object.assign({}, prev, { fixes: next }));

    return el("div", { className: "olympus-page" },
      el(Hero, { health, tuning, history: data && data.history, loading, onRefresh: load }),
      error ? el("div", { className: "olympus-error" }, error) : null,
      el(ModeTabs, { activeMode, onChange: setActiveMode }),
      el(ModePanel, { id: "brief", activeMode },
        el(StaticCompatibilityNotice, { compatibility: data && data.static_compatibility }),
        el(NeedsYou, { tuning, fixes, onFixes: data && data.static_compatibility ? null : setFixes }),
        el(FixTracking, { fixes, onFixes: setFixes }),
        el(ScoreExplainer, { tuning }),
        el(AgentHQ, { hq: tuning.agent_hq })
      ),
      el(ModePanel, { id: "agents", activeMode },
        el(CostAttribution, { attribution: data && data.cost_attribution }),
        el(PerformanceTracking, { performance: data && data.performance }),
        el(Fleet, { fleet: data && data.fleet }),
        el(PartyView, { party: data && data.party, events: data && data.activity_events })
      ),
      el(ModePanel, { id: "skills", activeMode },
        el(SkillCoverage, { coverage: data && data.skill_coverage }),
        el(SkillHygiene, { hygiene: data && data.skill_hygiene })
      ),
      el(ModePanel, { id: "kanban", activeMode },
        el(BacklogTriage, { backlog: data && data.backlog }),
        el(TraceSpine, { trace: data && data.trace_spine }),
        el(KanbanIntelligence, { kanban: data && data.kanban })
      ),
      el(ModePanel, { id: "policy", activeMode },
        el(ToolPolicy, { policy: data && data.config_policy })
      ),
      el(ModePanel, { id: "diagnostics", activeMode },
        el(OpsEvals, { evals: data && data.ops_evals }),
        el("details", { className: "olympus-details olympus-debug" },
          el("summary", null, "Debug details: metrics spine, payload budgets, evidence sources"),
          el(MetricsSpine, { metrics: data && data.metrics_spine }),
          el(ProductionDiagnostics, { diagnostics: data && data.diagnostics, clientDiagnostics, evidenceSources: data && data.evidence_sources })
        )
      )
    );
  }

  window.__HERMES_PLUGINS__.register("olympus", OlympusPage);
})();
