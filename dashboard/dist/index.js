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

  // Stacked bars: tokens per UTC day, input / cache / output.
  function TokenChart({ days }) {
    return el(DayBars, {
      rows: days, series: TOKEN_SERIES, caption: "Tokens per day", format: formatTokens, peakUnit: "tokens", whole: true,
      empty: "No tokens recorded in the last 7 days."
    });
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
    { id: "live", label: "Live" },
    { id: "floor", label: "Floor" },
    { id: "performance", label: "Performance" },
    { id: "checks", label: "Checks" }
  ];

  // The glance view is the whole page (it is what the popup shows), so it
  // carries neither the view switch nor the popout button.
  function Header({ data, view, onView, loading, now, popout }) {
    const summary = (data && data.agents && data.agents.summary) || {};
    const updated = data && data.generated_at ? ago(data.generated_at, now) : null;
    const chrome = data && !data.static && view !== "glance";
    return el("header", { className: "olympus-header" },
      el("div", { className: "olympus-brand" },
        el(Laurel),
        el("h1", { className: "olympus-wordmark" }, "Olympus")
      ),
      el("p", { className: "olympus-census", "aria-live": "polite" },
        data && data.agents ? census(summary, data.agents.agents) : data && data.static ? "Agents only: the Olympus backend is off" : "Reading your agents…"),
      el("div", { className: "olympus-header-meta" },
        el("span", { className: "olympus-updated" }, loading && !data ? "Loading" : updated ? "Updated " + updated : ""),
        chrome ? el("nav", { className: "olympus-views", "aria-label": "Olympus views" },
          VIEWS.map((item) => el("button", {
            key: item.id,
            type: "button",
            className: cx("olympus-view-switch", view === item.id && "olympus-view-current"),
            "aria-current": view === item.id ? "page" : undefined,
            onClick: () => onView(item.id)
          }, item.label))
        ) : null,
        chrome ? el("button", {
          type: "button",
          className: cx("olympus-view-switch olympus-popout", popout.open && "olympus-view-current"),
          "aria-pressed": popout.open ? "true" : "false",
          title: popout.open ? "Close the small window" : "Your agents in a small window that stays on top",
          onClick: popout.toggle
        }, popout.open ? "Close popout" : "Pop out") : null
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

  // The full date for a bar's hover text and the day panel ("Wed, Oct 29").
  function dayTitle(day) {
    const ts = Date.parse(day + "T12:00:00Z");
    return Number.isFinite(ts) ? new Date(ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : day;
  }

  // Value-axis ticks under the peak: multiples of 1, 2 or 5 times a power of
  // ten, the largest step that still gives two lines (four at most); counts
  // get whole numbers only.
  function axisTicks(max, whole) {
    if (!(max > 0)) return [];
    const power = Math.pow(10, Math.floor(Math.log10(max)));
    const steps = [5, 2, 1, 0.5, 0.2].map((n) => n * power).filter((step) => !whole || Number.isInteger(step));
    const step = steps.find((candidate) => max / candidate >= 2) || steps[steps.length - 1];
    if (!step) return [max];
    const ticks = [];
    for (let value = step; value <= max * 1.000001 && ticks.length < 4; value += step) ticks.push(Number(value.toFixed(6)));
    return ticks;
  }

  // Bars per UTC day; several series stack, one series is a plain bar. The
  // value axis and a label on hover or focus make every bar readable; with
  // onPick each bar is a button that opens that day's runs.
  function DayBars({ rows, series, caption, format, peakUnit, whole, tickUnit, empty, onPick, picked }) {
    const list = asList(rows);
    const totals = list.map((row) => series.reduce((sum, item) => sum + Number(row[item.key] || 0), 0));
    const max = Math.max(...totals, 0);
    // Ticks fall on round values of the unit read (whole minutes for seconds).
    const ticks = axisTicks(max / (tickUnit || 1), whole).map((value) => value * (tickUnit || 1));
    const unit = peakUnit ? " " + peakUnit : "";
    const columns = { gridTemplateColumns: "repeat(" + list.length + ", minmax(0, 1fr))" };
    const pct = (value) => (value / max) * 100 + "%";
    // One label for the hovered or focused bar, placed over the plot: near
    // its bar in the middle, pinned to the edge for the outer quarter.
    const [shown, setShown] = useState(null);
    function detail(row, idx) {
      const parts = series.length > 1
        ? series.filter((item) => Number(row[item.key] || 0) > 0).map((item) => format(row[item.key]) + " " + item.label.toLowerCase())
        : [];
      return dayTitle(row.day) + ": " + format(totals[idx]) + unit + (parts.length ? " (" + parts.join(", ") + ")" : "");
    }
    function labelPlace(idx) {
      const centre = (idx + 0.5) / list.length;
      if (centre < 0.25) return { left: 0 };
      if (centre > 0.75) return { right: 0 };
      return { left: centre * 100 + "%", transform: "translateX(-50%)" };
    }
    const longest = ticks.map(format).reduce((a, b) => (b.length > a.length ? b : a), "");
    const summary = list.map((row, idx) => row.day + " " + format(totals[idx])).join(", ");
    return el("figure", { className: "olympus-token-chart" },
      el("figcaption", null,
        el("span", null, caption),
        series.length > 1 ? el("span", { className: "olympus-legend" },
          series.map((item) => el("span", { key: item.key }, el("i", { className: item.className, "aria-hidden": "true" }), item.label))
        ) : null
      ),
      max ? el("div", { className: "olympus-chart-plot" },
        el("div", { className: "olympus-chart-axis", "aria-hidden": "true" },
          el("span", { className: "olympus-chart-axis-size" }, longest),
          ticks.map((value) => el("span", { key: value, style: { bottom: pct(value) } }, format(value)))
        ),
        el("div", { className: "olympus-token-bars", style: columns, role: onPick ? "group" : "img", "aria-label": caption + ": " + summary },
          el("div", { className: "olympus-chart-grid", "aria-hidden": "true" },
            ticks.map((value) => el("i", { key: value, style: { bottom: pct(value) } }))
          ),
          list.map((row, idx) => el(onPick ? "button" : "div", {
            key: row.day,
            type: onPick ? "button" : undefined,
            className: cx("olympus-token-day", picked === row.day && "olympus-token-day-picked"),
            "data-day": row.day,
            "aria-label": onPick ? detail(row, idx) + ". Show these runs" : undefined,
            "aria-pressed": onPick ? (picked === row.day ? "true" : "false") : undefined,
            onClick: onPick ? () => onPick(row.day) : undefined,
            onMouseEnter: () => setShown(idx),
            onMouseLeave: () => setShown((current) => (current === idx ? null : current)),
            onFocus: () => setShown(idx),
            onBlur: () => setShown((current) => (current === idx ? null : current))
          },
            el("span", { className: "olympus-token-stack", style: { height: pct(totals[idx]) } },
              series.map((item) => totals[idx] ? el("span", { key: item.key, className: item.className, style: { flexGrow: Number(row[item.key] || 0) } }) : null)
            )
          )),
          shown != null && list[shown] ? el("span", { className: "olympus-chart-value", "aria-hidden": "true", style: labelPlace(shown) }, detail(list[shown], shown)) : null
        ),
        el("div", { className: "olympus-chart-days", style: columns, "aria-hidden": "true" },
          list.map((row, idx) => el("small", { key: row.day }, dayLabel(row.day, idx, list.length)))
        )
      ) : el("p", { className: "olympus-muted" }, empty || "Nothing recorded in this range."),
      max ? el("small", { className: "olympus-chart-scale" }, "Peak " + format(max) + unit) : null
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

  function RunList({ title, runs, onInspect, now, showAgent }) {
    const list = asList(runs);
    if (!list.length) return null;
    return el(InspectorSection, { title },
      el("ul", { className: "olympus-work" }, list.map((run) => el("li", { key: run.ref, className: "olympus-work-row" },
        el("div", null,
          el("strong", null, run.label),
          el("small", { className: run.outcome === "failed" ? "olympus-error-text" : run.outcome === "cut_off" ? "olympus-attention-text" : null }, [
            showAgent && run.agent ? run.agent.label : null,
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

  function PerformancePanel({ row, days, ctx, onClose, onInspect, onDay }) {
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
      el(DayBars, { rows: row.daily, series: OUTCOME_SERIES, caption: "Runs per day", format: formatCount, peakUnit: "runs", whole: true, onPick: onDay }),
      el(DayBars, { rows: row.daily, series: [{ key: "median_seconds", label: "Typical run", className: "olympus-series-input" }], caption: "Typical run time per day", format: formatDuration, tickUnit: 60 }),
      el(DayBars, { rows: row.daily, series: [{ key: "cost_usd", label: "Cost", className: "olympus-series-input" }], caption: "Cost per day", format: formatMoney }),
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

  // The runs behind one bar of a runs-per-day chart: the fleet's, or one
  // agent's when its panel's chart was clicked.
  function DayPanel({ day, agent, ctx, onClose, onInspect }) {
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);
    const panel = useRef(null);
    const agentId = agent ? agent.id : null;
    useEffect(() => {
      let live = true;
      setReport(null);
      setError(null);
      SDK.fetchJSON(API + "/performance/day?day=" + encodeURIComponent(day) + (agentId ? "&agent=" + encodeURIComponent(agentId) : ""))
        .then((next) => { if (live) { if (next.error) setError(next.error); else setReport(next); } })
        .catch((err) => { if (live) setError(toErrorMessage(err)); });
      if (panel.current) panel.current.focus({ preventScroll: true });
      return () => { live = false; };
    }, [day, agentId]);
    const summary = report && report.summary;
    return el("aside", {
      ref: panel,
      tabIndex: -1,
      className: "olympus-inspector",
      "aria-label": "Runs on " + dayTitle(day),
      onKeyDown: (event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }
    },
      el("div", { className: "olympus-inspector-head" },
        el("button", { type: "button", className: "olympus-back", onClick: onClose }, agent ? "Back to " + agent.label : "Back to performance"),
        agent ? el(Avatar, { agent, size: "large" }) : null,
        el("div", { className: "olympus-inspector-title" },
          el("h2", null, dayTitle(day)),
          el("p", null, agent ? agent.label : "All agents")
        ),
        el("div", { className: "olympus-inspector-controls" },
          el("button", { type: "button", className: "olympus-close", "aria-label": "Close the day", onClick: onClose }, "×")
        )
      ),
      error ? el("p", { className: "olympus-error-text", role: "alert" }, "Could not read the day: " + error) : null,
      !report && !error ? el(RosterSkeleton) : null,
      summary ? el("p", { className: "olympus-census" }, [
        plural(summary.runs, "run"),
        summary.succeeded ? summary.succeeded + " succeeded" : null,
        summary.failed ? summary.failed + " failed" : null,
        summary.cut_off ? summary.cut_off + " cut off" : null,
        summary.median_seconds == null ? null : "typical run " + formatDuration(summary.median_seconds),
        formatMoney(summary.cost_usd)
      ].filter(Boolean).join(" · ")) : null,
      report ? (report.runs.length
        ? el(RunList, { title: "Runs", runs: report.runs, onInspect, now: ctx.now, showAgent: !agent })
        : el("p", { className: "olympus-muted" }, "No runs started that day.")) : null,
      report && report.total > report.runs.length ? el("small", { className: "olympus-muted" }, "Showing the newest " + report.runs.length + " of " + report.total + " runs.") : null
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

  // The fleet line, with how this window compares to the one before it.
  function fleetCensus(fleet, days) {
    const trend = fleet.trend || {};
    const before = beforeText(fleet, days);
    const speed = trend.median_change != null && Math.abs(trend.median_change) >= 0.05 ? speedText(trend.median_change) : null;
    const parts = [
      plural(fleet.runs, "run"),
      fleet.success_rate == null ? null : el("span", { key: "ok" }, percent(fleet.success_rate) + " succeeded",
        before ? el("span", { className: trend.success_rate_points <= WORSE_POINTS ? "olympus-attention-text" : "olympus-muted" }, ", " + before.charAt(0).toLowerCase() + before.slice(1)) : null),
      fleet.median_seconds == null ? null : el("span", { key: "time" }, "typical run " + formatDuration(fleet.median_seconds) + " (slow " + formatDuration(fleet.p90_seconds) + ")",
        speed ? el("span", { className: trend.median_change >= SLOWER_SHARE ? "olympus-attention-text" : "olympus-muted" }, ", " + speed) : null),
      fleet.tool_error_rate == null ? null : percent(fleet.tool_error_rate) + " of tool calls failed",
      formatMoney(fleet.cost_usd)
    ].filter(Boolean);
    return parts.flatMap((part, idx) => idx ? [" · ", part] : [part]);
  }

  function PerformanceView({ ctx, days, onDays, selected, onSelect, runRef, onRun, day, onDay }) {
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
        fleet ? el("p", { className: "olympus-census" }, fleetCensus(fleet, days)) : null
      ),
      error ? el("p", { className: "olympus-error-text", role: "alert" }, "Could not read performance: " + error) : null,
      !report && !error ? el(RosterSkeleton) : null,
      fleet ? el(DayBars, {
        rows: fleet.daily, series: OUTCOME_SERIES, caption: "Runs per day, all agents", format: formatCount, peakUnit: "runs", whole: true,
        onPick: (picked) => onDay(picked, null), picked: row ? null : day
      }) : null,
      report ? el("div", { className: cx("olympus-workspace", (row || runRef || day) && "olympus-workspace-split") },
        el("div", { className: "olympus-roster-wrap" },
          el(PerformanceTable, { agents: report.agents, selected, onSelect, sort, onSort: setSort, days }),
          el("small", { className: "olympus-muted olympus-perf-basis" }, report.basis)
        ),
        runRef ? el(RunView, { runRef, onBack: () => onRun(null) })
          : day ? el(DayPanel, { day, agent: row, ctx, onClose: () => onDay(null, row ? row.id : null), onInspect: onRun })
          : row ? el(PerformancePanel, { row, days, ctx, onClose: () => onSelect(null), onInspect: onRun, onDay: (picked) => onDay(picked, row.id) }) : null
      ) : null
    );
  }

  // ---------------------------------------------------------------------
  // Live: every open run and its subagents, read again every five seconds.
  // One lane per agent with an open run; a run is two levels deep (the run,
  // then the subagents delegate_task opened under it), so each lane is a
  // short tree, not a graph. The backend orders lanes by what needs eyes
  // (a failed subagent, then the most running; ties keep profile order).
  // Idle agents fold into one line at the end.
  // ---------------------------------------------------------------------

  const LIVE_REFRESH_MS = 5000;
  const LIVE_WINDOW_MS = 60000;
  const LIVE_STRIP_WIDTH = 120;
  const LIVE_STRIP_HEIGHT = 14;
  const SOURCE_TEXT = { cli: "CLI", oneshot: "CLI", cron: "Cron", kanban: "Kanban", subagent: "Subagent", api_server: "API", acp: "ACP" };
  const CHILD_STATUS_TEXT = { running: "Running", done: "Done", failed: "Failed", ended: "Ended" };

  function sourceText(source) {
    const key = String(source || "session");
    return SOURCE_TEXT[key] || key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
  }

  function spanBetween(startIso, endIso) {
    const start = parseTime(startIso);
    const end = parseTime(endIso);
    return start == null || end == null ? null : formatSpan(Math.max(0, end - start));
  }

  // The tool a session is on. The code element is keyed by its text so a
  // change remounts it and the stylesheet fades the new one in. A chip that
  // was on screen at first paint stays still until its text changes.
  function ToolChip({ tool, settled }) {
    const [mountedLate] = useState(settled);
    const previous = useRef(undefined);
    const text = toolText(tool);
    // A chip appearing where there was none is a change too.
    const changed = previous.current !== undefined && previous.current !== text;
    previous.current = text;
    if (!text) return null;
    return el("code", { key: text, className: cx("olympus-lane-tool", (mountedLate || changed) && "olympus-lane-tool-change"), title: text }, text);
  }

  // The last minute of tool calls as ticks: a call in accent, a failed call
  // taller and in the failure colour. Positions are measured from the time of
  // the read, so the strip moves only when a new read arrives.
  function ActivityStrip({ ticks, readAt }) {
    const anchor = parseTime(readAt);
    const rows = asList(ticks).filter((tick) => parseTime(tick.at) != null);
    const failed = rows.filter((tick) => tick.error).length;
    const label = rows.length
      ? plural(rows.length, "tool call") + " in the last minute" + (failed ? ", " + failed + " failed" : "")
      : "No tool calls in the last minute";
    return el("span", { className: "olympus-lane-strip-cell" },
      el("svg", {
        className: "olympus-lane-strip",
        width: LIVE_STRIP_WIDTH,
        height: LIVE_STRIP_HEIGHT,
        viewBox: "0 0 " + LIVE_STRIP_WIDTH + " " + LIVE_STRIP_HEIGHT,
        role: "img",
        "aria-label": label
      },
        el("title", null, label),
        el("line", { x1: 0, y1: LIVE_STRIP_HEIGHT - 0.5, x2: LIVE_STRIP_WIDTH, y2: LIVE_STRIP_HEIGHT - 0.5, className: "olympus-lane-strip-base" }),
        rows.map((tick, idx) => {
          const age = anchor == null ? 0 : Math.max(0, Math.min(1, (anchor - parseTime(tick.at)) / LIVE_WINDOW_MS));
          return el("rect", {
            key: tick.at + idx,
            x: LIVE_STRIP_WIDTH - 2,
            y: tick.error ? 1 : 5,
            width: 2,
            height: tick.error ? LIVE_STRIP_HEIGHT - 2 : LIVE_STRIP_HEIGHT - 6,
            className: cx("olympus-lane-tick", tick.error && "olympus-lane-tick-error"),
            style: { transform: "translateX(-" + (age * LIVE_STRIP_WIDTH).toFixed(1) + "px)" }
          });
        })
      ),
      el("small", { className: "olympus-lane-strip-caption", "aria-hidden": "true" },
        rows.length ? plural(rows.length, "call") + (failed ? ", " + failed + " failed" : "") + " · last minute" : "no calls · last minute")
    );
  }

  // `fresh`: the subagent appeared since the last read, so it slides in from
  // its parent. Rows already on screen at first paint stay still.
  function ChildRow({ child, now, fresh, settled, onOpen }) {
    const running = child.status === "running";
    return el("li", { className: cx("olympus-lane-child", "olympus-lane-child-" + child.status, fresh && "olympus-lane-child-new"), "data-status": child.status },
      el("span", { className: "olympus-lane-cell olympus-lane-status" },
        el("span", { className: cx("olympus-lane-dot", "olympus-lane-dot-" + child.status), "aria-hidden": "true" }),
        CHILD_STATUS_TEXT[child.status] || child.status
      ),
      el("button", { type: "button", className: "olympus-link-button olympus-lane-cell olympus-lane-label", title: child.label, onClick: () => onOpen(child.ref) }, child.label),
      el("span", { className: "olympus-lane-cell olympus-lane-time" }, running ? elapsed(child.started_at, now) : spanBetween(child.started_at, child.ended_at)),
      el("span", { className: "olympus-lane-cell olympus-lane-tool-cell" }, el(ToolChip, { tool: child.last_tool, settled })),
      el("span", { className: "olympus-lane-cell olympus-lane-note" }, child.errors ? plural(child.errors, "failed call") : null)
    );
  }

  // The last leaf of a run's tree: batch progress from the manifest when
  // there is one, otherwise a count of the finished subagents. Failures keep
  // their colour so a closed fold still says something went wrong.
  function foldText(batch, finished) {
    const failed = batch ? batch.failed : finished.filter((child) => child.status === "failed").length;
    const failedText = failed ? el("span", { key: "failed", className: "olympus-lane-fold-failed" }, plural(failed, "failed")) : null;
    if (batch) return ["Tasks done " + batch.done + " of " + batch.total, failedText ? ", " : null, failedText];
    const done = finished.filter((child) => child.status === "done").length;
    const ended = finished.length - failed - done;
    const parts = [done ? plural(done, "done") : null, failedText, ended ? plural(ended, "ended") : null].filter(Boolean);
    return parts.flatMap((part, i) => (i ? [", ", part] : [part]));
  }

  // Every label is a session, so each opens that session's steps in the run
  // view. Running subagents stay as rows; finished ones fold under the batch
  // line, so a run reads as what is still moving plus one line of progress.
  function RunRow({ run, now, readAt, freshRefs, settled, onOpen }) {
    const batch = run.batch;
    const children = asList(run.children);
    const running = children.filter((child) => child.status === "running");
    const finished = children.filter((child) => child.status !== "running");
    const row = (child) => el(ChildRow, { key: child.ref, child, now, fresh: freshRefs.has(child.ref), settled, onOpen });
    let fold = null;
    if (finished.length) {
      fold = el("li", { key: "fold", className: "olympus-lane-fold" },
        el("details", { className: "olympus-lane-finished" },
          el("summary", { className: "olympus-lane-batch" }, foldText(batch, finished), el("span", { className: "olympus-lane-fold-toggle", "aria-hidden": "true" })),
          el("ol", { className: "olympus-lane-finished-list" }, finished.map(row))
        )
      );
    } else if (batch) {
      fold = el("li", { key: "fold", className: "olympus-lane-fold" }, el("p", { className: "olympus-lane-batch" }, foldText(batch, finished)));
    }
    return el("li", { className: "olympus-lane-run" },
      el("div", { className: "olympus-lane-run-row" },
        el("span", { className: "olympus-lane-cell olympus-lane-source" }, sourceText(run.source)),
        el("button", { type: "button", className: "olympus-link-button olympus-lane-cell olympus-lane-label", title: run.label, onClick: () => onOpen(run.ref) }, run.label),
        el("span", { className: "olympus-lane-cell olympus-lane-time" }, elapsed(run.started_at, now)),
        el("span", { className: "olympus-lane-cell olympus-lane-tool-cell" }, el(ToolChip, { tool: run.last_tool, settled })),
        el(ActivityStrip, { ticks: run.ticks, readAt })
      ),
      running.length || fold ? el("ol", { className: "olympus-lane-children" }, running.map(row), fold) : null
    );
  }

  function Lane({ lane, ctx, readAt, freshRefs, settled }) {
    const agent = ctx.agentById[lane.agent.id] || lane.agent;
    return el("section", { className: "olympus-lane", "aria-label": agent.label, "data-agent": agent.id },
      el("header", { className: "olympus-lane-head" },
        el(Avatar, { agent }),
        el("button", { type: "button", className: "olympus-link-button olympus-lane-name", onClick: () => ctx.openAgent(agent.id) }, agent.label),
        agent.status ? el(StatusPill, { status: agent.status, label: agent.status_label }) : null
      ),
      el("ol", { className: "olympus-lane-runs" }, asList(lane.runs).map((run) => el(RunRow, { key: run.ref, run, now: ctx.now, readAt, freshRefs, settled, onOpen: ctx.openRun })))
    );
  }

  // Agents with no open run, each with its roster status unless it is plain
  // idle, so a stalled or failed agent never reads as calm here.
  function noRunsLine(idle, ctx) {
    const names = idle.map((agent) => {
      const row = ctx.agentById[agent.id] || agent;
      return row.status && row.status !== "idle" && row.status_label ? row.label + " (" + row.status_label + ")" : row.label;
    });
    return "No open runs: " + names.join(", ");
  }

  function childRefs(payload) {
    const refs = new Set();
    asList(payload && payload.lanes).forEach((lane) => asList(lane.runs).forEach((run) => asList(run.children).forEach((child) => refs.add(child.ref))));
    return refs;
  }

  function liveCensus(summary) {
    const children = Number(summary.children || 0);
    return plural(Number(summary.runs || 0), "run") + " open on " + plural(Number(summary.agents_running || 0), "agent")
      + " · " + (children ? plural(children, "subagent") + " running" : "no subagents running");
  }

  // The one live poll, shared by the Live view, the Floor and the popout
  // so no two of them read /live at once. `freshRefs`: the subagents new
  // since the last read; `settled`: the first read has painted. Only those
  // animate, never the whole list at once. The poll stops while nothing
  // shows it and starts again, unsettled, when something does.
  function useLivePoll(active) {
    const [state, setState] = useState({ live: null, error: null, freshRefs: new Set(), settled: false });
    const seen = useRef(null);
    useEffect(() => {
      if (!active) return undefined;
      let alive = true;
      let timer = null;
      function load() {
        SDK.fetchJSON(API + "/live")
          .then((next) => {
            if (!alive) return;
            const refs = childRefs(next);
            const fresh = new Set();
            if (seen.current) refs.forEach((ref) => { if (!seen.current.has(ref)) fresh.add(ref); });
            seen.current = refs;
            setState((prev) => ({ ...prev, live: next, error: null, freshRefs: fresh }));
            window.requestAnimationFrame(() => { if (alive) setState((prev) => (prev.settled ? prev : { ...prev, settled: true })); });
          })
          .catch((err) => { if (alive) setState((prev) => ({ ...prev, error: toErrorMessage(err) })); })
          .finally(() => { if (alive) timer = window.setTimeout(load, LIVE_REFRESH_MS); });
      }
      load();
      // Leaving drops the snapshot: a view that comes back paints its first
      // read still, instead of animating everything that happened meanwhile.
      return () => {
        alive = false;
        window.clearTimeout(timer);
        seen.current = null;
        setState({ live: null, error: null, freshRefs: new Set(), settled: false });
      };
    }, [active]);
    return state;
  }

  function LiveView({ ctx, poll }) {
    const { live, error, freshRefs, settled } = poll;
    const lanes = asList(live && live.lanes);
    const idle = asList(live && live.idle);
    // The header already says when Olympus last read Hermes, so this view
    // adds one census line, and with nothing running, one sentence.
    return el("div", { className: "olympus-live" },
      lanes.length ? el("p", { className: "olympus-census olympus-live-head" }, liveCensus(live.summary || {})) : null,
      error ? el("p", { className: "olympus-error-text", role: "alert" }, "Could not read live runs: " + error) : null,
      !live && !error ? el(RosterSkeleton) : null,
      live && !lanes.length ? el("p", { className: "olympus-muted olympus-live-empty" },
        "Nothing is running. Start a chat, a cron job or a Kanban task and it shows here within " + live.poll_seconds + " s.") : null,
      lanes.map((lane) => el(Lane, { key: lane.agent.id, lane, ctx, readAt: live.generated_at, freshRefs, settled })),
      lanes.length && idle.length ? el("p", { className: "olympus-muted olympus-live-idle" }, noRunsLine(idle, ctx)) : null
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
  // Floor: every agent at a fixed place in one frame, so the whole fleet
  // reads from across a room. Motion only where Hermes recorded something:
  // a tool call pulses from the agent's node, a subagent enters from it and
  // keeps its slot, a ring says which agent needs you. A bet (PRODUCT.md).
  // Plain DOM like the glance list, so the popout can show it too; one
  // builder keeps the tab and the popout identical.
  // ---------------------------------------------------------------------

  const FLOOR_PULSE_LIMIT = 6;
  const FLOOR_PULSE_STEP_MS = 90;
  const FLOOR_PULSE_FALLBACK_MS = 1600;
  const FLOOR_COMPACT_SATS = 3;
  const SAT_STATE_TEXT = { done: "Done", failed: "Failed", ended: "Ended" };

  function tickKey(tick) {
    return String(tick.at) + (tick.error ? "!" : "");
  }

  function toolText(tool) {
    return tool && tool.name ? tool.name + (tool.args ? "(" + tool.args + ")" : "") : "";
  }

  // "2 need you · 3 working · 7 agents", the glance and floor census.
  function rosterCensus(summary, agentCount) {
    const need = Number(summary.need_you || 0);
    return [
      need ? need + (need === 1 ? " needs you" : " need you") : "none need you",
      Number(summary.working || 0) + " working",
      plural(agentCount, "agent")
    ];
  }

  // Plain-DOM element builder for a document (the tab's or the popout's).
  function domMaker(doc) {
    return (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    };
  }

  // A one-time entrance class leaves with its animation (or after its
  // length under reduced motion), so a later move of the node, or a resize
  // of a spoke, never replays it.
  function entranceOnce(node, className, ms, done) {
    const clear = () => {
      if (!node.classList.contains(className)) return;
      node.classList.remove(className);
      if (done) done();
    };
    node.addEventListener("animationend", clear);
    node.ownerDocument.defaultView.setTimeout(clear, ms);
  }

  // Stations are in name order and never re-sorted by state (the overview
  // lists agents by status), so an agent is always where the operator last
  // saw it; the rings, not the order, say which ones need you.
  function floorModel(data, live, now, compact) {
    const agents = asList(data && data.agents && data.agents.agents).slice()
      .sort((a, b) => String(a.label).localeCompare(String(b.label)) || String(a.id).localeCompare(String(b.id)));
    const summary = (data && data.agents && data.agents.summary) || {};
    const lanes = {};
    asList(live && live.lanes).forEach((lane) => { lanes[lane.agent.id] = lane; });
    const children = Number((live && live.summary && live.summary.children) || 0);
    return {
      hasLive: Boolean(live),
      census: rosterCensus(summary, agents.length)
        .concat(live ? [children ? plural(children, "subagent") + " running" : "no subagents running"] : []).join(" · "),
      stations: agents.map((agent) => {
        const runs = lanes[agent.id] ? asList(lanes[agent.id].runs) : [];
        const line = glanceText(agent);
        const ticks = [];
        const sats = [];
        runs.forEach((run) => {
          asList(run.ticks).forEach((tick) => ticks.push({ at: tick.at, error: Boolean(tick.error) }));
          asList(run.children).forEach((child) => sats.push({
            ref: child.ref,
            label: child.label,
            status: child.status,
            tool: toolText(child.last_tool),
            time: (child.status === "running" ? elapsed(child.started_at, now) : spanBetween(child.started_at, child.ended_at)) || ""
          }));
        });
        const failedCalls = ticks.filter((tick) => tick.error).length;
        const hidden = compact && sats.length > FLOOR_COMPACT_SATS ? sats.length - FLOOR_COMPACT_SATS : 0;
        return {
          id: agent.id,
          label: agent.label,
          avatar: agent.avatar || String(agent.label || "?").slice(0, 1).toUpperCase(),
          hue: avatarHue(agent.id),
          status: agent.status || "unknown",
          state: agent.status_label || "Not checked",
          text: line.text,
          since: line.since ? elapsed(line.since, now) : "",
          calls: !runs.length ? "" : ticks.length
            ? plural(ticks.length, "call") + " in the last minute" + (failedCalls ? ", " + failedCalls + " failed" : "")
            : "no calls in the last minute",
          ticks,
          sats: hidden ? sats.slice(0, FLOOR_COMPACT_SATS) : sats,
          hidden
        };
      })
    };
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function buildStation(doc, row, opts) {
    const make = domMaker(doc);
    const root = make("li", "olympus-floor-station");
    root.dataset.agent = row.id;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "olympus-floor-spokes");
    svg.setAttribute("aria-hidden", "true");
    root.appendChild(svg);
    const nodeCell = make("div", "olympus-floor-node-cell");
    const node = make("button", "olympus-floor-node");
    node.type = "button";
    node.addEventListener("click", () => opts.onOpenAgent(row.id));
    const avatar = make("span", "olympus-avatar", row.avatar);
    avatar.style.setProperty("--olympus-avatar-hue", String(row.hue));
    avatar.setAttribute("aria-hidden", "true");
    node.appendChild(avatar);
    const ring = make("span", "olympus-floor-ring");
    ring.setAttribute("aria-hidden", "true");
    node.appendChild(ring);
    nodeCell.appendChild(node);
    root.appendChild(nodeCell);
    const body = make("div", "olympus-floor-body");
    const head = make("div", "olympus-floor-head");
    const name = make("button", "olympus-link-button olympus-floor-name", row.label);
    name.type = "button";
    name.addEventListener("click", () => opts.onOpenAgent(row.id));
    head.appendChild(name);
    const pill = make("span", "olympus-status");
    const dot = make("span", "olympus-status-dot");
    dot.setAttribute("aria-hidden", "true");
    pill.appendChild(dot);
    pill.appendChild(make("span", "olympus-floor-state"));
    head.appendChild(pill);
    body.appendChild(head);
    const now = make("p", "olympus-floor-now");
    now.appendChild(make("span", "olympus-floor-text"));
    now.appendChild(make("span", "olympus-floor-since"));
    body.appendChild(now);
    body.appendChild(make("small", "olympus-floor-calls"));
    body.appendChild(make("ul", "olympus-floor-sats"));
    body.appendChild(make("p", "olympus-floor-more"));
    root.appendChild(body);
    return { root, svg, node, ring, name, pill, state: pill.lastChild, text: now.firstChild, since: now.lastChild, calls: body.children[2], sats: body.children[3], more: body.children[4], rows: new Map(), spokes: new Map(), ticks: null, hadLive: false, make };
  }

  function buildSat(st, sat, opts) {
    const make = st.make;
    const row = make("li", "olympus-floor-sat");
    row.dataset.ref = sat.ref;
    const dot = make("span", "olympus-floor-sat-dot");
    dot.setAttribute("aria-hidden", "true");
    row.appendChild(dot);
    const label = make("button", "olympus-link-button olympus-floor-sat-label");
    label.type = "button";
    label.addEventListener("click", () => opts.onOpenRun(sat.ref));
    row.appendChild(label);
    row.appendChild(make("span", "olympus-floor-sat-time"));
    row.appendChild(make("span", "olympus-floor-sat-state"));
    row.appendChild(make("code", "olympus-floor-sat-tool"));
    return { row, dot, label, time: row.children[2], state: row.children[3], tool: row.children[4] };
  }

  // Pulses are DOM for the length of their animation, then gone; a
  // timer covers reduced motion, where no animation ends.
  function spawnPulses(st, fresh) {
    fresh.slice(-FLOOR_PULSE_LIMIT).forEach((tick, idx) => {
      const pulse = st.make("span", cx("olympus-floor-pulse", tick.error && "olympus-floor-pulse-error"));
      pulse.setAttribute("aria-hidden", "true");
      pulse.dataset.at = tick.at;
      pulse.style.animationDelay = (idx * FLOOR_PULSE_STEP_MS) + "ms";
      const remove = () => pulse.remove();
      pulse.addEventListener("animationend", remove);
      st.node.ownerDocument.defaultView.setTimeout(remove, FLOOR_PULSE_FALLBACK_MS + idx * FLOOR_PULSE_STEP_MS);
      st.node.appendChild(pulse);
    });
  }

  function updateStation(st, row, opts, animate) {
    st.root.dataset.status = row.status;
    st.root.setAttribute("aria-label", row.label + ": " + row.state);
    st.node.setAttribute("aria-label", "Open " + row.label);
    st.pill.className = "olympus-status olympus-status-" + row.status;
    setText(st.state, row.state);
    setText(st.name, row.label);
    setText(st.text, row.text);
    setText(st.since, row.since);
    setText(st.calls, row.calls);
    setText(st.more, row.hidden ? "+" + plural(row.hidden, "more subagent") : "");
    // Subagents keep their slot by ref; a new one enters from the node.
    const keep = new Set();
    const live = animate && st.hadLive;
    row.sats.forEach((sat, index) => {
      keep.add(sat.ref);
      let item = st.rows.get(sat.ref);
      if (!item) {
        item = buildSat(st, sat, opts);
        if (live) {
          item.row.classList.add("olympus-floor-sat-new");
          entranceOnce(item.row, "olympus-floor-sat-new", FLOOR_PULSE_FALLBACK_MS);
        }
        item.fresh = live;
        st.rows.set(sat.ref, item);
      }
      item.row.className = cx("olympus-floor-sat", "olympus-floor-sat-" + sat.status, item.row.classList.contains("olympus-floor-sat-new") && "olympus-floor-sat-new");
      item.row.dataset.status = sat.status;
      setText(item.label, sat.label);
      item.label.title = sat.label;
      setText(item.time, sat.time);
      setText(item.state, SAT_STATE_TEXT[sat.status] || "");
      setText(item.tool, sat.tool);
      item.tool.title = sat.tool;
      const current = st.sats.children[index];
      if (current !== item.row) st.sats.insertBefore(item.row, current || null);
    });
    st.rows.forEach((item, ref) => {
      if (!keep.has(ref)) {
        item.row.remove();
        st.rows.delete(ref);
        const spoke = st.spokes.get(ref);
        if (spoke) { spoke.remove(); st.spokes.delete(ref); }
      }
    });
    // One pulse per tool call Hermes recorded since the last read.
    const keys = new Set(row.ticks.map(tickKey));
    if (live && st.ticks) spawnPulses(st, row.ticks.filter((tick) => !st.ticks.has(tickKey(tick))));
    st.ticks = keys;
  }

  // A hairline from the node to each subagent's dot, measured from the
  // laid-out boxes; a fresh spoke draws in with its row.
  // All layout reads first, then the writes, so a station costs one layout.
  function drawSpokes(st) {
    const box = st.root.getBoundingClientRect();
    if (!box.width) return;
    const node = st.node.getBoundingClientRect();
    const dots = [];
    st.rows.forEach((item, ref) => dots.push([ref, item, item.dot.getBoundingClientRect()]));
    const x1 = node.left + node.width / 2 - box.left;
    const y1 = node.top + node.height / 2 - box.top;
    st.svg.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);
    st.svg.setAttribute("width", String(box.width));
    st.svg.setAttribute("height", String(box.height));
    const r = node.width / 2 - 2;
    dots.forEach(([ref, item, dot]) => {
      const x2 = dot.left + dot.width / 2 - box.left;
      const y2 = dot.top + dot.height / 2 - box.top;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      // Start at the ring's edge, end at the dot's edge.
      const sx = x1 + (x2 - x1) * (r / len);
      const sy = y1 + (y2 - y1) * (r / len);
      const ex = x2 - (x2 - x1) * (5 / len);
      const ey = y2 - (y2 - y1) * (5 / len);
      let line = st.spokes.get(ref);
      if (!line) {
        line = st.svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "line");
        st.spokes.set(ref, line);
        if (item.fresh) {
          line.style.strokeDasharray = String(Math.ceil(len));
          line.style.strokeDashoffset = String(Math.ceil(len));
          line.classList.add("olympus-floor-spoke-new");
          entranceOnce(line, "olympus-floor-spoke-new", FLOOR_PULSE_FALLBACK_MS, () => {
            line.style.strokeDasharray = "";
            line.style.strokeDashoffset = "";
          });
        }
        st.svg.appendChild(line);
      }
      line.setAttribute("class", cx("olympus-floor-spoke", item.row.dataset.status === "failed" && "olympus-floor-spoke-failed", line.classList.contains("olympus-floor-spoke-new") && "olympus-floor-spoke-new"));
      line.setAttribute("x1", sx.toFixed(1));
      line.setAttribute("y1", sy.toFixed(1));
      line.setAttribute("x2", ex.toFixed(1));
      line.setAttribute("y2", ey.toFixed(1));
    });
  }

  // Drops the floor's state and its window listener when its host leaves.
  function destroyFloor(host) {
    const state = host && host.__olympusFloor;
    if (!state) return;
    host.ownerDocument.defaultView.removeEventListener("resize", state.onResize);
    delete host.__olympusFloor;
  }

  // Builds or updates the floor in `host`. Nothing animates on the first
  // paint; afterwards only what changed since the previous read moves.
  function renderFloor(host, model, opts) {
    const doc = host.ownerDocument;
    let state = host.__olympusFloor;
    const first = !state;
    if (first) {
      const section = doc.createElement("section");
      section.className = cx("olympus-floor", opts.compact && "olympus-floor-compact");
      section.setAttribute("aria-label", "Your agents on the floor");
      section.appendChild(doc.createElement("p")).className = "olympus-floor-census";
      section.appendChild(doc.createElement("ol")).className = "olympus-floor-stations";
      host.replaceChildren(section);
      state = host.__olympusFloor = { section, stations: new Map(), renders: 0, onResize: () => state.stations.forEach(drawSpokes) };
      doc.defaultView.addEventListener("resize", state.onResize);
    }
    setText(state.section.firstChild, model.census);
    const list = state.section.lastChild;
    const keep = new Set();
    model.stations.forEach((row, index) => {
      keep.add(row.id);
      let st = state.stations.get(row.id);
      if (!st) {
        st = buildStation(doc, row, opts);
        state.stations.set(row.id, st);
      }
      updateStation(st, row, opts, !first);
      st.hadLive = model.hasLive;
      const current = list.children[index];
      if (current !== st.root) list.insertBefore(st.root, current || null);
    });
    state.stations.forEach((st, id) => {
      if (!keep.has(id)) {
        st.root.remove();
        state.stations.delete(id);
      }
    });
    state.renders += 1;
    state.section.dataset.render = String(state.renders);
    state.stations.forEach(drawSpokes);
    state.stations.forEach((st) => st.rows.forEach((item) => { item.fresh = false; }));
  }

  // Elapsed times tick every second without touching anything else.
  function tickFloor(host, model) {
    const state = host.__olympusFloor;
    if (!state) return;
    model.stations.forEach((row) => {
      const st = state.stations.get(row.id);
      if (!st) return;
      setText(st.since, row.since);
      row.sats.forEach((sat) => {
        const item = st.rows.get(sat.ref);
        if (item) setText(item.time, sat.time);
      });
    });
  }

  function FloorView({ ctx, data, live }) {
    const host = useRef(null);
    const opts = { onOpenAgent: ctx.openAgent, onOpenRun: ctx.openRun, compact: false };
    useEffect(() => { renderFloor(host.current, floorModel(data, live.live, ctx.now, false), opts); }, [data, live.live]);
    useEffect(() => { tickFloor(host.current, floorModel(data, live.live, ctx.now, false)); }, [ctx.now]);
    // React clears the ref before this cleanup runs, so the node is taken
    // while it is still mounted.
    useEffect(() => { const node = host.current; return () => destroyFloor(node); }, []);
    return el("div", { className: "olympus-floor-view" },
      live.error ? el("p", { className: "olympus-error-text", role: "alert" }, "Could not read live runs: " + live.error) : null,
      el("div", { className: "olympus-floor-host", ref: host })
    );
  }

  // ---------------------------------------------------------------------
  // Glance: the roster in one small always-on-top window, so the agents
  // stay in view while the operator works elsewhere. A bet (PRODUCT.md):
  // nobody has asked for it. The list is plain DOM, not React: the Hermes
  // SDK exposes no ReactDOM, so a second window cannot host a React root.
  // The same builder draws ?view=glance in the tab, which is also what the
  // popup shows in browsers without Document Picture-in-Picture.
  // ---------------------------------------------------------------------

  const GLANCE_WIDTH = 340;
  const GLANCE_ROW_HEIGHT = 40;
  const GLANCE_LINE_HEIGHT = 28;
  const GLANCE_CHROME_HEIGHT = 42;
  const GLANCE_MIN_HEIGHT = 160;
  const GLANCE_MAX_HEIGHT = 480;

  // What the line says after the status word: for a working agent the task
  // or session it is on, for one that needs you the reason, for idle
  // nothing. The elapsed time shows only when it belongs to that text.
  function glanceText(agent) {
    const current = agent.current;
    if (agent.status === "working") return { text: current ? current.label : "", since: current ? current.since : null };
    if (agent.status === "waiting") {
      if (current && current.kind === "waiting") return { text: current.label, since: current.since };
      return { text: agent.status_reason || "", since: null };
    }
    return { text: agent.status === "idle" || agent.status === "unknown" ? "" : agent.status_reason || "", since: null };
  }

  function glanceModel(data, now) {
    const agents = asList(data && data.agents && data.agents.agents).slice().sort(SORTS.status);
    const summary = (data && data.agents && data.agents.summary) || {};
    return {
      census: rosterCensus(summary, agents.length).join(" · "),
      rows: agents.map((agent) => {
        const line = glanceText(agent);
        const subagents = Number((agent.helpers && agent.helpers.subagents) || 0);
        return {
          id: agent.id,
          label: agent.label,
          status: agent.status || "unknown",
          state: agent.status_label || "Not checked",
          text: [line.text, subagents ? plural(subagents, "subagent") : ""].filter(Boolean).join(" · "),
          since: line.since ? elapsed(line.since, now) : ""
        };
      })
    };
  }

  // The window opens as tall as its rows (two lines for an agent with
  // something to say, one for idle), between 160 and 480 px.
  function glanceHeight(model) {
    const rows = model.rows.reduce((sum, row) => sum + (row.text ? GLANCE_ROW_HEIGHT : GLANCE_LINE_HEIGHT), 0);
    return Math.max(GLANCE_MIN_HEIGHT, Math.min(GLANCE_MAX_HEIGHT, GLANCE_CHROME_HEIGHT + rows));
  }

  // Builds the glance into `host`: the census line with its List / Floor
  // switch, then either the list (every row a button that opens that agent
  // in the Olympus tab) or the floor. The list is rebuilt on every read;
  // the floor keeps its DOM between reads so only what changed moves.
  function renderGlance(host, model, onOpen, glance, floor) {
    const make = domMaker(host.ownerDocument);
    const mode = glance.mode === "floor" ? "floor" : "list";
    const previous = host.querySelector(".olympus-glance");
    if (previous && previous.dataset.mode === "floor" && mode === "floor") {
      setText(previous.querySelector(".olympus-glance-census"), model.census);
      previous.dataset.render = String(Number(previous.dataset.render || 0) + 1);
      renderFloor(previous.lastChild, floor.model, { onOpenAgent: onOpen, onOpenRun: floor.onOpenRun, compact: true });
      return;
    }
    if (previous && previous.dataset.mode === "floor") destroyFloor(previous.lastChild);
    const section = make("section", "olympus-glance");
    section.setAttribute("aria-label", "Your agents at a glance");
    section.dataset.mode = mode;
    const head = make("div", "olympus-glance-head");
    head.appendChild(make("p", "olympus-glance-census", model.census));
    const modes = make("div", "olympus-glance-modes");
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "Show as");
    [["list", "List"], ["floor", "Floor"]].forEach(([id, label]) => {
      const button = make("button", cx("olympus-glance-mode", mode === id && "olympus-glance-mode-current"), label);
      button.type = "button";
      button.dataset.mode = id;
      button.setAttribute("aria-pressed", mode === id ? "true" : "false");
      button.addEventListener("click", () => glance.onMode(id));
      modes.appendChild(button);
    });
    head.appendChild(modes);
    section.appendChild(head);
    section.dataset.render = String(previous ? Number(previous.dataset.render || 0) + 1 : 1);
    if (mode === "floor") {
      section.appendChild(make("div", "olympus-floor-host"));
      host.replaceChildren(section);
      renderFloor(section.lastChild, floor.model, { onOpenAgent: onOpen, onOpenRun: floor.onOpenRun, compact: true });
      return;
    }
    const list = make("ol", "olympus-glance-list");
    model.rows.forEach((row) => {
      const item = make("li");
      const button = make("button", "olympus-glance-row");
      button.type = "button";
      button.dataset.agent = row.id;
      button.dataset.status = row.status;
      button.addEventListener("click", () => onOpen(row.id));
      const dot = make("span", "olympus-glance-dot olympus-glance-dot-" + row.status);
      dot.setAttribute("aria-hidden", "true");
      button.appendChild(dot);
      button.appendChild(make("span", "olympus-glance-name", row.label));
      button.appendChild(make("span", "olympus-glance-state olympus-glance-state-" + row.status, row.state));
      button.appendChild(make("span", "olympus-glance-since", row.since));
      if (row.text) button.appendChild(make("span", "olympus-glance-text", row.text));
      item.appendChild(button);
      list.appendChild(item);
    });
    section.appendChild(list);
    host.replaceChildren(section);
  }

  // Elapsed times tick every second without rebuilding the rows.
  function tickGlance(host, model, floor) {
    const section = host.querySelector(".olympus-glance");
    if (section && section.dataset.mode === "floor") {
      tickFloor(section.lastChild, floor.model);
      return;
    }
    model.rows.forEach((row) => {
      const node = host.querySelector('.olympus-glance-row[data-agent="' + CSS.escape(row.id) + '"] .olympus-glance-since');
      if (node && node.textContent !== row.since) node.textContent = row.since;
    });
  }

  // The popout document gets the dashboard's stylesheets, the root
  // element's inline style (Hermes writes the active theme's tokens there),
  // and its attributes, so Olympus is native there in every Hermes theme.
  function adoptStyles(target) {
    Array.from(document.styleSheets).forEach((sheet) => {
      if (sheet.href) {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.head.appendChild(link);
        return;
      }
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n");
      target.head.appendChild(style);
    });
    Array.from(document.documentElement.attributes).forEach((attr) => {
      if (attr.name !== "class") target.documentElement.setAttribute(attr.name, attr.value);
    });
    target.documentElement.className = cx(document.documentElement.className, "olympus-glance-window");
    target.body.className = document.body.className;
  }

  function glanceUrl() {
    const params = new URLSearchParams(window.location.search);
    ["agent", "run", "days"].forEach((name) => params.delete(name));
    params.set("view", "glance");
    return window.location.pathname + "?" + params.toString();
  }

  // `glance`: the List / Floor mode, its setter, and the live payload the
  // floor draws from. `onOpenChange` tells the page the window is open, so
  // the live poll runs while the popout shows the floor.
  function usePopout(data, now, onOpen, glance, onOpenChange) {
    const [open, setOpen] = useState(false);
    const win = useRef(null);
    const pending = useRef(false);
    const host = () => (win.current ? win.current.document.body.firstElementChild : null);
    const floor = () => ({ model: floorModel(data, glance.live, now, true), onOpenRun: glance.onOpenRun });
    function setOpenState(next) {
      setOpen(next);
      onOpenChange(next);
    }
    // The popout shows the roster, so when the backend goes off and the
    // roster turns static the popout closes rather than going stale.
    useEffect(() => {
      if (!win.current || !data) return;
      if (data.static) win.current.close();
      else renderGlance(host(), glanceModel(data, now), onOpen, glance, floor());
    }, [data, glance.live, glance.mode]);
    useEffect(() => {
      if (win.current && data && !data.static) tickGlance(host(), glanceModel(data, now), floor());
    }, [now]);
    function openPopup() {
      window.open(glanceUrl(), "olympus-glance", "popup,width=" + (GLANCE_WIDTH + 20) + ",height=" + GLANCE_MAX_HEIGHT);
    }
    function toggle() {
      if (win.current) {
        win.current.close();
        return;
      }
      if (pending.current) return;
      if (!window.documentPictureInPicture) {
        openPopup();
        return;
      }
      const model = glanceModel(data, now);
      pending.current = true;
      window.documentPictureInPicture.requestWindow({ width: GLANCE_WIDTH, height: glanceHeight(model) }).then((pip) => {
        // The window is tracked before anything is drawn in it, so a failure
        // while filling it still leaves a window the header can close.
        pip.addEventListener("pagehide", () => {
          win.current = null;
          setOpenState(false);
        });
        win.current = pip;
        setOpenState(true);
        adoptStyles(pip.document);
        pip.document.title = "Olympus";
        const page = pip.document.createElement("div");
        page.className = "olympus-page olympus-glance-page";
        pip.document.body.appendChild(page);
        renderGlance(page, model, onOpen, glance, floor());
      // The browser can refuse the window (no user gesture left, a policy);
      // then the plain popup carries the same list. Only the refusal falls
      // back: a window that opened is never doubled by a popup.
      }, openPopup).finally(() => { pending.current = false; });
    }
    return { open, toggle };
  }

  function GlanceView({ data, now, onOpen, glance, onOpenRun }) {
    const host = useRef(null);
    const floor = () => ({ model: floorModel(data, glance.live, now, true), onOpenRun });
    useEffect(() => { renderGlance(host.current, glanceModel(data, now), onOpen, glance, floor()); }, [data, glance.live, glance.mode]);
    useEffect(() => { tickGlance(host.current, glanceModel(data, now), floor()); }, [now]);
    useEffect(() => {
      const node = host.current;
      return () => {
        const section = node && node.querySelector(".olympus-glance");
        if (section && section.dataset.mode === "floor") destroyFloor(section.lastChild);
      };
    }, []);
    return el("div", { className: "olympus-glance-host", ref: host });
  }

  // ---------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------

  function OlympusPage() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [client, setClient] = useState(null);
    const [view, setView] = useState(["live", "floor", "performance", "checks", "glance"].includes(readParam("view")) ? readParam("view") : "agents");
    // The popout (and the ?view=glance popup) shows the list or the floor.
    const [glanceMode, setGlanceMode] = useState(readParam("mode") === "floor" ? "floor" : "list");
    const [popoutOpen, setPopoutOpen] = useState(false);
    const [days, setDays] = useState(readParam("days") === "30" ? 30 : 7);
    const [runRef, setRunRef] = useState(readParam("run"));
    const [day, setDay] = useState(readParam("day"));
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
      setDay(null);
      writeParam("day", null);
      showRun(null);
    }

    // A bar of a runs-per-day chart opens that day's runs: the fleet's (which
    // drops the agent selection) or the selected agent's. The same bar again
    // closes them.
    function pickDay(next, agentId) {
      const value = next === day ? null : next;
      setDay(value);
      writeParam("day", value);
      if (value && !agentId && selectedRef.current) {
        selectedRef.current = null;
        setSelected(null);
        writeParam("agent", null);
      }
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
      setDay(null);
      writeParam("day", null);
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

    // A glance popup (the browsers without Document Picture-in-Picture)
    // asks this tab to open an agent; only a same-origin window is heard.
    useEffect(() => {
      function onKey(event) {
        if (event.key === "Escape" && selectedRef.current && !event.defaultPrevented) closeAgent();
      }
      function onMessage(event) {
        if (event.origin !== window.location.origin || !event.data) return;
        if (event.data.olympus === "open-agent") openAgent(String(event.data.id));
        else if (event.data.olympus === "open-run") openRunHere(String(event.data.ref));
        else return;
        window.focus();
      }
      document.addEventListener("keydown", onKey);
      window.addEventListener("message", onMessage);
      return () => {
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("message", onMessage);
      };
    }, []);

    // A session's steps live in the run view under Performance.
    function openRunHere(ref) {
      changeView("performance");
      showRun(ref);
    }

    // From the popout a row opens the agent (or a subagent's run) here and
    // asks for this tab.
    function openFromPopout(agentId) {
      openAgent(agentId);
      window.focus();
    }

    function openRunFromPopout(ref) {
      openRunHere(ref);
      window.focus();
    }

    function openRunFromGlance(ref) {
      const opener = window.opener;
      if (opener && !opener.closed && window.location.origin !== "null") {
        opener.postMessage({ olympus: "open-run", ref }, window.location.origin);
        opener.focus();
        return;
      }
      openRunHere(ref);
    }

    // In the glance view itself a row opens the agent in the tab that
    // opened this popup, or here when there is none.
    function openFromGlance(agentId) {
      const opener = window.opener;
      if (opener && !opener.closed && window.location.origin !== "null") {
        opener.postMessage({ olympus: "open-agent", id: agentId }, window.location.origin);
        opener.focus();
        return;
      }
      openAgent(agentId);
    }

    function changeGlanceMode(mode) {
      setGlanceMode(mode);
      writeParam("mode", mode === "floor" ? "floor" : null);
    }

    const floorShown = glanceMode === "floor" && (popoutOpen || view === "glance");
    const livePoll = useLivePoll(Boolean(data && !data.static) && (view === "live" || view === "floor" || floorShown));
    const glance = { mode: glanceMode, onMode: changeGlanceMode, live: livePoll.live, onOpenRun: openRunFromPopout };
    const popout = usePopout(data, now, openFromPopout, glance, setPopoutOpen);

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
      // A session's steps live in the run view under Performance.
      openRun: openRunHere,
      onActionDone
    };
    const open = selected && (agentById[selected] || detail);

    let body;
    if (error) body = el("p", { className: "olympus-error-text", role: "alert" }, "Olympus could not read Hermes: " + error);
    else if (!data) body = el(RosterSkeleton);
    else if (data.static) body = el(React.Fragment, null, el(BackendOff, { info: data.static }), el(StaticRoster, { agents: data.static_agents }));
    else if (view === "checks") body = el(Checks, { data, ctx, client });
    else if (view === "live") body = el(LiveView, { ctx, poll: livePoll });
    else if (view === "floor") body = el(FloorView, { ctx, data, live: livePoll });
    else if (view === "glance") body = el(GlanceView, { data, now, onOpen: openFromGlance, glance, onOpenRun: openRunFromGlance });
    else if (view === "performance") body = el(PerformanceView, { ctx, days, onDays: changeDays, selected, onSelect: selectPerformance, runRef, onRun: showRun, day, onDay: pickDay });
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
      el(Header, { data, view, onView: changeView, loading, now, popout }),
      el(GreekKey),
      el("p", { className: cx("olympus-notice", notice && "olympus-notice-shown"), role: "status" }, notice || ""),
      body
    );
  }

  window.__HERMES_PLUGINS__.register("olympus", OlympusPage);
})();
