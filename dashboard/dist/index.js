(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React } = SDK;
  const { useEffect, useRef, useState } = SDK.hooks;

  const API = "/api/plugins/olympus";
  const KANBAN_API = "/api/plugins/kanban";
  const POLL_INTERVAL_MS = 10000;
  const BANNER_ITEMS = 3;
  const TIMELINE_PREVIEW = 12;
  const NOTICE_MS = 6000;
  const STATUS_ORDER = ["waiting", "stalled", "failed", "offline", "working", "idle", "unknown"];
  const ROLE_TEXT = { auto: "Role written by Hermes, not reviewed", missing: "No role description" };

  function el(type, props, ...children) {
    return React.createElement(type, props || null, ...children);
  }

  function cx(...parts) {
    return parts.filter(Boolean).join(" ");
  }

  function asList(value) {
    return Array.isArray(value) ? value : [];
  }

  function plural(count, one, many) {
    return count + " " + (count === 1 ? one : many || one + "s");
  }

  // ---------------------------------------------------------------------
  // Links and URL state
  // ---------------------------------------------------------------------

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
    const route = path && path.startsWith("/") ? path : "/" + (path || "");
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

  // The open agent and the view live in the URL so a refresh or a shared
  // link lands in the same place. Other parameters (?profile=) are kept.
  function readParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function writeParam(name, value) {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(name, value);
    else params.delete(name);
    const query = params.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
  }

  // ---------------------------------------------------------------------
  // Formatting: one duration format everywhere ("45 s", "12 min", "3 h", "2 d").
  // ---------------------------------------------------------------------

  function parseTime(iso) {
    const ts = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ts) ? ts : null;
  }

  function formatSpan(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + " s";
    if (s < 3600) return Math.round(s / 60) + " min";
    if (s < 86400) return Math.round(s / 3600) + " h";
    return Math.round(s / 86400) + " d";
  }

  function ago(iso, now) {
    const ts = parseTime(iso);
    return ts == null ? null : formatSpan((now || Date.now()) - ts) + " ago";
  }

  function elapsed(iso, now) {
    const ts = parseTime(iso);
    return ts == null ? null : "for " + formatSpan((now || Date.now()) - ts);
  }

  function until(iso, now) {
    const ts = parseTime(iso);
    if (ts == null) return null;
    const delta = ts - (now || Date.now());
    return delta >= 0 ? "in " + formatSpan(delta) : formatSpan(-delta) + " late";
  }

  function clockTime(iso) {
    const ts = parseTime(iso);
    return ts == null ? "" : new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatTokens(value) {
    const n = Number(value || 0);
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
    return String(Math.round(n));
  }

  function formatMoney(value) {
    const n = Number(value || 0);
    return n > 0 ? "$" + n.toFixed(2) : "$0.00";
  }

  function formatDuration(seconds) {
    const n = Number(seconds || 0);
    return Number.isFinite(n) && n > 0 ? formatSpan(n * 1000) : "none";
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

  // A clock that re-renders its subtree every second, for "N s ago" text.
  function useNow(intervalMs) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
      const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
      return () => window.clearInterval(timer);
    }, [intervalMs]);
    return now;
  }

  // ---------------------------------------------------------------------
  // Identity: laurel mark, serif wordmark, one Greek-key hairline.
  // ---------------------------------------------------------------------

  function Laurel() {
    const leaf = (x, y, angle) => el("ellipse", { key: x + "," + y, cx: x, cy: y, rx: 1.3, ry: 2.6, transform: "rotate(" + angle + " " + x + " " + y + ")" });
    return el("svg", { className: "olympus-laurel", viewBox: "0 0 24 24", width: 22, height: 22, "aria-hidden": "true", focusable: "false" },
      el("path", { d: "M11 21C6.5 18.5 4.2 13.5 5.2 7.5M13 21c4.5-2.5 6.8-7.5 5.8-13.5", fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" }),
      el("g", { fill: "none", stroke: "currentColor", strokeWidth: 1 },
        leaf(5.6, 17, -50), leaf(4.3, 13, -25), leaf(4.4, 8.8, 0),
        leaf(18.4, 17, 50), leaf(19.7, 13, 25), leaf(19.6, 8.8, 0)
      )
    );
  }

  function GreekKey() {
    return el("svg", { className: "olympus-key", width: "100%", height: 8, "aria-hidden": "true", focusable: "false" },
      el("defs", null,
        el("pattern", { id: "olympus-key-unit", width: 12, height: 8, patternUnits: "userSpaceOnUse" },
          el("path", { d: "M0 7.5H10.5V0.5H2.5V5H7.5V3M10.5 7.5H12", fill: "none", stroke: "currentColor", strokeWidth: 1 })
        )
      ),
      el("rect", { width: "100%", height: 8, fill: "url(#olympus-key-unit)" })
    );
  }

  // A soft tint per agent, derived from its id, so the same agent keeps the
  // same avatar across views. The initial is the only text.
  function avatarHue(id) {
    let hash = 0;
    for (const ch of String(id || "")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash % 360;
  }

  function Avatar({ agent, size }) {
    if (!agent) return el("span", { className: "olympus-avatar olympus-avatar-fleet", "aria-hidden": "true" }, "∗");
    return el("span", {
      className: cx("olympus-avatar", size === "large" && "olympus-avatar-large"),
      style: { "--olympus-avatar-hue": avatarHue(agent.id) },
      "aria-hidden": "true"
    }, agent.avatar || String(agent.label || "?").slice(0, 1).toUpperCase());
  }

  function StatusPill({ status, label }) {
    return el("span", { className: "olympus-status olympus-status-" + (status || "unknown") },
      el("span", { className: "olympus-status-dot", "aria-hidden": "true" }),
      label || "Not checked"
    );
  }

  // ---------------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------------

  // Seven days of sessions as tiny bars; today is the last bar.
  function percent(rate) {
    return rate == null ? null : Math.round(rate * 100) + "%";
  }

  // Seven days of runs as tiny bars (failed or cut-off runs in red on top),
  // then the share of finished runs that succeeded.
  function RunBars({ runs }) {
    const days = asList(runs && runs.days);
    if (!days.length || !runs.runs) return el("span", { className: "olympus-muted" }, "No runs");
    const max = Math.max(1, ...days.map((day) => day.runs));
    const rate = runs.success_rate;
    return el("span", { className: "olympus-runs" },
      el("span", {
        className: "olympus-activity",
        role: "img",
        "aria-label": plural(runs.runs, "run") + " in 7 days" + (rate == null ? "" : ", " + percent(rate) + " of finished runs succeeded")
      },
        days.map((day, idx) => {
          const height = Math.max(2, Math.round((day.runs / max) * 16));
          const bad = day.runs ? Math.round(height * (day.unsuccessful / day.runs)) : 0;
          return el("span", { key: idx, className: cx("olympus-activity-bar", idx === days.length - 1 && "olympus-activity-today"), style: { height: height + "px" } },
            bad ? el("span", { className: "olympus-activity-bad", style: { height: bad + "px" } }) : null
          );
        })
      ),
      rate == null ? null : el("span", { className: cx("olympus-rate", rateClass(rate)) }, percent(rate))
    );
  }

  // Colour only when the success rate needs attention.
  function rateClass(rate) {
    if (rate == null) return null;
    return rate < 0.75 ? "olympus-rate-bad" : rate < 0.9 ? "olympus-rate-low" : null;
  }

  const TOKEN_SERIES = [
    { key: "input_tokens", label: "Input", className: "olympus-series-input" },
    { key: "cache_tokens", label: "Cache", className: "olympus-series-cache" },
    { key: "output_tokens", label: "Output", className: "olympus-series-output" }
  ];

  function dayName(day) {
    const ts = Date.parse(day + "T12:00:00Z");
    return Number.isFinite(ts) ? new Date(ts).toLocaleDateString([], { weekday: "short", timeZone: "UTC" }) : day;
  }

  // Stacked bars: tokens per UTC day, input / cache / output.
  function TokenChart({ days }) {
    const rows = asList(days);
    const totals = rows.map((day) => TOKEN_SERIES.reduce((sum, series) => sum + Number(day[series.key] || 0), 0));
    const max = Math.max(...totals, 0);
    const summary = rows.map((day, idx) => dayName(day.day) + " " + formatTokens(totals[idx])).join(", ");
    return el("figure", { className: "olympus-token-chart" },
      el("figcaption", null,
        el("span", null, "Tokens per day"),
        el("span", { className: "olympus-legend" },
          TOKEN_SERIES.map((series) => el("span", { key: series.key }, el("i", { className: series.className, "aria-hidden": "true" }), series.label))
        )
      ),
      max ? el("div", { className: "olympus-token-bars", role: "img", "aria-label": "Tokens per day, last 7 days: " + summary },
        rows.map((day, idx) => el("div", { key: day.day, className: "olympus-token-day", title: dayName(day.day) + ": " + formatCount(totals[idx]) + " tokens" },
          el("div", { className: "olympus-token-stack", style: { height: Math.round((totals[idx] / max) * 100) + "%" } },
            TOKEN_SERIES.map((series) => totals[idx] ? el("span", {
              key: series.key,
              className: series.className,
              style: { flexGrow: Number(day[series.key] || 0) }
            }) : null)
          ),
          el("small", null, dayName(day.day))
        ))
      ) : el("p", { className: "olympus-muted" }, "No tokens recorded in the last 7 days."),
      max ? el("small", { className: "olympus-chart-scale" }, "Peak " + formatTokens(max) + " tokens") : null
    );
  }

  // ---------------------------------------------------------------------
  // Controls: every action is confirmed in a popover that states its exact
  // effect, runs through Hermes' own endpoint, and is logged by Olympus.
  // ---------------------------------------------------------------------

  function jsonRequest(method, body) {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }

  async function resolveTarget(kind, ref, board) {
    const query = "kind=" + encodeURIComponent(kind) + "&ref=" + encodeURIComponent(ref) + (board ? "&board=" + encodeURIComponent(board) : "");
    const found = await SDK.fetchJSON(API + "/resolve?" + query);
    if (!found.allowed) throw new Error(found.reason || "Controls are off.");
    if (!found.found) throw new Error("Hermes no longer has this item. It may have changed since the last refresh.");
    return found;
  }

  async function performAction(action, input) {
    const target = action.target;
    if (action.id === "fix") {
      const result = await SDK.fetchJSON(API + "/fixes?key=" + encodeURIComponent(target.ref), { method: "POST" });
      if (!result.tracked) throw new Error("This finding already cleared.");
      return result;
    }
    if (target.kind === "cron") {
      const verb = { pause: "pause", resume: "resume", run_now: "trigger" }[action.id];
      let result = null;
      // "Pause all scheduled" carries several jobs; each is its own call.
      for (const ref of target.refs || [target.ref]) {
        const job = await resolveTarget("cron", ref);
        result = await SDK.fetchJSON("/api/cron/jobs/" + encodeURIComponent(job.job_id) + "/" + verb + "?profile=" + encodeURIComponent(job.profile), { method: "POST" });
      }
      return result;
    }
    const task = await resolveTarget("task", target.ref, target.board);
    const url = KANBAN_API + "/tasks/" + encodeURIComponent(task.task_id);
    const board = "?board=" + encodeURIComponent(task.board);
    if (action.id === "answer") {
      await SDK.fetchJSON(url + "/comments" + board, jsonRequest("POST", { body: input.text }));
      return SDK.fetchJSON(url + board, jsonRequest("PATCH", { status: "ready" }));
    }
    if (action.id === "retry") return SDK.fetchJSON(url + board, jsonRequest("PATCH", { status: "ready" }));
    if (action.id === "reclaim") return SDK.fetchJSON(url + "/reclaim" + board, jsonRequest("POST", { reason: "Reclaimed from Olympus" }));
    const profile = await resolveTarget("profile", input.agent);
    return SDK.fetchJSON(url + "/reassign" + board, jsonRequest("POST", {
      profile: profile.profile,
      reclaim_first: target.status === "running",
      reason: "Reassigned from Olympus"
    }));
  }

  function logAction(action, subject, agentId, ok, detail) {
    if (action.id === "fix") return Promise.resolve();
    const params = new URLSearchParams({ action: action.id, kind: action.target.kind, ref: action.target.ref, label: subject, ok: ok ? "true" : "false" });
    if (agentId) params.set("agent", agentId);
    if (detail) params.set("detail", detail);
    return SDK.fetchJSON(API + "/actions?" + params.toString(), { method: "POST" }).catch(() => undefined);
  }

  const DONE_TEXT = {
    answer: "Answer posted; back to ready",
    retry: "Moved back to ready",
    reclaim: "Worker stopped; back to ready",
    reassign: "Reassigned",
    assign: "Assigned",
    pause: "Paused",
    resume: "Resumed",
    run_now: "Started",
    fix: "Tracking your fix"
  };

  function ActionButton({ action, subject, agentId, agents, controls, onDone, primary }) {
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState("idle");
    const [message, setMessage] = useState("");
    const [text, setText] = useState("");
    const [choice, setChoice] = useState("");
    const box = useRef(null);
    const trigger = useRef(null);
    const needsAgent = action.id === "reassign" || action.id === "assign";
    const choices = asList(agents).filter((agent) => agent.id !== agentId);

    useEffect(() => {
      if (!open) return undefined;
      const field = box.current && box.current.querySelector("textarea, select, button");
      if (field) field.focus();
      function outside(event) {
        if (box.current && !box.current.contains(event.target) && trigger.current && !trigger.current.contains(event.target)) setOpen(false);
      }
      document.addEventListener("mousedown", outside);
      return () => document.removeEventListener("mousedown", outside);
    }, [open]);

    if (action.id !== "fix" && !controls) return null;

    function close() {
      setOpen(false);
      if (trigger.current) trigger.current.focus();
    }

    const name = action.target.name || subject;

    function confirm() {
      setPhase("pending");
      setMessage("");
      performAction(action, { text: text.trim(), agent: choice })
        .then(() => {
          setPhase("done");
          setOpen(false);
          logAction(action, name, agentId || choice, true, null);
          onDone(DONE_TEXT[action.id] + ": " + name);
        })
        .catch((error) => {
          const reason = toErrorMessage(error);
          setPhase("failed");
          setMessage(reason);
          logAction(action, name, agentId || choice, false, reason);
        });
    }

    const blocked = (action.id === "answer" && !text.trim()) || (needsAgent && !choice) || phase === "pending";
    const labelText = phase === "pending" ? action.label + "…" : action.label;
    return el("span", {
      className: "olympus-action",
      onClick: (event) => event.stopPropagation(),
      onKeyDown: (event) => {
        // Keys pressed on a control never reach the roster row behind it;
        // Escape closes the popover first and only then the inspector.
        if (event.key === "Escape") {
          if (open) { event.stopPropagation(); close(); }
          return;
        }
        event.stopPropagation();
      }
    },
      phase === "done" ? el("span", { className: "olympus-action-done", role: "status" }, DONE_TEXT[action.id] || "Done") : el("button", {
        type: "button",
        ref: trigger,
        className: cx("olympus-button", primary && "olympus-button-primary"),
        "aria-expanded": open ? "true" : "false",
        "aria-haspopup": "dialog",
        disabled: phase === "pending",
        onClick: () => setOpen(!open)
      }, labelText),
      open ? el("div", { ref: box, className: "olympus-popover", role: "dialog", "aria-label": action.label + ": " + subject },
        action.question ? el("div", { className: "olympus-popover-field" },
          el("span", null, "The agent asked"),
          el("p", { className: "olympus-popover-question" }, action.question)
        ) : null,
        el("p", null, action.effect),
        action.id === "answer" ? el("textarea", {
          rows: 3,
          value: text,
          placeholder: "Your answer",
          "aria-label": "Your answer",
          onChange: (event) => setText(event.target.value)
        }) : null,
        needsAgent ? el("label", { className: "olympus-popover-field" },
          el("span", null, "Give it to"),
          el("select", { value: choice, onChange: (event) => setChoice(event.target.value) },
            el("option", { value: "" }, "Choose an agent"),
            choices.map((agent) => el("option", { key: agent.id, value: agent.id }, agent.label))
          )
        ) : null,
        phase === "failed" ? el("p", { className: "olympus-popover-error", role: "alert" }, "Hermes said: " + message) : null,
        el("div", { className: "olympus-popover-actions" },
          el("button", { type: "button", className: "olympus-button olympus-button-primary", disabled: blocked, onClick: confirm },
            phase === "pending" ? "Working…" : phase === "failed" ? "Try again" : "Confirm"),
          el("button", { type: "button", className: "olympus-button olympus-button-quiet", onClick: close }, "Cancel")
        )
      ) : null
    );
  }

  // Sessions are named by hashed ref; the raw id is looked up only on click.
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
    return el("button", { type: "button", className: "olympus-link-button", onClick: open, disabled: state !== "idle" },
      state === "missing" ? "Session no longer available" : state === "opening" ? "Opening…" : "Open " + (target.label || "session") + " session"
    );
  }

  function SessionLinks({ targets }) {
    const sessions = asList(targets).filter((target) => target && target.kind === "session" && target.ref);
    if (!sessions.length) return null;
    return el("span", { className: "olympus-session-links" }, sessions.map((target) => el(SessionLink, { key: target.ref, target })));
  }

  // ---------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------

  function census(summary, agents) {
    const parts = [plural(Number(summary.agents || 0), "agent")];
    parts.push(Number(summary.working || 0) + " working");
    parts.push(Number(summary.need_you || 0) ? summary.need_you + " need you" : "none need you");
    const finished = asList(agents).reduce((sum, agent) => sum + Number((agent.runs_7d && agent.runs_7d.finished) || 0), 0);
    const succeeded = asList(agents).reduce((sum, agent) => sum + Number((agent.runs_7d && agent.runs_7d.succeeded) || 0), 0);
    if (finished) parts.push(percent(succeeded / finished) + " of runs succeeded this week");
    return parts.join(" · ");
  }

  const VIEWS = [
    { id: "agents", label: "Agents" },
    { id: "performance", label: "Performance" },
    { id: "checks", label: "Checks" }
  ];

  function Header({ data, view, onView, loading, now }) {
    const summary = (data && data.agents && data.agents.summary) || {};
    const updated = data && data.generated_at ? ago(data.generated_at, now) : null;
    return el("header", { className: "olympus-header" },
      el("div", { className: "olympus-brand" },
        el(Laurel),
        el("h1", { className: "olympus-wordmark" }, "Olympus")
      ),
      el("p", { className: "olympus-census", "aria-live": "polite" },
        data && data.agents ? census(summary, data.agents.agents) : data && data.static ? "Agents only: the Olympus backend is off" : "Reading your agents…"),
      el("div", { className: "olympus-header-meta" },
        el("span", { className: "olympus-updated" }, loading && !data ? "Loading" : updated ? "Updated " + updated : ""),
        data && !data.static ? el("nav", { className: "olympus-views", "aria-label": "Olympus views" },
          VIEWS.map((item) => el("button", {
            key: item.id,
            type: "button",
            className: cx("olympus-view-switch", view === item.id && "olympus-view-current"),
            "aria-current": view === item.id ? "page" : undefined,
            onClick: () => onView(item.id)
          }, item.label))
        ) : null
      )
    );
  }

  // ---------------------------------------------------------------------
  // Needs you: one queue across everything Olympus checks.
  // ---------------------------------------------------------------------

  // `own`: listed inside that agent's inspector, so the agent is not repeated.
  function QueueItem({ item, ctx, compact, own }) {
    const actions = asList(item.actions);
    const shown = compact ? actions.slice(0, 1) : actions;
    const subject = item.title;
    const since = item.since ? elapsed(item.since, ctx.now) : null;
    return el("li", { className: cx("olympus-queue-item", own && "olympus-queue-item-own") },
      own ? null : el(Avatar, { agent: item.agent && ctx.agentById[item.agent.id] || item.agent }),
      el("div", { className: "olympus-queue-text" },
        el("p", { className: "olympus-queue-title" },
          own ? null : item.agent ? el("button", { type: "button", className: "olympus-agent-link", onClick: () => ctx.openAgent(item.agent.id) }, item.agent.label) : el("span", { className: "olympus-queue-scope" }, "All agents"),
          el("span", null, subject)
        ),
        el("p", { className: "olympus-queue-detail" }, [item.detail, since].filter(Boolean).join(" · ")),
        compact ? null : el(SessionLinks, { targets: item.targets })
      ),
      el("div", { className: "olympus-queue-actions" },
        shown.map((action, idx) => el(ActionButton, {
          key: action.id,
          action,
          subject,
          agentId: item.agent && item.agent.id,
          agents: ctx.agents,
          controls: ctx.controls,
          onDone: ctx.onActionDone,
          primary: idx === 0
        })),
        !shown.length || !ctx.controls && shown.every((action) => action.id !== "fix")
          ? el("a", { className: "olympus-link", href: routeLink(item.link) }, item.link_label || routeLabel(item.link))
          : null
      )
    );
  }

  function NeedsYouBanner({ queue, ctx }) {
    const [expanded, setExpanded] = useState(false);
    const items = asList(queue);
    if (!items.length) return null;
    const shown = expanded ? items : items.slice(0, BANNER_ITEMS);
    const more = items.length - BANNER_ITEMS;
    return el("section", { className: "olympus-banner", "aria-labelledby": "olympus-banner-title" },
      el("h2", { id: "olympus-banner-title" }, "Needs you", el("span", { className: "olympus-count" }, String(items.length))),
      el("ol", { className: "olympus-queue" }, shown.map((item) => el(QueueItem, { key: item.key, item, ctx, compact: true }))),
      more > 0 ? el("button", { type: "button", className: "olympus-link-button", "aria-expanded": expanded ? "true" : "false", onClick: () => setExpanded(!expanded) },
        expanded ? "Show the top " + BANNER_ITEMS : "+" + more + " more") : null
    );
  }

  // ---------------------------------------------------------------------
  // Roster
  // ---------------------------------------------------------------------

  const SORTS = {
    status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.issues - a.issues || String(a.label).localeCompare(String(b.label)),
    name: (a, b) => String(a.label).localeCompare(String(b.label)),
    last: (a, b) => (parseTime(b.last_active_at) || 0) - (parseTime(a.last_active_at) || 0)
  };

  function NowCell({ agent, now }) {
    const current = agent.current;
    if (!current) return el("span", { className: "olympus-muted" }, "Nothing running");
    const when = current.since ? (current.kind === "waiting" ? "waiting " : "") + elapsed(current.since, now) : null;
    return el("span", { className: "olympus-now" },
      agent.live ? el("span", { className: "olympus-live-dot", "aria-hidden": "true" }) : null,
      el("span", { className: "olympus-now-label" }, current.label),
      el("small", null, [current.tool ? "using " + current.tool + " " + ago(current.tool_at, now) : null, when].filter(Boolean).join(" · ") || null)
    );
  }

  function Helpers({ helpers }) {
    const h = helpers || {};
    const chips = [
      h.subagents ? plural(h.subagents, "subagent") : null,
      h.workers ? plural(h.workers, "worker") : null,
      h.cron ? h.cron + " scheduled" : null
    ].filter(Boolean);
    if (!chips.length) return el("span", { className: "olympus-muted" }, "None");
    return el("span", { className: "olympus-chips" }, chips.map((chip) => el("span", { key: chip, className: "olympus-chip" }, chip)));
  }

  function rowAction(agent, queue) {
    const item = asList(queue).find((entry) => entry.agent && entry.agent.id === agent.id && asList(entry.actions).length);
    return item ? { item, action: item.actions[0] } : null;
  }

  function Roster({ agents, queue, selected, ctx, sort, onSort }) {
    const body = useRef(null);
    const rows = asList(agents).slice().sort(SORTS[sort] || SORTS.status);

    function focusRow(offset, from) {
      const all = Array.from(body.current ? body.current.querySelectorAll("tr[data-agent]") : []);
      const next = all[Math.min(all.length - 1, Math.max(0, all.indexOf(from) + offset))];
      if (next) next.focus();
    }

    function onKey(event, agent) {
      if (event.key === "ArrowDown") { event.preventDefault(); focusRow(1, event.currentTarget); }
      else if (event.key === "ArrowUp") { event.preventDefault(); focusRow(-1, event.currentTarget); }
      else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); ctx.openAgent(agent.id); }
    }

    function header(key, label) {
      const active = sort === key;
      return el("th", { scope: "col", "aria-sort": active ? (key === "last" ? "descending" : "ascending") : "none" },
        el("button", { type: "button", className: cx("olympus-sort", active && "olympus-sort-active"), onClick: () => onSort(key) }, label)
      );
    }

    return el("table", { className: "olympus-roster" },
      el("caption", { className: "olympus-sr-only" }, "Your agents. Use the arrow keys to move and Enter to inspect one."),
      el("thead", null, el("tr", null,
        header("name", "Agent"),
        header("status", "Status"),
        el("th", { scope: "col" }, "Now"),
        el("th", { scope: "col" }, "Helpers"),
        header("last", "Last active"),
        el("th", { scope: "col" }, "Runs, 7 days"),
        el("th", { scope: "col" }, "Issues"),
        el("th", { scope: "col" }, el("span", { className: "olympus-sr-only" }, "Action"))
      )),
      el("tbody", { ref: body },
        rows.map((agent) => {
          const next = rowAction(agent, queue);
          return el("tr", {
            key: agent.id,
            "data-agent": agent.id,
            tabIndex: 0,
            "aria-selected": selected === agent.id ? "true" : "false",
            className: cx("olympus-row", selected === agent.id && "olympus-row-selected"),
            onClick: () => ctx.openAgent(agent.id),
            onKeyDown: (event) => onKey(event, agent)
          },
            el("td", { className: "olympus-cell-agent" },
              el(Avatar, { agent }),
              el("span", { className: "olympus-agent-name" },
                el("strong", null, agent.label),
                el("small", null, agent.role || ROLE_TEXT[agent.role_state] || (agent.dashboard_home ? "This dashboard's profile" : ""))
              )
            ),
            el("td", { "data-label": "Status" }, el(StatusPill, { status: agent.status, label: agent.status_label })),
            el("td", { className: "olympus-cell-now", "data-label": "Now" }, el(NowCell, { agent, now: ctx.now })),
            el("td", { "data-label": "Helpers" }, el(Helpers, { helpers: agent.helpers })),
            el("td", { "data-label": "Last active" }, agent.last_active_at ? ago(agent.last_active_at, ctx.now) : el("span", { className: "olympus-muted" }, "Never")),
            el("td", { "data-label": "Runs, 7 days" }, el(RunBars, { runs: agent.runs_7d })),
            el("td", { "data-label": "Issues", className: agent.issues ? null : "olympus-cell-quiet" }, agent.issues ? el("span", { className: "olympus-issues" }, plural(agent.issues, "issue")) : el("span", { className: "olympus-muted" }, "None")),
            el("td", { className: "olympus-cell-action" },
              next ? el(ActionButton, {
                action: next.action,
                subject: next.item.title,
                agentId: agent.id,
                agents: ctx.agents,
                controls: ctx.controls,
                onDone: ctx.onActionDone
              }) : null
            )
          );
        })
      )
    );
  }

  function RosterSkeleton() {
    return el("div", { className: "olympus-skeleton", role: "status", "aria-label": "Loading agents" },
      [0, 1, 2, 3, 4].map((idx) => el("div", { key: idx, className: "olympus-skeleton-row" },
        el("span", { className: "olympus-skeleton-avatar" }),
        el("span", { className: "olympus-skeleton-bar", style: { width: (38 + idx * 7) + "%" } }),
        el("span", { className: "olympus-skeleton-bar olympus-skeleton-short" })
      ))
    );
  }

  function EmptyNote({ agents }) {
    const rows = asList(agents);
    const quiet = rows.length <= 1 && rows.every((agent) => !agent.last_active_at && !agent.current && !agent.issues);
    if (!quiet) return null;
    return el("p", { className: "olympus-note" },
      "Olympus fills in as your agents work: sessions, scheduled jobs and Kanban tasks appear here as Hermes records them. Each Hermes profile is one agent. ",
      el("a", { className: "olympus-link", href: routeLink("/profiles") }, "Create profiles in Hermes")
    );
  }

  // ---------------------------------------------------------------------
  // Inspector
  // ---------------------------------------------------------------------

  const TIMELINE_KIND = { tool: "Tool", session: "Session", subagent: "Subagent", task: "Kanban", cron: "Scheduled", action: "You" };

  function Timeline({ events, now }) {
    const [all, setAll] = useState(false);
    const rows = asList(events);
    if (!rows.length) return el("p", { className: "olympus-muted" }, "No recorded steps yet.");
    const shown = all ? rows : rows.slice(0, TIMELINE_PREVIEW);
    return el(React.Fragment, null,
      el("ol", { className: "olympus-timeline" },
        shown.map((event, idx) => el("li", { key: idx, className: cx("olympus-step", event.state && "olympus-step-" + event.state) },
          el("time", { dateTime: event.at, title: event.at }, clockTime(event.at)),
          el("span", { className: "olympus-step-kind" }, TIMELINE_KIND[event.kind] || event.kind),
          el("span", { className: "olympus-step-text" }, event.text, event.detail ? el("small", null, event.detail) : null),
          el("small", { className: "olympus-step-ago" }, ago(event.at, now))
        ))
      ),
      rows.length > TIMELINE_PREVIEW ? el("button", { type: "button", className: "olympus-link-button", onClick: () => setAll(!all) },
        all ? "Show fewer" : "Show all " + rows.length + " steps") : null
    );
  }

  function InspectorSection({ title, count, children }) {
    return el("section", { className: "olympus-inspector-section" },
      el("h3", null, title, typeof count === "number" ? el("span", { className: "olympus-count olympus-count-quiet" }, String(count)) : null),
      children
    );
  }

  function CronRow({ job, ctx, agentId, now }) {
    return el("li", { className: "olympus-work-row" },
      el("div", null,
        el("strong", null, job.label),
        el("small", null, [
          job.schedule,
          job.enabled ? (job.next_run_at ? "next " + until(job.next_run_at, now) : null) : "paused",
          job.last_run_at ? "last ran " + ago(job.last_run_at, now) : "never ran",
          job.no_agent ? "no model" : null
        ].filter(Boolean).join(" · ")),
        job.state === "error" ? el("small", { className: "olympus-error-text" }, job.last_error || "Last run failed") : null
      ),
      el("div", { className: "olympus-work-actions" },
        asList(job.actions).map((action) => el(ActionButton, { key: action.id, action, subject: job.label, agentId, agents: ctx.agents, controls: ctx.controls, onDone: ctx.onActionDone }))
      )
    );
  }

  // The Kanban task this agent is running now; the board itself stays in Kanban.
  function RunningTask({ task, ctx, agentId, now }) {
    return el("li", { className: "olympus-work-row" },
      el("div", null,
        el("strong", null, task.title),
        el("small", { className: task.stale ? "olympus-attention-text" : null },
          task.stale ? "Worker " + task.stale : task.started_at ? "running " + elapsed(task.started_at, now) : "running")
      ),
      el("div", { className: "olympus-work-actions" },
        asList(task.actions).map((action) => el(ActionButton, { key: action.id, action, subject: task.title, agentId, agents: ctx.agents, controls: ctx.controls, onDone: ctx.onActionDone }))
      )
    );
  }

  function KanbanSummary({ kanban }) {
    const k = kanban || {};
    return el("p", { className: "olympus-muted olympus-kanban-summary" },
      [Number(k.open || 0) + " open", Number(k.blocked || 0) + " blocked", Number(k.done_7d || 0) + " done this week"].join(" · ") + ". ",
      el("a", { className: "olympus-link", href: routeLink("/kanban") }, "Open Kanban")
    );
  }

  // Route, skills, gateway, platforms and loop limits in one line.
  function setupLine(setup) {
    const s = setup || {};
    const gateway = { own: "own gateway", shared: "shares the default gateway", stopped: "gateway stopped" }[s.gateway];
    return [
      s.route === "configured" ? (s.model ? "model " + s.model : "own model route") : "inherits the default model",
      plural(Number(s.skills || 0), "skill"),
      gateway,
      asList(s.platforms).length ? "on " + s.platforms.join(", ") : null,
      "loop hard stop " + (s.loop_stop || "unknown") + (s.max_turns ? ", max " + s.max_turns + " turns" : "")
    ].filter(Boolean).join(" · ");
  }

  // How the agent's own sessions behave: what Kanban cannot show.
  function WorkingSection({ working, usage, ctx }) {
    const w = working || {};
    const tools = asList(w.top_tools);
    const signals = asList(w.signals);
    return el(InspectorSection, { title: "How it's working" },
      el("dl", { className: "olympus-facts" },
        el("div", null, el("dt", null, "Typical run"), el("dd", null, w.median_run_seconds == null ? "No finished runs" : formatDuration(w.median_run_seconds) + (w.p90_run_seconds != null ? ", slow " + formatDuration(w.p90_run_seconds) : ""))),
        el("div", null, el("dt", null, "Tools per run"), el("dd", null, String(w.tools_per_session || 0))),
        el("div", null, el("dt", null, "Tokens per call"), el("dd", null, formatTokens(w.tokens_per_call))),
        el("div", null, el("dt", null, "Cost this week"), el("dd", null, formatMoney(usage && usage.cost_7d_usd)))
      ),
      tools.length ? el("p", { className: "olympus-tool-mix" },
        el("span", { className: "olympus-muted" }, "Most used tools this week: "),
        tools.map((tool) => tool.tool + " " + formatCount(tool.calls)).join(" · ")
      ) : null,
      signals.length ? el("ul", { className: "olympus-signals" }, signals.map((signal) => el("li", { key: signal.kind },
        el("span", { className: "olympus-severity olympus-severity-" + signal.severity }, SEVERITY_TEXT[signal.severity]),
        el("div", null,
          el("strong", null, signal.label + " in " + plural(signal.count, "session")),
          el("small", null, signal.detail),
          el(SessionLinks, { targets: signal.sessions })
        )
      ))) : el("p", { className: "olympus-muted" }, "No looping, cost or context problems in its sessions."),
      el("small", { className: "olympus-muted" }, "From " + (w.window || "recent sessions") + ". ",
        el("button", { type: "button", className: "olympus-link-button", onClick: ctx.openPerformance }, "See run performance"))
    );
  }

  const VERDICT_TEXT = { cleared: "Cleared", improved: "Improved", unchanged: "Unchanged", worse: "Worse", "still present": "Still present" };

  function PauseAll({ detail, ctx }) {
    const jobs = asList(detail.cron).filter((job) => job.enabled);
    if (!jobs.length || !ctx.controls) return null;
    const agent = detail.agent;
    const pauses = jobs.map((job) => job.actions.find((action) => action.id === "pause")).filter(Boolean);
    const refs = pauses.map((action) => action.target.ref);
    const combined = {
      id: "pause",
      label: "Pause all scheduled",
      target: { kind: "cron", ref: refs.join(","), refs },
      effect: "Pause " + plural(pauses.length, "scheduled job") + " for " + agent.label + " until you resume " + (pauses.length === 1 ? "it." : "them.")
    };
    return el(ActionButton, {
      action: combined,
      subject: plural(pauses.length, "scheduled job"),
      agentId: agent.id,
      agents: ctx.agents,
      controls: ctx.controls,
      onDone: ctx.onActionDone
    });
  }

  function Inspector({ agentId, detail, error, ctx, onClose }) {
    const panel = useRef(null);
    useEffect(() => {
      if (panel.current) panel.current.focus({ preventScroll: true });
    }, [agentId]);
    const row = ctx.agentById[agentId];
    const agent = (detail && detail.agent) || row;
    if (!agent) return null;
    const usage = (detail && detail.usage) || {};
    const success = (detail && detail.success) || {};
    return el("aside", {
      ref: panel,
      tabIndex: -1,
      className: "olympus-inspector",
      "aria-label": "Agent " + agent.label,
      onKeyDown: (event) => {
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      }
    },
      el("div", { className: "olympus-inspector-head" },
        el("button", { type: "button", className: "olympus-back", onClick: onClose }, "Back to agents"),
        el(Avatar, { agent, size: "large" }),
        el("div", { className: "olympus-inspector-title" },
          el("h2", null, agent.label),
          el("p", null, agent.role || ROLE_TEXT[agent.role_state] || ""),
          agent.setup ? el("p", { className: "olympus-setup" }, setupLine(agent.setup)) : null,
          el("div", { className: "olympus-inspector-status" },
            el(StatusPill, { status: agent.status, label: agent.status_label }),
            agent.last_active_at ? el("span", { className: "olympus-muted" }, "last active " + ago(agent.last_active_at, ctx.now)) : null
          )
        ),
        el("div", { className: "olympus-inspector-controls" },
          detail ? el(PauseAll, { detail, ctx }) : null,
          agent.current && agent.current.kind === "session" && agent.current.ref ? el(SessionLink, { target: { kind: "session", ref: agent.current.ref, label: "current" } }) : null,
          el("a", { className: "olympus-link", href: routeLink("/profiles") }, "Open in Hermes"),
          el("button", { type: "button", className: "olympus-close", "aria-label": "Close inspector", onClick: onClose }, "×")
        )
      ),
      error ? el("p", { className: "olympus-error-text", role: "alert" }, "Could not load this agent: " + error) : null,
      !detail && !error ? el(RosterSkeleton) : null,
      detail && detail.start_gateway ? el("p", { className: "olympus-note" }, "Its gateway is not running, so scheduled jobs and Kanban work wait. Start it with ", el("code", null, detail.start_gateway), ".") : null,
      detail && asList(detail.needs_you).length ? el(InspectorSection, { title: "Needs you", count: detail.needs_you.length },
        el("ol", { className: "olympus-queue" }, detail.needs_you.map((item) => el(QueueItem, { key: item.key, item, ctx, own: true })))
      ) : null,
      detail ? el(InspectorSection, { title: "Now" }, el(Timeline, { events: detail.timeline, now: ctx.now })) : null,
      detail ? el(WorkingSection, { working: detail.working, usage, ctx }) : null,
      detail && asList(detail.cron).length ? el(InspectorSection, { title: "Scheduled", count: detail.cron.length },
        el("ul", { className: "olympus-work" }, detail.cron.map((job) => el(CronRow, { key: job.id, job, ctx, agentId: agent.id, now: ctx.now })))
      ) : null,
      detail && (asList(detail.kanban.running).length || detail.kanban.open) ? el(InspectorSection, { title: "Kanban" },
        asList(detail.kanban.running).length ? el("ul", { className: "olympus-work" }, detail.kanban.running.map((task) => el(RunningTask, { key: task.board + ":" + task.id, task, ctx, agentId: agent.id, now: ctx.now }))) : null,
        el(KanbanSummary, { kanban: detail.kanban })
      ) : null,
      detail ? el("footer", { className: "olympus-inspector-foot" },
        el(TokenChart, { days: usage.days }),
        el("dl", { className: "olympus-facts" },
          el("div", null, el("dt", null, "Kanban worker runs"), el("dd", null,
            success.rate == null ? "None finished this week" : success.succeeded + " of " + (success.succeeded + success.failed) + " succeeded (" + Math.round(success.rate * 100) + "%)"))
        ),
        asList(detail.fixes).length ? el("div", { className: "olympus-fixes" },
          el("h4", null, "Your fixes"),
          el("ul", null, detail.fixes.map((fix) => el("li", { key: fix.key },
            el("span", null, fix.title),
            el("small", { className: "olympus-verdict olympus-verdict-" + fix.verdict.replace(" ", "-") }, VERDICT_TEXT[fix.verdict] || fix.verdict)
          )))
        ) : null,
        el("small", { className: "olympus-muted" }, usage.basis || "")
      ) : null
    );
  }

  // ---------------------------------------------------------------------
  // Performance: how well each agent's runs go over 7 or 30 days.
  // ---------------------------------------------------------------------

  const PERFORMANCE_REFRESH_MS = 60000;
  const OUTCOME_SERIES = [
    { key: "succeeded", label: "Succeeded", className: "olympus-series-ok" },
    { key: "cut_off", label: "Cut off", className: "olympus-series-cut" },
    { key: "failed", label: "Failed", className: "olympus-series-failed" },
    { key: "open", label: "Still running", className: "olympus-series-open" }
  ];
  const OUTCOME_TEXT = { succeeded: "Succeeded", failed: "Failed", cut_off: "Cut off", open: "Still running" };
  const TOOL_ATTENTION_RATE = 0.2;

  // Day labels: weekdays for a week, a date every fifth day for a month.
  function dayLabel(day, idx, count) {
    const ts = Date.parse(day + "T12:00:00Z");
    if (!Number.isFinite(ts)) return day;
    if (count <= 7) return new Date(ts).toLocaleDateString([], { weekday: "short", timeZone: "UTC" });
    return idx % 5 === 0 || idx === count - 1 ? new Date(ts).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" }) : "";
  }

  // Bars per UTC day; several series stack, one series is a plain bar.
  function DayBars({ rows, series, caption, format, peakUnit }) {
    const list = asList(rows);
    const totals = list.map((row) => series.reduce((sum, item) => sum + Number(row[item.key] || 0), 0));
    const max = Math.max(...totals, 0);
    const summary = list.map((row, idx) => row.day + " " + format(totals[idx])).join(", ");
    return el("figure", { className: "olympus-token-chart" },
      el("figcaption", null,
        el("span", null, caption),
        series.length > 1 ? el("span", { className: "olympus-legend" },
          series.map((item) => el("span", { key: item.key }, el("i", { className: item.className, "aria-hidden": "true" }), item.label))
        ) : null
      ),
      max ? el("div", { className: "olympus-token-bars", style: { gridTemplateColumns: "repeat(" + list.length + ", minmax(0, 1fr))" }, role: "img", "aria-label": caption + ": " + summary },
        list.map((row, idx) => el("div", { key: row.day, className: "olympus-token-day", title: row.day + ": " + format(totals[idx]) },
          el("div", { className: "olympus-token-stack", style: { height: Math.round((totals[idx] / max) * 100) + "%" } },
            series.map((item) => totals[idx] ? el("span", { key: item.key, className: item.className, style: { flexGrow: Number(row[item.key] || 0) } }) : null)
          ),
          el("small", null, dayLabel(row.day, idx, list.length))
        ))
      ) : el("p", { className: "olympus-muted" }, "Nothing recorded in this range."),
      max ? el("small", { className: "olympus-chart-scale" }, "Peak " + format(max) + (peakUnit ? " " + peakUnit : "")) : null
    );
  }

  const PERF_SORTS = {
    success: (a, b) => (a.success_rate == null ? 2 : a.success_rate) - (b.success_rate == null ? 2 : b.success_rate) || b.runs - a.runs,
    name: (a, b) => String(a.label).localeCompare(String(b.label)),
    runs: (a, b) => b.runs - a.runs,
    cost: (a, b) => b.cost_usd - a.cost_usd
  };

  function runTimes(row) {
    if (row.median_seconds == null) return el("span", { className: "olympus-muted" }, "No finished runs");
    const change = row.trend ? row.trend.median_change : null;
    return el("span", null, formatSpan(row.median_seconds * 1000),
      el("small", null, "slow " + formatSpan(row.p90_seconds * 1000)),
      change != null && Math.abs(change) >= 0.05 ? el("small", { className: change >= SLOWER_SHARE ? "olympus-attention-text" : null }, speedText(change)) : null);
  }

  // Trend: this window against the equal window before it. Words carry the
  // direction; colour only underlines a clear turn for the worse.
  const WORSE_POINTS = -0.05;
  const SLOWER_SHARE = 0.25;

  function speedText(change) {
    return Math.round(Math.abs(change) * 100) + "% " + (change > 0 ? "slower" : "faster") + " than before";
  }

  // The comparison names the earlier rate itself ("was 100% the 7 days before"),
  // so nobody has to add points to a percentage; null when there is nothing to compare.
  function beforeText(row, days) {
    const before = row.previous ? row.previous.success_rate : null;
    const points = row.trend ? row.trend.success_rate_points : null;
    if (before == null || points == null) return null;
    if (Math.round(Math.abs(points) * 100) === 0) return "Same as the " + days + " days before";
    return "was " + percent(before) + " the " + days + " days before";
  }

  // Success rate per day as one thin line; days with nothing finished leave a gap.
  function Sparkline({ daily, label }) {
    const list = asList(daily);
    const rates = list.map((day) => {
      const finished = Number(day.succeeded || 0) + Number(day.failed || 0) + Number(day.cut_off || 0);
      return finished ? Number(day.succeeded || 0) / finished : null;
    });
    if (!rates.some((rate) => rate != null)) return null;
    const width = 84, height = 22, pad = 3;
    const x = (idx) => list.length > 1 ? pad + (idx / (list.length - 1)) * (width - 2 * pad) : width / 2;
    const y = (rate) => height - pad - rate * (height - 2 * pad);
    let path = "";
    let open = false;
    // A day with no finished neighbour has no line to sit on, so it gets its
    // own dot; the latest day always gets the larger one.
    const dots = [];
    rates.forEach((rate, idx) => {
      if (rate == null) { open = false; return; }
      path += (open ? " L" : " M") + x(idx).toFixed(1) + " " + y(rate).toFixed(1);
      open = true;
      const alone = rates[idx - 1] == null && rates[idx + 1] == null;
      if (alone) dots.push({ x: x(idx), y: y(rate), r: 1.5 });
    });
    const lastIdx = rates.length - 1 - rates.slice().reverse().findIndex((rate) => rate != null);
    if (dots.length && dots[dots.length - 1].x === x(lastIdx)) dots.pop(); // the latest day's dot is the large one
    dots.push({ x: x(lastIdx), y: y(rates[lastIdx]), r: 2.5 });
    const summary = list.map((day, idx) => dayLabel(day.day, idx, list.length) + (rates[idx] == null ? " none finished" : " " + percent(rates[idx]))).filter((text) => text.trim()).join(", ");
    return el("span", { className: "olympus-spark", role: "img", "aria-label": label + " by day: " + summary, title: summary },
      el("svg", { viewBox: "0 0 " + width + " " + height, "aria-hidden": "true", focusable: "false" },
        el("line", { x1: pad, x2: width - pad, y1: height - pad, y2: height - pad }),
        el("path", { d: path.trim() }),
        dots.map((dot, idx) => el("circle", { key: idx, cx: dot.x.toFixed(1), cy: dot.y.toFixed(1), r: dot.r }))
      )
    );
  }

  function TrendCell({ row, days }) {
    const trend = row.trend || {};
    const points = trend.success_rate_points;
    let text;
    if (points == null) {
      const why = row.success_rate == null ? "Nothing finished to compare"
        : !trend.previous_runs ? "No runs the " + days + " days before"
        : "Nothing finished before";
      text = el("small", { className: "olympus-muted" }, why);
    }
    else text = el("small", { className: points <= WORSE_POINTS ? "olympus-attention-text" : null }, beforeText(row, days));
    return el("span", { className: "olympus-trend" }, el(Sparkline, { daily: row.daily, label: "Success rate" }), text);
  }

  function PerformanceTable({ agents, selected, onSelect, sort, onSort, days }) {
    const rows = asList(agents).slice().sort(PERF_SORTS[sort] || PERF_SORTS.success);
    function header(key, label) {
      const active = sort === key;
      return el("th", { scope: "col", "aria-sort": active ? (key === "name" || key === "success" ? "ascending" : "descending") : "none" },
        el("button", { type: "button", className: cx("olympus-sort", active && "olympus-sort-active"), onClick: () => onSort(key) }, label));
    }
    return el("table", { className: "olympus-roster olympus-perf-table" },
      el("caption", { className: "olympus-sr-only" }, "Run performance per agent. Select an agent for its charts and runs."),
      el("thead", null, el("tr", null,
        header("name", "Agent"),
        header("runs", "Runs"),
        header("success", "Succeeded"),
        el("th", { scope: "col" }, "Trend"),
        el("th", { scope: "col" }, "Typical run"),
        el("th", { scope: "col" }, "Tools per run"),
        el("th", { scope: "col" }, "Tool failures"),
        el("th", { scope: "col" }, "Tokens per run"),
        header("cost", "Cost")
      )),
      el("tbody", null, rows.map((row) => el("tr", {
        key: row.id,
        "data-agent": row.id,
        tabIndex: 0,
        "aria-selected": selected === row.id ? "true" : "false",
        className: cx("olympus-row", selected === row.id && "olympus-row-selected"),
        onClick: () => onSelect(row.id),
        onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.id); } }
      },
        el("td", { className: "olympus-cell-agent" }, el(Avatar, { agent: row }), el("span", { className: "olympus-agent-name" }, el("strong", null, row.label))),
        el("td", { "data-label": "Runs" }, formatCount(row.runs), row.subagent_runs ? el("small", null, " +" + row.subagent_runs + " subagent") : null),
        el("td", { "data-label": "Succeeded" }, row.success_rate == null ? el("span", { className: "olympus-muted" }, "None finished") : el("span", { className: cx("olympus-rate", rateClass(row.success_rate)) },
          percent(row.success_rate), el("small", null, [row.failed ? row.failed + " failed" : null, row.cut_off ? row.cut_off + " cut off" : null].filter(Boolean).join(", ")))),
        el("td", { "data-label": "Trend" }, el(TrendCell, { row, days })),
        el("td", { "data-label": "Typical run" }, runTimes(row)),
        el("td", { "data-label": "Tools per run" }, String(row.tool_calls_per_run)),
        el("td", { "data-label": "Tool failures" }, row.tool_error_rate == null ? el("span", { className: "olympus-muted" }, "No tool calls") :
          el("span", { className: row.tool_error_rate >= TOOL_ATTENTION_RATE ? "olympus-attention-text" : null }, percent(row.tool_error_rate), el("small", null, row.tool_failures + " of " + formatCount(row.tool_calls)))),
        el("td", { "data-label": "Tokens per run" }, formatTokens(row.tokens_per_run)),
        el("td", { "data-label": "Cost" }, formatMoney(row.cost_usd))
      )))
    );
  }

  function RunList({ title, runs, onInspect, now }) {
    const list = asList(runs);
    if (!list.length) return null;
    return el(InspectorSection, { title },
      el("ul", { className: "olympus-work" }, list.map((run) => el("li", { key: run.ref, className: "olympus-work-row" },
        el("div", null,
          el("strong", null, run.label),
          el("small", { className: run.outcome === "failed" ? "olympus-error-text" : run.outcome === "cut_off" ? "olympus-attention-text" : null }, [
            OUTCOME_TEXT[run.outcome],
            run.duration_seconds != null ? formatDuration(run.duration_seconds) : null,
            plural(run.tool_calls, "tool call"),
            formatMoney(run.cost_usd),
            ago(run.started_at, now)
          ].filter(Boolean).join(" · "))
        ),
        el("div", { className: "olympus-work-actions" },
          el("button", { type: "button", className: "olympus-button", onClick: () => onInspect(run.ref) }, "Inspect run"))
      )))
    );
  }

  function PerformancePanel({ row, days, ctx, onClose, onInspect }) {
    const panel = useRef(null);
    useEffect(() => { if (panel.current) panel.current.focus({ preventScroll: true }); }, [row.id]);
    const tools = asList(row.tools);
    return el("aside", {
      ref: panel,
      tabIndex: -1,
      className: "olympus-inspector",
      "aria-label": "Performance of " + row.label,
      onKeyDown: (event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }
    },
      el("div", { className: "olympus-inspector-head" },
        el("button", { type: "button", className: "olympus-back", onClick: onClose }, "Back to performance"),
        el(Avatar, { agent: row, size: "large" }),
        el("div", { className: "olympus-inspector-title" },
          el("h2", null, row.label),
          el("p", null, "Last " + days + " days")
        ),
        el("div", { className: "olympus-inspector-controls" },
          el("button", { type: "button", className: "olympus-link-button", onClick: () => ctx.openAgent(row.id) }, "Open in Agents"),
          el("button", { type: "button", className: "olympus-close", "aria-label": "Close performance panel", onClick: onClose }, "×")
        )
      ),
      el("dl", { className: "olympus-facts" },
        el("div", null, el("dt", null, "Runs"), el("dd", null, formatCount(row.runs) + (row.open ? " (" + row.open + " running)" : ""))),
        el("div", null, el("dt", null, "Succeeded"), el("dd", { className: rateClass(row.success_rate) }, row.success_rate == null ? "None finished" : percent(row.success_rate) + " of " + formatCount(row.succeeded + row.failed + row.cut_off),
          row.trend && row.trend.success_rate_points != null ? el("small", { className: row.trend.success_rate_points <= WORSE_POINTS ? "olympus-attention-text" : null }, beforeText(row, days)) : null)),
        el("div", null, el("dt", null, "Typical run"), el("dd", null, row.median_seconds == null ? "None finished" : formatSpan(row.median_seconds * 1000) + ", slow " + formatSpan(row.p90_seconds * 1000),
          row.trend && row.trend.median_change != null && Math.abs(row.trend.median_change) >= 0.05 ? el("small", { className: row.trend.median_change >= SLOWER_SHARE ? "olympus-attention-text" : null }, speedText(row.trend.median_change)) : null)),
        el("div", null, el("dt", null, "Cost"), el("dd", null, formatMoney(row.cost_usd)))
      ),
      el(DayBars, { rows: row.daily, series: OUTCOME_SERIES, caption: "Runs per day", format: (n) => formatCount(n), peakUnit: "runs" }),
      el(DayBars, { rows: row.daily, series: [{ key: "median_seconds", label: "Typical run", className: "olympus-series-input" }], caption: "Typical run time per day", format: (n) => formatDuration(n) }),
      el(DayBars, { rows: row.daily, series: [{ key: "cost_usd", label: "Cost", className: "olympus-series-input" }], caption: "Cost per day", format: (n) => formatMoney(n) }),
      tools.length ? el(InspectorSection, { title: "Tools" },
        el("table", { className: "olympus-table" },
          el("caption", { className: "olympus-sr-only" }, "Tool calls and failures"),
          el("thead", null, el("tr", null, ["Tool", "Calls", "Failed", "Failure rate"].map((label) => el("th", { key: label, scope: "col" }, label)))),
          el("tbody", null, tools.map((tool) => el("tr", { key: tool.tool },
            el("td", null, tool.tool),
            el("td", null, formatCount(tool.calls)),
            el("td", null, formatCount(tool.failures)),
            el("td", { className: tool.failures > 1 && tool.error_rate >= TOOL_ATTENTION_RATE ? "olympus-attention-text" : null }, percent(tool.error_rate))
          )))
        )
      ) : null,
      el(RunList, { title: "Failed or cut off", runs: row.failed_runs, onInspect, now: ctx.now }),
      el(RunList, { title: "Slowest runs", runs: row.slowest, onInspect, now: ctx.now })
    );
  }

  const STEP_WHO = { user: "You", assistant: "Agent", system: "System" };

  function RunView({ runRef, onBack }) {
    const [detail, setDetail] = useState(null);
    const [error, setError] = useState(null);
    const panel = useRef(null);
    useEffect(() => {
      let live = true;
      setDetail(null);
      setError(null);
      SDK.fetchJSON(API + "/run?ref=" + encodeURIComponent(runRef))
        .then((result) => { if (live) { if (result.found) setDetail(result); else setError("Hermes no longer has this run."); } })
        .catch((err) => { if (live) setError(toErrorMessage(err)); });
      if (panel.current) panel.current.focus({ preventScroll: true });
      return () => { live = false; };
    }, [runRef]);
    const run = detail && detail.run;
    const started = run ? parseTime(run.started_at) : null;
    return el("aside", {
      ref: panel,
      tabIndex: -1,
      className: "olympus-inspector",
      "aria-label": "Run detail",
      onKeyDown: (event) => { if (event.key === "Escape") { event.stopPropagation(); onBack(); } }
    },
      el("div", { className: "olympus-run-head" },
        el("button", { type: "button", className: "olympus-link-button", onClick: onBack }, "← Back to " + (detail ? detail.agent.label : "the agent")),
        run ? el("h2", null, run.label) : null,
        run ? el("p", { className: cx("olympus-run-outcome", run.outcome === "failed" && "olympus-error-text", run.outcome === "cut_off" && "olympus-attention-text") },
          [OUTCOME_TEXT[run.outcome], run.duration_seconds != null ? formatDuration(run.duration_seconds) : null, run.source, run.end_reason ? "ended: " + String(run.end_reason).replaceAll("_", " ") : null].filter(Boolean).join(" · ")) : null
      ),
      error ? el("p", { className: "olympus-error-text", role: "alert" }, error) : null,
      !detail && !error ? el(RosterSkeleton) : null,
      run ? el("dl", { className: "olympus-facts" },
        el("div", null, el("dt", null, "Model calls"), el("dd", null, formatCount(run.api_calls))),
        el("div", null, el("dt", null, "Tool calls"), el("dd", null, formatCount(run.tool_calls) + (detail.tool_failures ? ", " + detail.tool_failures + " failed" : ""))),
        el("div", null, el("dt", null, "Tokens"), el("dd", null, formatTokens(run.tokens))),
        el("div", null, el("dt", null, "Cost"), el("dd", null, formatMoney(run.cost_usd)))
      ) : null,
      run ? el(SessionLinks, { targets: [{ kind: "session", ref: run.ref, label: "this" }] }) : null,
      detail ? el(InspectorSection, { title: "Steps", count: detail.steps_total },
        el("ol", { className: "olympus-timeline" }, detail.steps.map((step, idx) => {
          const at = parseTime(step.at);
          return el("li", { key: idx, className: cx("olympus-step", (step.failed || step.error) && "olympus-step-error") },
            el("time", { dateTime: step.at, title: step.at }, at != null && started != null ? "+" + formatSpan(at - started) : ""),
            el("span", { className: "olympus-step-kind" }, step.tool || STEP_WHO[step.role] || step.role),
            el("span", { className: "olympus-step-text" },
              step.failed ? "Failed" : step.error ? "Ended on an error" : step.preview || (step.role === "tool" ? "Returned" : step.role === "user" ? "Message" : "Replied"),
              step.preview && (step.failed || step.error) ? el("small", null, step.preview) : null
            ),
            el("small", { className: "olympus-step-ago" }, [step.seconds != null ? formatDuration(step.seconds) : null, step.tokens ? formatTokens(step.tokens) + " tokens" : null].filter(Boolean).join(" · "))
          );
        })),
        detail.steps_total > detail.steps.length ? el("small", { className: "olympus-muted" }, "Showing the first " + detail.steps.length + " of " + detail.steps_total + " steps.") : null,
        detail.content_shown ? null : el("small", { className: "olympus-muted" }, "Message content is hidden. It shows on a private machine with dashboard.olympus.expose_local_labels: true.")
      ) : null
    );
  }

  function PerformanceView({ ctx, days, onDays, selected, onSelect, runRef, onRun }) {
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);
    const [sort, setSort] = useState("success");
    useEffect(() => {
      let live = true;
      let timer = null;
      function load() {
        SDK.fetchJSON(API + "/performance?days=" + days)
          .then((next) => { if (live) { setReport(next); setError(next.error || null); } })
          .catch((err) => { if (live) setError(toErrorMessage(err)); })
          .finally(() => { if (live) timer = window.setTimeout(load, PERFORMANCE_REFRESH_MS); });
      }
      setReport(null);
      load();
      return () => { live = false; window.clearTimeout(timer); };
    }, [days]);
    const fleet = report && report.fleet;
    const row = report && selected ? asList(report.agents).find((agent) => agent.id === selected) : null;
    return el("div", { className: "olympus-performance" },
      el("div", { className: "olympus-perf-head" },
        el("div", { className: "olympus-range", role: "group", "aria-label": "Range" },
          [7, 30].map((n) => el("button", {
            key: n,
            type: "button",
            className: cx("olympus-view-switch", days === n && "olympus-view-current"),
            "aria-pressed": days === n ? "true" : "false",
            onClick: () => onDays(n)
          }, n + " days"))
        ),
        fleet ? el("p", { className: "olympus-census" }, [
          plural(fleet.runs, "run"),
          fleet.success_rate == null ? null : percent(fleet.success_rate) + " succeeded",
          fleet.median_seconds == null ? null : "typical run " + formatDuration(fleet.median_seconds) + " (slow " + formatDuration(fleet.p90_seconds) + ")",
          fleet.tool_error_rate == null ? null : percent(fleet.tool_error_rate) + " of tool calls failed",
          formatMoney(fleet.cost_usd)
        ].filter(Boolean).join(" · ")) : null
      ),
      error ? el("p", { className: "olympus-error-text", role: "alert" }, "Could not read performance: " + error) : null,
      !report && !error ? el(RosterSkeleton) : null,
      fleet ? el(DayBars, { rows: fleet.daily, series: OUTCOME_SERIES, caption: "Runs per day, all agents", format: (n) => formatCount(n), peakUnit: "runs" }) : null,
      report ? el("div", { className: cx("olympus-workspace", (row || runRef) && "olympus-workspace-split") },
        el("div", { className: "olympus-roster-wrap" },
          el(PerformanceTable, { agents: report.agents, selected, onSelect, sort, onSort: setSort, days }),
          el("small", { className: "olympus-muted olympus-perf-basis" }, report.basis)
        ),
        runRef ? el(RunView, { runRef, onBack: () => onRun(null) })
          : row ? el(PerformancePanel, { row, days, ctx, onClose: () => onSelect(null), onInspect: onRun }) : null
      ) : null
    );
  }

  // ---------------------------------------------------------------------
  // Checks: the material that is not about one agent.
  // ---------------------------------------------------------------------

  const SEVERITY_TEXT = { critical: "Critical", warning: "Warning", info: "Note", ok: "OK" };

  function CheckSection({ id, title, lead, link, children }) {
    return el("section", { id, className: "olympus-check", "aria-labelledby": id + "-title" },
      el("div", { className: "olympus-check-head" },
        el("h2", { id: id + "-title" }, title),
        link ? el("a", { className: "olympus-link", href: routeLink(link) }, routeLabel(link)) : null
      ),
      lead ? el("p", { className: "olympus-check-lead" }, lead) : null,
      children
    );
  }

  function Finding({ item, children }) {
    return el("li", { className: "olympus-finding" },
      el("span", { className: "olympus-severity olympus-severity-" + (item.severity || "info") }, SEVERITY_TEXT[item.severity] || item.severity),
      el("div", null,
        el("strong", null, item.title),
        item.detail ? el("p", null, item.detail) : null,
        item.evidence ? el("small", null, item.evidence) : null,
        children
      ),
      item.recommended_view ? el("a", { className: "olympus-link", href: routeLink(item.recommended_view) }, item.action_label || routeLabel(item.recommended_view)) : null
    );
  }

  function FindingsCheck({ tuning, fixes, ctx }) {
    const items = asList(tuning && tuning.agent_hq && tuning.agent_hq.recommendations).filter((item) => item.severity !== "ok");
    const tracked = new Set(asList(fixes).map((fix) => fix.key));
    return el(CheckSection, { id: "olympus-check-findings", title: "Findings", lead: items.length ? "Everything Olympus noticed across your agents, worst first. The urgent ones are also in Needs you." : "Nothing to report in this scan." },
      items.length ? el("ul", { className: "olympus-findings" }, items.map((item) => el(Finding, { key: item.key, item },
        el("div", { className: "olympus-finding-actions" },
          el(SessionLinks, { targets: item.targets }),
          tracked.has(item.key) ? el("span", { className: "olympus-action-done" }, "Tracking your fix") : el(ActionButton, {
            action: { id: "fix", label: "I fixed this", target: { kind: "finding", ref: item.key }, effect: "Olympus notes the current count and tells you on later scans whether it cleared." },
            subject: item.title,
            controls: ctx.controls,
            onDone: ctx.onActionDone
          })
        )
      ))) : null,
      asList(fixes).length ? el(React.Fragment, null,
        el("h3", null, "Did your fixes work?"),
        el("ul", { className: "olympus-fix-list" }, fixes.map((fix) => el("li", { key: fix.key },
          el("span", null, fix.title),
          el("small", null, [
            fix.baseline == null ? null : fix.baseline + " → " + fix.current,
            fix.days_tracked ? "tracked " + plural(fix.days_tracked, "day") : "tracked since today"
          ].filter(Boolean).join(" · ")),
          el("small", { className: "olympus-verdict olympus-verdict-" + fix.verdict.replace(" ", "-") }, VERDICT_TEXT[fix.verdict] || fix.verdict),
          el(StopTracking, { fixKey: fix.key, onDone: ctx.onActionDone })
        )))
      ) : null
    );
  }

  function StopTracking({ fixKey, onDone }) {
    const [state, setState] = useState("idle");
    function stop() {
      setState("saving");
      SDK.fetchJSON(API + "/fixes?key=" + encodeURIComponent(fixKey), { method: "DELETE" })
        .then(() => onDone())
        .catch(() => setState("failed"));
    }
    return el("button", { type: "button", className: "olympus-link-button", onClick: stop, disabled: state === "saving" },
      state === "failed" ? "Could not stop; retry" : "Stop tracking");
  }

  function BacklogCheck({ backlog }) {
    const groups = asList(backlog && backlog.groups);
    if (!groups.length) return null;
    const summary = backlog.summary || {};
    return el(CheckSection, {
      id: "olympus-check-backlog",
      title: "Backlog",
      link: "/kanban",
      lead: plural(Number(summary.tasks || 0), "stuck task") + ", grouped by who has to act. " + formatCount(summary.needs_you) + " need a person."
    },
      el("ul", { className: "olympus-findings" }, groups.map((group) => el("li", { key: group.kind, className: "olympus-finding" },
        el("span", { className: "olympus-severity olympus-severity-" + group.severity }, plural(group.count, "task")),
        el("div", null,
          el("strong", null, group.label),
          el("p", null, group.action),
          el("small", null, [
            group.oldest_days != null ? "oldest " + plural(group.oldest_days, "day") : null,
            group.repeat_blocks ? group.repeat_blocks + " blocked more than once" : null,
            asList(group.assignees).map((a) => a.assignee + " " + a.count).join(", ")
          ].filter(Boolean).join(" · "))
        )
      )))
    );
  }

  function SkillsCheck({ hygiene }) {
    const data = hygiene || {};
    const summary = data.summary || {};
    const signals = asList(data.signals);
    const hub = asList(data.hub).filter((item) => item.state && item.state !== "ok");
    if (!summary.total_skills && !signals.length) return null;
    return el(CheckSection, {
      id: "olympus-check-skills",
      title: "Skills",
      link: "/skills",
      lead: plural(Number(summary.total_skills || 0), "skill") + " installed. " + [
        summary.stale ? summary.stale + " stale" : null,
        summary.never_used ? summary.never_used + " never used" : null,
        summary.hub_audit_fail ? summary.hub_audit_fail + " failed a security audit" : null
      ].filter(Boolean).join(", ") + (summary.stale || summary.never_used || summary.hub_audit_fail ? "." : "No hygiene issues.")
    },
      signals.length ? el("ul", { className: "olympus-findings" }, signals.map((item, idx) => el(Finding, { key: idx, item }))) : null,
      hub.length ? el(React.Fragment, null,
        el("h3", null, "Hub skills to review"),
        el("ul", { className: "olympus-plain-list" }, hub.map((item) => el("li", { key: item.id || item.label },
          el("span", null, item.label),
          el("small", null, [item.trust_level ? "trust " + item.trust_level : "no trust level", item.scan_verdict ? "scan " + item.scan_verdict : "not scanned", item.audit_summary].filter(Boolean).join(" · "))
        )))
      ) : null
    );
  }

  function settingValue(item) {
    if (item.unit === "usd") return formatMoney(item.value);
    if (typeof item.value === "number") return formatCount(item.value);
    return String(item.value == null || item.value === "" ? "none" : item.value);
  }

  function PolicyCheck({ policy }) {
    const data = policy || {};
    const findings = asList(data.findings);
    const settings = asList(data.settings);
    if (!findings.length && !settings.length) return null;
    return el(CheckSection, { id: "olympus-check-policy", title: "Policy", link: "/config", lead: findings.length ? plural(findings.length, "configuration risk") + " found." : "No configuration risks found." },
      findings.length ? el("ul", { className: "olympus-findings" }, findings.map((item, idx) => el(Finding, { key: idx, item }))) : null,
      settings.length ? el("dl", { className: "olympus-settings" }, settings.map((item) => el("div", { key: item.id || item.label },
        el("dt", null, item.label),
        el("dd", null, settingValue(item), item.detail ? el("small", null, item.detail) : null)
      ))) : null
    );
  }

  function SpendCheck({ attribution }) {
    const data = attribution || {};
    const jobs = asList(data.cron && data.cron.jobs);
    const tasks = asList(data.background && data.background.tasks);
    if (!Number(data.window_cost_usd || 0) && !jobs.length && !tasks.length) return null;
    return el(CheckSection, {
      id: "olympus-check-spend",
      title: "Where spend goes",
      link: "/analytics",
      lead: formatMoney(data.window_cost_usd) + " across sessions in the last " + (data.window_days || 7) + " days: " +
        formatMoney(data.cron && data.cron.total_cost_usd) + " scheduled, " + formatMoney(data.background && data.background.total_cost_usd) + " in background tasks."
    },
      jobs.length ? el("table", { className: "olympus-table" },
        el("caption", { className: "olympus-sr-only" }, "Scheduled jobs by estimated cost"),
        el("thead", null, el("tr", null, ["Scheduled job", "Runs", "Tokens", "Avg run", "Errors", "Est. cost"].map((label) => el("th", { key: label, scope: "col" }, label)))),
        el("tbody", null, jobs.map((job) => el("tr", { key: job.job_ref },
          el("td", null, el("strong", null, job.label), el("small", null, [job.profile, job.schedule].filter(Boolean).join(" · "))),
          el("td", null, formatCount(job.fires)),
          el("td", null, formatTokens(job.tokens)),
          el("td", null, formatDuration(job.avg_duration_seconds)),
          el("td", { className: job.errors ? "olympus-attention-text" : null }, formatCount(job.errors)),
          el("td", null, formatMoney(job.est_cost_usd))
        )))
      ) : null,
      tasks.length ? el(React.Fragment, null,
        el("h3", null, "Background tasks"),
        el("ul", { className: "olympus-plain-list" }, tasks.map((task) => el("li", { key: task.task },
          el("span", null, task.task.replaceAll("_", " ")),
          el("small", null, formatCount(task.calls) + " calls · " + formatTokens(task.tokens) + " tokens · " + formatMoney(task.cost_usd))
        )))
      ) : null,
      jobs.length && data.cron.allocation ? el("small", { className: "olympus-muted" }, data.cron.allocation) : null
    );
  }

  function DebugCheck({ data, client }) {
    const diag = (data && data.diagnostics) || {};
    const sources = asList(data && data.evidence_sources && data.evidence_sources.items);
    return el("details", { className: "olympus-debug" },
      el("summary", null, "Debug details"),
      el("dl", { className: "olympus-settings" },
        [
          ["Scan built in", diag.generated_ms ? Math.round(diag.generated_ms) + " ms" : "unknown"],
          ["Payload", formatBytes(diag.payload_bytes)],
          ["Fetch", client && client.fetch_ms != null ? client.fetch_ms + " ms" : "pending"],
          ["Render", client && client.render_ms != null ? client.render_ms + " ms" : "pending"],
          ["Hermes", diag.hermes && diag.hermes.version || "unknown"]
        ].map((pair) => el("div", { key: pair[0] }, el("dt", null, pair[0]), el("dd", null, pair[1])))
      ),
      sources.length ? el(React.Fragment, null,
        el("h3", null, "Evidence sources"),
        el("ul", { className: "olympus-plain-list" }, sources.map((item) => el("li", { key: item.id || item.label },
          el("span", null, item.label),
          el("small", null, [item.state, item.redaction].filter(Boolean).join(" · "))
        )))
      ) : null
    );
  }

  function Checks({ data, ctx, client }) {
    return el("div", { className: "olympus-checks" },
      el(FindingsCheck, { tuning: data.tuning, fixes: data.fixes, ctx }),
      el(BacklogCheck, { backlog: data.backlog }),
      el(SkillsCheck, { hygiene: data.skill_hygiene }),
      el(PolicyCheck, { policy: data.config_policy }),
      el(SpendCheck, { attribution: data.cost_attribution }),
      el(DebugCheck, { data, client })
    );
  }

  // ---------------------------------------------------------------------
  // Backend off: Hermes served the tab but /api/plugins/olympus did not
  // mount. List the agents from Hermes' own API and say how to turn it on.
  // ---------------------------------------------------------------------

  function loadStaticRoster(reason) {
    return SDK.fetchJSON("/api/profiles")
      .catch(() => ({ profiles: [] }))
      .then((result) => {
        const profiles = asList(result && result.profiles);
        const agents = profiles.map((_profile, idx) => {
          const label = idx === 0 ? "Default" : "Profile " + idx;
          return {
            id: "profile:" + idx,
            label,
            avatar: idx === 0 ? "D" : String(idx),
            status: "unknown",
            status_label: "Not checked",
            current: null,
            helpers: {},
            runs_7d: null,
            issues: 0,
            last_active_at: null
          };
        });
        return { static: { reason }, generated_at: new Date().toISOString(), agents: null, static_agents: agents, needs_you: [], controls: false };
      });
  }

  function BackendOff({ info }) {
    return el("section", { className: "olympus-note olympus-backend-off", role: "status" },
      el("h2", null, "The Olympus backend is not running"),
      el("p", null, "Without it Olympus can only list your agents. Enable it and restart the dashboard:"),
      el("pre", null, el("code", null, "hermes plugins enable olympus\nhermes dashboard")),
      info.reason ? el("small", { className: "olympus-muted" }, "Hermes said: " + info.reason) : null
    );
  }

  function StaticRoster({ agents }) {
    return el("ul", { className: "olympus-static-roster" }, asList(agents).map((agent) => el("li", { key: agent.id },
      el(Avatar, { agent }),
      el("strong", null, agent.label),
      el(StatusPill, { status: "unknown", label: "Not checked" })
    )));
  }

  // ---------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------

  function OlympusPage() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [client, setClient] = useState(null);
    const [view, setView] = useState(["performance", "checks"].includes(readParam("view")) ? readParam("view") : "agents");
    const [days, setDays] = useState(readParam("days") === "30" ? 30 : 7);
    const [runRef, setRunRef] = useState(readParam("run"));
    const [selected, setSelected] = useState(readParam("agent"));
    const [detail, setDetail] = useState(null);
    const [detailError, setDetailError] = useState(null);
    const [sort, setSort] = useState("status");
    const [notice, setNotice] = useState(null);
    const noticeTimer = useRef(null);
    const now = useNow(1000);
    // One request at a time: the next poll is scheduled only after the
    // previous /overview settles, so a slow backend never stacks requests.
    const inFlight = useRef(false);
    const mounted = useRef(true);
    const pollTimer = useRef(null);
    const selectedRef = useRef(selected);
    const lastRow = useRef(null);

    function clock() {
      return window.performance && performance.now ? performance.now() : Date.now();
    }

    function loadDetail(agentId) {
      if (!agentId) return Promise.resolve();
      return SDK.fetchJSON(API + "/agent?ref=" + encodeURIComponent(agentId))
        .then((next) => {
          if (!mounted.current || selectedRef.current !== agentId) return;
          if (next && next.found) {
            setDetail(next);
            setDetailError(null);
          } else {
            setDetail(null);
            setDetailError("this agent no longer exists in Hermes");
          }
        })
        .catch((err) => {
          if (mounted.current && selectedRef.current === agentId) setDetailError(toErrorMessage(err));
        });
    }

    function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      window.clearTimeout(pollTimer.current);
      setLoading(true);
      const started = clock();
      SDK.fetchJSON(API + "/overview?ts=" + encodeURIComponent(String(Date.now())))
        .then((next) => {
          if (!mounted.current) return;
          const received = clock();
          setData(next);
          setError(null);
          window.requestAnimationFrame(() => {
            if (!mounted.current) return;
            setClient({ fetch_ms: Math.round(received - started), render_ms: Math.round(clock() - received) });
          });
          return loadDetail(selectedRef.current);
        })
        .catch((err) => loadStaticRoster(toErrorMessage(err)).then((fallback) => {
          if (mounted.current) setData(fallback);
        }).catch((fallbackErr) => {
          if (mounted.current) setError(toErrorMessage(fallbackErr));
        }))
        .finally(() => {
          inFlight.current = false;
          if (!mounted.current) return;
          setLoading(false);
          pollTimer.current = window.setTimeout(load, POLL_INTERVAL_MS);
        });
    }

    useEffect(() => {
      mounted.current = true;
      load();
      return () => {
        mounted.current = false;
        window.clearTimeout(pollTimer.current);
        window.clearTimeout(noticeTimer.current);
      };
    }, []);

    function openAgent(agentId) {
      const active = document.activeElement;
      if (active && active.matches && active.matches("tr[data-agent]")) lastRow.current = active.getAttribute("data-agent");
      else lastRow.current = agentId;
      selectedRef.current = agentId;
      setSelected(agentId);
      setDetail(null);
      setDetailError(null);
      setView("agents");
      writeParam("view", null);
      writeParam("agent", agentId);
      loadDetail(agentId);
    }

    function showRun(ref) {
      setRunRef(ref);
      writeParam("run", ref);
    }

    // Performance keeps the same ?agent= selection as the roster.
    function selectPerformance(agentId) {
      if (!agentId) {
        closeAgent();
        return;
      }
      lastRow.current = agentId;
      selectedRef.current = agentId;
      setSelected(agentId);
      writeParam("agent", agentId);
      showRun(null);
    }

    function changeDays(next) {
      setDays(next);
      writeParam("days", next === 7 ? null : String(next));
    }

    function closeAgent() {
      const back = lastRow.current;
      selectedRef.current = null;
      setSelected(null);
      setDetail(null);
      writeParam("agent", null);
      showRun(null);
      window.requestAnimationFrame(() => {
        const row = back && document.querySelector('tr[data-agent="' + CSS.escape(back) + '"]');
        if (row) row.focus();
      });
    }

    function changeView(next, anchor) {
      setView(next);
      writeParam("view", next === "agents" ? null : next);
      if (anchor) window.requestAnimationFrame(() => {
        const target = document.getElementById(anchor);
        if (target) target.scrollIntoView({ block: "start" });
      });
    }

    // After a control succeeds, say so (the item it fixed usually leaves the
    // queue on the refresh) and refresh at once so the change shows.
    function onActionDone(message) {
      if (message) {
        setNotice(message);
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
      }
      window.clearTimeout(pollTimer.current);
      if (!inFlight.current) load();
    }

    useEffect(() => {
      function onKey(event) {
        if (event.key === "Escape" && selectedRef.current && !event.defaultPrevented) closeAgent();
      }
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, []);

    const agents = asList(data && data.agents && data.agents.agents);
    const agentById = {};
    agents.forEach((agent) => { agentById[agent.id] = agent; });
    const ctx = {
      now,
      agents,
      agentById,
      controls: Boolean(data && data.controls),
      openAgent,
      openPerformance: () => changeView("performance"),
      onActionDone
    };
    const open = selected && (agentById[selected] || detail);

    let body;
    if (error) body = el("p", { className: "olympus-error-text", role: "alert" }, "Olympus could not read Hermes: " + error);
    else if (!data) body = el(RosterSkeleton);
    else if (data.static) body = el(React.Fragment, null, el(BackendOff, { info: data.static }), el(StaticRoster, { agents: data.static_agents }));
    else if (view === "checks") body = el(Checks, { data, ctx, client });
    else if (view === "performance") body = el(PerformanceView, { ctx, days, onDays: changeDays, selected, onSelect: selectPerformance, runRef, onRun: showRun });
    else body = el(React.Fragment, null,
      el(NeedsYouBanner, { queue: data.needs_you, ctx }),
      el("div", { className: cx("olympus-workspace", open && "olympus-workspace-split") },
        el("div", { className: "olympus-roster-wrap" },
          el(Roster, { agents, queue: data.needs_you, selected, ctx, sort, onSort: setSort }),
          el(EmptyNote, { agents }),
          !ctx.controls ? el("p", { className: "olympus-muted olympus-controls-off" }, "Controls are off (dashboard.olympus.controls: false). Olympus shows what needs you and links to the Hermes page that fixes it.") : null
        ),
        open ? el(Inspector, { agentId: selected, detail, error: detailError, ctx, onClose: closeAgent }) : null
      )
    );

    return el("div", { className: "olympus-page" },
      el(Header, { data, view, onView: changeView, loading, now }),
      el(GreekKey),
      el("p", { className: cx("olympus-notice", notice && "olympus-notice-shown"), role: "status" }, notice || ""),
      body
    );
  }

  window.__HERMES_PLUGINS__.register("olympus", OlympusPage);
})();
