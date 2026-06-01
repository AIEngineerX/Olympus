"""Read-only backend for the Olympus Hermes dashboard plugin."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from fastapi import APIRouter
except Exception:
    class APIRouter:  # type: ignore
        def get(self, *_args, **_kwargs):
            return lambda fn: fn

try:
    from hermes_constants import get_hermes_home
except Exception:
    def get_hermes_home() -> Path:  # type: ignore[misc]
        val = (os.environ.get("HERMES_HOME") or "").strip()
        return Path(val) if val else Path.home() / ".hermes"

try:
    import yaml  # type: ignore
except Exception:
    yaml = None

router = APIRouter()

STALE_SECONDS = 60 * 60 * 24
RECENT_SECONDS = 60 * 60
ACTIVE_SECONDS = 60 * 10
KANBAN_READY_STALE_SECONDS = 60 * 60 * 24
KANBAN_HEARTBEAT_STALE_SECONDS = 60 * 60
TOOL_HEAVY_THRESHOLD = 20
LONG_THREAD_THRESHOLD = 40
OVERLOADED_OPEN_THRESHOLD = 5
OVERLOADED_RUNNING_THRESHOLD = 2
OPEN_KANBAN_STATUSES = {"triage", "todo", "scheduled", "ready", "running", "blocked", "review"}
KANBAN_COLUMNS = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived"]
EXPOSE_LOCAL_LABELS = os.environ.get("OLYMPUS_EXPOSE_LOCAL_LABELS", "").strip().lower() in {"1", "true", "yes", "on"}
REDACTION_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|token|secret|password|passwd)\s*[:=]\s*['\"]?[^'\"\s]+"),
    re.compile(r"(?i)(bearer\s+)[a-z0-9._~+/=-]+"),
    re.compile(r"sk-[A-Za-z0-9_-]{12,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]+"),
    re.compile(r"ghp_[A-Za-z0-9_]+"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]+"),
]
# Precise log failure signals (avoids false positives like "0 failed" / "failed: false").
LOG_ERROR_PATTERNS = [
    ("traceback", re.compile(r"\btraceback\b")),
    ("exception", re.compile(r"\bexception\b")),
    ("unauthorized", re.compile(r"\bunauthorized\b|\b401\b")),
    ("telegram conflict", re.compile(r"terminated by other getupdates")),
    ("rate limit", re.compile(r"\brate limit(?:ed|ing)?\b|\b429\b")),
    ("failure", re.compile(r"\bfailed to\b|\bfailure\b")),
    ("critical", re.compile(r"\bcritical\b")),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ts_to_iso(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    try:
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    except Exception:
        return str(value)


def age_state(iso_or_ts: Any) -> str:
    try:
        if isinstance(iso_or_ts, str):
            dt = datetime.fromisoformat(iso_or_ts.replace("Z", "+00:00"))
            ts = dt.timestamp()
        else:
            ts = float(iso_or_ts)
        age = time.time() - ts
    except Exception:
        return "unknown"
    if age <= ACTIVE_SECONDS:
        return "active"
    if age <= RECENT_SECONDS:
        return "recent"
    if age <= STALE_SECONDS:
        return "idle"
    return "stale"


def read_text(path: Path, limit: int = 12000) -> str:
    try:
        data = path.read_text(errors="replace")
        return data[-limit:]
    except Exception:
        return ""


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(errors="replace"))
    except Exception:
        return None


def redact_text(value: Any, limit: int = 180) -> str:
    text = "" if value is None else str(value)
    for pattern in REDACTION_PATTERNS:
        text = pattern.sub(lambda m: m.group(1) + "[redacted]" if m.groups() else "[redacted]", text)
    return text[:limit]


def safe_id(value: Any, prefix: str = "item") -> str:
    raw = str(value or "")
    if not raw:
        return prefix
    if len(raw) <= 12:
        return raw
    return f"{prefix}:{raw[-8:]}"


def public_label(raw: Any, fallback: str, prefix: str = "item") -> str:
    if EXPOSE_LOCAL_LABELS and raw:
        return redact_text(raw, 120)
    return fallback or safe_id(raw, prefix)


def public_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in profile.items() if k not in {"_path", "path", "_public_name"}}
    if "_public_name" in profile:
        out["name"] = profile["_public_name"]
    return out


def strip_internal(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: strip_internal(v) for k, v in value.items() if not str(k).startswith("_")}
    if isinstance(value, list):
        return [strip_internal(v) for v in value]
    return value


def _parse_simple_yaml(text: str) -> Dict[str, Any]:
    """Small fallback for Hermes config.yaml when PyYAML is unavailable."""
    data: Dict[str, Any] = {}
    current: Optional[str] = None
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not raw.startswith((" ", "\t")) and line.endswith(":"):
            current = line[:-1].strip()
            data[current] = {}
            continue
        if not raw.startswith((" ", "\t")) and ":" in line:
            key, val = line.split(":", 1)
            data[key.strip()] = val.strip().strip('"\'')
            current = None
            continue
        if current and ":" in line:
            key, val = line.strip().split(":", 1)
            val = val.strip().strip('"\'')
            if val.lower() == "true":
                parsed: Any = True
            elif val.lower() == "false":
                parsed = False
            elif val in ("null", "None", "~"):
                parsed = None
            elif val in ("{}", ""):
                parsed = {}
            elif val == "[]":
                parsed = []
            else:
                parsed = val
            if isinstance(data.get(current), dict):
                data[current][key.strip()] = parsed
    return data


def read_yaml(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        text = path.read_text(errors="replace")
    except Exception:
        return {}
    if yaml is None:
        return _parse_simple_yaml(text)
    try:
        data = yaml.safe_load(text)
        return data if isinstance(data, dict) else {}
    except Exception:
        return _parse_simple_yaml(text)


def as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def row_value(row: sqlite3.Row, key: str, default: Any = None) -> Any:
    try:
        if key in row.keys():
            return row[key]
    except Exception:
        pass
    return default


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    try:
        return {str(r["name"]) for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    except Exception:
        return set()


def kanban_root() -> Path:
    override = os.environ.get("HERMES_KANBAN_HOME", "").strip()
    if override:
        return Path(override).expanduser()
    base = get_hermes_home()
    try:
        if base.parent.name == "profiles":
            return base.parent.parent
    except Exception:
        pass
    return base


def kanban_board_db(slug: str) -> Path:
    root = kanban_root()
    if slug == "default":
        return root / "kanban.db"
    return root / "kanban" / "boards" / slug / "kanban.db"


def read_kanban_current() -> str:
    current_path = kanban_root() / "kanban" / "current"
    current = current_path.read_text(errors="replace").strip() if current_path.exists() else ""
    return current or "default"


def discover_kanban_boards() -> List[Dict[str, Any]]:
    root = kanban_root()
    boards: List[Dict[str, Any]] = [{
        "slug": "default",
        "name": "Default",
        "description": "Default Kanban board",
        "db_exists": (root / "kanban.db").exists(),
    }]
    boards_root = root / "kanban" / "boards"
    if boards_root.exists():
        try:
            for p in sorted(boards_root.iterdir()):
                if not p.is_dir() or p.name.startswith("_") or p.name == "default":
                    continue
                meta = read_json(p / "board.json") or {}
                boards.append({
                    "slug": p.name,
                    "name": meta.get("name") or p.name,
                    "description": meta.get("description"),
                    "db_exists": (p / "kanban.db").exists(),
                })
        except Exception:
            pass
    current = read_kanban_current()
    for board in boards:
        board["is_current"] = board["slug"] == current
    return boards


def _kanban_conn(path: Path) -> Optional[sqlite3.Connection]:
    if not path.exists():
        return None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1.5)
        con.row_factory = sqlite3.Row
        return con
    except Exception:
        return None


def profile_config(profile_home: Path) -> Dict[str, Any]:
    return read_yaml(profile_home / "config.yaml")


def summarize_model(config: Dict[str, Any]) -> Dict[str, Optional[str]]:
    model = config.get("model") if isinstance(config.get("model"), dict) else {}
    if not isinstance(model, dict):
        model = {}
    return {
        "provider": model.get("provider"),
        "model": model.get("default") or model.get("model"),
    }


def _pid_alive(pid: int) -> Optional[bool]:
    """True/False when liveness is known, None when it cannot be determined."""
    try:
        import psutil  # type: ignore

        return bool(psutil.pid_exists(pid))
    except Exception:
        pass
    if os.name == "posix":
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        except Exception:
            return None
    return None


def _process_cmdline(pid: int) -> Optional[str]:
    """Lowercased command line of ``pid`` via psutil, or None if unavailable."""
    try:
        import psutil  # type: ignore

        return " ".join(psutil.Process(pid).cmdline()).lower()
    except Exception:
        return None


def gateway_process_state(profile_home: Path) -> str:
    """Gateway liveness for a profile, keyed on Hermes' per-profile ``gateway.pid``.

    Prefers Hermes' own authoritative check (``gateway.status.get_running_pid``),
    which validates the runtime lock, process start time, and cmdline -- so a
    recycled PID is not mistaken for a live gateway. Falls back to a defensive
    PID-file read that still guards against PID reuse by confirming the live
    process actually looks like a gateway. Works for the default profile and on
    Windows, which a pgrep scan cannot.
    """
    pid_path = profile_home / "gateway.pid"
    if not pid_path.exists():
        return "stopped"
    try:
        from gateway.status import get_running_pid  # type: ignore

        return "running" if get_running_pid(pid_path, cleanup_stale=False) else "stopped"
    except Exception:
        pass

    record = read_json(pid_path)
    pid: Optional[int] = None
    kind: Optional[str] = None
    if isinstance(record, dict):
        kind = record.get("kind")
        try:
            pid = int(record.get("pid"))
        except (TypeError, ValueError):
            pid = None
    elif isinstance(record, (int, float)):
        pid = int(record)
    if not pid:
        return "unknown"
    alive = _pid_alive(pid)
    if alive is False:
        return "stopped"
    if alive is None:
        return "unknown"
    # Alive: guard against a recycled PID by confirming the process is a gateway.
    cmdline = _process_cmdline(pid)
    if cmdline is not None:
        return "running" if "gateway" in cmdline else "stopped"
    return "running" if kind == "hermes-gateway" else "unknown"


def collect_profiles() -> List[Dict[str, Any]]:
    base = get_hermes_home()
    profiles: List[Dict[str, Any]] = []

    candidates = [("default", base)]
    prof_dir = base / "profiles"
    if prof_dir.exists():
        for p in sorted(prof_dir.iterdir()):
            if p.is_dir():
                candidates.append((p.name, p))

    for name, home in candidates:
        cfg = profile_config(home)
        model = summarize_model(cfg)
        model_name = model.get("model")
        provider_name = model.get("provider")
        env_exists = (home / ".env").exists()
        soul_exists = (home / "SOUL.md").exists()
        skills_dir = home / "skills"
        skill_count = 0
        if skills_dir.exists():
            try:
                skill_count = sum(1 for p in skills_dir.rglob("SKILL.md") if p.is_file())
            except Exception:
                skill_count = 0
        gstate = gateway_process_state(home)
        trust = "primary" if name == "default" else "isolated"
        profile_number = len(profiles)
        public_name = name if (EXPOSE_LOCAL_LABELS or name == "default") else f"profile_{profile_number}"
        label = "Default" if name == "default" else (name.capitalize() if EXPOSE_LOCAL_LABELS else f"Profile {profile_number}")
        profiles.append({
            "id": f"profile:{public_name}",
            "kind": "profile",
            "name": name,
            "_public_name": public_name,
            "label": label,
            "state": "active" if gstate == "running" else "idle",
            "trust_boundary": trust,
            "_path": str(home),
            "model": model_name if EXPOSE_LOCAL_LABELS else ("configured" if model_name else None),
            "provider": provider_name if EXPOSE_LOCAL_LABELS else ("configured" if provider_name else None),
            "has_env": env_exists,
            "has_soul": soul_exists,
            "skill_count": skill_count,
            "gateway_state": gstate,
        })
    return profiles


def collect_cron() -> List[Dict[str, Any]]:
    base = get_hermes_home()
    data = read_json(base / "cron" / "jobs.json") or {}
    jobs = data.get("jobs") if isinstance(data, dict) else []
    if not isinstance(jobs, list):
        return []
    out: List[Dict[str, Any]] = []
    for job in jobs:
        if not isinstance(job, dict):
            continue
        last_status = job.get("last_status")
        enabled = bool(job.get("enabled", True))
        error = job.get("last_error") or job.get("last_delivery_error")
        state = "error" if error or last_status == "error" else ("scheduled" if enabled else "paused")
        out.append({
            "id": f"cron:{job.get('id')}",
            "kind": "cron",
            "job_id": job.get("id"),
            "label": public_label(job.get("name"), safe_id(job.get("id"), "cron"), "cron"),
            "state": state,
            "enabled": enabled,
            "schedule": job.get("schedule_display") or (job.get("schedule") or {}).get("display"),
            "next_run_at": ts_to_iso(job.get("next_run_at")),
            "last_run_at": ts_to_iso(job.get("last_run_at")),
            "last_status": last_status,
            "last_error": redact_text(error) if error else None,
            "profile": job.get("profile") or "default",
            "no_agent": bool(job.get("no_agent")),
        })
    return out


def collect_sessions(limit: int = 12) -> List[Dict[str, Any]]:
    db = get_hermes_home() / "state.db"
    if not db.exists():
        return []
    con: Optional[sqlite3.Connection] = None
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
        con.row_factory = sqlite3.Row
        cols = table_columns(con, "sessions")
        wanted = [
            "id", "source", "started_at", "ended_at", "end_reason", "message_count",
            "tool_call_count", "model", "title", "handoff_platform", "handoff_error",
        ]
        select = [c for c in wanted if c in cols]
        if "id" not in select:
            return []
        if "ended_at" in cols and "started_at" in cols:
            order = "COALESCE(ended_at, started_at)"
        elif "started_at" in cols:
            order = "started_at"
        else:
            order = "id"
        rows = con.execute(
            f"SELECT {', '.join(select)} FROM sessions ORDER BY {order} DESC LIMIT ?",
            (limit,),
        ).fetchall()
    except Exception:
        return []
    finally:
        if con is not None:
            try:
                con.close()
            except Exception:
                pass
    out: List[Dict[str, Any]] = []
    for r in rows:
        ended = row_value(r, "ended_at")
        started = row_value(r, "started_at")
        last_ts = ended or started
        if ended is None:
            state = "active" if age_state(started) in ("active", "recent") else "stale"
        else:
            state = "recent" if age_state(last_ts) in ("active", "recent") else "completed"
        handoff_error = row_value(r, "handoff_error")
        if handoff_error:
            state = "error"
        duration_seconds: Optional[float] = None
        try:
            if started and ended:
                duration_seconds = max(0.0, float(ended) - float(started))
        except Exception:
            duration_seconds = None
        session_id = row_value(r, "id")
        model = row_value(r, "model")
        out.append({
            "id": f"session:{session_id}",
            "kind": "session",
            "session_id": session_id,
            "label": public_label(row_value(r, "title"), str(row_value(r, "source") or safe_id(session_id, "session")), "session"),
            "state": state,
            "source": row_value(r, "source"),
            "started_at": ts_to_iso(started),
            "ended_at": ts_to_iso(ended),
            "message_count": row_value(r, "message_count"),
            "tool_call_count": row_value(r, "tool_call_count"),
            "duration_seconds": duration_seconds,
            "model": model if EXPOSE_LOCAL_LABELS else ("configured" if model else None),
            "handoff_platform": row_value(r, "handoff_platform"),
            "handoff_error": redact_text(handoff_error) if handoff_error else None,
        })
    return out


def collect_gateways(profiles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Markers are the real env vars Hermes reads (see hermes-agent gateway/config.py).
    platform_markers = {
        "telegram": ["TELEGRAM_BOT_TOKEN"],
        "discord": ["DISCORD_BOT_TOKEN"],
        "slack": ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
        "whatsapp": ["WHATSAPP_ENABLED"],
        "signal": ["SIGNAL_HTTP_URL", "SIGNAL_ACCOUNT"],
        "matrix": ["MATRIX_ACCESS_TOKEN", "MATRIX_HOMESERVER"],
        "email": ["EMAIL_ADDRESS", "EMAIL_IMAP_HOST", "EMAIL_SMTP_HOST"],
        "sms": ["TWILIO_ACCOUNT_SID"],
        "mattermost": ["MATTERMOST_TOKEN", "MATTERMOST_URL"],
        "homeassistant": ["HASS_TOKEN", "HASS_URL"],
        "webhook": ["WEBHOOK_ENABLED"],
        "api_server": ["API_SERVER_KEY", "API_SERVER_ENABLED"],
    }
    out: List[Dict[str, Any]] = []
    for prof in profiles:
        name = prof["name"]
        public_name = prof.get("_public_name") or name
        home = Path(prof["_path"])
        cfg = profile_config(home)
        platforms_block = cfg.get("platforms") if isinstance(cfg.get("platforms"), dict) else {}
        env_text = read_text(home / ".env", 12000).upper()
        gateway_state = prof.get("gateway_state") or "unknown"
        for platform, markers in platform_markers.items():
            # Hermes accepts both a top-level `<platform>:` block and `platforms.<platform>:`.
            pdata = cfg.get(platform)
            if not isinstance(pdata, dict):
                pdata = platforms_block.get(platform)
            explicitly_enabled = bool(pdata.get("enabled", False)) if isinstance(pdata, dict) else False
            configured = any(marker in env_text for marker in markers)
            enabled = explicitly_enabled or configured
            if not enabled:
                continue
            out.append({
                "id": f"gateway:{public_name}:{platform}",
                "kind": "gateway",
                "label": platform.replace("_", " ").title(),
                "platform": platform,
                "profile": public_name,
                "state": gateway_state if enabled else "disabled",
                "enabled": enabled,
                "configured": configured,
                "trust_boundary": prof.get("trust_boundary"),
            })
    return out


def collect_kanban(profiles: List[Dict[str, Any]]) -> Dict[str, Any]:
    profile_states = {str(p.get("name")): p.get("state") for p in profiles}
    profile_gateway = {str(p.get("name")): p.get("gateway_state") for p in profiles}
    profile_public_names = {str(p.get("name")): str(p.get("_public_name") or p.get("name")) for p in profiles}
    now = int(time.time())
    boards = discover_kanban_boards()
    totals = {status: 0 for status in KANBAN_COLUMNS}
    attention: List[Dict[str, Any]] = []
    assignee_load: Dict[str, Dict[str, Any]] = {}
    recent_tasks: List[Dict[str, Any]] = []
    recent_runs: List[Dict[str, Any]] = []
    active_workers: List[Dict[str, Any]] = []

    def add_attention(severity: str, label: str, detail: str, board: str, task_id: Optional[str] = None) -> None:
        attention.append({
            "severity": severity,
            "label": label,
            "detail": detail,
            "board": board,
            "task_id": task_id,
            "recommended_view": "/kanban",
        })

    for board in boards:
        slug = str(board["slug"])
        db_path = kanban_board_db(slug)
        con = _kanban_conn(db_path)
        board_counts = {status: 0 for status in KANBAN_COLUMNS}
        board.update({
            "counts": board_counts,
            "total": 0,
            "open": 0,
            "diagnostic_count": 0,
            "active_workers": 0,
        })
        if con is None:
            continue
        try:
            task_cols = table_columns(con, "tasks")
            run_cols = table_columns(con, "task_runs")
            for r in con.execute("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status").fetchall():
                status = str(r["status"] or "unknown")
                n = int(r["n"] or 0)
                board_counts[status] = n
                totals[status] = totals.get(status, 0) + n
            board["total"] = sum(board_counts.values())
            board["open"] = sum(board_counts.get(s, 0) for s in OPEN_KANBAN_STATUSES)

            task_select = [
                "id", "title", "status", "assignee", "priority", "created_at", "started_at", "completed_at",
                "consecutive_failures", "last_failure_error", "worker_pid", "claim_expires",
                "last_heartbeat_at", "current_run_id", "max_runtime_seconds", "session_id",
                "goal_mode", "workspace_kind", "tenant",
            ]
            task_select = [c for c in task_select if c in task_cols]
            if task_select:
                task_rows = con.execute(
                    f"SELECT {', '.join(task_select)} FROM tasks WHERE status != 'archived' "
                    "ORDER BY COALESCE(completed_at, started_at, created_at) DESC LIMIT 400"
                ).fetchall()
            else:
                task_rows = []

            for t in task_rows:
                status = str(row_value(t, "status", "unknown"))
                assignee = str(row_value(t, "assignee") or "unassigned")
                public_assignee = profile_public_names.get(assignee, assignee if EXPOSE_LOCAL_LABELS or assignee == "unassigned" else safe_id(assignee, "assignee"))
                if status in OPEN_KANBAN_STATUSES:
                    load = assignee_load.setdefault(assignee, {
                        "_assignee": assignee,
                        "assignee": public_assignee,
                        "open": 0,
                        "running": 0,
                        "ready": 0,
                        "blocked": 0,
                        "review": 0,
                        "boards": set(),
                        "profile_state": profile_states.get(assignee, "unknown"),
                        "gateway_state": profile_gateway.get(assignee, "unknown"),
                    })
                    load["open"] += 1
                    load["boards"].add(slug)
                    if status in ("running", "ready", "blocked", "review"):
                        load[status] += 1

                raw_title = str(row_value(t, "title", row_value(t, "id", "task")))
                task_id = str(row_value(t, "id", ""))
                title = public_label(raw_title, safe_id(task_id, "task"), "task")
                created_at = row_value(t, "created_at")
                started_at = row_value(t, "started_at")
                heartbeat = row_value(t, "last_heartbeat_at")
                claim_expires = row_value(t, "claim_expires")
                failures = int(row_value(t, "consecutive_failures", 0) or 0)

                if status == "running":
                    stale_by_heartbeat = heartbeat and now - int(heartbeat) > KANBAN_HEARTBEAT_STALE_SECONDS
                    expired_claim = claim_expires and int(claim_expires) < now
                    if stale_by_heartbeat or expired_claim:
                        add_attention(
                            "critical",
                            f"Stale running task: {title}",
                            f"{public_assignee} has a running task with stale heartbeat or expired claim.",
                            slug,
                            task_id,
                        )
                if status == "ready" and assignee == "unassigned":
                    add_attention("warning", f"Ready task is unassigned: {title}", "Dispatcher cannot claim ready work without an assignee.", slug, task_id)
                if status == "ready" and assignee != "unassigned" and profile_gateway.get(assignee) not in ("running", None):
                    add_attention("warning", f"Ready task may not dispatch: {title}", f"Assignee {public_assignee} does not have a visible running gateway.", slug, task_id)
                if status == "blocked":
                    add_attention("warning", f"Blocked task: {title}", "Blocked Kanban work needs operator review or clearer acceptance criteria.", slug, task_id)
                if failures > 0:
                    add_attention("warning", f"Retry pressure: {title}", f"{failures} consecutive failure(s). {redact_text(row_value(t, 'last_failure_error'), 120)}", slug, task_id)
                if status in ("triage", "todo", "ready") and created_at:
                    try:
                        if now - int(created_at) > KANBAN_READY_STALE_SECONDS:
                            add_attention("info", f"Aging Kanban work: {title}", f"Task has been waiting in {status} for more than 24h.", slug, task_id)
                    except Exception:
                        pass

                if len(recent_tasks) < 16:
                    recent_tasks.append({
                        "id": task_id,
                        "board": slug,
                        "title": title,
                        "status": status,
                        "assignee": public_assignee,
                        "priority": row_value(t, "priority", 0),
                        "created_at": ts_to_iso(created_at),
                        "started_at": ts_to_iso(started_at),
                        "completed_at": ts_to_iso(row_value(t, "completed_at")),
                        "consecutive_failures": failures,
                        "goal_mode": bool(row_value(t, "goal_mode", 0)),
                        "session_id": row_value(t, "session_id"),
                    })

            if run_cols:
                run_select = [
                    "id", "task_id", "profile", "step_key", "status", "outcome", "worker_pid",
                    "last_heartbeat_at", "started_at", "ended_at", "error", "summary",
                ]
                run_select = [c for c in run_select if c in run_cols]
                run_rows = con.execute(
                    f"SELECT {', '.join(run_select)} FROM task_runs ORDER BY id DESC LIMIT 100"
                ).fetchall() if run_select else []
                for r in run_rows:
                    run_status = str(row_value(r, "status", "unknown"))
                    outcome = row_value(r, "outcome")
                    ended_at = row_value(r, "ended_at")
                    heartbeat = row_value(r, "last_heartbeat_at")
                    task_id = str(row_value(r, "task_id", ""))
                    if ended_at is None and run_status == "running":
                        active_workers.append({
                            "board": slug,
                            "run_id": row_value(r, "id"),
                            "task_id": task_id,
                            "profile": profile_public_names.get(str(row_value(r, "profile") or ""), safe_id(row_value(r, "profile"), "profile") if row_value(r, "profile") else None),
                            "worker_pid": row_value(r, "worker_pid"),
                            "started_at": ts_to_iso(row_value(r, "started_at")),
                            "last_heartbeat_at": ts_to_iso(heartbeat),
                        })
                    if run_status in ("crashed", "timed_out", "failed") or outcome in ("crashed", "timed_out", "spawn_failed", "gave_up"):
                        add_attention("critical", f"Kanban worker {outcome or run_status}: {task_id}", str(row_value(r, "error") or "Worker run failed")[:200], slug, task_id)
                    if len(recent_runs) < 16:
                        recent_runs.append({
                            "id": row_value(r, "id"),
                            "board": slug,
                            "task_id": task_id,
                            "profile": profile_public_names.get(str(row_value(r, "profile") or ""), safe_id(row_value(r, "profile"), "profile") if row_value(r, "profile") else None),
                            "status": run_status,
                            "outcome": outcome,
                            "started_at": ts_to_iso(row_value(r, "started_at")),
                            "ended_at": ts_to_iso(ended_at),
                            "error": redact_text(row_value(r, "error"), 180),
                        })

            board["active_workers"] = sum(1 for w in active_workers if w.get("board") == slug)
        except Exception as exc:
            board["error"] = str(exc)
            add_attention("warning", f"Could not read Kanban board {slug}", redact_text(exc), slug)
        finally:
            con.close()

    for load in assignee_load.values():
        load["boards"] = sorted(load["boards"])

    attention.sort(key=lambda x: _severity_rank(str(x.get("severity"))))
    return {
        "current": read_kanban_current(),
        "boards": boards,
        "totals": totals,
        "open": sum(totals.get(s, 0) for s in OPEN_KANBAN_STATUSES),
        "active_workers": active_workers[:12],
        "assignee_load": sorted(assignee_load.values(), key=lambda x: (-int(x.get("open") or 0), str(x.get("assignee")))),
        "attention": attention[:16],
        "recent_tasks": recent_tasks,
        "recent_runs": recent_runs,
    }


def collect_health(profiles: List[Dict[str, Any]], cron: List[Dict[str, Any]]) -> Dict[str, Any]:
    base = get_hermes_home()
    logs_dir = base / "logs"
    agent_log = logs_dir / "agent.log"
    gateway_log = logs_dir / "gateway.log"
    error_log = logs_dir / "errors.log"
    # agent.log is written on every run; gateway.log only exists once the gateway runs.
    log_tail = "\n".join(
        read_text(p, 8000) for p in (agent_log, gateway_log, error_log) if p.exists()
    ).lower()
    recent_errors = [label for label, pattern in LOG_ERROR_PATTERNS if pattern.search(log_tail)]
    failed_cron = [j for j in cron if j.get("state") == "error"]
    gateway_running = any(p.get("gateway_state") == "running" for p in profiles)
    status = "error" if failed_cron else ("warning" if recent_errors or not gateway_running else "ok")
    if failed_cron:
        status_label = "Needs action"
        summary = f"{len(failed_cron)} scheduled job(s) report errors."
    elif recent_errors:
        status_label = "Needs review"
        summary = "Recent Hermes logs contain failure terms. Inspect logs."
    elif not gateway_running:
        status_label = "Check gateway"
        summary = "No visible gateway process was detected."
    else:
        status_label = "Healthy"
        summary = "No cron failures or log failure terms detected in the current scan."
    return {
        "status": status,
        "status_label": status_label,
        "summary": summary,
        "gateway_running": gateway_running,
        "recent_error_terms": recent_errors[:5],
        "failed_cron_count": len(failed_cron),
        "agent_log_mtime": ts_to_iso(agent_log.stat().st_mtime) if agent_log.exists() else None,
        "gateway_log_mtime": ts_to_iso(gateway_log.stat().st_mtime) if gateway_log.exists() else None,
        "errors_log_mtime": ts_to_iso(error_log.stat().st_mtime) if error_log.exists() else None,
    }


def build_attention(profiles: List[Dict[str, Any]], gateways: List[Dict[str, Any]], cron: List[Dict[str, Any]], sessions: List[Dict[str, Any]], health: Dict[str, Any], kanban: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    if health.get("status") == "error":
        items.append({"severity": "critical", "label": "Health check reports errors", "detail": ", ".join(health.get("recent_error_terms") or []) or "Cron/log error detected"})
    elif health.get("status") == "warning":
        items.append({"severity": "warning", "label": "No running gateway process detected", "detail": "Gateway may be intentionally stopped or not visible to Olympus."})
    for job in cron:
        if job.get("state") == "error":
            items.append({"severity": "critical", "label": f"Cron failed: {job.get('label')}", "detail": str(job.get("last_error") or "last_status=error")[:240]})
    for sess in sessions:
        if sess.get("state") == "error":
            items.append({"severity": "warning", "label": f"Session handoff error: {sess.get('label')}", "detail": str(sess.get("handoff_error"))[:240]})
    for item in as_list((kanban or {}).get("attention")):
        if isinstance(item, dict):
            items.append({
                "severity": item.get("severity") or "warning",
                "label": item.get("label") or "Kanban attention item",
                "detail": item.get("detail") or "",
                "recommended_view": item.get("recommended_view") or "/kanban",
            })
    return items[:12]


def _severity_rank(value: str) -> int:
    return {"critical": 0, "error": 1, "warning": 2, "info": 3, "ok": 4}.get(value, 3)


def _rec(severity: str, title: str, detail: str, evidence: str, view: str, deity: str, action: str, basis: str = "") -> Dict[str, Any]:
    return {
        "severity": severity,
        "title": title,
        "detail": detail,
        "evidence": evidence,
        "recommended_view": view,
        "action_label": action,
        "deity": deity,
        "basis": basis,
    }


def _opportunity(kind: str, severity: str, title: str, detail: str, evidence: str, view: str, action: str, owner: str = "Olympus", basis: str = "", threshold: str = "") -> Dict[str, Any]:
    return {
        "kind": kind,
        "severity": severity,
        "title": title,
        "detail": detail,
        "evidence": evidence,
        "recommended_view": view,
        "action_label": action,
        "owner": owner,
        "basis": basis,
        "threshold": threshold,
    }


def build_agent_hq(profiles: List[Dict[str, Any]], gateways: List[Dict[str, Any]], cron: List[Dict[str, Any]], sessions: List[Dict[str, Any]], kanban: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    kanban = kanban or {}
    assignee_load = {
        str(a.get("_assignee") or a.get("assignee")): a for a in as_list(kanban.get("assignee_load"))
        if isinstance(a, dict) and (a.get("_assignee") or a.get("assignee"))
    }
    cron_by_profile: Dict[str, int] = {}
    for job in cron:
        profile = str(job.get("profile") or "default")
        cron_by_profile[profile] = cron_by_profile.get(profile, 0) + 1

    tool_heavy = [s for s in sessions if int(s.get("tool_call_count") or 0) >= TOOL_HEAVY_THRESHOLD]
    message_heavy = [s for s in sessions if int(s.get("message_count") or 0) >= LONG_THREAD_THRESHOLD]
    active_sessions = [s for s in sessions if s.get("state") in ("active", "recent")]
    stale_sessions = [s for s in sessions if s.get("state") == "stale"]
    failed_runs = [
        r for r in as_list(kanban.get("recent_runs"))
        if isinstance(r, dict) and (r.get("status") in ("crashed", "timed_out", "failed") or r.get("outcome") in ("crashed", "timed_out", "spawn_failed", "gave_up"))
    ]
    ready_unassigned = [
        t for t in as_list(kanban.get("recent_tasks"))
        if isinstance(t, dict) and t.get("status") == "ready" and (not t.get("assignee") or t.get("assignee") == "unassigned")
    ]
    blocked_tasks = [
        t for t in as_list(kanban.get("recent_tasks"))
        if isinstance(t, dict) and t.get("status") == "blocked"
    ]

    agents: List[Dict[str, Any]] = []
    for profile in profiles:
        name = str(profile.get("name") or profile.get("label") or "default")
        load = assignee_load.get(name, {})
        open_work = int(load.get("open") or 0)
        blocked = int(load.get("blocked") or 0)
        running = int(load.get("running") or 0)
        ready = int(load.get("ready") or 0)
        skill_count = int(profile.get("skill_count") or 0)
        flags: List[str] = []
        if not profile.get("model"):
            flags.append("route metadata")
        if skill_count == 0:
            flags.append("skill coverage")
        if blocked:
            flags.append("blocked work")
        if open_work >= OVERLOADED_OPEN_THRESHOLD or running >= OVERLOADED_RUNNING_THRESHOLD:
            flags.append("load balance")
        if profile.get("gateway_state") != "running" and (ready or running):
            flags.append("gateway route")
        if cron_by_profile.get(name, 0):
            flags.append("scheduled work")
        agents.append({
            "id": profile.get("id") or name,
            "label": profile.get("label") or name,
            "state": "warning" if flags else (profile.get("state") or "unknown"),
            "model": profile.get("model"),
            "provider": profile.get("provider"),
            "skill_count": skill_count,
            "gateway_state": profile.get("gateway_state"),
            "cron_jobs": cron_by_profile.get(name, 0),
            "kanban": {
                "open": open_work,
                "ready": ready,
                "running": running,
                "blocked": blocked,
                "review": int(load.get("review") or 0),
            },
            "flags": flags or ["stable"],
        })

    opportunities: List[Dict[str, Any]] = []
    overloaded = [a for a in agents if int(a["kanban"]["open"]) >= OVERLOADED_OPEN_THRESHOLD or int(a["kanban"]["running"]) >= OVERLOADED_RUNNING_THRESHOLD]
    missing_models = [a for a in agents if not a.get("model")]
    zero_skill_profiles = [a for a in agents if int(a.get("skill_count") or 0) == 0]

    if tool_heavy:
        opportunities.append(_opportunity(
            "skill",
            "warning",
            "Create or preload a skill for repeated tool-heavy work",
            "Recent sessions spent many turns in tools. Add a narrower skill, checklist, or reusable procedure.",
            ", ".join(f"{s.get('label')}: {s.get('tool_call_count')} tools" for s in tool_heavy[:3]),
            "/skills",
            "Open Skills",
            "Hephaestus",
            "Hermes records tool_call_count. Use traces, tool counts, outcomes, and repeatable evidence before changing routes.",
            f">= {TOOL_HEAVY_THRESHOLD} tool calls in a session",
        ))
    if message_heavy:
        opportunities.append(_opportunity(
            "memory",
            "info",
            "Add recap or memory discipline for long-running agents",
            "Long threads need summary checkpoints, memory rules, or task splits before context pressure hurts quality.",
            ", ".join(f"{s.get('label')}: {s.get('message_count')} messages" for s in message_heavy[:3]),
            "/sessions",
            "Open Sessions",
            "Mnemosyne",
            "Hermes records message_count. Long threads can hide context drift.",
            f">= {LONG_THREAD_THRESHOLD} messages in a session",
        ))
    if overloaded:
        opportunities.append(_opportunity(
            "agent",
            "warning",
            "Consider a specialist agent or route split",
            "One profile owns enough open or running work to justify a route split.",
            ", ".join(f"{a.get('label')}: {a['kanban']['open']} open" for a in overloaded[:4]),
            "/profiles",
            "Open Profiles",
            "Hermes",
            "Kanban assignee load shows route concentration.",
            f">= {OVERLOADED_OPEN_THRESHOLD} open or >= {OVERLOADED_RUNNING_THRESHOLD} running tasks",
        ))
    if blocked_tasks:
        opportunities.append(_opportunity(
            "kanban",
            "warning",
            "Clarify blocked work before tuning autonomy upward",
            "Blocked tasks usually need clearer acceptance criteria, a dependency, or a human decision.",
            ", ".join(str(t.get("title") or t.get("id")) for t in blocked_tasks[:4]),
            "/kanban",
            "Open Kanban",
            "Athena",
            "Kanban blocked status is first-party orchestration evidence.",
            "task status = blocked",
        ))
    if ready_unassigned:
        opportunities.append(_opportunity(
            "agent",
            "warning",
            "Assign ready work to an agent profile",
            "Ready tasks need an assignee before performance evidence is useful.",
            ", ".join(str(t.get("title") or t.get("id")) for t in ready_unassigned[:4]),
            "/kanban",
            "Open Kanban",
            "Hermes",
            "Kanban ready tasks need an assignee before worker routing can run.",
            "task status = ready and assignee is empty/unassigned",
        ))
    if failed_runs:
        opportunities.append(_opportunity(
            "tool",
            "critical",
            "Inspect failed worker runs before adding more automation",
            "Worker failures point to a tool, runtime, approval, or instruction boundary.",
            ", ".join(f"{r.get('task_id')}: {r.get('outcome') or r.get('status')}" for r in failed_runs[:4]),
            "/kanban",
            "Open Kanban",
            "Argus",
            "Kanban task_runs record worker failures, crashes, and timeouts.",
            "task_run status/outcome indicates failure",
        ))
    if missing_models:
        opportunities.append(_opportunity(
            "model",
            "warning",
            "Make routing explicit per profile",
            "Agent tuning is easier when each profile has an intentional route.",
            ", ".join(str(a.get("label")) for a in missing_models[:4]),
            "/profiles",
            "Open Profiles",
            "Athena",
            "Profile route metadata makes behavior changes auditable.",
            "profile route metadata is unset",
        ))
    if zero_skill_profiles:
        opportunities.append(_opportunity(
            "skill",
            "info",
            "Review skill coverage for bare profiles",
            "Profiles with no local skills lack an explicit operating procedure.",
            ", ".join(str(a.get("label")) for a in zero_skill_profiles[:4]),
            "/skills",
            "Open Skills",
            "Apollo",
            "Hermes skills are reusable operating instructions.",
            "profile skill_count = 0",
        ))
    if stale_sessions:
        opportunities.append(_opportunity(
            "operations",
            "warning",
            "Resolve stale sessions so the HQ view reflects reality",
            "Stale work makes tuning noisy. Close, resume, or annotate it.",
            ", ".join(str(s.get("label") or s.get("session_id")) for s in stale_sessions[:3]),
            "/sessions",
            "Open Sessions",
            "Chronos",
            "Hermes sessions without an end time and recent activity are stale.",
            "session has no end time and is older than the freshness window",
        ))
    if not opportunities:
        opportunities.append(_opportunity(
            "review",
            "ok",
            "No current agent tuning gap",
            "Olympus did not find overloaded assignees, failed worker runs, blocked tasks, missing routes, or heavy recent sessions.",
            "Current cross-surface scan is clean.",
            "/analytics",
            "Open Analytics",
            "Athena",
        ))

    opportunities.sort(key=lambda x: _severity_rank(str(x.get("severity"))))
    return {
        "summary": {
            "agents": len(agents),
            "opportunities": len(opportunities),
            "active_sessions": len(active_sessions),
            "tool_heavy_sessions": len(tool_heavy),
            "long_threads": len(message_heavy),
            "kanban_open": int(kanban.get("open") or 0),
        },
        "agents": agents,
        "opportunities": opportunities[:8],
    }


def build_tuning(profiles: List[Dict[str, Any]], gateways: List[Dict[str, Any]], cron: List[Dict[str, Any]], sessions: List[Dict[str, Any]], health: Dict[str, Any], attention: List[Dict[str, Any]], kanban: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    failed_cron = [j for j in cron if j.get("state") == "error"]
    paused_cron = [j for j in cron if j.get("state") == "paused"]
    stale_sessions = [s for s in sessions if s.get("state") == "stale"]
    errored_sessions = [s for s in sessions if s.get("state") == "error"]
    active_sessions = [s for s in sessions if s.get("state") in ("active", "recent")]
    tool_heavy = [s for s in sessions if int(s.get("tool_call_count") or 0) >= TOOL_HEAVY_THRESHOLD]
    message_heavy = [s for s in sessions if int(s.get("message_count") or 0) >= LONG_THREAD_THRESHOLD]
    missing_models = [p for p in profiles if not p.get("model")]
    idle_profiles = [p for p in profiles if p.get("state") == "idle"]
    running_gateways = [g for g in gateways if g.get("state") == "running"]
    kanban = kanban or {}
    kanban_totals = kanban.get("totals") if isinstance(kanban.get("totals"), dict) else {}
    kanban_attention = [x for x in as_list(kanban.get("attention")) if isinstance(x, dict)]
    kanban_open = int(kanban.get("open") or 0)
    kanban_ready = int(kanban_totals.get("ready") or 0)
    kanban_running = int(kanban_totals.get("running") or 0)
    kanban_blocked = int(kanban_totals.get("blocked") or 0)
    active_workers = as_list(kanban.get("active_workers"))
    overloaded_assignees = [
        a for a in as_list(kanban.get("assignee_load"))
        if isinstance(a, dict) and (int(a.get("open") or 0) >= 5 or int(a.get("blocked") or 0) >= 2 or int(a.get("running") or 0) >= 2)
    ]

    recommendations: List[Dict[str, Any]] = []
    if failed_cron:
        recommendations.append(_rec(
            "critical",
            "Tune failing scheduled work",
            f"{len(failed_cron)} cron job(s) report errors. Review cadence, prompt, profile, approvals, and delivery target.",
            ", ".join(str(j.get("label") or j.get("job_id")) for j in failed_cron[:3]),
            "/cron",
            "Apollo",
            "Open Cron",
            "Cron failures are direct runtime evidence. Fix scheduled work first.",
        ))
    if errored_sessions:
        recommendations.append(_rec(
            "warning",
            "Review handoff failures",
            f"{len(errored_sessions)} recent session(s) contain handoff errors. Check delivery and cancellation behavior.",
            ", ".join(str(s.get("label") or s.get("session_id")) for s in errored_sessions[:3]),
            "/sessions",
            "Hermes",
            "Open Sessions",
            "Session handoff_error comes from Hermes session metadata and indicates delivery or cancellation trouble.",
        ))
    if stale_sessions:
        recommendations.append(_rec(
            "warning",
            "Inspect stale work",
            f"{len(stale_sessions)} recent session(s) are stale. Close, resume, or annotate them.",
            ", ".join(str(s.get("label") or s.get("session_id")) for s in stale_sessions[:3]),
            "/sessions",
            "Chronos",
            "Open Sessions",
            "Stale sessions are open-ended records with no recent activity; they make agent performance review noisy.",
        ))
    if tool_heavy:
        recommendations.append(_rec(
            "info",
            "Tune tool-heavy routes",
            f"{len(tool_heavy)} session(s) used 20 or more tool calls. Add skills, narrower prompts, or decomposition.",
            ", ".join(f"{s.get('label')}: {s.get('tool_call_count')} tools" for s in tool_heavy[:3]),
            "/analytics",
            "Hephaestus",
            "Open Analytics",
            "High tool_call_count is a trace-level signal for workflow friction, missing skills, or poor decomposition.",
        ))
    if message_heavy:
        recommendations.append(_rec(
            "info",
            "Watch long conversations",
            f"{len(message_heavy)} session(s) crossed 40 messages. Add recap, memory, or task splits.",
            ", ".join(f"{s.get('label')}: {s.get('message_count')} messages" for s in message_heavy[:3]),
            "/sessions",
            "Mnemosyne",
            "Open Sessions",
            "High message_count is a context-pressure signal; summaries, memory, or task splitting can improve follow-up quality.",
        ))
    if missing_models:
        recommendations.append(_rec(
            "warning",
            "Set explicit profile routes",
            f"{len(missing_models)} profile(s) do not expose a default route in config.",
            ", ".join(str(p.get("label") or p.get("name")) for p in missing_models[:4]),
            "/profiles",
            "Athena",
            "Open Profiles",
            "Explicit route metadata makes changes auditable and keeps profile behavior intentional.",
        ))
    if not running_gateways and gateways:
        recommendations.append(_rec(
            "warning",
            "Check gateway process state",
            "Gateway markers exist, but no running gateway was detected.",
            ", ".join(str(g.get("label")) for g in gateways[:4]),
            "/logs",
            "Iris",
            "Open Logs",
            "Gateway process state determines whether platform-delivered work can be routed.",
        ))
    if health.get("recent_error_terms"):
        recommendations.append(_rec(
            "critical",
            "Investigate recent log errors",
            "Recent gateway or error logs contain failure terms.",
            ", ".join(str(x) for x in health.get("recent_error_terms", [])[:5]),
            "/logs",
            "Argus",
            "Open Logs",
            "Recent log failure terms are operational evidence.",
        ))
    if kanban_attention:
        recommendations.append(_rec(
            str(kanban_attention[0].get("severity") or "warning"),
            "Review Kanban attention",
            f"{len(kanban_attention)} Kanban issue(s) need review.",
            ", ".join(str(x.get("label") or "Kanban issue") for x in kanban_attention[:3]),
            "/kanban",
            "Athena",
            "Open Kanban",
            "Kanban attention is derived from task status, heartbeats, retries, assignees, and task_runs.",
        ))
    if overloaded_assignees:
        recommendations.append(_rec(
            "warning",
            "Balance agent workload",
            f"{len(overloaded_assignees)} assignee(s) show Kanban pressure. Split work, clarify blockers, or reroute specialist tasks.",
            ", ".join(f"{a.get('assignee')}: {a.get('open')} open" for a in overloaded_assignees[:4]),
            "/kanban",
            "Hermes",
            "Open Kanban",
            "Assignee load comes from Kanban task ownership and is the right signal for route balancing.",
        ))
    if not recommendations:
        recommendations.append(_rec(
            "ok",
            "No urgent tuning pressure",
            "Olympus did not detect failing cron jobs, stale sessions, handoff errors, or missing profile routes.",
            "Current metadata scan is clean.",
            "/analytics",
            "Athena",
            "Open Analytics",
            "No current heuristic crossed its threshold.",
        ))

    score = 100
    deductions: List[Dict[str, Any]] = []

    def deduct(label: str, amount: int, reason: str, evidence: str, source: str) -> None:
        nonlocal score
        if amount <= 0:
            return
        score -= amount
        deductions.append({
            "label": label,
            "points": amount,
            "reason": reason,
            "evidence": evidence,
            "source": source,
        })

    deduct(
        "Runtime health",
        25 if health.get("status") == "error" else 10 if health.get("status") == "warning" else 0,
        "Gateway, cron, or log evidence needs operator review.",
        health.get("summary") or "",
        "Hermes logs, cron metadata, and gateway process state",
    )
    deduct("Cron failures", min(25, len(failed_cron) * 8), "Scheduled agent work is failing.", f"{len(failed_cron)} failed job(s)", "Hermes cron jobs")
    deduct("Handoff failures", min(20, len(errored_sessions) * 6), "Recent sessions contain handoff errors.", f"{len(errored_sessions)} session(s)", "Hermes sessions")
    deduct("Stale sessions", min(15, len(stale_sessions) * 3), "Open-ended stale sessions make performance review noisy.", f"{len(stale_sessions)} stale session(s)", "Hermes sessions")
    deduct("Unset profile routes", min(15, len(missing_models) * 4), "Implicit routing makes tuning harder to audit.", f"{len(missing_models)} profile(s)", "Hermes profile config")
    deduct("Kanban attention", min(20, len(kanban_attention) * 4), "Kanban has blocked, stale, failed, or unassigned work.", f"{len(kanban_attention)} attention item(s)", "Hermes Kanban tasks/task_runs")
    deduct("Blocked Kanban work", min(12, kanban_blocked * 3), "Blocked work usually needs a human decision, dependency, or clearer acceptance criteria.", f"{kanban_blocked} blocked task(s)", "Hermes Kanban tasks")
    score = max(0, score)

    if score >= 85:
        score_label = "Stable"
    elif score >= 70:
        score_label = "Watch"
    elif score >= 55:
        score_label = "Needs review"
    else:
        score_label = "Needs action"

    signals = [
        {"id": "attention", "label": "Attention Items", "value": len(attention), "state": "warning" if attention else "ok", "hint": "Cross-system findings ranked before inventory."},
        {"id": "kanban_open", "label": "Open Kanban Work", "value": kanban_open, "state": "active" if kanban_open else "idle", "hint": "Open task load across Kanban boards."},
        {"id": "kanban_blocked", "label": "Blocked Tasks", "value": kanban_blocked, "state": "warning" if kanban_blocked else "ok", "hint": "Kanban cards needing decisions or clearer specs."},
        {"id": "kanban_workers", "label": "Active Workers", "value": len(active_workers), "state": "running" if active_workers else "idle", "hint": "Kanban task runs currently in flight."},
        {"id": "active_sessions", "label": "Active/Recent Work", "value": len(active_sessions), "state": "active" if active_sessions else "idle", "hint": "Sessions that still look fresh."},
        {"id": "failed_cron", "label": "Cron Failures", "value": len(failed_cron), "state": "error" if failed_cron else "ok", "hint": "Scheduled work that needs review."},
        {"id": "tool_heavy", "label": "Tool-Heavy Runs", "value": len(tool_heavy), "state": "warning" if tool_heavy else "ok", "hint": "Sessions with 20+ tool calls."},
        {"id": "message_heavy", "label": "Long Threads", "value": len(message_heavy), "state": "warning" if message_heavy else "ok", "hint": "Sessions with 40+ messages."},
        {"id": "missing_routes", "label": "Unset Routes", "value": len(missing_models), "state": "warning" if missing_models else "ok", "hint": "Profiles without explicit route metadata."},
        {"id": "paused_cron", "label": "Paused Cron", "value": len(paused_cron), "state": "idle" if paused_cron else "ok", "hint": "Paused scheduled jobs."},
        {"id": "idle_profiles", "label": "Idle Profiles", "value": len(idle_profiles), "state": "idle" if idle_profiles else "active", "hint": "Profiles without visible gateway activity."},
    ]

    pantheon = [
        {
            "name": "Hermes",
            "role": "Routing",
            "state": "running" if running_gateways or kanban_ready else "warning",
            "metric": f"{kanban_ready} ready / {len(running_gateways)} gates",
            "action": "Carrying route packets between gateway arches.",
        },
        {
            "name": "Athena",
            "role": "Tuning Counsel",
            "state": recommendations[0].get("severity", "ok"),
            "metric": f"{len(recommendations)} recs / {kanban_blocked} blocked",
            "action": "Reading the top recommendation tablet and marking review priority.",
        },
        {
            "name": "Hephaestus",
            "role": "Tool Pressure",
            "state": "warning" if tool_heavy or kanban_running else "ok",
            "metric": f"{len(tool_heavy)} tool-heavy / {kanban_running} running",
            "action": "Working at the forge on tool-heavy routes and runtime pressure.",
        },
        {
            "name": "Apollo",
            "role": "Schedules",
            "state": "error" if failed_cron else "ok",
            "metric": f"{len(cron)} jobs",
            "action": "Tuning the sundial and watching scheduled work cadence.",
        },
        {
            "name": "Mnemosyne",
            "role": "Context",
            "state": "warning" if message_heavy else "ok",
            "metric": f"{len(message_heavy)} long threads",
            "action": "Cataloging long threads and memory/context pressure.",
        },
        {
            "name": "Argus",
            "role": "Watchtower",
            "state": health.get("status") or "unknown",
            "metric": f"{len(attention)} findings",
            "action": "Scanning the watchtower for anomalies, errors, and stuck work.",
        },
        {
            "name": "Iris",
            "role": "Gateways",
            "state": "running" if running_gateways else "idle",
            "metric": f"{len(gateways)} configured",
            "action": "Relaying delivery status across gateway messages.",
        },
        {
            "name": "Chronos",
            "role": "Freshness",
            "state": "warning" if stale_sessions else "ok",
            "metric": f"{len(stale_sessions)} stale",
            "action": "Turning the hourglass for stale work, timeouts, and freshness.",
        },
    ]

    profile_rows = []
    for p in profiles:
        flags = []
        if not p.get("model"):
            flags.append("set route")
        if p.get("gateway_state") != "running":
            flags.append("check gateway")
        if int(p.get("skill_count") or 0) == 0:
            flags.append("review skills")
        profile_rows.append({
            "id": p.get("id"),
            "label": p.get("label"),
            "state": p.get("state"),
            "trust_boundary": p.get("trust_boundary"),
            "model": p.get("model"),
            "provider": p.get("provider"),
            "skill_count": p.get("skill_count") or 0,
            "gateway_state": p.get("gateway_state"),
            "tuning_flags": flags or ["stable"],
        })

    agent_hq = build_agent_hq(profiles, gateways, cron, sessions, kanban)
    recommendations.sort(key=lambda x: _severity_rank(str(x.get("severity"))))
    return {
        "score": score,
        "score_breakdown": {
            "base": 100,
            "score": score,
            "label": score_label,
            "deductions": deductions,
            "explanation": "A transparent heuristic readiness score. It prioritizes current operational risks, not absolute agent intelligence.",
        },
        "methodology": {
            "thresholds": [
                {"signal": "Tool-heavy session", "threshold": f">= {TOOL_HEAVY_THRESHOLD} tool calls", "why": "Repeated tool use can indicate missing skills, unclear prompts, or poor decomposition."},
                {"signal": "Long thread", "threshold": f">= {LONG_THREAD_THRESHOLD} messages", "why": "Long conversations can create context pressure and benefit from summaries, memory rules, or task splits."},
                {"signal": "Overloaded assignee", "threshold": f">= {OVERLOADED_OPEN_THRESHOLD} open or >= {OVERLOADED_RUNNING_THRESHOLD} running Kanban tasks", "why": "Load concentration suggests route balancing or a specialist profile may help."},
                {"signal": "Stale session", "threshold": "open session older than the freshness window", "why": "Unresolved stale work makes performance evidence unreliable."},
            ],
            "sources": [
                {"label": "Hermes session store", "detail": "Uses local runtime metadata, message_count, tool_call_count, handoff_error, and timestamps from state.db."},
                {"label": "Hermes Kanban", "detail": "Uses first-party task status, assignee load, worker heartbeats, retries, and task_runs."},
                {"label": "HermesOS profiles and skills", "detail": "Uses profile runtime-route metadata, gateway state, and local SKILL.md counts."},
                {"label": "Provider-neutral agent evaluation", "detail": "Uses traces, tool calls, outcomes, and repeatable signals before changing agents or routes."},
            ],
        },
        "summary": "Read-only tuning scan generated from Hermes profile, gateway, cron, session, and log metadata.",
        "recommendations": recommendations[:8],
        "signals": signals,
        "pantheon": pantheon,
        "profiles": profile_rows,
        "agent_hq": agent_hq,
    }


@router.get("/health")
async def health() -> Dict[str, Any]:
    profiles = collect_profiles()
    cron = collect_cron()
    h = collect_health(profiles, cron)
    return {"ok": h.get("status") != "error", "generated_at": now_iso(), **h}


@router.get("/overview")
async def overview() -> Dict[str, Any]:
    profiles = collect_profiles()
    cron = collect_cron()
    sessions = collect_sessions(60)
    gateways = collect_gateways(profiles)
    kanban = collect_kanban(profiles)
    health = collect_health(profiles, cron)
    attention = build_attention(profiles, gateways, cron, sessions, health, kanban)
    tuning = build_tuning(profiles, gateways, cron, sessions, health, attention, kanban)
    return {
        "generated_at": now_iso(),
        "health": health,
        "attention": attention,
        "tuning": strip_internal(tuning),
        "profiles": [public_profile(p) for p in profiles],
        "gateways": gateways,
        "cron": cron,
        "sessions": sessions,
        "kanban": strip_internal(kanban),
    }


@router.get("/tuning")
async def tuning() -> Dict[str, Any]:
    profiles = collect_profiles()
    cron = collect_cron()
    sessions = collect_sessions(60)
    gateways = collect_gateways(profiles)
    kanban = collect_kanban(profiles)
    health = collect_health(profiles, cron)
    attention = build_attention(profiles, gateways, cron, sessions, health, kanban)
    return {
        "generated_at": now_iso(),
        "health": health,
        "attention": attention,
        "kanban": strip_internal(kanban),
        "tuning": strip_internal(build_tuning(profiles, gateways, cron, sessions, health, attention, kanban)),
    }
