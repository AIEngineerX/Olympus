"""Backend for the Olympus Hermes dashboard plugin. Reads Hermes stores read-only; never writes them."""
from __future__ import annotations

import json
import hashlib
import math
import logging
import os
import re
import sqlite3
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

try:
    from fastapi import APIRouter
except Exception:
    class APIRouter:  # type: ignore
        def get(self, *_args, **_kwargs):
            return lambda fn: fn

        post = get
        delete = get

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
logger = logging.getLogger("olympus.dashboard")

STALE_SECONDS = 60 * 60 * 24
RECENT_SECONDS = 60 * 60
ACTIVE_SECONDS = 60 * 10
KANBAN_READY_STALE_SECONDS = 60 * 60 * 24
KANBAN_HEARTBEAT_STALE_SECONDS = 60 * 60
# Hermes closes a cron session, delivers, then stamps the job's last_run_at;
# a session that ended longer before that stamp is not the last run.
CRON_RUN_SETTLE_SECONDS = 5 * 60
TOOL_HEAVY_THRESHOLD = 20
LONG_THREAD_THRESHOLD = 40
OVERLOADED_OPEN_THRESHOLD = 5
OVERLOADED_RUNNING_THRESHOLD = 2
CONTEXT_PRESSURE_TOKENS = 50000
RUNAWAY_TOOLS_THRESHOLD = 40
EXPENSIVE_RUN_USD = 1.0
MAX_TURNS_REVIEW_THRESHOLD = 80
KANBAN_CLOSED_TASK_SAMPLE = 100
# Session signals cover a fixed time window so every count means "in the last
# week", capped so a very busy fleet keeps the scan inside its response budget.
SESSION_WINDOW_DAYS = 7
SESSION_SCAN_LIMIT = 200
SPEND_WINDOW_SECONDS = 60 * 60 * 24
KANBAN_FINISHED_RUN_SAMPLE = 100
KANBAN_DISPLAY_SAMPLE = 16
API_RESPONSE_BUDGET_MS = 750.0
PAYLOAD_BUDGET_BYTES = 250_000
CLIENT_RENDER_BUDGET_MS = 150.0
OPEN_KANBAN_STATUSES = {"triage", "todo", "scheduled", "ready", "running", "blocked", "review"}
KANBAN_COLUMNS = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived"]
FAILED_RUN_STATUSES = {"crashed", "timed_out", "failed"}
FAILED_RUN_OUTCOMES = {"crashed", "timed_out", "spawn_failed", "gave_up"}
SKILLS_SH_AUDIT_CHECKS = ("agent-trust-hub", "socket", "snyk")
SKILLS_SH_AUDIT_OK = {"pass", "passed", "ok", "clean"}
SKILLS_SH_AUDIT_WARN = {"warn", "warning", "review"}
SKILLS_SH_AUDIT_FAIL = {"fail", "failed", "error", "critical", "block"}
# Behavioral settings belong in config.yaml, not env vars, so the
# private-machine label opt-in lives at dashboard.olympus.expose_local_labels.
# Refreshed at the start of every request; fails closed (labels hidden) when
# the config cannot be read.
EXPOSE_LOCAL_LABELS = False
REDACTION_PATTERNS = [
    # Secret assignments are removed whole: a quoted value (including one cut
    # off by truncation) is consumed up to its closing quote, so
    # `password='two word secret'` cannot leak its trailing words.
    re.compile(
        r"(?i)(?:['\"]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)['\"]?\s*[:=]\s*)"
        r"(?:\"(?:[^\"\\]|\\.)*(?:\"|$)|'(?:[^'\\]|\\.)*(?:'|$)|[^\s,;}&]+)"
    ),
    re.compile(r"(?i)(bearer\s+)[a-z0-9._~+/=-]+"),
    re.compile(r"sk-[A-Za-z0-9_-]{12,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]+"),
    re.compile(r"ghp_[A-Za-z0-9_]+"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]+"),
]
# Free-text error/log fields routinely embed absolute filesystem paths and
# delivery URLs (worker tracebacks, handoff failures, webhook errors). The
# privacy contract says local paths and base URLs are hidden by default, so
# scrub them alongside secret-like strings before any error text is returned.
URL_PATTERN = re.compile(r"(?i)\b(?:https?|ftp|wss?)://[^\s'\"<>]+")
PATH_PATTERNS = [
    re.compile(r"(?i)[a-z]:\\[^\s'\"|<>]+"),         # Windows: C:\Users\alice\...
    re.compile(r"(?<![\w.])~?(?:/[\w.\-]+){2,}/?"),  # POSIX / home: /home/alice/.hermes, ~/x/y
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


def olympus_settings() -> Dict[str, Any]:
    """The ``dashboard.olympus`` block of config.yaml (raises if unreadable)."""
    try:
        from hermes_cli.config import load_config_readonly
        cfg: Any = load_config_readonly() or {}
    except ImportError:
        # Standalone loads (plugin unit tests) run without hermes_cli on
        # sys.path; read the active HERMES_HOME config directly.
        cfg = read_yaml(get_hermes_home() / "config.yaml")
    dashboard_cfg = cfg.get("dashboard") if isinstance(cfg, dict) else None
    olympus_cfg = dashboard_cfg.get("olympus") if isinstance(dashboard_cfg, dict) else None
    return olympus_cfg if isinstance(olympus_cfg, dict) else {}


def refresh_expose_local_labels() -> bool:
    global EXPOSE_LOCAL_LABELS
    try:
        value = bool(olympus_settings().get("expose_local_labels", False))
    except Exception as exc:
        log_read_warning("expose_local_labels config read failed", exc)
        value = False
    EXPOSE_LOCAL_LABELS = value
    return value


def controls_enabled() -> bool:
    """Whether the page may act through Hermes (dashboard.olympus.controls).

    On by default; every action is still confirmed. Fails closed when the
    config cannot be read.
    """
    try:
        return _cfg_flag(olympus_settings().get("controls"), True)
    except Exception as exc:
        log_read_warning("controls config read failed", exc)
        return False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def redact_log_value(value: Any, limit: int = 180) -> str:
    # Same redaction the API payloads use, so log warnings can't leak a path
    # or secret that the response fields scrub.
    return redact_text(value, limit)


def log_read_warning(context: str, exc: BaseException) -> None:
    logger.warning("%s: %s", context, redact_log_value(exc))


def ts_to_iso(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    try:
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    except Exception:
        return None


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
    """Return the last ``limit`` bytes of a file without reading the rest.

    Hermes logs grow without bound; seeking keeps each scan O(limit) in time
    and memory regardless of log size.
    """
    try:
        with path.open("rb") as handle:
            size = handle.seek(0, os.SEEK_END)
            handle.seek(max(0, size - limit))
            return handle.read(limit).decode("utf-8", errors="replace")
    except OSError as exc:
        if path.exists():
            log_read_warning(f"read_text failed for {path.name}", exc)
        return ""


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(errors="replace"))
    except Exception as exc:
        if path.exists():
            log_read_warning(f"read_json failed for {path.name}", exc)
        return None


def env_keys(path: Path) -> set[str]:
    keys: set[str] = set()
    try:
        lines = path.read_text(errors="replace").splitlines()
    except Exception:
        return keys
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            keys.add(key.upper())
    return keys


def redact_text(value: Any, limit: int = 180) -> str:
    text = "" if value is None else str(value)
    for pattern in REDACTION_PATTERNS:
        text = pattern.sub(lambda m: m.group(1) + "[redacted]" if m.groups() else "[redacted]", text)
    text = URL_PATTERN.sub("[redacted-url]", text)
    for pattern in PATH_PATTERNS:
        text = pattern.sub("[redacted-path]", text)
    return text[:limit]


# Free-text failure messages can quote prompt text, task titles, or raw IDs that
# no pattern can reliably scrub. By default only the failure class is returned;
# the redacted text is shown only when local labels are enabled.
ERROR_CATEGORIES = [
    ("timeout", re.compile(r"(?i)timed?\s*out|timeout|deadline exceeded")),
    ("rate limit", re.compile(r"(?i)rate[\s_-]?limit|\b429\b|too many requests")),
    ("auth", re.compile(r"(?i)unauthori[sz]ed|forbidden|\b40[13]\b|invalid (?:api )?key|authenticat|permission denied|credential")),
    ("quota", re.compile(r"(?i)quota|insufficient[_ ](?:funds|credit|balance)|billing|payment required|\b402\b")),
    ("context limit", re.compile(r"(?i)context (?:length|window)|maximum context|too many tokens|prompt is too long")),
    ("network", re.compile(r"(?i)connection (?:refused|reset|error|aborted)|unreachable|name resolution|dns|ssl|tls|network|econn")),
    ("delivery", re.compile(r"(?i)deliver|webhook|send(?:ing)? (?:message|failed)|chat not found")),
    ("not found", re.compile(r"(?i)not found|no such file|\b404\b|does not exist")),
    ("crash", re.compile(r"(?i)traceback|exception|segmentation fault|killed|crash|exit(?:ed)? (?:code|status)")),
]


def error_category(value: Any) -> str:
    text = "" if value is None else str(value)
    for label, pattern in ERROR_CATEGORIES:
        if pattern.search(text):
            return label
    return "error"


def public_error(value: Any, limit: int = 180) -> Optional[str]:
    if value in (None, ""):
        return None
    if EXPOSE_LOCAL_LABELS:
        return redact_text(value, limit)
    return f"{error_category(value)} (details hidden)"


def safe_int(value: Any, default: int = 0) -> int:
    if value in (None, ""):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError, OverflowError):
            return default


def safe_float(value: Any, default: float = 0.0) -> float:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def safe_id(value: Any, prefix: str = "item") -> str:
    raw = str(value or "")
    if not raw:
        return prefix
    digest = hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:10]
    return f"{prefix}:{digest}"


def public_ref(value: Any, prefix: str = "item") -> Optional[str]:
    if value in (None, ""):
        return None
    return redact_text(value, 120) if EXPOSE_LOCAL_LABELS else safe_id(value, prefix)


def public_label(raw: Any, fallback: str, prefix: str = "item") -> str:
    if EXPOSE_LOCAL_LABELS and raw:
        return redact_text(raw, 120)
    return fallback or safe_id(raw, prefix)


def strip_internal(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: strip_internal(v) for k, v in value.items() if not str(k).startswith("_")}
    if isinstance(value, list):
        return [strip_internal(v) for v in value]
    return value


def payload_size_bytes(value: Dict[str, Any]) -> int:
    try:
        return len(json.dumps(value, separators=(",", ":"), default=str).encode("utf-8"))
    except Exception:
        return 0


def runtime_diagnostics(route: str, started_at: float, payload: Dict[str, Any], profiles: List[Dict[str, Any]], sessions: List[Dict[str, Any]], kanban: Dict[str, Any]) -> Dict[str, Any]:
    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
    payload_bytes = payload_size_bytes(payload)
    boards = as_list(kanban.get("boards"))
    board_read_failures = sum(1 for board in boards if isinstance(board, dict) and board.get("error"))
    state = "warning" if elapsed_ms > API_RESPONSE_BUDGET_MS or payload_bytes > PAYLOAD_BUDGET_BYTES or board_read_failures else "ok"
    return {
        "route": route,
        "state": state,
        "generated_ms": elapsed_ms,
        "payload_bytes": payload_bytes,
        "budgets": {
            "api_response_ms": API_RESPONSE_BUDGET_MS,
            "payload_bytes": PAYLOAD_BUDGET_BYTES,
            "client_render_ms": CLIENT_RENDER_BUDGET_MS,
        },
        "budget_status": {
            "api_response": "warning" if elapsed_ms > API_RESPONSE_BUDGET_MS else "ok",
            "payload": "warning" if payload_bytes > PAYLOAD_BUDGET_BYTES else "ok",
            "client_render": "reported_by_browser",
        },
        "counts": {
            "profiles_scanned": len(profiles),
            "sessions_scanned": len(sessions),
            "kanban_boards_scanned": len(boards),
            "kanban_board_read_failures": board_read_failures,
            "kanban_attention_items": len(as_list(kanban.get("attention"))),
        },
        "hermes": {
            "version": os.environ.get("HERMES_VERSION") or "unknown",
            "home_detected": bool(get_hermes_home()),
        },
    }


def _source_state(present: bool, read_failures: int = 0) -> str:
    if not present:
        return "missing"
    return "warning" if read_failures else "ok"


def _sqlite_count(path: Path, table: str) -> Optional[int]:
    if not path.exists():
        return None
    con: Optional[sqlite3.Connection] = None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1.5)
        con.row_factory = sqlite3.Row
        row = con.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()
        return int(row["n"] or 0) if row is not None else 0
    except Exception as exc:
        log_read_warning(f"sqlite count failed for {table}", exc)
        return None
    finally:
        if con is not None:
            try:
                con.close()
            except Exception:
                pass


def _json_object_count(path: Path, key: Optional[str] = None) -> Optional[int]:
    data = read_json(path)
    if key and isinstance(data, dict):
        data = data.get(key)
    if isinstance(data, dict):
        return len(data)
    if isinstance(data, list):
        return len(data)
    return None


def build_evidence_sources(profiles: List[Dict[str, Any]], sessions: List[Dict[str, Any]], cron: List[Dict[str, Any]], gateways: List[Dict[str, Any]], kanban: Dict[str, Any]) -> Dict[str, Any]:
    hermes_home = get_hermes_home()
    state_store = hermes_home / "state.db"
    config_file = hermes_home / "config.yaml"
    skill_usage = hermes_home / "skills" / ".usage.json"
    hub_lock = hermes_home / "skills" / ".hub" / "lock.json"
    boards = as_list(kanban.get("boards"))
    board_failures = sum(1 for board in boards if isinstance(board, dict) and board.get("error"))
    boards_present = any(isinstance(board, dict) and board.get("db_exists") for board in boards)

    session_count = _sqlite_count(state_store, "sessions")
    message_count = _sqlite_count(state_store, "messages")
    state_failures = int(state_store.exists() and (session_count is None or message_count is None))
    skill_usage_count = _json_object_count(skill_usage)
    hub_installed_count = _json_object_count(hub_lock, "installed")

    items = [
        {
            "id": "hermes_state",
            "label": "Hermes state store",
            "type": "sqlite",
            "state": _source_state(state_store.exists(), state_failures),
            "present": state_store.exists(),
            "counts": {
                "sessions_returned": len(sessions),
                "sessions_recorded": session_count if session_count is not None else 0,
                "messages_recorded": message_count if message_count is not None else 0,
            },
            "fields": [
                "sessions.started_at",
                "sessions.ended_at",
                "sessions.message_count",
                "sessions.tool_call_count",
                "sessions.input_tokens",
                "sessions.output_tokens",
                "sessions.api_call_count",
                "sessions.handoff_error",
            ],
            "redaction": "Session IDs are hashed and titles are hidden unless local labels are enabled.",
            "read_failures": state_failures,
            "recommended_view": "/sessions",
        },
        {
            "id": "hermes_kanban",
            "label": "Hermes Kanban store",
            "type": "sqlite",
            "state": _source_state(boards_present, board_failures),
            "present": boards_present,
            "counts": {
                "boards_scanned": len(boards),
                "open_tasks": int(kanban.get("open") or 0),
                "attention_items": len(as_list(kanban.get("attention"))),
                "recent_runs": len(as_list(kanban.get("recent_runs"))),
            },
            "fields": [
                "tasks.status",
                "tasks.assignee",
                "tasks.skills",
                "tasks.session_id",
                "tasks.model_override",
                "task_runs.status",
                "task_runs.outcome",
                "task_runs.last_heartbeat_at",
            ],
            "redaction": "Task IDs and board labels are hashed unless local labels are enabled.",
            "read_failures": board_failures,
            "recommended_view": "/kanban",
        },
        {
            "id": "hermes_config",
            "label": "Hermes config",
            "type": "yaml",
            "state": _source_state(config_file.exists(), 0),
            "present": config_file.exists(),
            "counts": {
                "profiles_scanned": len(profiles),
                "cron_jobs": len(cron),
                "gateways": len(gateways),
            },
            "fields": [
                "model.provider_presence",
                "model.default_presence",
                "fallback_providers.presence",
                "toolsets.presence",
                "agent.max_turns",
                "agent.gateway_timeout",
                "tool_loop_guardrails.presence",
                "compression.presence",
                "browser.privacy_flags",
                "auxiliary_provider.presence",
                "profile.gateway_state",
                "profile.skill_count",
                "cron.enabled",
                "cron.last_status",
            ],
            "redaction": "Secrets, prompt text, local paths, and exact model labels are not returned by default.",
            "read_failures": 0,
            "recommended_view": "/config",
        },
        {
            "id": "skill_usage",
            "label": "Skill usage metadata",
            "type": "json",
            "state": _source_state(skill_usage.exists(), int(skill_usage.exists() and skill_usage_count is None)),
            "present": skill_usage.exists(),
            "counts": {
                "skills_recorded": skill_usage_count if skill_usage_count is not None else 0,
            },
            "fields": [
                "created_at",
                "last_used_at",
                "last_viewed_at",
                "last_patched_at",
                "use_count",
                "state",
                "pinned",
            ],
            "redaction": "Skill names are summarized and can be hashed when labels are hidden.",
            "read_failures": int(skill_usage.exists() and skill_usage_count is None),
            "recommended_view": "/skills",
        },
        {
            "id": "skill_hub_lock",
            "label": "Skill hub lock metadata",
            "type": "json",
            "state": _source_state(hub_lock.exists(), int(hub_lock.exists() and hub_installed_count is None)),
            "present": hub_lock.exists(),
            "counts": {
                "hub_installed": hub_installed_count if hub_installed_count is not None else 0,
            },
            "fields": [
                "version",
                "installed",
                "optional_trust_metadata",
                "optional_scan_metadata",
            ],
            "redaction": "Only local hub metadata presence and counts are shown in Phase 0.",
            "read_failures": int(hub_lock.exists() and hub_installed_count is None),
            "recommended_view": "/skills",
        },
    ]
    missing = sum(1 for item in items if item["state"] == "missing")
    warnings = sum(1 for item in items if item["state"] == "warning")
    return {
        "summary": {
            "sources": len(items),
            "available": len(items) - missing,
            "missing": missing,
            "warnings": warnings,
            "privacy": "local labels hidden" if not EXPOSE_LOCAL_LABELS else "local labels visible",
        },
        "items": items,
    }


def _epoch_seconds(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)):
            raw = float(value)
            return raw / 1000 if raw > 10_000_000_000 else raw
        text = str(value).strip()
        if not text:
            return None
        if re.match(r"^\d+(\.\d+)?$", text):
            raw = float(text)
            return raw / 1000 if raw > 10_000_000_000 else raw
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except Exception as exc:
        log_read_warning("timestamp parse failed", exc)
        return None


def _public_skill_label(name: Any) -> str:
    raw = str(name or "")
    if EXPOSE_LOCAL_LABELS:
        return redact_text(raw, 120)
    return safe_id(raw, "skill")


def _skill_audit_verdict(value: Any) -> Optional[str]:
    raw: Any = value
    if isinstance(value, dict):
        raw = value.get("verdict") or value.get("status") or value.get("result")
    text = str(raw or "").strip().lower()
    if not text:
        return None
    if text in SKILLS_SH_AUDIT_OK:
        return "pass"
    if text in SKILLS_SH_AUDIT_WARN:
        return "warn"
    if text in SKILLS_SH_AUDIT_FAIL:
        return "fail"
    return None


def _skill_audit_state(verdict: str) -> str:
    if verdict == "fail":
        return "critical"
    if verdict == "warn":
        return "warning"
    return "ok"


def _stored_skill_audits(meta: Dict[str, Any]) -> List[Dict[str, str]]:
    source = meta.get("skills_sh_audit")
    if not isinstance(source, dict):
        source = meta.get("security_audit")
    if not isinstance(source, dict):
        source = meta
    audits: List[Dict[str, str]] = []
    for check in SKILLS_SH_AUDIT_CHECKS:
        verdict = _skill_audit_verdict(source.get(check) if isinstance(source, dict) else None)
        if verdict:
            audits.append({
                "check": check,
                "verdict": verdict,
                "state": _skill_audit_state(verdict),
            })
    return audits


def _profile_skill_usage_sources(profiles: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """Return read-only skill usage files grounded in configured Hermes profiles."""
    base = get_hermes_home()
    sources: List[Dict[str, Any]] = []
    seen: set[str] = set()

    def add(label: str, public_name: str, home: Path) -> None:
        key = str(home.resolve()) if home.exists() else str(home)
        if key in seen:
            return
        seen.add(key)
        sources.append({
            "profile": public_name,
            "label": label,
            "path": home / "skills" / ".usage.json",
        })

    if profiles:
        for idx, profile in enumerate(profiles):
            raw_path = profile.get("_path")
            if not raw_path:
                continue
            label = str(profile.get("label") or f"Profile {idx}")
            public_name = str(profile.get("_public_name") or profile.get("id") or f"profile_{idx}")
            add(label, public_name, Path(str(raw_path)))
    else:
        add("Default", "default", base)

    return sources


def collect_skill_metadata(profiles: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    skills_dir = get_hermes_home() / "skills"
    hub_lock_path = skills_dir / ".hub" / "lock.json"
    hub_data = read_json(hub_lock_path)
    installed = hub_data.get("installed") if isinstance(hub_data, dict) and isinstance(hub_data.get("installed"), dict) else {}
    now_ts = time.time()

    usage_items: List[Dict[str, Any]] = []
    profile_usage: List[Dict[str, Any]] = []
    usage_sources = _profile_skill_usage_sources(profiles)
    usage_present = False
    usage_read_failures = 0

    for source in usage_sources:
        usage_path = Path(source["path"])
        usage_data = read_json(usage_path)
        if usage_path.exists():
            usage_present = True
        if usage_path.exists() and not isinstance(usage_data, dict):
            usage_read_failures += 1
        usage = usage_data if isinstance(usage_data, dict) else {}
        source_items: List[Dict[str, Any]] = []
        for name, meta in sorted(usage.items()):
            if not isinstance(meta, dict):
                continue
            use_count = safe_int(meta.get("use_count"))
            view_count = safe_int(meta.get("view_count"))
            patch_count = safe_int(meta.get("patch_count"))
            last_used_ts = _epoch_seconds(meta.get("last_used_at"))
            last_patched_ts = _epoch_seconds(meta.get("last_patched_at"))
            archived = bool(meta.get("archived_at")) or str(meta.get("state") or "").lower() == "archived"
            stale = not last_used_ts or now_ts - last_used_ts > 90 * 24 * 60 * 60
            recently_patched = bool(last_patched_ts and now_ts - last_patched_ts <= 14 * 24 * 60 * 60)
            created_ts = _epoch_seconds(meta.get("created_at"))
            item = {
                "_name": str(name),
                "_profile": source.get("profile"),
                "id": _public_skill_label(f"{source.get('profile')}:{name}"),
                "label": _public_skill_label(name),
                "profile": source.get("profile"),
                "profile_label": source.get("label"),
                "state": "archived" if archived else (str(meta.get("state") or "active")),
                "created_by": "agent" if meta.get("created_by") == "agent" or meta.get("agent_created") is True else None,
                "use_count": use_count,
                "view_count": view_count,
                "patch_count": patch_count,
                "pinned": bool(meta.get("pinned")),
                "archived": archived,
                "stale": stale,
                "recently_patched": recently_patched,
                "created_recently": bool(created_ts and now_ts - created_ts <= 30 * 24 * 60 * 60),
                "created_at": ts_to_iso(meta.get("created_at")),
                "last_used_at": ts_to_iso(meta.get("last_used_at")),
                "last_viewed_at": ts_to_iso(meta.get("last_viewed_at")),
                "last_patched_at": ts_to_iso(meta.get("last_patched_at")),
            }
            usage_items.append(item)
            source_items.append(item)
        profile_usage.append({
            "profile": source.get("profile"),
            "label": source.get("label"),
            "usage_present": usage_path.exists(),
            "skills": len(source_items),
            "created_30d": sum(1 for item in source_items if item.get("created_recently")),
            "used": sum(1 for item in source_items if int(item.get("use_count") or 0) > 0),
            "never_used": sum(1 for item in source_items if int(item.get("use_count") or 0) == 0),
            "stale": sum(1 for item in source_items if item.get("stale")),
            "archived": sum(1 for item in source_items if item.get("archived")),
            "recently_patched": sum(1 for item in source_items if item.get("recently_patched")),
        })

    hub_items: List[Dict[str, Any]] = []
    for name, meta in sorted(installed.items()):
        if not isinstance(meta, dict):
            continue
        trust_level = meta.get("trust_level")
        scan_verdict = meta.get("scan_verdict")
        audits = _stored_skill_audits(meta)
        audit_states = {item["state"] for item in audits}
        hub_items.append({
            "_name": str(name),
            "id": _public_skill_label(name),
            "label": _public_skill_label(name),
            "trust_level": str(trust_level) if trust_level not in (None, "") else None,
            "scan_verdict": str(scan_verdict) if scan_verdict not in (None, "") else None,
            "security_audits": audits,
            "audit_summary": " / ".join(f"{item['check']}: {item['verdict']}" for item in audits) if audits else None,
            "state": "critical" if "critical" in audit_states else ("warning" if "warning" in audit_states or not trust_level or not scan_verdict else "ok"),
            "installed_at": ts_to_iso(meta.get("installed_at")),
            "updated_at": ts_to_iso(meta.get("updated_at")),
        })

    archived = [item for item in usage_items if item.get("archived")]
    stale = [item for item in usage_items if item.get("stale")]
    never_used = [item for item in usage_items if int(item.get("use_count") or 0) == 0]
    recently_patched = [item for item in usage_items if item.get("recently_patched")]
    hub_missing_trust = [item for item in hub_items if not item.get("trust_level")]
    hub_missing_scan = [item for item in hub_items if not item.get("scan_verdict")]
    audit_records = [audit for item in hub_items for audit in as_list(item.get("security_audits")) if isinstance(audit, dict)]
    return {
        "summary": {
            "usage_present": usage_present,
            "usage_sources": len(usage_sources),
            "hub_lock_present": hub_lock_path.exists(),
            "total_skills": len(usage_items),
            "created_30d": sum(1 for item in usage_items if item.get("created_recently")),
            "agent_created": sum(1 for item in usage_items if item.get("created_by") == "agent"),
            "archived": len(archived),
            "pinned": sum(1 for item in usage_items if item.get("pinned")),
            "never_used": len(never_used),
            "used": sum(1 for item in usage_items if int(item.get("use_count") or 0) > 0),
            "stale": len(stale),
            "recently_patched": len(recently_patched),
            "hub_installed": len(hub_items),
            "hub_missing_trust": len(hub_missing_trust),
            "hub_missing_scan": len(hub_missing_scan),
            "hub_audit_pass": sum(1 for item in audit_records if item.get("verdict") == "pass"),
            "hub_audit_warn": sum(1 for item in audit_records if item.get("verdict") == "warn"),
            "hub_audit_fail": sum(1 for item in audit_records if item.get("verdict") == "fail"),
            "read_failures": usage_read_failures + int(hub_lock_path.exists() and not isinstance(hub_data, dict)),
        },
        "profile_usage": profile_usage,
        "usage_items": usage_items,
        "hub_items": hub_items,
    }


def build_skill_hygiene(skill_metadata: Dict[str, Any], skill_coverage: Dict[str, Any], kanban: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    kanban = kanban or {}
    summary = skill_metadata.get("summary") if isinstance(skill_metadata.get("summary"), dict) else {}
    usage_items = [item for item in as_list(skill_metadata.get("usage_items")) if isinstance(item, dict)]
    hub_items = [item for item in as_list(skill_metadata.get("hub_items")) if isinstance(item, dict)]
    usage_names = {str(item.get("_name")) for item in usage_items if item.get("_name")}
    hub_names = {str(item.get("_name")) for item in hub_items if item.get("_name")}
    findings: List[Dict[str, Any]] = []

    def add_signal(severity: str, title: str, detail: str, evidence: str, view: str = "/skills", basis: str = "Hermes skill metadata") -> None:
        findings.append(_tuning_item(
            "skill",
            severity,
            title,
            detail,
            evidence,
            view,
            _action_label_for_view(view),
            "Apollo",
            basis,
        ))

    if not summary.get("usage_present"):
        add_signal("info", "Skill usage metadata is not present", "Hermes has not recorded skill usage metadata on this machine yet.", "usage metadata missing")
    if not summary.get("hub_lock_present"):
        add_signal("info", "Skill hub lock metadata is not present", "Hub install provenance is unavailable until Hermes records a skill hub lock.", "hub lock missing")

    heavily_used_unpinned = sorted(
        [item for item in usage_items if int(item.get("use_count") or 0) >= 10 and not item.get("pinned")],
        key=lambda item: int(item.get("use_count") or 0),
        reverse=True,
    )
    if heavily_used_unpinned:
        add_signal(
            "warning",
            "Pin heavily used skills",
            "Frequently used skills are part of the operating surface. Pinning or reviewing them makes drift easier to spot.",
            ", ".join(f"{item.get('label')}: {item.get('use_count')} uses" for item in heavily_used_unpinned[:3]),
        )

    archived_recent = [
        item for item in usage_items
        if item.get("archived") and item.get("last_used_at") and not item.get("stale")
    ]
    if archived_recent:
        add_signal(
            "warning",
            "Archived skills still show recent use metadata",
            "An archived skill with use evidence may indicate stale provenance or a workflow depending on an archived procedure.",
            ", ".join(str(item.get("label")) for item in archived_recent[:3]),
        )

    frequently_patched = sorted(
        [item for item in usage_items if int(item.get("patch_count") or 0) >= 3 or item.get("recently_patched")],
        key=lambda item: (int(item.get("patch_count") or 0), str(item.get("last_patched_at") or "")),
        reverse=True,
    )
    if frequently_patched:
        add_signal(
            "info",
            "Recently changed skills need review",
            "Review frequently patched skills before treating their recommendations as stable procedure.",
            ", ".join(f"{item.get('label')}: {item.get('patch_count')} patches" for item in frequently_patched[:3]),
        )

    hub_missing = [item for item in hub_items if not item.get("trust_level") or not item.get("scan_verdict")]
    if hub_missing:
        add_signal(
            "warning",
            "Hub skills are missing trust or scan metadata",
            "Hub-installed skills need trust and scan evidence when Hermes has recorded it locally.",
            ", ".join(str(item.get("label")) for item in hub_missing[:3]),
        )

    audit_findings = []
    for item in hub_items:
        for audit in as_list(item.get("security_audits")):
            if not isinstance(audit, dict) or audit.get("verdict") == "pass":
                continue
            audit_findings.append(f"{item.get('label')}: {audit.get('check')} {audit.get('verdict')}")
    if audit_findings:
        add_signal(
            "warning",
            "Stored skill audit needs review",
            "Hermes has stored a warn or fail audit result for installed hub skills. Review the Skills page before using those skills in forced workflows.",
            ", ".join(audit_findings[:4]),
            "/skills",
            "Hermes skill hub lock stored skills.sh audit metadata",
        )

    forced_skill_names: set[str] = set()
    for task in kanban_items(kanban, "_tasks"):
        for name in as_list(task.get("_skills")):
            if name:
                forced_skill_names.add(str(name))
    missing_forced = sorted(name for name in forced_skill_names if name not in usage_names and name not in hub_names)
    if missing_forced:
        add_signal(
            "warning",
            "Kanban tasks require skills this machine does not have",
            "Kanban references skills that do not appear in local usage or hub metadata. Review the task or skill install.",
            ", ".join(_public_skill_label(name) for name in missing_forced[:4]),
            "/kanban",
            "Hermes Kanban tasks.skills plus local skill metadata",
        )

    coverage_summary = skill_coverage.get("summary") if isinstance(skill_coverage.get("summary"), dict) else {}
    state = "warning" if any(item.get("severity") == "warning" for item in findings) else ("active" if usage_items or hub_items else "unknown")
    return {
        "summary": {
            "state": state,
            "issues": len(findings),
            "total_skills": summary.get("total_skills") or coverage_summary.get("total_skills") or 0,
            "archived": summary.get("archived") or 0,
            "stale": summary.get("stale") or 0,
            "never_used": summary.get("never_used") or 0,
            "recently_patched": summary.get("recently_patched") or 0,
            "hub_installed": summary.get("hub_installed") or 0,
            "hub_missing_trust": summary.get("hub_missing_trust") or 0,
            "hub_missing_scan": summary.get("hub_missing_scan") or 0,
            "hub_audit_pass": summary.get("hub_audit_pass") or 0,
            "hub_audit_warn": summary.get("hub_audit_warn") or 0,
            "hub_audit_fail": summary.get("hub_audit_fail") or 0,
            "forced_skill_metadata_gaps": len(missing_forced),
        },
        "signals": findings[:8],
        "usage": strip_internal(sorted(usage_items, key=lambda item: int(item.get("use_count") or 0), reverse=True)[:8]),
        "hub": strip_internal(hub_items[:8]),
    }


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


def recency_expr(columns: List[str], fallback: str = "rowid") -> str:
    """Latest-of expression for the given timestamp columns.

    SQLite's COALESCE needs at least two arguments, so one column is used as is.
    """
    if len(columns) > 1:
        return f"COALESCE({', '.join(columns)})"
    return columns[0] if columns else fallback


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
        "_slug": "default",
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
                public_slug = p.name if EXPOSE_LOCAL_LABELS else safe_id(p.name, "board")
                boards.append({
                    "slug": public_slug,
                    "_slug": p.name,
                    "name": public_label(meta.get("name") or p.name, public_slug, "board"),
                    "description": meta.get("description") if EXPOSE_LOCAL_LABELS else None,
                    "db_exists": (p / "kanban.db").exists(),
                })
        except Exception:
            pass
    current = read_kanban_current()
    for board in boards:
        board["is_current"] = str(board.get("_slug") or board.get("slug")) == current
    return boards


def _kanban_conn(path: Path) -> Optional[sqlite3.Connection]:
    if not path.exists():
        return None
    # Some Kanban SQLite files can be opened in `mode=ro` but fail on the
    # first read when SQLite tries to resolve journal/WAL sidecars. Verify the
    # connection before returning it and fall back to immutable read-only mode.
    for uri in (f"file:{path}?mode=ro", f"file:{path}?mode=ro&immutable=1"):
        con: Optional[sqlite3.Connection] = None
        try:
            con = sqlite3.connect(uri, uri=True, timeout=1.5)
            con.row_factory = sqlite3.Row
            con.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone()
            return con
        except Exception:
            if con is not None:
                try:
                    con.close()
                except Exception:
                    pass
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


def _cfg_value(config: Dict[str, Any], *keys: str) -> Any:
    current: Any = config
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _cfg_flag(value: Any, default: bool) -> bool:
    """A config boolean that falls back to Hermes' default when unset."""
    if value in (None, ""):
        return default
    return _cfg_bool(value)


def _cfg_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on", "enabled", "allow", "record"}
    return False


def _cfg_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _configured_count(value: Any) -> int:
    if isinstance(value, dict):
        return len([k for k, v in value.items() if v not in (None, "", False, [], {})])
    if isinstance(value, list):
        return len([item for item in value if item not in (None, "", False, [], {})])
    return 1 if value not in (None, "", False, [], {}) else 0


def _cfg_any_count(config: Dict[str, Any], paths: List[List[str]]) -> int:
    total = 0
    for path in paths:
        total += _configured_count(_cfg_value(config, *path))
    return total


def _cfg_any_bool(config: Dict[str, Any], paths: List[List[str]]) -> bool:
    return any(_cfg_bool(_cfg_value(config, *path)) for path in paths)


def _profile_config_paths(profiles: List[Dict[str, Any]]) -> List[Path]:
    paths: List[Path] = []
    for profile in profiles:
        raw = profile.get("_path") if isinstance(profile, dict) else None
        if raw:
            paths.append(Path(str(raw)) / "config.yaml")
    return paths


def _config_max_turns(configs: List[Dict[str, Any]], kanban: Dict[str, Any]) -> List[int]:
    values: List[int] = []
    for cfg in configs:
        for path in (["agent", "max_turns"], ["agents", "max_turns"], ["max_turns"]):
            val = _cfg_int(_cfg_value(cfg, *path))
            if val is not None:
                values.append(val)
    for task in kanban_items(kanban, "_tasks"):
        val = _cfg_int(task.get("goal_max_turns"))
        if val is not None:
            values.append(val)
    return values


def _loop_guardrail_policy(config: Dict[str, Any]) -> Dict[str, bool]:
    """Effective hard-stop coverage from Hermes' top-level ``tool_loop_guardrails``.

    Mirrors agent/tool_guardrails.ToolCallGuardrailConfig: hard stops are off
    for attended platforms (cli/tui/desktop) unless ``hard_stop_enabled``, and
    on for unattended gateway/cron sessions unless
    ``non_interactive_hard_stop_enabled`` is turned off. An absent section
    means Hermes' defaults.
    """
    section = config.get("tool_loop_guardrails")
    if not isinstance(section, dict):
        section = {}
    hard_stop = _cfg_flag(section.get("hard_stop_enabled"), False)
    unattended = hard_stop or _cfg_flag(section.get("non_interactive_hard_stop_enabled"), True)
    return {"interactive": hard_stop, "unattended": unattended}


def _auxiliary_route_count(config: Dict[str, Any], env_names: set[str]) -> int:
    config_count = _cfg_any_count(config, [
        ["auxiliary_provider"],
        ["auxiliary_providers"],
        ["auxiliary"],
        ["aux"],
        ["model", "auxiliary_provider"],
        ["model", "auxiliary_providers"],
        ["providers", "auxiliary"],
        ["providers", "background"],
        ["providers", "summarizer"],
    ])
    env_count = 1 if any("AUX" in key or "AUXILIARY" in key for key in env_names) else 0
    return config_count + env_count


def collect_config_policy(profiles: List[Dict[str, Any]], sessions: List[Dict[str, Any]], kanban: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    kanban = kanban or {}
    hermes_home = get_hermes_home()
    root_config_path = hermes_home / "config.yaml"
    root_config = read_yaml(root_config_path)
    profile_paths = _profile_config_paths(profiles)
    profile_configs = [read_yaml(path) for path in profile_paths if path.exists()]
    configs = [root_config, *profile_configs]
    env_names = set(env_keys(hermes_home / ".env"))
    for profile in profiles:
        raw = profile.get("_path") if isinstance(profile, dict) else None
        if raw:
            env_names.update(env_keys(Path(str(raw)) / ".env"))

    max_turns_values = _config_max_turns(configs, kanban)
    max_turns = max(max_turns_values) if max_turns_values else 0
    # Each profile runs with its own config.yaml, so coverage holds only when
    # every scanned config provides it.
    loop_policies = [_loop_guardrail_policy(cfg) for cfg in configs]
    hard_loop_stop = all(policy["unattended"] for policy in loop_policies)
    interactive_hard_stop = all(policy["interactive"] for policy in loop_policies)
    high_turn_limit = max_turns >= MAX_TURNS_REVIEW_THRESHOLD
    fallback_count = _cfg_any_count(root_config, [["fallback_providers"], ["model", "fallback_providers"], ["providers", "fallback"], ["providers", "fallback_providers"]])
    toolset_count = sum(_cfg_any_count(cfg, [["toolsets"], ["tools", "toolsets"], ["agent", "toolsets"]]) for cfg in configs)
    compression_enabled = any(_cfg_any_bool(cfg, [["compression", "enabled"], ["agent", "compression"], ["memory", "compression"]]) for cfg in configs)
    browser_private_urls = _cfg_any_bool(root_config, [["browser", "allow_private_urls"], ["browser", "allow_local_urls"], ["browser", "private_urls"], ["browser", "allow_private_network"]])
    browser_recording = _cfg_any_bool(root_config, [["browser", "record_sessions"], ["browser", "recording"], ["browser", "session_recording"]])
    auxiliary_routes = _auxiliary_route_count(root_config, env_names)
    route_audit_profiles = sum(1 for profile in profiles if profile.get("model") or profile.get("provider"))
    model_override_tasks = int(((build_orchestration(kanban).get("summary") or {}).get("model_override_tasks")) or 0)
    sessions_with_cost = sum(1 for session in sessions if _session_cost(session) > 0)
    total_cost = round(sum(_session_cost(session) for session in sessions), 4)
    cost_signal_available = bool(sessions_with_cost or total_cost > 0)

    findings: List[Dict[str, Any]] = []

    def add(kind: str, severity: str, title: str, detail: str, evidence: str, view: str, basis: str, threshold: str = "") -> None:
        action = "Open Config" if view == "/config" else ("Open Sessions" if view == "/sessions" else "Open Analytics")
        findings.append(_tuning_item(kind, severity, title, detail, evidence, view, action, "Olympus", basis, threshold))

    if root_config_path.exists() is False and not profile_configs:
        add(
            "config",
            "info",
            "Hermes config policy evidence is missing",
            "Olympus did not find a readable root or profile config. Runtime signals still render, but policy checks cannot explain agent limits.",
            "config files missing",
            "/config",
            "Hermes config.yaml presence",
        )
    if high_turn_limit and not hard_loop_stop:
        add(
            "policy",
            "warning",
            "Unattended sessions have no loop hard stop",
            "tool_loop_guardrails.non_interactive_hard_stop_enabled is off, so gateway and cron sessions only warn on tool loops while a high turn limit lets them run long. Nobody is present to stop them.",
            f"max_turns {max_turns} / unattended hard stop off",
            "/config",
            "Turn limit and loop guardrail settings",
            f"max_turns >= {MAX_TURNS_REVIEW_THRESHOLD} and non_interactive_hard_stop_enabled false",
        )
    elif high_turn_limit and not interactive_hard_stop:
        add(
            "policy",
            "info",
            "Interactive sessions only warn on tool loops",
            "Gateway and cron sessions hard-stop on loops, but CLI, TUI and Desktop sessions only warn (Hermes' default). Enable hard_stop_enabled if long attended runs keep looping.",
            f"max_turns {max_turns} / interactive hard stop off",
            "/config",
            "Turn limit and loop guardrail settings",
            f"max_turns >= {MAX_TURNS_REVIEW_THRESHOLD} and hard_stop_enabled false",
        )
    if browser_private_urls:
        add(
            "browser",
            "warning",
            "Browser private URL access is enabled",
            "Private or local browser targets widen the data boundary. Keep this enabled only when local automation needs it.",
            "browser private URL flag enabled",
            "/config",
            "Hermes browser privacy flags",
        )
    if browser_recording:
        add(
            "browser",
            "warning",
            "Browser session recording is enabled",
            "Recorded browser sessions can capture sensitive local workflow context. Review retention and access before long-running agents use it.",
            "browser recording flag enabled",
            "/config",
            "Hermes browser privacy flags",
        )
    if auxiliary_routes and not cost_signal_available:
        add(
            "cost",
            "warning",
            "Auxiliary route cost is not visible",
            "Auxiliary or background provider routes are configured, but recent sessions do not expose cost. Background work can hide spend without a usage signal.",
            f"{auxiliary_routes} auxiliary route signal(s) / 0 costed sessions",
            "/analytics",
            "Auxiliary model routes and session costs",
        )
    if fallback_count and not route_audit_profiles:
        add(
            "model",
            "warning",
            "Fallback providers lack route audit evidence",
            "Fallback providers are configured, but profile/session route evidence is not visible. Make routing explicit before tuning model behavior.",
            f"{fallback_count} fallback provider(s) / 0 visible profile routes",
            "/config",
            "Hermes fallback provider config plus profile route metadata",
        )
    if fallback_count and route_audit_profiles:
        add(
            "model",
            "info",
            "Fallback providers have visible route evidence",
            "Fallback routes are present and profile route metadata is visible, so route changes can be audited from Olympus.",
            f"{fallback_count} fallback provider(s) / {route_audit_profiles} routed profile(s)",
            "/config",
            "Hermes fallback provider config plus profile route metadata",
        )

    settings = [
        {
            "id": "max_turns",
            "label": "Max Turns",
            "value": max_turns,
            "state": "warning" if high_turn_limit and not hard_loop_stop else ("active" if max_turns else "unknown"),
            "detail": "Highest configured agent or goal turn limit.",
            "source": "agent.max_turns and Kanban goal_max_turns",
            "recommended_view": "/config",
        },
        {
            "id": "loop_guard",
            "label": "Loop Stop",
            "value": "all sessions" if interactive_hard_stop else ("unattended only" if hard_loop_stop else "off"),
            "state": "ok" if hard_loop_stop else ("warning" if high_turn_limit else "unknown"),
            "detail": "Sessions where repeated failing tool calls hard-stop instead of only warning.",
            "source": "tool_loop_guardrails",
            "recommended_view": "/config",
        },
        {
            "id": "fallbacks",
            "label": "Fallbacks",
            "value": fallback_count,
            "state": "active" if fallback_count else "idle",
            "detail": "Fallback provider routes configured in safe config structure.",
            "source": "fallback_providers",
            "recommended_view": "/config",
        },
        {
            "id": "toolsets",
            "label": "Toolsets",
            "value": toolset_count,
            "state": "active" if toolset_count else "unknown",
            "detail": "Configured toolset collections across root and profile config.",
            "source": "toolsets",
            "recommended_view": "/config",
        },
        {
            "id": "browser",
            "label": "Browser Privacy",
            "value": (1 if browser_private_urls else 0) + (1 if browser_recording else 0),
            "state": "warning" if browser_private_urls or browser_recording else "ok",
            "detail": "Private URL access and browser recording flags.",
            "source": "browser privacy flags",
            "recommended_view": "/config",
        },
        {
            "id": "aux_cost",
            "label": "Aux Cost",
            "value": total_cost,
            "unit": "usd",
            "state": "warning" if auxiliary_routes and not cost_signal_available else ("active" if cost_signal_available else "unknown"),
            "detail": f"{auxiliary_routes} auxiliary route signal(s), {sessions_with_cost} costed session(s).",
            "source": "auxiliary route presence and estimated/actual_cost_usd",
            "recommended_view": "/analytics",
        },
    ]
    findings.sort(key=lambda item: _severity_rank(str(item.get("severity"))))
    state = "warning" if any(item.get("severity") in ("critical", "warning") for item in findings) else ("info" if findings else ("ok" if root_config_path.exists() or profile_configs else "unknown"))
    return {
        "summary": {
            "state": state,
            "findings": len(findings),
            "root_config_present": root_config_path.exists(),
            "profile_configs": len(profile_configs),
            "max_turns": max_turns,
            "hard_loop_stop": hard_loop_stop,
            "interactive_hard_stop": interactive_hard_stop,
            "fallback_providers": fallback_count,
            "toolsets": toolset_count,
            "compression_enabled": compression_enabled,
            "browser_private_flags": (1 if browser_private_urls else 0) + (1 if browser_recording else 0),
            "auxiliary_routes": auxiliary_routes,
            "costed_sessions": sessions_with_cost,
            "total_cost_usd": total_cost,
            "route_audit_profiles": route_audit_profiles,
            "model_override_tasks": model_override_tasks,
        },
        "settings": settings,
        "findings": findings[:8],
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
    """Gateway liveness for a profile home.

    Inside Hermes this is ``gateway.status.live_gateway_pid_for_home``: pid file
    and runtime lock first, then the runtime record, so a launch-service
    gateway whose ``gateway.pid`` was unlinked still reads as running. Outside
    Hermes (unit tests) the ``gateway.pid`` record is checked directly.
    """
    try:
        from gateway.status import live_gateway_pid_for_home  # type: ignore
    except ImportError:
        return _pid_file_gateway_state(profile_home / "gateway.pid")
    return "running" if live_gateway_pid_for_home(profile_home) else "stopped"


def multiplexed_profile_names(root: Path, root_gateway_state: str) -> set[str]:
    """Named profiles the live default gateway serves as a multiplexer.

    Such profiles have no gateway of their own; the default gateway records
    them as ``served_profiles`` in its ``gateway_state.json`` (Hermes #97120).
    """
    if root_gateway_state != "running":
        return set()
    record = read_json(root / "gateway_state.json")
    served = record.get("served_profiles") if isinstance(record, dict) else None
    return {str(name) for name in as_list(served) if name and name != "default"}


def _pid_file_gateway_state(pid_path: Path) -> str:
    if not pid_path.exists():
        return "stopped"
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
    # Avoid treating a recycled PID as a gateway.
    cmdline = _process_cmdline(pid)
    if cmdline is not None:
        return "running" if "gateway" in cmdline else "stopped"
    return "running" if kind == "hermes-gateway" else "unknown"


# Mirrors hermes_constants.PROFILE_ID_RE: named profiles live in
# <root>/profiles/<id>; anything else in that folder (the .deleted tombstone,
# stray files) is not a profile.
PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def hermes_root(home: Path) -> Path:
    """Hermes root for a home, like Hermes' ``profile_root_for_env_home``.

    The root is the ``default`` profile's home; a profile-shaped home
    (``<root>/profiles/<name>``) belongs to the root two levels up.
    """
    return home.parent.parent if home.parent.name == "profiles" else home


def profile_homes() -> List[tuple[str, Path]]:
    """Every profile as (name, home), default first, named profiles sorted."""
    root = hermes_root(get_hermes_home())
    homes: List[tuple[str, Path]] = [("default", root)]
    profiles_dir = root / "profiles"
    if profiles_dir.is_dir():
        for entry in sorted(profiles_dir.iterdir()):
            if entry.is_dir() and entry.name != "default" and PROFILE_ID_RE.match(entry.name):
                homes.append((entry.name, entry))
    return homes


def active_profile_name() -> str:
    base = get_hermes_home().resolve()
    for name, home in profile_homes():
        if home.resolve() == base:
            return name
    return "default"


def profile_stores(profiles: Optional[List[Dict[str, Any]]]) -> List[tuple[str, Path]]:
    """(raw profile name, home) for each scanned profile, or the active home alone."""
    stores = [
        (str(profile["name"]), Path(str(profile["_path"])))
        for profile in as_list(profiles)
        if isinstance(profile, dict) and profile.get("name") and profile.get("_path")
    ]
    return stores or [(active_profile_name(), get_hermes_home())]


def profile_role(home: Path) -> Dict[str, Any]:
    """Role from Hermes' profile.yaml (what the Kanban decomposer routes by).

    The description is the operator's own text, so like other labels it is
    returned only when local labels are enabled; its state always is.
    """
    meta = read_yaml(home / "profile.yaml")
    description = str(meta.get("description") or "").strip()
    if not description:
        state = "missing"
    elif meta.get("description_auto"):
        state = "auto"
    else:
        state = "described"
    return {"role_state": state, "role": redact_text(description, 200) if EXPOSE_LOCAL_LABELS and description else None}


def collect_profiles() -> List[Dict[str, Any]]:
    base = get_hermes_home().resolve()
    profiles: List[Dict[str, Any]] = []
    homes = profile_homes()
    root_gateway = gateway_process_state(homes[0][1])
    multiplexed = multiplexed_profile_names(homes[0][1], root_gateway)

    for name, home in homes:
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
        gstate = root_gateway if name == "default" else gateway_process_state(home)
        gateway_mode = "own" if gstate == "running" else None
        if gstate != "running" and name in multiplexed:
            gstate = "running"
            gateway_mode = "multiplexed"
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
            "gateway_mode": gateway_mode,
            "dashboard_home": home.resolve() == base,
            **profile_role(home),
        })
    return profiles


def cron_schedule_display(job: Dict[str, Any]) -> Optional[str]:
    """Human-readable schedule for a cron job, tolerant of legacy shapes.

    ``schedule`` may be a dict (current shape, carrying a ``display`` field), a
    bare string (older / hand-edited ``jobs.json``), or absent. Mirrors Hermes'
    own ``_schedule_display_for_job`` normalization so a string schedule doesn't
    raise ``AttributeError`` on ``.get("display")`` and 500 the whole scan.
    """
    display = job.get("schedule_display")
    if display:
        return str(display)
    schedule = job.get("schedule")
    if isinstance(schedule, dict):
        return schedule.get("display")
    if schedule is not None:
        return str(schedule)
    return None


def collect_cron(profiles: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    # Cron is per-profile in Hermes: each profile home owns cron/jobs.json and
    # runs those jobs under its own config, so the store a job came from is
    # its profile.
    profile_public_names = profile_public_map(as_list(profiles))
    out: List[Dict[str, Any]] = []
    for raw_profile, home in profile_stores(profiles):
        data = read_json(home / "cron" / "jobs.json") or {}
        jobs = as_list(data.get("jobs") if isinstance(data, dict) else [])
        out.extend(_cron_rows(jobs, raw_profile, profile_public_names, _cron_last_run_tool_failures(home / "state.db", jobs)))
    return out


def _cron_last_run_tool_failures(db: Path, jobs: List[Any]) -> Dict[str, Dict[str, Any]]:
    """Per job id: its last run, when Hermes recorded it OK but every tool call failed.

    Hermes titles each cron session "<job name> · <time>" before closing it
    and sets the job's last_run_at just after (cron/scheduler.py
    _finalize_cron_session), so the last run is the newest session with that
    title that ended shortly before last_run_at.
    """
    wanted: Dict[str, tuple[str, float]] = {}
    for job in jobs:
        if not isinstance(job, dict) or not job.get("id") or job.get("no_agent") or job.get("last_status") != "ok":
            continue
        last_run = parse_iso_ts(job.get("last_run_at"))
        if last_run is None:
            continue
        job_id = str(job["id"])
        base = " ".join(str(job.get("name") or job.get("prompt") or job_id).split())[:60].strip() or f"cron {job_id}"
        wanted[job_id] = (f"{base} · ", last_run)
    if not wanted or not db.exists():
        return {}
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
    con.row_factory = sqlite3.Row
    out: Dict[str, Dict[str, Any]] = {}
    try:
        if not {"id", "source", "title", "started_at", "ended_at"}.issubset(table_columns(con, "sessions")):
            return {}
        for job_id, (prefix, last_run) in wanted.items():
            row = con.execute(
                "SELECT id, ended_at FROM sessions WHERE source = 'cron' AND started_at <= ? AND substr(title, 1, ?) = ? "
                "ORDER BY started_at DESC LIMIT 1",
                (last_run, len(prefix), prefix),
            ).fetchone()
            if row is None or not 0 <= last_run - safe_float(row["ended_at"]) <= CRON_RUN_SETTLE_SECONDS:
                continue
            failed = _sessions_with_every_tool_failed(con, "s.id = ?", (row["id"],)).get(str(row["id"]))
            if failed:
                out[job_id] = failed
    except sqlite3.Error as exc:
        log_read_warning("cron last-run scan failed", exc)
        return {}
    finally:
        con.close()
    return out


def _cron_rows(
    jobs: List[Any],
    raw_profile: str,
    profile_public_names: Dict[str, str],
    tool_failures: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    public_name = public_profile_label(raw_profile, profile_public_names) or "default"
    for job in jobs:
        if not isinstance(job, dict):
            continue
        last_status = job.get("last_status")
        enabled = bool(job.get("enabled", True))
        error = job.get("last_error") or job.get("last_delivery_error")
        state = "error" if error or last_status == "error" else ("scheduled" if enabled else "paused")
        tools_failed = None if state == "error" else tool_failures.get(str(job.get("id")))
        last_error = public_error(error)
        if tools_failed:
            state = "error"
            calls = tools_failed["calls"]
            which = "its only tool call" if calls == 1 else f"all {calls} of its tool calls"
            last_error = f"Hermes recorded the run as OK, but {which} failed. {public_error(tools_failed['first'])}"
        job_ref = public_ref(job.get("id"), "cron") or "cron"
        out.append({
            "id": job_ref,
            "kind": "cron",
            "job_id": job_ref,
            "label": public_label(job.get("name"), job_ref, "cron"),
            "state": state,
            "enabled": enabled,
            "schedule": cron_schedule_display(job),
            "next_run_at": ts_to_iso(job.get("next_run_at")),
            "last_run_at": ts_to_iso(job.get("last_run_at")),
            "last_status": last_status,
            "last_error": last_error,
            "tools_failed": bool(tools_failed),
            "profile": public_name,
            "_profile": raw_profile,
            "no_agent": bool(job.get("no_agent")),
        })
    return out


def collect_sessions(
    limit: int = 12,
    profiles: Optional[List[Dict[str, Any]]] = None,
    since: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """Most recently active sessions across every profile's state store.

    ``since`` (epoch seconds) keeps only sessions active at or after it.
    """
    profile_public_names = profile_public_map(as_list(profiles))
    rows: List[Dict[str, Any]] = []
    for raw_profile, home in profile_stores(profiles):
        public_name = public_profile_label(raw_profile, profile_public_names) or "default"
        for session in _store_sessions(home / "state.db", limit, since):
            session["profile"] = public_name
            session["_profile"] = raw_profile
            rows.append(session)
    rows.sort(key=lambda s: float(s.get("_last_ts") or 0), reverse=True)
    return rows[:limit]


def _store_sessions(db: Path, limit: int, since: Optional[float] = None) -> List[Dict[str, Any]]:
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
            "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
            "reasoning_tokens", "api_call_count", "estimated_cost_usd", "actual_cost_usd",
            "last_activity_at",
        ]
        select = [c for c in wanted if c in cols]
        if "id" not in select:
            return []
        # Most recent activity first: a long-running session that is still
        # working must not sort behind newer, idle ones.
        recency = [c for c in ("last_activity_at", "ended_at", "started_at") if c in cols]
        order = recency_expr(recency, "id")
        where = ""
        params: tuple[Any, ...] = (limit,)
        if since is not None and recency:
            where = f" WHERE {order} >= ?"
            params = (since, limit)
        rows = con.execute(
            f"SELECT {', '.join(select)} FROM sessions{where} ORDER BY {order} DESC LIMIT ?",
            params,
        ).fetchall()
    except Exception as exc:
        log_read_warning("session scan failed", exc)
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
        last_activity = row_value(r, "last_activity_at")
        last_ts = last_activity or ended or started
        if ended is None:
            state = "active" if age_state(last_ts) in ("active", "recent") else "stale"
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
        message_count = safe_int(row_value(r, "message_count", 0))
        tool_call_count = safe_int(row_value(r, "tool_call_count", 0))
        input_tokens = safe_int(row_value(r, "input_tokens", 0))
        output_tokens = safe_int(row_value(r, "output_tokens", 0))
        cache_read_tokens = safe_int(row_value(r, "cache_read_tokens", 0))
        cache_write_tokens = safe_int(row_value(r, "cache_write_tokens", 0))
        api_calls = safe_int(row_value(r, "api_call_count", 0))
        # Hermes' CanonicalUsage buckets: input_tokens is the uncached part of
        # the prompt, so the prompt the model actually saw adds both cache
        # buckets; reasoning is already inside output_tokens.
        prompt_tokens = input_tokens + cache_read_tokens + cache_write_tokens
        # Average prompt per API call is the context-pressure signal;
        # cumulative tokens over-count chatty sessions.
        avg_input_tokens = int(prompt_tokens / api_calls) if api_calls > 0 else 0
        actual_cost = row_value(r, "actual_cost_usd")
        estimated_cost = row_value(r, "estimated_cost_usd")
        cost_source = actual_cost if actual_cost not in (None, "") else estimated_cost
        try:
            cost_usd = float(cost_source) if cost_source not in (None, "") else 0.0
        except (TypeError, ValueError):
            cost_usd = 0.0
        cost_estimated = actual_cost in (None, "") and estimated_cost not in (None, "")
        public_session_ref = str(session_id) if EXPOSE_LOCAL_LABELS else safe_id(session_id, "session")
        out.append({
            "id": f"session:{public_session_ref}" if EXPOSE_LOCAL_LABELS else public_session_ref,
            "kind": "session",
            "session_ref": public_session_ref,
            "label": public_label(row_value(r, "title"), str(row_value(r, "source") or safe_id(session_id, "session")), "session"),
            "state": state,
            "source": row_value(r, "source"),
            "started_at": ts_to_iso(started),
            "ended_at": ts_to_iso(ended),
            "message_count": message_count,
            "tool_call_count": tool_call_count,
            "duration_seconds": duration_seconds,
            "last_activity_at": ts_to_iso(last_ts),
            "_last_ts": safe_float(last_ts),
            "input_tokens": input_tokens,
            "cache_read_tokens": cache_read_tokens,
            "cache_write_tokens": cache_write_tokens,
            "prompt_tokens": prompt_tokens,
            "output_tokens": output_tokens,
            "total_tokens": prompt_tokens + output_tokens,
            "avg_input_tokens": avg_input_tokens,
            "api_call_count": api_calls,
            "cost_usd": round(cost_usd, 4),
            "cost_estimated": cost_estimated,
            "model": model if EXPOSE_LOCAL_LABELS else ("configured" if model else None),
            "handoff_platform": row_value(r, "handoff_platform"),
            "handoff_error": public_error(handoff_error),
        })
    return out


def collect_gateways(profiles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Match Hermes gateway env markers.
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
        configured_keys = env_keys(home / ".env")
        gateway_state = prof.get("gateway_state") or "unknown"
        for platform, markers in platform_markers.items():
            # Hermes accepts top-level and `platforms.<platform>` config.
            pdata = cfg.get(platform)
            if not isinstance(pdata, dict):
                pdata = platforms_block.get(platform)
            explicitly_enabled = bool(pdata.get("enabled", False)) if isinstance(pdata, dict) else False
            configured = any(marker in configured_keys for marker in markers)
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
    profile_public_names = profile_public_map(profiles)
    now = int(time.time())
    boards = discover_kanban_boards()
    totals = {status: 0 for status in KANBAN_COLUMNS}
    attention: List[Dict[str, Any]] = []
    assignee_load: Dict[str, Dict[str, Any]] = {}
    tasks: List[Dict[str, Any]] = []
    runs: List[Dict[str, Any]] = []
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
        raw_slug = str(board.get("_slug") or slug)
        db_path = kanban_board_db(raw_slug)
        con = _kanban_conn(db_path)
        board_counts = {status: 0 for status in KANBAN_COLUMNS}
        board.update({
            "counts": board_counts,
            "total": 0,
            "open": 0,
            "diagnostic_count": 0,
            "active_workers": 0,
        })
        if not db_path.exists():
            board["state"] = "missing"
            continue
        if con is None:
            board["state"] = "error"
            board["error"] = "unreadable (details hidden)" if not EXPOSE_LOCAL_LABELS else "SQLite could not open the board database read-only."
            add_attention("warning", f"Could not read Kanban board {slug}", "The board database exists but could not be opened read-only.", slug)
            continue
        board["state"] = "ok"
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
                "goal_mode", "goal_max_turns", "workspace_kind", "tenant", "skills", "model_override",
                "block_kind", "block_recurrences",
            ]
            task_select = [c for c in task_select if c in task_cols]
            task_rows = []
            if task_select:
                # Every open task is operational evidence (load, blocked,
                # stale, unassigned); only closed history is sampled. A
                # recency LIMIT over all tasks let newer completed work push
                # an older running task out of the scan.
                recency = recency_expr([c for c in ("completed_at", "started_at", "created_at") if c in task_cols])
                open_marks = ", ".join("?" for _ in OPEN_KANBAN_STATUSES)
                open_params = tuple(sorted(OPEN_KANBAN_STATUSES))
                task_rows.extend(con.execute(
                    f"SELECT {', '.join(task_select)} FROM tasks WHERE status IN ({open_marks})",
                    open_params,
                ).fetchall())
                task_rows.extend(con.execute(
                    f"SELECT {', '.join(task_select)} FROM tasks WHERE status NOT IN ({open_marks}) AND status != 'archived' "
                    f"ORDER BY {recency} DESC LIMIT ?",
                    open_params + (KANBAN_CLOSED_TASK_SAMPLE,),
                ).fetchall())

            # When each blocked task last blocked, and why (the agent's
            # question for needs_input): the task row has neither, the
            # latest "blocked" event in task_events does.
            blocked_at: Dict[str, Any] = {}
            block_reasons: Dict[str, Optional[str]] = {}
            event_cols = table_columns(con, "task_events")
            if {"task_id", "kind", "created_at"}.issubset(event_cols):
                payload_col = "e.payload" if "payload" in event_cols else "NULL"
                for r in con.execute(
                    f"SELECT e.task_id, e.created_at AS at, {payload_col} AS payload FROM task_events e JOIN tasks t ON t.id = e.task_id "
                    "WHERE t.status = 'blocked' AND e.kind = 'blocked' ORDER BY e.created_at, e.id"
                ):
                    blocked_at[str(r["task_id"])] = r["at"]
                    try:
                        payload = json.loads(r["payload"] or "{}")
                    except ValueError:
                        payload = {}
                    reason = payload.get("reason") if isinstance(payload, dict) else None
                    block_reasons[str(r["task_id"])] = redact_text(reason, 300) if EXPOSE_LOCAL_LABELS and isinstance(reason, str) and reason.strip() else None

            for t in task_rows:
                status = str(row_value(t, "status", "unknown"))
                assignee = str(row_value(t, "assignee") or "unassigned")
                public_assignee = public_profile_label(assignee, profile_public_names) or "unassigned"
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
                public_task_id = task_id if EXPOSE_LOCAL_LABELS else safe_id(task_id, "task")
                title = public_label(raw_title, public_task_id, "task")
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
                            public_task_id,
                        )
                if status == "ready" and assignee == "unassigned":
                    add_attention("warning", f"Ready task is unassigned: {title}", "Dispatcher cannot claim ready work without an assignee.", slug, public_task_id)
                if status == "ready" and assignee != "unassigned" and profile_gateway.get(assignee) not in ("running", None):
                    add_attention("warning", f"Ready task may not dispatch: {title}", f"Assignee {public_assignee} does not have a visible running gateway.", slug, public_task_id)
                if status == "blocked":
                    add_attention("warning", f"Blocked task: {title}", "Blocked Kanban work needs operator review or clearer acceptance criteria.", slug, public_task_id)
                if failures > 0:
                    add_attention("warning", f"Retry pressure: {title}", f"{failures} consecutive failure(s). {public_error(row_value(t, 'last_failure_error'), 120) or 'No failure text recorded.'}", slug, public_task_id)
                if status in ("triage", "todo", "ready") and created_at:
                    try:
                        if now - int(created_at) > KANBAN_READY_STALE_SECONDS:
                            add_attention("info", f"Aging Kanban work: {title}", f"Task has been waiting in {status} for more than 24h.", slug, public_task_id)
                    except Exception:
                        pass

                forced_skills: List[str] = []
                raw_skills = row_value(t, "skills")
                if raw_skills:
                    try:
                        parsed_skills = json.loads(raw_skills)
                        if isinstance(parsed_skills, list):
                            forced_skills = [str(x) for x in parsed_skills if x]
                    except (TypeError, ValueError):
                        forced_skills = []
                tasks.append({
                    "_sort_ts": max(safe_float(row_value(t, c)) for c in ("completed_at", "last_heartbeat_at", "started_at", "created_at")),
                    "id": public_task_id,
                    "board": slug,
                    "title": title,
                    "status": status,
                    "assignee": public_assignee,
                    "_assignee": assignee,
                    "priority": row_value(t, "priority", 0),
                    "created_at": ts_to_iso(created_at),
                    "started_at": ts_to_iso(started_at),
                    "completed_at": ts_to_iso(row_value(t, "completed_at")),
                    "last_heartbeat_at": ts_to_iso(heartbeat),
                    "claim_expires_at": ts_to_iso(claim_expires),
                    "worker_ref": public_ref(row_value(t, "worker_pid"), "pid"),
                    "current_run_ref": public_ref(row_value(t, "current_run_id"), "run"),
                    "max_runtime_seconds": row_value(t, "max_runtime_seconds"),
                    "consecutive_failures": failures,
                    "goal_mode": bool(row_value(t, "goal_mode", 0)),
                    "block_kind": row_value(t, "block_kind"),
                    "block_recurrences": safe_int(row_value(t, "block_recurrences")),
                    "blocked_at": ts_to_iso(blocked_at.get(task_id)),
                    "block_reason": block_reasons.get(task_id),
                    "last_failure_error": public_error(row_value(t, "last_failure_error"), 160),
                    "_created_ts": safe_float(created_at),
                    "goal_max_turns": row_value(t, "goal_max_turns"),
                    "_skills": forced_skills,
                    "forced_skill_count": len(forced_skills),
                    "model_override": row_value(t, "model_override") if EXPOSE_LOCAL_LABELS else ("override" if row_value(t, "model_override") else None),
                    "session_ref": row_value(t, "session_id") if EXPOSE_LOCAL_LABELS else (safe_id(row_value(t, "session_id"), "session") if row_value(t, "session_id") else None),
                })

            if run_cols:
                run_select = [
                    "id", "task_id", "profile", "step_key", "status", "outcome", "worker_pid",
                    "last_heartbeat_at", "started_at", "ended_at", "error", "summary",
                ]
                run_select = [c for c in run_select if c in run_cols]
                run_rows = []
                if run_select:
                    # In-flight runs are always read; finished runs are a
                    # recency sample ordered by time, not by id.
                    run_recency = recency_expr([c for c in ("ended_at", "started_at") if c in run_cols])
                    in_flight = "ended_at IS NULL" if "ended_at" in run_cols else "0"
                    run_rows.extend(con.execute(
                        f"SELECT {', '.join(run_select)} FROM task_runs WHERE {in_flight}"
                    ).fetchall())
                    run_rows.extend(con.execute(
                        f"SELECT {', '.join(run_select)} FROM task_runs WHERE NOT ({in_flight}) "
                        f"ORDER BY {run_recency} DESC LIMIT ?",
                        (KANBAN_FINISHED_RUN_SAMPLE,),
                    ).fetchall())
                for r in run_rows:
                    run_status = str(row_value(r, "status", "unknown"))
                    outcome = row_value(r, "outcome")
                    ended_at = row_value(r, "ended_at")
                    heartbeat = row_value(r, "last_heartbeat_at")
                    task_id = str(row_value(r, "task_id", ""))
                    public_task_id = task_id if EXPOSE_LOCAL_LABELS else safe_id(task_id, "task")
                    if ended_at is None and run_status == "running":
                        active_workers.append({
                            "board": slug,
                            "run_ref": public_ref(row_value(r, "id"), "run"),
                            "task_id": public_task_id,
                            "profile": public_profile_label(row_value(r, "profile"), profile_public_names),
                            "worker_ref": public_ref(row_value(r, "worker_pid"), "pid"),
                            "started_at": ts_to_iso(row_value(r, "started_at")),
                            "last_heartbeat_at": ts_to_iso(heartbeat),
                        })
                    if is_failed_run({"status": run_status, "outcome": outcome}):
                        add_attention("critical", f"Kanban worker {outcome or run_status}: {public_task_id}", public_error(row_value(r, "error"), 200) or "Worker run failed", slug, public_task_id)
                    runs.append({
                        "id": public_ref(row_value(r, "id"), "run"),
                        "_sort_ts": max(safe_float(ended_at), safe_float(row_value(r, "started_at"))),
                        "board": slug,
                        "task_id": public_task_id,
                        "profile": public_profile_label(row_value(r, "profile"), profile_public_names),
                        "_profile": row_value(r, "profile"),
                        "status": run_status,
                        "outcome": outcome,
                        "started_at": ts_to_iso(row_value(r, "started_at")),
                        "ended_at": ts_to_iso(ended_at),
                        "error": public_error(row_value(r, "error"), 180),
                    })

            event_cols = table_columns(con, "task_events")
            recent_events: List[Dict[str, Any]] = board.setdefault("_recent_events", [])
            if {"id", "task_id", "kind", "created_at"}.issubset(event_cols):
                event_select = ["id", "task_id", "run_id", "kind", "created_at"]
                event_select = [c for c in event_select if c in event_cols]
                event_rows = con.execute(
                    f"SELECT {', '.join('e.' + c for c in event_select)}, t.title, t.assignee, t.status "
                    "FROM task_events e LEFT JOIN tasks t ON t.id = e.task_id "
                    "ORDER BY e.created_at DESC LIMIT 80"
                ).fetchall()
                for e in event_rows:
                    task_id = str(row_value(e, "task_id", ""))
                    public_task_id = task_id if EXPOSE_LOCAL_LABELS else safe_id(task_id, "task")
                    raw_title = str(row_value(e, "title") or task_id or "task")
                    assignee = str(row_value(e, "assignee") or "unassigned")
                    public_assignee = public_profile_label(assignee, profile_public_names) or "unassigned"
                    event_ref = public_ref(row_value(e, "id"), "event") or "event"
                    recent_events.append({
                        "id": f"{slug}:{event_ref}",
                        "board": slug,
                        "task_id": public_task_id,
                        "run_ref": public_ref(row_value(e, "run_id"), "run"),
                        "kind": row_value(e, "kind"),
                        "created_at": ts_to_iso(row_value(e, "created_at")),
                        "task_title": public_label(raw_title, public_task_id, "task"),
                        "task_status": row_value(e, "status"),
                        "assignee": public_assignee,
                        "_assignee": assignee,
                    })

            board["active_workers"] = sum(1 for w in active_workers if w.get("board") == slug)
        except Exception as exc:
            log_read_warning(f"kanban board scan failed for {slug}", exc)
            board["error"] = public_error(exc, 200)
            add_attention("warning", f"Could not read Kanban board {slug}", public_error(exc), slug)
        finally:
            con.close()

    for load in assignee_load.values():
        load["boards"] = sorted(load["boards"])
    tasks.sort(key=lambda item: item["_sort_ts"], reverse=True)
    runs.sort(key=lambda item: item["_sort_ts"], reverse=True)

    all_events: List[Dict[str, Any]] = []
    for board in boards:
        all_events.extend(as_list(board.pop("_recent_events", [])))
    all_events.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    attention.sort(key=lambda x: _severity_rank(str(x.get("severity"))))
    current_board = read_kanban_current()
    public_current_board = current_board if (EXPOSE_LOCAL_LABELS or current_board == "default") else safe_id(current_board, "board")
    return {
        "current": public_current_board,
        "boards": boards,
        "totals": totals,
        "open": sum(totals.get(s, 0) for s in OPEN_KANBAN_STATUSES),
        "active_workers": active_workers[:12],
        "assignee_load": sorted(assignee_load.values(), key=lambda x: (-int(x.get("open") or 0), str(x.get("assignee")))),
        "attention": attention[:16],
        # _tasks/_runs are the complete operational sets every builder reads;
        # recent_* are display samples, newest first across all boards.
        "_tasks": tasks,
        "_runs": runs,
        "recent_tasks": tasks[:KANBAN_DISPLAY_SAMPLE],
        "recent_runs": runs[:KANBAN_DISPLAY_SAMPLE],
        "recent_events": all_events[:40],
    }


def collect_health(profiles: List[Dict[str, Any]], cron: List[Dict[str, Any]]) -> Dict[str, Any]:
    base = get_hermes_home()
    logs_dir = base / "logs"
    agent_log = logs_dir / "agent.log"
    gateway_log = logs_dir / "gateway.log"
    error_log = logs_dir / "errors.log"
    # agent.log always exists; gateway.log appears after gateway startup.
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
        summary = "Log tail contains failure terms. Inspect logs."
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
        "log_scan_window": "last 8KB per log file",
        "failed_cron_count": len(failed_cron),
        "agent_log_mtime": ts_to_iso(agent_log.stat().st_mtime) if agent_log.exists() else None,
        "gateway_log_mtime": ts_to_iso(gateway_log.stat().st_mtime) if gateway_log.exists() else None,
        "errors_log_mtime": ts_to_iso(error_log.stat().st_mtime) if error_log.exists() else None,
    }


def _severity_rank(value: str) -> int:
    return {"critical": 0, "error": 1, "warning": 2, "info": 3, "ok": 4}.get(value, 3)


def _action_label_for_view(view: str) -> str:
    return {
        "/analytics": "Open Analytics",
        "/config": "Open Config",
        "/cron": "Open Cron",
        "/kanban": "Open Kanban",
        "/logs": "Open Logs",
        "/profiles": "Open Profiles",
        "/sessions": "Open Sessions",
        "/skills": "Open Skills",
    }.get(view, "Open Route")


def session_targets(sessions: List[Dict[str, Any]], limit: int = 3) -> List[Dict[str, Any]]:
    """Sessions a tuning item points at, openable through ``/open/session``."""
    return [
        {"kind": "session", "ref": s.get("session_ref"), "label": s.get("label"), "agent": f"profile:{s.get('profile') or 'default'}"}
        for s in sessions[:limit]
        if s.get("session_ref")
    ]


def tuning_key(kind: str, title: str) -> str:
    """Stable identity for a finding across scans, used by fix tracking."""
    return re.sub(r"[^a-z0-9]+", "-", f"{kind} {title}".lower()).strip("-")


def _tuning_item(kind: str, severity: str, title: str, detail: str, evidence: str, view: str, action: str, owner: str = "Olympus", basis: str = "", threshold: str = "", targets: Optional[List[Dict[str, Any]]] = None, count: Optional[int] = None, scope: str = "fleet") -> Dict[str, Any]:
    # scope "entity": the Needs-you queue already lists each task behind this
    # finding with its own action; scope "agent": the queue lists it per
    # agent from that agent's own sessions. Either way the queue skips the
    # fleet summary and Checks still shows it.
    return {
        "key": tuning_key(kind, title),
        "count": count,
        "targets": targets or [],
        "scope": scope,
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


def _session_cost(s: Dict[str, Any]) -> float:
    try:
        return float(s.get("cost_usd") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def profile_public_map(profiles: List[Dict[str, Any]]) -> Dict[str, str]:
    return {
        str(p.get("name")): str(p.get("_public_name") or p.get("name"))
        for p in profiles
        if isinstance(p, dict) and p.get("name")
    }


def public_profile_label(raw: Any, profile_names: Dict[str, str]) -> Optional[str]:
    if raw in (None, ""):
        return None
    name = str(raw)
    return profile_names.get(name, name if EXPOSE_LOCAL_LABELS or name in {"default", "unassigned"} else safe_id(name, "profile"))


def cron_profile(job: Dict[str, Any]) -> str:
    return str(job.get("_profile") or job.get("profile") or "default")


def group_cron_by_profile(cron: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for job in cron:
        grouped.setdefault(cron_profile(job), []).append(job)
    return grouped


# Hermes' block kinds (hermes_cli/kanban_db.VALID_BLOCK_KINDS) say who has to
# act. Olympus groups the backlog by them so a long blocked list becomes a few
# decisions instead of a scroll.
BACKLOG_GROUPS = [
    ("needs_input", "Waiting on a human answer",
     "These tasks are blocked on a decision or answer only a person can give. Answer them in Kanban, oldest first.", "critical"),
    ("capability", "Missing a tool, skill or permission",
     "The assignee could not do the work with what it has. Give it the tool, skill or permission, or reassign the task.", "warning"),
    ("transient", "Temporary failures",
     "Usually clears on the next attempt. Look at the ones blocked for more than a day.", "info"),
    ("untyped", "Blocked without a reason kind",
     "The agent blocked without saying why. Open each task to read the reason.", "warning"),
    ("triage", "Sent to triage after repeat blocks",
     "Hermes moved these to triage because they were unblocked and blocked again for the same reason.", "warning"),
    ("dependency", "Waiting on parent tasks",
     "Not actionable yet: these start when the tasks they depend on finish.", "info"),
]
BACKLOG_STALE_DAYS = 3
BACKLOG_NEEDS_INPUT_WARNING = 3


def backlog_group(task: Dict[str, Any]) -> Optional[str]:
    status = task.get("status")
    kind = task.get("block_kind")
    if status == "triage":
        return "triage"
    if status == "todo" and kind == "dependency":
        return "dependency"
    if status != "blocked":
        return None
    return kind if kind in ("needs_input", "capability", "transient") else "untyped"


def build_backlog_triage(kanban: Optional[Dict[str, Any]], now: Optional[float] = None) -> Dict[str, Any]:
    now = time.time() if now is None else now
    members: Dict[str, List[Dict[str, Any]]] = {}
    for task in kanban_items(kanban, "_tasks"):
        group = backlog_group(task)
        if group:
            members.setdefault(group, []).append(task)
    groups: List[Dict[str, Any]] = []
    for key, label, action, severity in BACKLOG_GROUPS:
        tasks = members.get(key, [])
        if not tasks:
            continue
        tasks.sort(key=lambda task: safe_float(task.get("_created_ts")) or now)
        oldest = safe_float(tasks[0].get("_created_ts"))
        assignees: Dict[str, int] = {}
        for task in tasks:
            assignees[str(task.get("assignee") or "unassigned")] = assignees.get(str(task.get("assignee") or "unassigned"), 0) + 1
        groups.append({
            "kind": key,
            "label": label,
            "action": action,
            "severity": severity,
            "count": len(tasks),
            "oldest_days": int((now - oldest) // 86400) if oldest else None,
            "stale": sum(1 for task in tasks if safe_float(task.get("_created_ts")) and now - safe_float(task.get("_created_ts")) > BACKLOG_STALE_DAYS * 86400),
            "repeat_blocks": sum(1 for task in tasks if int(task.get("block_recurrences") or 0) > 1),
            "assignees": [{"assignee": name, "count": count} for name, count in sorted(assignees.items(), key=lambda kv: -kv[1])[:3]],
            "samples": [{"title": task.get("title"), "board": task.get("board")} for task in tasks[:3]],
        })
    return {
        "summary": {
            "groups": len(groups),
            "tasks": sum(group["count"] for group in groups),
            "needs_you": sum(group["count"] for group in groups if group["kind"] in ("needs_input", "capability", "untyped", "triage")),
        },
        "groups": groups,
        "recommended_view": "/kanban",
    }


def backlog_findings(triage: Dict[str, Any]) -> List[Dict[str, Any]]:
    findings: List[Dict[str, Any]] = []
    for group in triage["groups"]:
        if group["kind"] == "needs_input" and (group["count"] >= BACKLOG_NEEDS_INPUT_WARNING or (group["oldest_days"] or 0) >= BACKLOG_STALE_DAYS):
            findings.append(_tuning_item(
                "kanban",
                "warning",
                f"{group['count']} Kanban task{'s are' if group['count'] != 1 else ' is'} waiting on your answer",
                "Agents blocked these on a question or decision only a person can give. Until someone answers, the work and anything depending on it stays stuck.",
                f"oldest waiting {group['oldest_days']} day(s); " + ", ".join(f"{a['assignee']}: {a['count']}" for a in group["assignees"]),
                "/kanban",
                "Open Kanban",
                "Olympus",
                "Hermes records why a task blocked (block_kind needs_input).",
                f">= {BACKLOG_NEEDS_INPUT_WARNING} needs-input tasks or one waiting >= {BACKLOG_STALE_DAYS} days",
                count=group["count"],
                scope="entity",
            ))
        if group["kind"] == "capability" and group["count"]:
            findings.append(_tuning_item(
                "kanban",
                "warning",
                "Agents are blocked on missing tools or permissions",
                "The assignee could not finish because it lacks a tool, skill or permission. Granting it, or routing the work elsewhere, unblocks every task in this group.",
                ", ".join(f"{a['assignee']}: {a['count']}" for a in group["assignees"]),
                "/kanban",
                "Open Kanban",
                "Olympus",
                "Hermes records why a task blocked (block_kind capability).",
                "any task blocked with kind capability",
                count=group["count"],
                scope="entity",
            ))
    return findings


def kanban_items(kanban: Optional[Dict[str, Any]], key: str) -> List[Dict[str, Any]]:
    return [x for x in as_list((kanban or {}).get(key)) if isinstance(x, dict)]


def session_matches_profile(session: Dict[str, Any], raw_name: str) -> bool:
    # Sessions carry the profile whose state store they were read from;
    # matching on source/title substrings mislabelled "cli" sessions as a
    # profile named "li" and missed ordinary default-profile sessions.
    return str(session.get("_profile") or "") == str(raw_name)


def is_failed_run(run: Dict[str, Any]) -> bool:
    return run.get("status") in FAILED_RUN_STATUSES or run.get("outcome") in FAILED_RUN_OUTCOMES


def task_stale_reason(task: Dict[str, Any], now: Optional[float] = None) -> Optional[str]:
    if task.get("status") != "running":
        return None
    now = time.time() if now is None else now
    try:
        heartbeat = task.get("last_heartbeat_at")
        if heartbeat:
            ts = datetime.fromisoformat(str(heartbeat).replace("Z", "+00:00")).timestamp()
            if now - ts > KANBAN_HEARTBEAT_STALE_SECONDS:
                return "heartbeat stale"
    except Exception:
        pass
    try:
        claim = task.get("claim_expires_at")
        if claim:
            ts = datetime.fromisoformat(str(claim).replace("Z", "+00:00")).timestamp()
            if ts < now:
                return "claim expired"
    except Exception:
        pass
    return None


CRON_AUDIT_TAIL_BYTES = 2_000_000
COST_FINDING_FLOOR_USD = 1.0
CRON_CONCENTRATION_SHARE = 0.5
BACKGROUND_SHARE_WARNING = 0.3


def parse_iso_ts(value: Any) -> Optional[float]:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def cron_audit_fires(path: Path, since: float) -> Dict[str, Dict[str, Any]]:
    """Per-job totals from Hermes' cron/usage_audit.jsonl (one line per fire)."""
    if not path.exists():
        return {}
    text = read_text(path, CRON_AUDIT_TAIL_BYTES)
    lines = text.splitlines()
    if path.stat().st_size > CRON_AUDIT_TAIL_BYTES and lines:
        lines = lines[1:]  # the first line of a tail read is usually cut
    fires: Dict[str, Dict[str, Any]] = {}
    for line in lines:
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(record, dict) or not record.get("job_id"):
            continue
        ts = parse_iso_ts(record.get("ts"))
        if ts is None or ts < since:
            continue
        job = fires.setdefault(str(record["job_id"]), {"fires": 0, "tokens": 0, "duration_ms": 0, "errors": 0, "silent": 0})
        job["fires"] += 1
        job["tokens"] += safe_int(record.get("total_tokens")) or safe_int(record.get("prompt_tokens")) + safe_int(record.get("completion_tokens"))
        job["duration_ms"] += safe_int(record.get("duration_ms"))
        job["errors"] += 1 if record.get("error") else 0
        job["silent"] += 1 if record.get("response_silent") else 0
    return fires


def _store_cost_breakdown(db: Path, since: float) -> Dict[str, Any]:
    """Cron-session cost and per-task background usage from one state.db."""
    out: Dict[str, Any] = {"cron_cost": 0.0, "cron_sessions": 0, "tasks": {}}
    if not db.exists():
        return out
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
    con.row_factory = sqlite3.Row
    try:
        cols = table_columns(con, "sessions")
        recency = [c for c in ("last_activity_at", "ended_at", "started_at") if c in cols]
        cost_cols = [c for c in ("actual_cost_usd", "estimated_cost_usd") if c in cols]
        if "source" in cols and recency and cost_cols:
            row = con.execute(
                f"SELECT COALESCE(SUM(COALESCE({', '.join(cost_cols)}, 0)), 0) AS cost, COUNT(*) AS n "
                f"FROM sessions WHERE source = 'cron' AND {recency_expr(recency)} >= ?",
                (since,),
            ).fetchone()
            out["cron_cost"] = float(row["cost"] or 0.0)
            out["cron_sessions"] = int(row["n"] or 0)
        usage_cols = table_columns(con, "session_model_usage")
        if {"task", "api_call_count", "actual_cost_usd", "estimated_cost_usd"}.issubset(usage_cols):
            seen = "COALESCE(last_seen, first_seen, 0)" if {"last_seen", "first_seen"}.issubset(usage_cols) else "0"
            token_cols = [c for c in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens") if c in usage_cols]
            tokens = " + ".join(token_cols) or "0"
            for row in con.execute(
                f"SELECT task, SUM(api_call_count) AS calls, SUM({tokens}) AS tokens, "
                "SUM(CASE WHEN actual_cost_usd > 0 THEN actual_cost_usd ELSE estimated_cost_usd END) AS cost "
                f"FROM session_model_usage WHERE task != '' AND {seen} >= ? GROUP BY task",
                (since,),
            ):
                out["tasks"][str(row["task"])] = {
                    "calls": int(row["calls"] or 0),
                    "tokens": int(row["tokens"] or 0),
                    "cost": float(row["cost"] or 0.0),
                }
    except sqlite3.Error as exc:
        log_read_warning("cost breakdown scan failed", exc)
    finally:
        con.close()
    return out


def collect_cost_attribution(
    profiles: List[Dict[str, Any]],
    cron: List[Dict[str, Any]],
    sessions: List[Dict[str, Any]],
    since: float,
) -> Dict[str, Any]:
    """Where scheduled and background spend goes, per cron job and per task.

    Hermes records cost per session, not per cron fire, so each profile's cron
    session cost is shared across its jobs by token share from
    cron/usage_audit.jsonl. Background tasks come from session_model_usage.
    """
    rows_by_job = {(job.get("_profile"), job.get("id")): job for job in cron}
    jobs: List[Dict[str, Any]] = []
    tasks: Dict[str, Dict[str, Any]] = {}
    cron_total = 0.0
    for raw_profile, home in profile_stores(profiles):
        breakdown = _store_cost_breakdown(home / "state.db", since)
        fires = cron_audit_fires(home / "cron" / "usage_audit.jsonl", since)
        cron_total += breakdown["cron_cost"]
        token_total = sum(job["tokens"] for job in fires.values())
        for job_id, stats in fires.items():
            row = rows_by_job.get((raw_profile, public_ref(job_id, "cron")), {})
            share = stats["tokens"] / token_total if token_total else 0.0
            jobs.append({
                "job_ref": row.get("id") or public_ref(job_id, "cron"),
                "label": row.get("label") or public_label(None, public_ref(job_id, "cron") or "cron job", "cron"),
                "profile": row.get("profile") or public_profile_label(raw_profile, profile_public_map(profiles)),
                "schedule": row.get("schedule"),
                "fires": stats["fires"],
                "tokens": stats["tokens"],
                "avg_duration_seconds": round(stats["duration_ms"] / stats["fires"] / 1000, 1) if stats["fires"] else 0,
                "errors": stats["errors"],
                "silent_runs": stats["silent"],
                "est_cost_usd": round(breakdown["cron_cost"] * share, 4),
            })
        for task, usage in breakdown["tasks"].items():
            merged = tasks.setdefault(task, {"task": task, "calls": 0, "tokens": 0, "cost_usd": 0.0})
            merged["calls"] += usage["calls"]
            merged["tokens"] += usage["tokens"]
            merged["cost_usd"] += usage["cost"]
    jobs.sort(key=lambda job: (job["est_cost_usd"], job["tokens"]), reverse=True)
    task_rows = sorted(tasks.values(), key=lambda task: task["cost_usd"], reverse=True)
    for task in task_rows:
        task["cost_usd"] = round(task["cost_usd"], 4)
    window_total = round(sum(_session_cost(s) for s in sessions), 4)
    background_total = round(sum(task["cost_usd"] for task in task_rows), 4)
    return {
        "window_days": SESSION_WINDOW_DAYS,
        "window_cost_usd": window_total,
        "cron": {
            "total_cost_usd": round(cron_total, 4),
            "jobs": jobs[:12],
            "allocation": "Each profile's cron-session cost is shared across its jobs by token share from cron/usage_audit.jsonl.",
        },
        "background": {
            "total_cost_usd": background_total,
            "tasks": task_rows[:8],
            "note": "Background task cost is part of the session cost it ran in.",
        },
        "recommended_view": "/analytics",
    }


def cost_findings(attribution: Dict[str, Any]) -> List[Dict[str, Any]]:
    findings: List[Dict[str, Any]] = []
    cron_block = attribution["cron"]
    jobs = cron_block["jobs"]
    cron_total = float(cron_block["total_cost_usd"])
    if jobs and cron_total >= COST_FINDING_FLOOR_USD:
        top = jobs[0]
        share = top["est_cost_usd"] / cron_total if cron_total else 0.0
        if share >= CRON_CONCENTRATION_SHARE:
            findings.append(_tuning_item(
                "cost",
                "warning",
                "One scheduled job drives most cron spend",
                f"{top['label']} accounts for about {share:.0%} of scheduled spend over {attribution['window_days']} days. "
                "Check its schedule, model and prompt size, or whether it needs an agent at all (a no-agent script costs nothing).",
                f"{top['label']}: ~${top['est_cost_usd']:.2f} of ${cron_total:.2f} across {top['fires']} runs",
                "/cron",
                "Open Cron",
                "Olympus",
                "Cron run tokens from Hermes' usage audit, priced with the cost Hermes recorded for cron sessions.",
                f"one job >= {CRON_CONCENTRATION_SHARE:.0%} of cron spend and cron spend >= ${COST_FINDING_FLOOR_USD:.2f}",
                count=1,
            ))
    background_total = float(attribution["background"]["total_cost_usd"])
    window_total = float(attribution["window_cost_usd"])
    if background_total >= COST_FINDING_FLOOR_USD and window_total and background_total / window_total >= BACKGROUND_SHARE_WARNING:
        top_task = attribution["background"]["tasks"][0]
        findings.append(_tuning_item(
            "cost",
            "info",
            "Background tasks are a large share of spend",
            f"Background model calls cost ${background_total:.2f} of ${window_total:.2f} over {attribution['window_days']} days. "
            f"The largest is {top_task['task']}. Review whether it needs this model or this frequency.",
            f"{top_task['task']}: ${top_task['cost_usd']:.2f} across {top_task['calls']} calls",
            "/config",
            "Open Config",
            "Olympus",
            "Hermes records model usage per background task in session_model_usage.",
            f"background spend >= {BACKGROUND_SHARE_WARNING:.0%} of session spend and >= ${COST_FINDING_FLOOR_USD:.2f}",
            count=len(attribution["background"]["tasks"]),
        ))
    return findings


def session_window_label(count: int) -> str:
    if count >= SESSION_SCAN_LIMIT:
        return f"last {SESSION_WINDOW_DAYS} days, most recent {SESSION_SCAN_LIMIT} sessions"
    return f"last {SESSION_WINDOW_DAYS} days, {count} session{'s' if count != 1 else ''}"


def build_metrics(sessions: List[Dict[str, Any]], kanban: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Window rollup of the performance signals Hermes already records."""
    kanban = kanban or {}
    durations = sorted(float(s["duration_seconds"]) for s in sessions if isinstance(s.get("duration_seconds"), (int, float)))
    median_duration = statistics.median(durations) if durations else None
    # Nearest-rank p90: the smallest duration at or above 90% of the sample.
    p90_duration = durations[math.ceil(len(durations) * 0.9) - 1] if durations else None
    total_tools = sum(int(s.get("tool_call_count") or 0) for s in sessions)
    total_tokens = sum(int(s.get("total_tokens") or 0) for s in sessions)
    total_api_calls = sum(int(s.get("api_call_count") or 0) for s in sessions)
    failed_runs = [r for r in kanban_items(kanban, "_runs") if is_failed_run(r)]
    # Spend is attributed to the day a session was last active; Hermes
    # Analytics owns the exact per-call ledger.
    spend_cutoff = time.time() - SPEND_WINDOW_SECONDS
    recent = [s for s in sessions if safe_float(s.get("_last_ts")) >= spend_cutoff]
    return {
        "window": {
            "days": SESSION_WINDOW_DAYS,
            "sessions": len(sessions),
            "capped": len(sessions) >= SESSION_SCAN_LIMIT,
            "label": session_window_label(len(sessions)),
        },
        "spend_24h_usd": round(sum(_session_cost(s) for s in recent), 4),
        "sessions_24h": len(recent),
        "window_sessions": len(sessions),
        "total_cost_usd": round(sum(_session_cost(s) for s in sessions), 4),
        "total_tokens": total_tokens,
        "total_tool_calls": total_tools,
        "total_api_calls": total_api_calls,
        "median_duration_seconds": median_duration,
        "p90_duration_seconds": p90_duration,
        "avg_tools_per_session": round(total_tools / len(sessions), 2) if sessions else 0,
        "avg_tokens_per_session": int(total_tokens / len(sessions)) if sessions else 0,
        "avg_tokens_per_call": int(total_tokens / total_api_calls) if total_api_calls else 0,
        "looping_sessions": sum(1 for s in sessions if int(s.get("tool_call_count") or 0) >= RUNAWAY_TOOLS_THRESHOLD),
        "expensive_sessions": sum(1 for s in sessions if _session_cost(s) >= EXPENSIVE_RUN_USD),
        "context_pressure_sessions": sum(1 for s in sessions if int(s.get("avg_input_tokens") or 0) >= CONTEXT_PRESSURE_TOKENS),
        "completed_sessions": sum(1 for s in sessions if s.get("state") == "completed"),
        "stale_sessions": sum(1 for s in sessions if s.get("state") == "stale"),
        "errored_sessions": sum(1 for s in sessions if s.get("state") == "error"),
        "failed_kanban_runs": len(failed_runs),
    }


def detect_friction(sessions: List[Dict[str, Any]], kanban: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Tuning signals for loops, runaway cost, and context pressure."""
    findings: List[Dict[str, Any]] = []
    looping = [s for s in sessions if int(s.get("tool_call_count") or 0) >= RUNAWAY_TOOLS_THRESHOLD]
    expensive = sorted((s for s in sessions if _session_cost(s) >= EXPENSIVE_RUN_USD), key=_session_cost, reverse=True)
    context_pressure = [s for s in sessions if int(s.get("avg_input_tokens") or 0) >= CONTEXT_PRESSURE_TOKENS]

    if looping:
        findings.append(_tuning_item(
            "skill",
            "warning",
            "An agent is looping or tool-thrashing",
            "One or more runs spent an unusually high number of tool calls. Step-repetition/looping is the most common agent failure mode and silently burns tokens. Add a recap or checklist skill, lower max turns, or split the task.",
            ", ".join(f"{s.get('label')}: {s.get('tool_call_count')} tools" for s in looping[:3]),
            "/sessions",
            "Open Sessions",
            "Olympus",
            "Hermes records tool calls per session; runaway tool use without termination is a known failure signature.",
            f">= {RUNAWAY_TOOLS_THRESHOLD} tool calls in one run",
            session_targets(looping),
            count=len(looping),
            scope="agent",
        ))
    if expensive:
        total = sum(_session_cost(s) for s in expensive)
        findings.append(_tuning_item(
            "model",
            "warning",
            "Expensive runs are driving cost",
            f"{len(expensive)} recent run(s) each cost over ${EXPENSIVE_RUN_USD:.2f} (~${total:.2f} total). Consider a cheaper model/route for routine work, tighter prompts, or task decomposition.",
            ", ".join(f"{s.get('label')}: ${_session_cost(s):.2f}" for s in expensive[:3]),
            "/analytics",
            "Open Analytics",
            "Olympus",
            "Hermes records each session's estimated or actual cost; cost concentration is a routing signal.",
            f"single-run cost >= ${EXPENSIVE_RUN_USD:.2f}",
            session_targets(expensive),
            count=len(expensive),
            scope="agent",
        ))
    if context_pressure:
        findings.append(_tuning_item(
            "memory",
            "info",
            "Runs are averaging a very large context per call",
            "Some runs sent a large prompt on every model call (full history re-sent each turn). Agent quality, latency, and cost degrade as the per-call context grows; add summarization/recap, prune stale memory, or split the task.",
            ", ".join(f"{s.get('label')}: {int(s.get('avg_input_tokens') or 0):,} avg in-tokens/call" for s in context_pressure[:3]),
            "/sessions",
            "Open Sessions",
            "Mnemosyne",
            "Hermes records prompt tokens and model calls per session; their ratio is the average context sent per call.",
            f">= {CONTEXT_PRESSURE_TOKENS:,} average input tokens per API call",
            session_targets(context_pressure),
            count=len(context_pressure),
            scope="agent",
        ))
    return findings


def build_agent_hq(profiles: List[Dict[str, Any]], gateways: List[Dict[str, Any]], cron: List[Dict[str, Any]], sessions: List[Dict[str, Any]], kanban: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    kanban = kanban or {}
    assignee_load = {
        str(a.get("_assignee") or a.get("assignee")): a for a in as_list(kanban.get("assignee_load"))
        if isinstance(a, dict) and (a.get("_assignee") or a.get("assignee"))
    }
    cron_by_profile = group_cron_by_profile(cron)

    tool_heavy = [s for s in sessions if int(s.get("tool_call_count") or 0) >= TOOL_HEAVY_THRESHOLD]
    # Runaway sessions are handled by detect_friction to avoid duplicate cards.
    _looping_ids = {s.get("id") for s in sessions if int(s.get("tool_call_count") or 0) >= RUNAWAY_TOOLS_THRESHOLD}
    tool_heavy = [s for s in tool_heavy if s.get("id") not in _looping_ids]
    message_heavy = [s for s in sessions if int(s.get("message_count") or 0) >= LONG_THREAD_THRESHOLD]
    active_sessions = [s for s in sessions if s.get("state") in ("active", "recent")]
    stale_sessions = [s for s in sessions if s.get("state") == "stale"]
    failed_runs = [r for r in kanban_items(kanban, "_runs") if is_failed_run(r)]
    ready_unassigned = [
        t for t in kanban_items(kanban, "_tasks")
        if t.get("status") == "ready" and (not t.get("assignee") or t.get("assignee") == "unassigned")
    ]
    blocked_tasks = [
        t for t in kanban_items(kanban, "_tasks")
        if t.get("status") == "blocked"
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
        cron_jobs = len(cron_by_profile.get(name, []))
        if cron_jobs:
            flags.append("scheduled work")
        agents.append({
            "id": profile.get("id") or name,
            "label": profile.get("label") or name,
            "state": "warning" if flags else (profile.get("state") or "unknown"),
            "model": profile.get("model"),
            "provider": profile.get("provider"),
            "skill_count": skill_count,
            "gateway_state": profile.get("gateway_state"),
            "cron_jobs": cron_jobs,
            "kanban": {
                "open": open_work,
                "ready": ready,
                "running": running,
                "blocked": blocked,
                "review": int(load.get("review") or 0),
            },
            "flags": flags or ["stable"],
        })

    tuning_items: List[Dict[str, Any]] = []
    overloaded = [a for a in agents if int(a["kanban"]["open"]) >= OVERLOADED_OPEN_THRESHOLD or int(a["kanban"]["running"]) >= OVERLOADED_RUNNING_THRESHOLD]
    missing_models = [a for a in agents if not a.get("model")]
    zero_skill_profiles = [a for a in agents if int(a.get("skill_count") or 0) == 0]

    if tool_heavy:
        tuning_items.append(_tuning_item(
            "skill",
            "warning",
            "Create or preload a skill for repeated tool-heavy work",
            "Recent sessions spent many turns in tools. Add a narrower skill, checklist, or reusable procedure.",
            ", ".join(f"{s.get('label')}: {s.get('tool_call_count')} tools" for s in tool_heavy[:3]),
            "/skills",
            "Open Skills",
            "Olympus",
            "Hermes records tool calls per session. Use traces, tool counts, outcomes, and repeatable evidence before changing routes.",
            f">= {TOOL_HEAVY_THRESHOLD} tool calls in a session",
            session_targets(tool_heavy),
            count=len(tool_heavy),
            scope="agent",
        ))
    if message_heavy:
        tuning_items.append(_tuning_item(
            "memory",
            "info",
            "Add recap or memory discipline for long-running agents",
            "Long threads need summary checkpoints, memory rules, or task splits before context pressure hurts quality.",
            ", ".join(f"{s.get('label')}: {s.get('message_count')} messages" for s in message_heavy[:3]),
            "/sessions",
            "Open Sessions",
            "Mnemosyne",
            "Hermes records messages per session. Long threads can hide context drift.",
            f">= {LONG_THREAD_THRESHOLD} messages in a session",
            count=len(message_heavy),
        ))
    if overloaded:
        tuning_items.append(_tuning_item(
            "agent",
            "warning",
            "Consider a specialist agent or route split",
            "One profile owns enough open or running work to need route review.",
            ", ".join(f"{a.get('label')}: {a['kanban']['open']} open" for a in overloaded[:4]),
            "/profiles",
            "Open Profiles",
            "Hermes",
            "Kanban assignee load shows route concentration.",
            f">= {OVERLOADED_OPEN_THRESHOLD} open or >= {OVERLOADED_RUNNING_THRESHOLD} running tasks",
            count=len(overloaded),
        ))
    if blocked_tasks:
        tuning_items.append(_tuning_item(
            "kanban",
            "warning",
            "Clarify blocked work before tuning autonomy upward",
            "Blocked tasks usually need clearer acceptance criteria, a dependency, or a human decision.",
            ", ".join(str(t.get("title") or t.get("id")) for t in blocked_tasks[:4]),
            "/kanban",
            "Open Kanban",
            "Olympus",
            "Kanban blocked status is first-party orchestration evidence.",
            "task status = blocked",
            count=len(blocked_tasks),
            scope="entity",
        ))
    if ready_unassigned:
        tuning_items.append(_tuning_item(
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
            count=len(ready_unassigned),
            scope="entity",
        ))
    if failed_runs:
        tuning_items.append(_tuning_item(
            "tool",
            "critical",
            "Inspect failed worker runs before adding more automation",
            "Worker failures point to a tool, runtime, approval, or instruction boundary.",
            ", ".join(f"{r.get('task_id')}: {r.get('outcome') or r.get('status')}" for r in failed_runs[:4]),
            "/kanban",
            "Open Kanban",
            "Olympus",
            "Kanban task_runs record worker failures, crashes, and timeouts.",
            "task_run status/outcome indicates failure",
            count=len(failed_runs),
            scope="entity",
        ))
    if missing_models:
        tuning_items.append(_tuning_item(
            "model",
            "warning",
            "Make routing explicit per profile",
            "Agent tuning is easier when each profile has an intentional route.",
            ", ".join(str(a.get("label")) for a in missing_models[:4]),
            "/profiles",
            "Open Profiles",
            "Olympus",
            "Profile route metadata makes behavior changes auditable.",
            "profile route metadata is unset",
            count=len(missing_models),
        ))
    if zero_skill_profiles:
        tuning_items.append(_tuning_item(
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
            count=len(zero_skill_profiles),
        ))
    if stale_sessions:
        tuning_items.append(_tuning_item(
            "operations",
            "warning",
            "Resolve stale sessions so the monitor reflects reality",
            "Stale work makes tuning noisy. Close, resume, or annotate it.",
            ", ".join(str(s.get("label") or s.get("session_ref")) for s in stale_sessions[:3]),
            "/sessions",
            "Open Sessions",
            "Chronos",
            "Hermes sessions without an end time and recent activity are stale.",
            "session has no end time and is older than the freshness window",
            session_targets(stale_sessions),
            count=len(stale_sessions),
            scope="agent",
        ))
    metrics = build_metrics(sessions, kanban)
    tuning_items = detect_friction(sessions, kanban) + tuning_items
    if not tuning_items:
        tuning_items.append(_tuning_item(
            "review",
            "ok",
            "No current agent tuning gap",
            "Olympus did not find overloaded assignees, failed worker runs, blocked tasks, missing routes, looping, runaway cost, or context pressure.",
            "Current cross-surface scan is clean.",
            "/analytics",
            "Open Analytics",
            "Olympus",
        ))

    tuning_items.sort(key=lambda x: _severity_rank(str(x.get("severity"))))
    return {
        "summary": {
            "agents": len(agents),
            "recommendations": len(tuning_items),
            "active_sessions": len(active_sessions),
            "tool_heavy_sessions": len(tool_heavy),
            "long_threads": len(message_heavy),
            "kanban_open": int(kanban.get("open") or 0),
            "total_cost_usd": metrics["total_cost_usd"],
            "total_tokens": metrics["total_tokens"],
            "looping_sessions": metrics["looping_sessions"],
            "expensive_sessions": metrics["expensive_sessions"],
            "context_pressure_sessions": metrics["context_pressure_sessions"],
        },
        "agents": agents,
        "recommendations": tuning_items[:8],
        "metrics": metrics,
    }


def build_skill_coverage(profiles: List[Dict[str, Any]], sessions: List[Dict[str, Any]], kanban: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    kanban = kanban or {}
    tasks = kanban_items(kanban, "_tasks")
    forced_skill_tasks = [t for t in tasks if int(t.get("forced_skill_count") or 0) > 0]
    forced_skill_total = sum(int(t.get("forced_skill_count") or 0) for t in forced_skill_tasks)
    looping = [s for s in sessions if int(s.get("tool_call_count") or 0) >= RUNAWAY_TOOLS_THRESHOLD]
    tool_heavy = [
        s for s in sessions
        if TOOL_HEAVY_THRESHOLD <= int(s.get("tool_call_count") or 0) < RUNAWAY_TOOLS_THRESHOLD
    ]
    long_threads = [s for s in sessions if int(s.get("message_count") or 0) >= LONG_THREAD_THRESHOLD]
    context_pressure = [s for s in sessions if int(s.get("avg_input_tokens") or 0) >= CONTEXT_PRESSURE_TOKENS]
    zero_skill_profiles = [p for p in profiles if int(p.get("skill_count") or 0) == 0]

    profile_rows: List[Dict[str, Any]] = []
    for profile in profiles:
        raw_name = str(profile.get("name") or "default")
        profile_tasks = [t for t in tasks if str(t.get("_assignee") or t.get("assignee")) == raw_name]
        profile_forced = [t for t in profile_tasks if int(t.get("forced_skill_count") or 0) > 0]
        profile_sessions = [s for s in sessions if session_matches_profile(s, raw_name)]
        profile_looping = [s for s in profile_sessions if int(s.get("tool_call_count") or 0) >= RUNAWAY_TOOLS_THRESHOLD]
        profile_tool_heavy = [
            s for s in profile_sessions
            if TOOL_HEAVY_THRESHOLD <= int(s.get("tool_call_count") or 0) < RUNAWAY_TOOLS_THRESHOLD
        ]
        skill_count = int(profile.get("skill_count") or 0)
        open_work = sum(1 for t in profile_tasks if t.get("status") in OPEN_KANBAN_STATUSES)
        blocked = sum(1 for t in profile_tasks if t.get("status") == "blocked")
        if skill_count == 0 and open_work:
            state = "warning"
            issue = "Profile has assigned work but no local skills."
            link = "/skills"
        elif profile_looping or profile_tool_heavy:
            state = "warning"
            issue = "Recent sessions show tool pressure. Review whether this profile needs a checklist or bundle."
            link = "/sessions"
        elif profile_forced:
            state = "active"
            issue = "Kanban is already forcing skills for some assigned work."
            link = "/kanban"
        elif skill_count == 0:
            state = "idle"
            issue = "No local skills detected."
            link = "/skills"
        else:
            state = "ok" if blocked == 0 else "warning"
            issue = "Skill coverage has no current warning signal." if blocked == 0 else "Blocked work may need a clearer skill or acceptance checklist."
            link = "/skills" if blocked == 0 else "/kanban"
        profile_rows.append({
            "id": profile.get("id"),
            "label": profile.get("label"),
            "state": state,
            "skill_count": skill_count,
            "open_work": open_work,
            "forced_skill_tasks": len(profile_forced),
            "blocked_work": blocked,
            "top_issue": issue,
            "recommended_view": link,
        })

    suggestions: List[Dict[str, Any]] = []
    if looping:
        suggestions.append(_tuning_item(
            "skill",
            "warning",
            "Add a loop-stop checklist skill",
            "One or more sessions crossed the runaway tool threshold. A short checklist or stop condition skill can prevent silent loops.",
            ", ".join(f"{s.get('label')}: {s.get('tool_call_count')} tools" for s in looping[:3]),
            "/skills",
            "Open Skills",
            "Olympus",
            "Tool-call counts come straight from Hermes' own session records.",
            f">= {RUNAWAY_TOOLS_THRESHOLD} tool calls in one session",
        ))
    if tool_heavy:
        suggestions.append(_tuning_item(
            "skill",
            "info",
            "Turn repeated tool-heavy work into a reusable skill",
            "Moderate tool pressure often means the agent is rediscovering a procedure worth writing once.",
            ", ".join(f"{s.get('label')}: {s.get('tool_call_count')} tools" for s in tool_heavy[:3]),
            "/skills",
            "Open Skills",
            "Olympus",
            "Hermes records tool calls per session.",
            f"{TOOL_HEAVY_THRESHOLD}-{RUNAWAY_TOOLS_THRESHOLD - 1} tool calls in one session",
        ))
    if long_threads or context_pressure:
        suggestions.append(_tuning_item(
            "skill",
            "info",
            "Add recap and handoff discipline",
            "Long or high-context sessions need a recap habit, memory rules, or task splits before quality drifts.",
            ", ".join(str(s.get("label")) for s in (context_pressure or long_threads)[:3]),
            "/skills",
            "Open Skills",
            "Mnemosyne",
            "Hermes records messages per session and the prompt size of each model call.",
            f">= {LONG_THREAD_THRESHOLD} messages or >= {CONTEXT_PRESSURE_TOKENS:,} avg input tokens/call",
        ))
    if zero_skill_profiles:
        suggestions.append(_tuning_item(
            "skill",
            "info",
            "Review bare profiles",
            "Profiles with no local skills may still work, but their operating procedure is implicit and harder to tune.",
            ", ".join(str(p.get("label")) for p in zero_skill_profiles[:4]),
            "/skills",
            "Open Skills",
            "Apollo",
            "Hermes profiles expose local skill counts.",
            "profile skill_count = 0",
        ))
    if forced_skill_tasks:
        suggestions.append(_tuning_item(
            "skill",
            "ok",
            "Kanban is using explicit skills",
            "Some tasks already declare forced skills. Keep this pattern for work that needs repeatable procedure.",
            ", ".join(str(t.get("title") or t.get("id")) for t in forced_skill_tasks[:4]),
            "/kanban",
            "Open Kanban",
            "Olympus",
            "Kanban task metadata exposes forced skill counts.",
            "task forced_skill_count > 0",
        ))

    suggestions.sort(key=lambda x: _severity_rank(str(x.get("severity"))))
    if not suggestions:
        suggestions.append(_tuning_item(
            "skill",
            "ok",
            "No skill coverage gap found",
            "Olympus did not find bare active profiles, forced-skill pressure, looping, tool-heavy sessions, long threads, or high per-call context in this scan.",
            "Current skill coverage scan is clean.",
            "/skills",
            "Open Skills",
            "Olympus",
        ))

    summary_state = "warning" if looping or zero_skill_profiles else ("info" if tool_heavy or long_threads or context_pressure else "ok")
    return {
        "summary": {
            "state": summary_state,
            "profiles": len(profiles),
            "total_skills": sum(int(p.get("skill_count") or 0) for p in profiles),
            "zero_skill_profiles": len(zero_skill_profiles),
            "forced_skill_tasks": len(forced_skill_tasks),
            "forced_skill_total": forced_skill_total,
            "looping_sessions": len(looping),
            "tool_heavy_sessions": len(tool_heavy),
            "long_threads": len(long_threads),
            "context_pressure_sessions": len(context_pressure),
        },
        "profiles": profile_rows,
        "suggestions": suggestions[:5],
    }


def build_orchestration(kanban: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    kanban = kanban or {}
    totals = kanban.get("totals") if isinstance(kanban.get("totals"), dict) else {}
    tasks = kanban_items(kanban, "_tasks")
    runs = kanban_items(kanban, "_runs")
    workers = kanban_items(kanban, "active_workers")
    now = time.time()

    failed_runs = [r for r in runs if is_failed_run(r)]
    stale_workers: List[Dict[str, Any]] = []
    for t in tasks:
        reason = task_stale_reason(t, now)
        if reason:
            stale_workers.append({
                "task_id": t.get("id"),
                "title": t.get("title"),
                "assignee": t.get("assignee"),
                "detail": reason,
            })

    return {
        "summary": {
            "boards": len(as_list(kanban.get("boards"))),
            "open": int(kanban.get("open") or 0),
            "ready": int(totals.get("ready") or 0),
            "running": int(totals.get("running") or 0),
            "blocked": int(totals.get("blocked") or 0),
            "review": int(totals.get("review") or 0),
            "active_workers": len(workers),
            "failed_runs": len(failed_runs),
            "stale_workers": len(stale_workers),
            "goal_mode_tasks": sum(1 for t in tasks if t.get("goal_mode")),
            "forced_skill_tasks": sum(1 for t in tasks if int(t.get("forced_skill_count") or 0) > 0),
            "model_override_tasks": sum(1 for t in tasks if t.get("model_override")),
            "ready_unassigned": sum(1 for t in tasks if t.get("status") == "ready" and (not t.get("assignee") or t.get("assignee") == "unassigned")),
        },
        "workers": workers[:12],
        "pressure": as_list(kanban.get("assignee_load"))[:12],
        "failed_runs": failed_runs[:8],
        "stale_workers": stale_workers[:8],
        "attention": as_list(kanban.get("attention"))[:12],
    }


# Routes are plain ``def`` on purpose: every collector does blocking SQLite and
# file I/O, and FastAPI runs sync endpoints in its threadpool instead of on the
# event loop the rest of the Hermes dashboard shares.
@router.get("/health")
def health() -> Dict[str, Any]:
    refresh_expose_local_labels()
    profiles = collect_profiles()
    cron = collect_cron(profiles)
    h = collect_health(profiles, cron)
    return {"ok": h.get("status") != "error", "generated_at": now_iso(), **h}


SESSION_RESOLVE_SCAN = 5000


def resolve_session_ref(ref: str) -> Optional[Dict[str, str]]:
    """Find the session behind a public ``session_ref`` across every profile.

    Payloads carry hashed refs so raw session IDs never appear on screen; the
    raw ID is looked up only when the operator clicks through to the session.
    """
    for raw_profile, home in profile_stores(collect_profiles()):
        db = home / "state.db"
        if not db.exists():
            continue
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
        except sqlite3.Error as exc:
            log_read_warning("session resolve open failed", exc)
            continue
        con.row_factory = sqlite3.Row
        try:
            cols = table_columns(con, "sessions")
            recency = [c for c in ("last_activity_at", "ended_at", "started_at") if c in cols]
            order = recency_expr(recency)
            ids = [row["id"] for row in con.execute(f"SELECT id FROM sessions ORDER BY {order} DESC LIMIT ?", (SESSION_RESOLVE_SCAN,))]
        except sqlite3.Error as exc:
            log_read_warning("session resolve scan failed", exc)
            continue
        finally:
            con.close()
        for session_id in ids:
            if ref in (safe_id(session_id, "session"), str(session_id) if EXPOSE_LOCAL_LABELS else None):
                return {"session_id": str(session_id), "profile": raw_profile}
    return None


@router.get("/open/session")
def open_session(ref: str) -> Dict[str, Any]:
    """Hermes chat URL for a session ref, or ``href: null`` when it is gone."""
    refresh_expose_local_labels()
    found = resolve_session_ref(ref)
    if found is None:
        return {"href": None}
    query = f"resume={quote(found['session_id'], safe='')}&profile={quote(found['profile'], safe='')}"
    # Desktop opens sessions natively (host.openSession) and needs the id and
    # profile; the web dashboard follows href. Both exist only at click time.
    return {"href": f"/chat?{query}", "session_id": found["session_id"], "profile": found["profile"]}


def scan_hermes() -> Dict[str, Any]:
    """One read of local Hermes state plus every Olympus synthesis built on it."""
    profiles = collect_profiles()
    cron = collect_cron(profiles)
    sessions = collect_sessions(SESSION_SCAN_LIMIT, profiles, since=time.time() - SESSION_WINDOW_DAYS * 86400)
    gateways = collect_gateways(profiles)
    kanban = collect_kanban(profiles)
    orchestration = build_orchestration(kanban)
    skill_coverage = build_skill_coverage(profiles, sessions, kanban)
    skill_metadata = collect_skill_metadata(profiles)
    skill_hygiene = build_skill_hygiene(skill_metadata, skill_coverage, kanban)
    config_policy = collect_config_policy(profiles, sessions, kanban)
    health = collect_health(profiles, cron)
    cost_attribution = collect_cost_attribution(profiles, cron, sessions, time.time() - SESSION_WINDOW_DAYS * 86400)
    backlog = build_backlog_triage(kanban)
    tuning = {"agent_hq": build_agent_hq(profiles, gateways, cron, sessions, kanban)}
    add_findings(tuning, cost_findings(cost_attribution) + backlog_findings(backlog))
    agent_activity = collect_agent_activity(profiles)
    needs_you = build_needs_you(profiles, cron, kanban, tuning, sessions)
    return {
        "agents": build_agents(profiles, sessions, cron, kanban, agent_activity, needs_you, gateways),
        "needs_you": needs_you,
        "agent_activity": agent_activity,
        "backlog": backlog,
        "cost_attribution": cost_attribution,
        "profiles": profiles,
        "cron": cron,
        "sessions": sessions,
        "kanban": kanban,
        "orchestration": orchestration,
        "skill_hygiene": skill_hygiene,
        "evidence_sources": build_evidence_sources(profiles, sessions, cron, gateways, kanban),
        "config_policy": config_policy,
        "health": health,
        "tuning": tuning,
    }


def add_findings(tuning: Dict[str, Any], findings: List[Dict[str, Any]]) -> None:
    """Merge extra findings into the ranked tuning queue."""
    if not findings:
        return
    hq = tuning.setdefault("agent_hq", {})
    items = [item for item in as_list(hq.get("recommendations")) if item.get("severity") != "ok"] + findings
    items.sort(key=lambda item: _severity_rank(str(item.get("severity"))))
    hq["recommendations"] = items[:8]
    hq.setdefault("summary", {})["recommendations"] = len(items)


# ---------------------------------------------------------------------------
# Agents: the roster, the one Needs-you queue and the agent inspector.
#
# An agent is a Hermes profile. Its status is one word derived from what
# Hermes recorded, and everything that needs a person becomes one queue item
# carrying the action that resolves it. Actions run through Hermes' own
# endpoints from the page; Olympus resolves a public ref to the raw id only at
# click time and keeps its own log of what was done.
# ---------------------------------------------------------------------------

AGENT_STATUS_LABELS = {
    "waiting": "Waiting on you",
    "stalled": "Stalled",
    "failed": "Failed",
    "offline": "Offline",
    "working": "Working",
    "idle": "Idle",
}
AGENT_STATUS_ORDER = list(AGENT_STATUS_LABELS)
AGENT_ACTIVITY_DAYS = 7
FAILING_TASK_ATTEMPTS = 2
QUEUE_KIND_ORDER = ("answer", "stalled", "cron_failed", "failing", "blocked", "offline", "cron_overdue", "unassigned", "behaviour", "finding")
ACTION_LABELS = {
    "answer": "Answer",
    "retry": "Retry",
    "reclaim": "Reclaim",
    "reassign": "Reassign",
    "assign": "Assign",
    "pause": "Pause",
    "resume": "Resume",
    "run_now": "Run now",
    "fix": "I fixed this",
}
SUCCESS_RUN_OUTCOMES = {"completed", "review_requested"}
CLOSED_KANBAN_STATUSES = {"done", "archived"}
AGENT_TIMELINE_LIMIT = 40
AGENT_TIMELINE_SESSIONS = 8
AGENT_TIMELINE_TOOLS = 60
AGENT_TOP_TOOLS = 5
TASK_EVENT_TEXT = {
    "created": "Task created",
    "claimed": "Claimed",
    "spawned": "Worker started",
    "worker_bound": "Worker attached",
    "worker_result": "Worker reported back",
    "completed": "Finished",
    "blocked": "Blocked",
    "unblocked": "Unblocked",
    "crashed": "Worker crashed",
    "timed_out": "Worker timed out",
    "gave_up": "Gave up",
    "reclaimed": "Reclaimed",
    "reassigned": "Reassigned",
    "commented": "Comment added",
    "review_requested": "Sent for review",
    "status": "Status changed",
}
TASK_EVENT_STATE = {
    "crashed": "error", "timed_out": "error", "gave_up": "error", "spawn_failed": "error",
    "blocked": "waiting", "completed": "ok",
}


def agent_ref(profile: Dict[str, Any]) -> Dict[str, str]:
    return {"id": str(profile["id"]), "label": str(profile["label"])}


def agent_avatar(label: str) -> str:
    """Initial for the avatar; hidden profiles ("Profile 3") show their number."""
    match = re.fullmatch(r"Profile (\d+)", label)
    return match.group(1) if match else (label[:1].upper() or "?")


def display_name(label: Any, ref: str, noun: str) -> str:
    """A hidden label reads as "Task 5408" instead of its hashed ref."""
    if str(label) != ref or ":" not in ref:
        return str(label)
    return f"{noun} {ref.rsplit(':', 1)[1][:4]}"


def _action(action_id: str, target: Dict[str, Any], effect: str) -> Dict[str, Any]:
    return {"id": action_id, "label": ACTION_LABELS[action_id], "target": target, "effect": effect}


def _queue_item(
    key: str,
    kind: str,
    severity: str,
    agent: Optional[Dict[str, str]],
    title: str,
    detail: str,
    since: Optional[str],
    actions: List[Dict[str, Any]],
    link: str,
    targets: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "key": key,
        "kind": kind,
        "severity": severity,
        "agent": agent,
        "title": title,
        "detail": detail,
        "since": since,
        "actions": actions,
        "link": link,
        "link_label": _action_label_for_view(link),
        "targets": targets or [],
    }


def gateway_start_command(raw_profile: str) -> str:
    if raw_profile == "default":
        return "hermes gateway start"
    return f"hermes -p {raw_profile} gateway start" if EXPOSE_LOCAL_LABELS else "hermes -p <profile> gateway start"


def task_actions(task: Dict[str, Any], who: str, now: float) -> List[Dict[str, Any]]:
    """The safe controls that fit a Kanban task in its current state."""
    title = display_name(task["title"], task["id"], "Task")
    target = {"kind": "task", "ref": task["id"], "board": task["board"], "status": task.get("status"), "name": title}
    status = task.get("status")
    if status == "blocked" and task.get("block_kind") == "needs_input":
        return [{**_action("answer", target, f"Post your answer on {title} as a comment and move it back to ready for {who}."),
                 "question": task.get("block_reason")}]
    if status == "blocked":
        return [
            _action("retry", target, f"Move {title} from blocked back to ready so {who} picks it up again."),
            _action("reassign", target, f"Give {title} to another agent. It keeps its history and goes to their queue."),
        ]
    if status == "running":
        stale = task_stale_reason(task, now)
        return [
            _action("reclaim", target, f"Stop {who}'s worker on {title}{' (' + stale + ')' if stale else ''} and put the task back to ready."),
            _action("reassign", target, f"Stop the current worker and give {title} to another agent."),
        ]
    if status == "ready" and task.get("_assignee") in (None, "", "unassigned"):
        return [_action("assign", target, f"Give {title} to an agent so the dispatcher can run it.")]
    if status in ("ready", "todo", "triage", "review"):
        return [_action("reassign", target, f"Give {title} to another agent.")]
    return []


def cron_actions(job: Dict[str, Any], who: str) -> List[Dict[str, Any]]:
    label = display_name(job["label"], job["id"], "Job")
    target = {"kind": "cron", "ref": job["id"], "name": label}
    toggle = (
        _action("pause", target, f"Pause {label} for {who}. It will not run until you resume it.")
        if job.get("enabled")
        else _action("resume", target, f"Resume {label} for {who} on its schedule ({job.get('schedule') or 'as configured'}).")
    )
    return [_action("run_now", target, f"Run {label} for {who} once, now. Its schedule does not change."), toggle]


# How an agent's own sessions behave: what Kanban cannot show. Each signal
# reads the sessions Olympus scanned for that agent; warnings join the
# Needs-you queue on that agent, notes stay in its inspector.
BEHAVIOUR_SIGNALS = (
    ("looping", "warning", "/sessions", "Looping or tool-thrashing",
     f"Runs passed {RUNAWAY_TOOLS_THRESHOLD} tool calls. Add a checklist skill, lower max turns, or split the task.",
     lambda s: int(s.get("tool_call_count") or 0) >= RUNAWAY_TOOLS_THRESHOLD),
    ("expensive", "warning", "/analytics", "Expensive runs",
     f"Each cost over ${EXPENSIVE_RUN_USD:.2f}. A cheaper model, a tighter prompt or a task split usually helps.",
     lambda s: _session_cost(s) >= EXPENSIVE_RUN_USD),
    ("context", "info", "/sessions", "Very large context per call",
     f"Runs averaged over {CONTEXT_PRESSURE_TOKENS:,} prompt tokens per model call. A recap or a task split keeps it down.",
     lambda s: int(s.get("avg_input_tokens") or 0) >= CONTEXT_PRESSURE_TOKENS),
    ("tool_heavy", "info", "/skills", "Tool-heavy runs",
     f"{TOOL_HEAVY_THRESHOLD} to {RUNAWAY_TOOLS_THRESHOLD - 1} tool calls in a run. A skill for the repeated steps would shorten them.",
     lambda s: TOOL_HEAVY_THRESHOLD <= int(s.get("tool_call_count") or 0) < RUNAWAY_TOOLS_THRESHOLD),
    ("long_thread", "info", "/sessions", "Long conversations",
     f"{LONG_THREAD_THRESHOLD}+ messages in a session. Recaps or memory keep follow-ups accurate.",
     lambda s: int(s.get("message_count") or 0) >= LONG_THREAD_THRESHOLD),
    ("stale", "info", "/sessions", "Sessions left open",
     "Open with no activity for over a day. Close or resume them so this view stays accurate.",
     lambda s: s.get("state") == "stale"),
)


def agent_behaviour(sessions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Behaviour signals for one agent's sessions, warnings first."""
    signals: List[Dict[str, Any]] = []
    for kind, severity, view, label, detail, matches in BEHAVIOUR_SIGNALS:
        hits = [s for s in sessions if matches(s)]
        if hits:
            signals.append({
                "kind": kind,
                "severity": severity,
                "label": label,
                "detail": detail,
                "count": len(hits),
                "cost_usd": round(sum(_session_cost(s) for s in hits), 2),
                "sessions": session_targets(hits),
                "link": view,
            })
    return signals


def build_needs_you(
    profiles: List[Dict[str, Any]],
    cron: List[Dict[str, Any]],
    kanban: Dict[str, Any],
    tuning: Dict[str, Any],
    sessions: List[Dict[str, Any]],
    now: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """Everything that needs a person, once, with the action that resolves it.

    Tasks and cron jobs become one item each and session behaviour one item
    per agent; Olympus' fleet-level findings join them unless those items
    already cover them (scope "entity" or "agent").
    """
    now = time.time() if now is None else now
    agents = {str(p["name"]): agent_ref(p) for p in profiles}
    offline = {str(p["name"]) for p in profiles if p.get("gateway_state") != "running"}
    queue: List[Dict[str, Any]] = []

    for profile in profiles:
        own = [s for s in sessions if session_matches_profile(s, str(profile["name"]))]
        for signal in agent_behaviour(own):
            if signal["severity"] != "warning":
                continue
            runs = f"{signal['count']} session{'s' if signal['count'] != 1 else ''}"
            queue.append(_queue_item(
                f"behaviour:{signal['kind']}:{profile['id']}", "behaviour", "warning", agent_ref(profile),
                f"{signal['label']} in {runs}" + (f" (${signal['cost_usd']:.2f})" if signal["kind"] == "expensive" else ""),
                signal["detail"], None, [], signal["link"], signal["sessions"],
            ))

    for task in kanban_items(kanban, "_tasks"):
        status = task.get("status")
        if status in CLOSED_KANBAN_STATUSES:
            continue
        raw = str(task.get("_assignee") or "unassigned")
        agent = agents.get(raw)
        who = agent["label"] if agent else "its agent"
        title = display_name(task["title"], task["id"], "Task")
        actions = task_actions(task, who, now)
        kind = task.get("block_kind")
        failures = int(task.get("consecutive_failures") or 0)
        stale = task_stale_reason(task, now)
        if status == "blocked" and kind == "needs_input":
            queue.append(_queue_item(
                f"answer:{task['id']}", "answer", "critical", agent,
                f"{title} is waiting on your answer",
                task.get("block_reason") or "The agent stopped on a question only you can answer. Open the task in Kanban to read it.",
                task.get("blocked_at") or task.get("created_at"), actions, "/kanban",
            ))
        elif status == "running" and stale:
            queue.append(_queue_item(
                f"stalled:{task['id']}", "stalled", "critical", agent,
                f"Worker stalled on {title}",
                f"The worker's {stale}. Reclaim it to free the task, or give the task to another agent.",
                task.get("last_heartbeat_at") or task.get("started_at"), actions, "/kanban",
            ))
        elif status == "blocked" and kind == "capability":
            queue.append(_queue_item(
                f"blocked:{task['id']}", "blocked", "warning", agent,
                f"{title} is missing a tool, skill or permission",
                "Give the agent what it needs and retry, or reassign the task to an agent that has it.",
                task.get("blocked_at") or task.get("created_at"), actions, "/kanban",
            ))
        elif status == "blocked" and kind not in ("transient", "dependency"):
            queue.append(_queue_item(
                f"blocked:{task['id']}", "blocked", "warning", agent,
                f"{title} is blocked without a reason",
                "Open the task to read why it stopped, then retry it or reassign it.",
                task.get("blocked_at") or task.get("created_at"), actions, "/kanban",
            ))
        elif status in ("ready", "running") and failures >= FAILING_TASK_ATTEMPTS:
            queue.append(_queue_item(
                f"failing:{task['id']}", "failing", "warning", agent,
                f"{title} failed {failures} times in a row",
                task.get("last_failure_error") or "Hermes keeps retrying it. Reassign it if this agent cannot do it.",
                task.get("started_at") or task.get("created_at"), actions, "/kanban",
            ))
        elif status == "ready" and raw == "unassigned":
            queue.append(_queue_item(
                f"unassigned:{task['id']}", "unassigned", "warning", None,
                f"{title} is ready but has no agent",
                "The dispatcher only runs ready tasks that have an assignee.",
                task.get("created_at"), actions, "/kanban",
            ))

    for raw, jobs in group_cron_by_profile(cron).items():
        agent = agents.get(raw)
        who = agent["label"] if agent else "this agent"
        for job in jobs:
            label = display_name(job["label"], job["id"], "Job")
            if job.get("state") == "error":
                queue.append(_queue_item(
                    f"cron_failed:{job['id']}", "cron_failed", "critical", agent,
                    f"{label} ran, but every tool call failed" if job.get("tools_failed") else f"{label} failed on its last run",
                    job.get("last_error") or "Its last run reported an error.",
                    job.get("last_run_at"), cron_actions(job, who), "/cron",
                ))
                continue
            due = parse_iso_ts(job.get("next_run_at"))
            if job.get("enabled") and due is not None and now - due > CRON_OVERDUE_SECONDS and raw not in offline:
                queue.append(_queue_item(
                    f"cron_overdue:{job['id']}", "cron_overdue", "critical", agent,
                    f"{label} is {int((now - due) // 60)} min overdue",
                    "Hermes runs scheduled jobs from the gateway's cron ticker. An overdue job means the ticker is not running for this agent.",
                    job.get("next_run_at"), cron_actions(job, who)[:1], "/cron",
                ))

    cron_by_profile = group_cron_by_profile(cron)
    tasks = kanban_items(kanban, "_tasks")
    for profile in profiles:
        raw = str(profile["name"])
        if raw not in offline:
            continue
        jobs = sum(1 for job in cron_by_profile.get(raw, []) if job.get("enabled"))
        ready = sum(1 for task in tasks if task.get("_assignee") == raw and task.get("status") == "ready")
        if not (jobs or ready):
            continue
        waiting = " and ".join(part for part in (
            f"{jobs} scheduled job{'s' if jobs != 1 else ''}" if jobs else "",
            f"{ready} ready task{'s' if ready != 1 else ''}" if ready else "",
        ) if part)
        queue.append(_queue_item(
            f"offline:{profile['id']}", "offline", "warning", agent_ref(profile),
            f"Gateway is not running for {profile['label']}",
            f"{waiting} {'waits' if jobs + ready == 1 else 'wait'} on it. Start it with: {gateway_start_command(raw)}",
            None, [], "/profiles",
        ))

    agent_ids = {a["id"]: a for a in agents.values()}
    for finding in as_list((tuning.get("agent_hq") or {}).get("recommendations")):
        if finding.get("severity") not in ("critical", "warning") or finding.get("scope") in ("entity", "agent"):
            continue
        owners = {t.get("agent") for t in as_list(finding.get("targets")) if t.get("agent")}
        agent = agent_ids.get(next(iter(owners))) if len(owners) == 1 else None
        queue.append(_queue_item(
            str(finding["key"]), "finding", str(finding["severity"]), agent,
            str(finding["title"]), str(finding.get("detail") or ""), None,
            [_action("fix", {"kind": "finding", "ref": finding["key"], "name": str(finding["title"])}, "Olympus notes the current count and tells you on later scans whether it cleared.")],
            str(finding.get("recommended_view") or "/analytics"),
            as_list(finding.get("targets")),
        ))

    queue.sort(key=lambda item: (
        _severity_rank(item["severity"]),
        QUEUE_KIND_ORDER.index(item["kind"]),
        parse_iso_ts(item["since"]) or now,
    ))
    return queue


def _store_daily_activity(db: Path, since: float, now: float) -> Dict[str, Any]:
    """Sessions, tokens and cost per UTC day (by session start) from one state.db."""
    out: Dict[str, Any] = {"days": {}, "last_active_ts": None, "live_tool": None}
    if not db.exists():
        return out
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
    con.row_factory = sqlite3.Row
    try:
        cols = table_columns(con, "sessions")
        if "started_at" not in cols:
            return out

        def summed(*names: str) -> str:
            present = [f"COALESCE({name}, 0)" for name in names if name in cols]
            return f"SUM({' + '.join(present)})" if present else "0"

        cost_cols = [c for c in ("actual_cost_usd", "estimated_cost_usd") if c in cols]
        cost = f"SUM(COALESCE({', '.join(cost_cols)}, 0))" if cost_cols else "0"
        for row in con.execute(
            f"SELECT date(started_at, 'unixepoch') AS day, COUNT(*) AS sessions, "
            f"{summed('input_tokens')} AS input, {summed('cache_read_tokens', 'cache_write_tokens')} AS cache, "
            f"{summed('output_tokens')} AS output, {cost} AS cost "
            "FROM sessions WHERE started_at >= ? GROUP BY day",
            (since,),
        ):
            out["days"][str(row["day"])] = {
                "sessions": int(row["sessions"] or 0),
                "input_tokens": int(row["input"] or 0),
                "cache_tokens": int(row["cache"] or 0),
                "output_tokens": int(row["output"] or 0),
                "cost_usd": round(float(row["cost"] or 0.0), 4),
            }
        recency = [c for c in ("last_activity_at", "ended_at", "started_at") if c in cols]
        row = con.execute(f"SELECT MAX({recency_expr(recency)}) AS ts FROM sessions").fetchone()
        out["last_active_ts"] = safe_float(row["ts"]) or None
        out["live_tool"] = _live_tool(con, cols, now)
    except sqlite3.Error as exc:
        log_read_warning("agent activity scan failed", exc)
    finally:
        con.close()
    return out


def _live_tool(con: sqlite3.Connection, session_cols: set[str], now: float) -> Optional[Dict[str, Any]]:
    """The last tool any still-open, recently active session called."""
    message_cols = table_columns(con, "messages")
    if not {"session_id", "tool_name", "timestamp"}.issubset(message_cols) or not {"id", "ended_at"}.issubset(session_cols):
        return None
    activity = recency_expr([f"s.{c}" for c in ("last_activity_at", "started_at") if c in session_cols], "0")
    role = " AND m.role = 'tool'" if "role" in message_cols else ""
    row = con.execute(
        f"SELECT m.tool_name, m.timestamp FROM sessions s JOIN messages m ON m.session_id = s.id "
        f"WHERE s.ended_at IS NULL AND {activity} >= ?{role} "
        "AND m.tool_name IS NOT NULL AND m.tool_name != '' ORDER BY m.timestamp DESC LIMIT 1",
        (now - ACTIVE_SECONDS,),
    ).fetchone()
    if row is None:
        return None
    return {"tool": redact_text(row["tool_name"], 60), "at": ts_to_iso(row["timestamp"])}


def activity_days(now: float) -> List[str]:
    return [
        datetime.fromtimestamp(now - offset * 86400, tz=timezone.utc).date().isoformat()
        for offset in range(AGENT_ACTIVITY_DAYS - 1, -1, -1)
    ]


def collect_agent_activity(profiles: List[Dict[str, Any]], now: Optional[float] = None) -> Dict[str, Dict[str, Any]]:
    """Per profile: the last seven UTC days of sessions, tokens and cost."""
    now = time.time() if now is None else now
    days = activity_days(now)
    since = datetime.fromisoformat(days[0]).replace(tzinfo=timezone.utc).timestamp()
    out: Dict[str, Dict[str, Any]] = {}
    for raw_profile, home in profile_stores(profiles):
        store = _store_daily_activity(home / "state.db", since, now)
        empty = {"sessions": 0, "input_tokens": 0, "cache_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
        out[raw_profile] = {
            "days": [{"day": day, **store["days"].get(day, empty)} for day in days],
            "last_active_ts": store["last_active_ts"],
            "live_tool": store["live_tool"],
            "runs": run_glance(_store_runs(home / "state.db", since), days),
        }
    return out


def run_glance(runs: List[Dict[str, Any]], days: List[str]) -> Dict[str, Any]:
    """The roster's seven days: runs and unsuccessful runs per day, and the success rate."""
    top = [r for r in runs if not r["subagent"] and not r["rotated"]]
    finished = [r for r in top if r["outcome"] != "open"]
    succeeded = sum(1 for r in finished if r["outcome"] == "succeeded")
    per_day = {day: {"runs": 0, "unsuccessful": 0} for day in days}
    for run in top:
        day = per_day.get(datetime.fromtimestamp(run["started"], tz=timezone.utc).date().isoformat())
        if day is not None:
            day["runs"] += 1
            day["unsuccessful"] += 1 if run["outcome"] in ("failed", "cut_off") else 0
    return {
        "days": [per_day[day] for day in days],
        "runs": len(top),
        "finished": len(finished),
        "succeeded": succeeded,
        "success_rate": round(succeeded / len(finished), 3) if finished else None,
    }


def agent_status(kinds: set[str], live: bool) -> str:
    if kinds & {"answer", "blocked"}:
        return "waiting"
    if "stalled" in kinds:
        return "stalled"
    if kinds & {"cron_failed", "failing"}:
        return "failed"
    if "offline" in kinds:
        return "offline"
    return "working" if live else "idle"


LOOP_STOP_TEXT = {(True, True): "all sessions", (False, True): "unattended only", (False, False): "off"}


def agent_setup(profile: Dict[str, Any], gateways: List[Dict[str, Any]]) -> Dict[str, Any]:
    """How the agent is set up: route, skills, gateway, platforms, loop limits."""
    config = profile_config(Path(str(profile["_path"])))
    guard = _loop_guardrail_policy(config)
    public_name = profile.get("_public_name") or profile.get("name")
    if profile.get("gateway_mode") == "multiplexed":
        gateway = "shared"
    else:
        gateway = "own" if profile.get("gateway_state") == "running" else "stopped"
    return {
        "route": "configured" if profile.get("model") or profile.get("provider") else "inherited",
        "model": profile.get("model") if EXPOSE_LOCAL_LABELS else None,
        "skills": int(profile.get("skill_count") or 0),
        "gateway": gateway,
        "platforms": sorted({str(g["label"]) for g in gateways if g.get("profile") == public_name}),
        "max_turns": _cfg_int(_cfg_value(config, "agent", "max_turns")),
        "loop_stop": LOOP_STOP_TEXT[(guard["interactive"], guard["unattended"])],
    }


def build_agents(
    profiles: List[Dict[str, Any]],
    sessions: List[Dict[str, Any]],
    cron: List[Dict[str, Any]],
    kanban: Dict[str, Any],
    activity: Dict[str, Dict[str, Any]],
    queue: List[Dict[str, Any]],
    gateways: List[Dict[str, Any]],
    now: Optional[float] = None,
) -> Dict[str, Any]:
    """One roster row per agent: status, current work, helpers and issues."""
    now = time.time() if now is None else now
    cron_by_profile = group_cron_by_profile(cron)
    tasks = kanban_items(kanban, "_tasks")
    rows: List[Dict[str, Any]] = []
    for profile in profiles:
        raw = str(profile["name"])
        own_items = [item for item in queue if item["agent"] and item["agent"]["id"] == profile["id"]]
        live_sessions = [
            s for s in sessions
            if session_matches_profile(s, raw) and not s.get("ended_at") and now - safe_float(s.get("_last_ts")) <= ACTIVE_SECONDS
        ]
        running = sorted(
            (t for t in tasks if t.get("_assignee") == raw and t.get("status") == "running"),
            key=lambda t: parse_iso_ts(t.get("started_at")) or 0.0,
            reverse=True,
        )
        working = [t for t in running if not task_stale_reason(t, now)]
        own_live = [s for s in live_sessions if s.get("source") != "subagent"]
        waiting = next((t for t in tasks if t.get("_assignee") == raw and t.get("status") == "blocked" and t.get("block_kind") == "needs_input"), None)
        if running:
            current = {"kind": "task", "label": display_name(running[0]["title"], running[0]["id"], "Task"), "since": running[0].get("started_at"), "ref": running[0]["id"], "board": running[0]["board"]}
        elif own_live:
            current = {"kind": "session", "label": own_live[0]["label"], "since": own_live[0].get("started_at"), "ref": own_live[0].get("session_ref")}
        elif waiting:
            current = {"kind": "waiting", "label": display_name(waiting["title"], waiting["id"], "Task"), "since": waiting.get("blocked_at") or waiting.get("created_at")}
        else:
            current = None
        tool = activity.get(raw, {}).get("live_tool")
        if current and current["kind"] != "waiting" and tool:
            current.update({"tool": tool["tool"], "tool_at": tool["at"]})
        stamps = [
            safe_float(activity.get(raw, {}).get("last_active_ts")),
            *(parse_iso_ts(t.get("last_heartbeat_at")) or 0.0 for t in tasks if t.get("_assignee") == raw),
            *(parse_iso_ts(j.get("last_run_at")) or 0.0 for j in cron_by_profile.get(raw, [])),
        ]
        last_active = max(stamps, default=0.0)
        live = bool(live_sessions or working)
        status = agent_status({item["kind"] for item in own_items}, live)
        rows.append({
            "id": profile["id"],
            "label": profile["label"],
            "avatar": agent_avatar(str(profile["label"])),
            "role": profile.get("role"),
            "role_state": profile.get("role_state"),
            "status": status,
            "status_label": AGENT_STATUS_LABELS[status],
            "status_reason": own_items[0]["title"] if own_items and status not in ("working", "idle") else None,
            "live": live,
            "current": current,
            "helpers": {
                "subagents": sum(1 for s in live_sessions if s.get("source") == "subagent"),
                "workers": len(running),
                "cron": sum(1 for job in cron_by_profile.get(raw, []) if job.get("enabled")),
            },
            "last_active_at": ts_to_iso(last_active) if last_active else None,
            "runs_7d": activity.get(raw, {}).get("runs"),
            "issues": len(own_items),
            "setup": agent_setup(profile, gateways),
            "gateway_state": profile.get("gateway_state"),
            "gateway_mode": profile.get("gateway_mode"),
            "dashboard_home": bool(profile.get("dashboard_home")),
        })
    rows.sort(key=lambda row: (AGENT_STATUS_ORDER.index(row["status"]), str(row["label"])))
    return {
        "summary": {
            "agents": len(rows),
            "working": sum(1 for row in rows if row["live"]),
            "need_you": sum(1 for row in rows if row["issues"]),
            "queue": len(queue),
            "unattributed": sum(1 for item in queue if item["agent"] is None),
        },
        "agents": rows,
    }


def _store_timeline(db: Path, now: float) -> List[Dict[str, Any]]:
    """Session and tool events from one profile's state.db, newest first."""
    if not db.exists():
        return []
    events: List[Dict[str, Any]] = []
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
    con.row_factory = sqlite3.Row
    try:
        cols = table_columns(con, "sessions")
        recency = [c for c in ("last_activity_at", "ended_at", "started_at") if c in cols]
        if "id" not in cols or not recency:
            return []
        wanted = [c for c in ("id", "source", "title", "started_at", "ended_at", "end_reason") if c in cols]
        rows = con.execute(
            f"SELECT {', '.join(wanted)} FROM sessions ORDER BY {recency_expr(recency)} DESC LIMIT ?",
            (AGENT_TIMELINE_SESSIONS,),
        ).fetchall()
        labels: Dict[str, str] = {}
        for row in rows:
            session_id = str(row_value(row, "id"))
            source = str(row_value(row, "source") or "session")
            ref = session_id if EXPOSE_LOCAL_LABELS else safe_id(session_id, "session")
            label = public_label(row_value(row, "title"), source, "session")
            labels[session_id] = label
            subagent = source == "subagent"
            kind = "subagent" if subagent else "session"
            started = safe_float(row_value(row, "started_at"))
            ended = safe_float(row_value(row, "ended_at"))
            where = None if label == source else source
            if ended:
                # A finished session is one step: what ran, for how long.
                reason = str(row_value(row, "end_reason") or "")
                minutes = f"{max(1, round((ended - started) / 60))} min" if started else None
                events.append({
                    "at": ts_to_iso(ended), "_ts": ended, "kind": kind,
                    "text": f"{'Subagent ran' if subagent else 'Ran'} {label}" + (f" ({minutes})" if minutes else ""),
                    "detail": ", ".join(part for part in (where, reason.replace("_", " ") if reason not in ("", "completed") else None) if part) or None,
                    "state": "error" if reason in ("error", "failed", "crashed") else None, "session_ref": ref,
                })
            elif started:
                events.append({
                    "at": ts_to_iso(started), "_ts": started, "kind": kind,
                    "text": f"Started a subagent: {label}" if subagent else f"Started {label}",
                    "detail": None if subagent else where, "state": None, "session_ref": ref,
                })
        message_cols = table_columns(con, "messages")
        if labels and {"session_id", "tool_name", "timestamp"}.issubset(message_cols):
            marks = ", ".join("?" for _ in labels)
            role = " AND role = 'tool'" if "role" in message_cols else ""
            tools = con.execute(
                f"SELECT session_id, tool_name, timestamp FROM messages WHERE session_id IN ({marks}){role} "
                "AND tool_name IS NOT NULL AND tool_name != '' ORDER BY timestamp DESC LIMIT ?",
                (*labels, AGENT_TIMELINE_TOOLS),
            ).fetchall()
            # Consecutive calls of one tool in one session read as one step.
            for row in tools:
                tool = redact_text(row["tool_name"], 60)
                last = events[-1] if events and events[-1]["kind"] == "tool" else None
                if last and last["_tool"] == (row["session_id"], tool):
                    last["count"] += 1
                    last["text"] = f"Used {tool} ×{last['count']}"
                    continue
                events.append({
                    "at": ts_to_iso(row["timestamp"]), "_ts": safe_float(row["timestamp"]),
                    "kind": "tool", "text": f"Used {tool}", "detail": labels.get(str(row["session_id"])),
                    "state": None, "count": 1, "_tool": (row["session_id"], tool),
                })
    except sqlite3.Error as exc:
        log_read_warning("agent timeline scan failed", exc)
    finally:
        con.close()
    return events


def _store_top_tools(db: Path, since: float) -> List[Dict[str, Any]]:
    """The tools this agent called most in sessions started since ``since``."""
    if not db.exists():
        return []
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
    con.row_factory = sqlite3.Row
    try:
        message_cols = table_columns(con, "messages")
        if not {"session_id", "tool_name"}.issubset(message_cols) or not {"id", "started_at"}.issubset(table_columns(con, "sessions")):
            return []
        role = " AND m.role = 'tool'" if "role" in message_cols else ""
        return [
            {"tool": redact_text(row["tool_name"], 60), "calls": int(row["calls"])}
            for row in con.execute(
                "SELECT m.tool_name, COUNT(*) AS calls FROM sessions s JOIN messages m ON m.session_id = s.id "
                f"WHERE s.started_at >= ?{role} AND m.tool_name IS NOT NULL AND m.tool_name != '' "
                "GROUP BY m.tool_name ORDER BY calls DESC, m.tool_name LIMIT ?",
                (since, AGENT_TOP_TOOLS),
            )
        ]
    except sqlite3.Error as exc:
        log_read_warning("agent tool mix scan failed", exc)
        return []
    finally:
        con.close()


def _kanban_timeline(raw_profile: str) -> List[Dict[str, Any]]:
    """Recent task events for tasks assigned to one profile, on every board."""
    events: List[Dict[str, Any]] = []
    for board in discover_kanban_boards():
        con = _kanban_conn(kanban_board_db(str(board["_slug"])))
        if con is None:
            continue
        try:
            if not {"task_id", "kind", "created_at"}.issubset(table_columns(con, "task_events")):
                continue
            for row in con.execute(
                "SELECT e.kind, e.created_at, e.task_id, t.title FROM task_events e JOIN tasks t ON t.id = e.task_id "
                "WHERE t.assignee = ? ORDER BY e.created_at DESC LIMIT ?",
                (raw_profile, AGENT_TIMELINE_LIMIT),
            ):
                task_id = str(row["task_id"])
                public_task = task_id if EXPOSE_LOCAL_LABELS else safe_id(task_id, "task")
                kind = str(row["kind"] or "")
                events.append({
                    "at": ts_to_iso(row["created_at"]), "_ts": safe_float(row["created_at"]),
                    "kind": "task",
                    "text": f"{TASK_EVENT_TEXT.get(kind, kind.replace('_', ' ').capitalize())}: {display_name(public_label(row['title'], public_task, 'task'), public_task, 'Task')}",
                    "detail": board["name"] if board["slug"] != "default" else None,
                    "state": TASK_EVENT_STATE.get(kind),
                })
        except sqlite3.Error as exc:
            log_read_warning("agent task events scan failed", exc)
        finally:
            con.close()
    return events


def agent_success(runs: List[Dict[str, Any]], raw_profile: str, now: float) -> Dict[str, Any]:
    """Finished Kanban worker runs in the activity window: how many succeeded."""
    since = now - AGENT_ACTIVITY_DAYS * 86400
    finished = [
        r for r in runs
        if r.get("_profile") == raw_profile and r.get("ended_at") and safe_float(r.get("_sort_ts")) >= since
    ]
    ok = sum(1 for r in finished if r.get("outcome") in SUCCESS_RUN_OUTCOMES)
    failed = sum(1 for r in finished if is_failed_run(r))
    return {
        "succeeded": ok,
        "failed": failed,
        "rate": round(ok / (ok + failed), 3) if ok + failed else None,
        "basis": f"Kanban worker runs that finished in the last {AGENT_ACTIVITY_DAYS} days",
    }


def build_agent_detail(scan: Dict[str, Any], agent_id: str, actions: List[Dict[str, Any]], fixes: List[Dict[str, Any]], now: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """Everything the inspector shows for one agent."""
    now = time.time() if now is None else now
    profile = next((p for p in scan["profiles"] if p["id"] == agent_id), None)
    if profile is None:
        return None
    raw = str(profile["name"])
    who = str(profile["label"])
    row = next(a for a in scan["agents"]["agents"] if a["id"] == agent_id)
    jobs = [
        {**strip_internal(job), "label": display_name(job["label"], job["id"], "Job"), "actions": cron_actions(job, who)}
        for job in scan["cron"] if cron_profile(job) == raw
    ]
    # Kanban owns the board; the inspector shows only what this agent is
    # working on now plus counts, and items that need a person are already
    # in its Needs-you list.
    own_tasks = [t for t in kanban_items(scan["kanban"], "_tasks") if t.get("_assignee") == raw]
    week_ago = now - AGENT_ACTIVITY_DAYS * 86400
    running = [
        {
            "id": t["id"], "board": t["board"], "title": display_name(t["title"], t["id"], "Task"), "status": t["status"],
            "started_at": t.get("started_at"), "stale": task_stale_reason(t, now),
            "actions": task_actions(t, who, now),
        }
        for t in sorted(own_tasks, key=lambda t: parse_iso_ts(t.get("started_at")) or 0.0, reverse=True)
        if t.get("status") == "running"
    ]
    kanban = {
        "running": running,
        "open": sum(1 for t in own_tasks if t.get("status") in OPEN_KANBAN_STATUSES),
        "blocked": sum(1 for t in own_tasks if t.get("status") == "blocked"),
        "done_7d": sum(1 for t in own_tasks if t.get("status") == "done" and (parse_iso_ts(t.get("completed_at")) or 0.0) >= week_ago),
    }
    own_sessions = [s for s in scan["sessions"] if session_matches_profile(s, raw)]
    metrics = build_metrics(own_sessions)
    working = {
        "window": session_window_label(len(own_sessions)),
        "sessions": len(own_sessions),
        "median_run_seconds": metrics["median_duration_seconds"],
        "p90_run_seconds": metrics["p90_duration_seconds"],
        "tools_per_session": metrics["avg_tools_per_session"],
        "tokens_per_call": metrics["avg_tokens_per_call"],
        "top_tools": _store_top_tools(Path(str(profile["_path"])) / "state.db", week_ago),
        "signals": agent_behaviour(own_sessions),
    }
    timeline = _store_timeline(Path(str(profile["_path"])) / "state.db", now) + _kanban_timeline(raw)
    for job in jobs:
        if job.get("last_run_at"):
            failed = job.get("state") == "error"
            timeline.append({
                "at": job["last_run_at"], "_ts": parse_iso_ts(job["last_run_at"]) or 0.0, "kind": "cron",
                "text": f"Ran {display_name(job['label'], job['id'], 'Job')}", "detail": job.get("last_error") if failed else job.get("last_status"),
                "state": "error" if failed else "ok",
            })
    for action in actions:
        # The log keeps the label and Hermes' reply as they were when the
        # operator acted; show them only while labels are on now.
        ref = str(action["target_ref"])
        if not EXPOSE_LOCAL_LABELS and ":" not in ref:
            ref = safe_id(ref, str(action["target_kind"]))  # a raw id logged while labels were on
        label = action["label"] if EXPOSE_LOCAL_LABELS else display_name(ref, ref, "Task" if action["target_kind"] == "task" else "Job")
        timeline.append({
            "at": ts_to_iso(action["at"]), "_ts": float(action["at"]), "kind": "action",
            "text": f"You chose {ACTION_LABELS.get(action['action'], action['action'])}: {label}",
            "detail": public_error(action.get("detail")), "state": "ok" if action["ok"] else "error",
        })
    timeline.sort(key=lambda event: event["_ts"], reverse=True)
    days = scan["agent_activity"].get(raw, {}).get("days", [])
    return {
        "agent": row,
        "needs_you": [item for item in scan["needs_you"] if item["agent"] and item["agent"]["id"] == agent_id],
        "timeline": strip_internal(timeline[:AGENT_TIMELINE_LIMIT]),
        "cron": jobs,
        "kanban": kanban,
        "working": working,
        "usage": {
            "days": days,
            "tokens_7d": sum(d["input_tokens"] + d["cache_tokens"] + d["output_tokens"] for d in days),
            "cost_7d_usd": round(sum(d["cost_usd"] for d in days), 4),
            "basis": "Hermes session totals by the UTC day each session started.",
        },
        "success": agent_success(kanban_items(scan["kanban"], "_runs"), raw, now),
        "fixes": [fix for fix in fixes if fix.get("agent") == agent_id],
        "start_gateway": gateway_start_command(raw) if profile.get("gateway_state") != "running" else None,
    }


# ---------------------------------------------------------------------------
# Performance: how well each agent's runs go over 7 or 30 days.
#
# A run is a top-level session. Its outcome uses Hermes' own rule
# (hermes_state_sessions.classify_session_status: the session's last message)
# and a failed tool call uses Hermes' own display rule
# (agent/display._detect_tool_failure). A cron run whose every tool call
# failed is failed too, though Hermes books it complete. Hermes stores no
# per-call latency, so run time is a session's start-to-end time.
# ---------------------------------------------------------------------------

PERFORMANCE_DAYS = (7, 30)
# Sessions that ended by rolling over into another session, not by finishing.
ROTATED_END_REASONS = {"compression", "branched", "superseded_by_repair", "orphaned_compression"}
FAILED_END_REASONS = {"cron_incomplete_no_output"}
ERROR_FINISH_REASONS = {"error", "agent_error", "content_filter"}
FILE_MUTATING_TOOLS = {"write_file", "patch"}
TOOL_RESULT_SCAN_LIMIT = 20000
TOOL_RESULT_FULL_CHARS = 20000
PERFORMANCE_TOOLS_SHOWN = 10
PERFORMANCE_RUNS_SHOWN = 6
RUN_STEP_LIMIT = 400
FAILURE_MARKER_RE = re.compile(r'"(?:error|failed)"(?!\s*:\s*(?:null|false|0|""|\[\]|\{\})\s*(?:[,}\]]|$))', re.IGNORECASE)
EXIT_CODE_RE = re.compile(r'"exit_code"\s*:\s*(-?\d+)')


def run_outcome(ended: Any, end_reason: Any, last_role: Any, pending_tool_calls: bool, finish_reason: Any) -> str:
    """succeeded / failed / cut_off for a finished run, open while it runs."""
    if not ended:
        return "open"
    if str(end_reason or "") in FAILED_END_REASONS or str(finish_reason or "").strip().lower() in ERROR_FINISH_REASONS:
        return "failed"
    role = str(last_role or "").strip().lower()
    if role in ("user", "tool") or (role == "assistant" and pending_tool_calls):
        return "cut_off"
    return "succeeded"


def _has_failure_marker(text: str) -> bool:
    head = text[:600]
    return any(m.start() < 500 for m in FAILURE_MARKER_RE.finditer(head)) or text.startswith("Error")


def tool_result_failed(tool_name: str, content: Any, truncated: bool = False) -> bool:
    """Whether a stored tool result is a failure, by Hermes' own display rule.

    ``truncated`` results (over TOOL_RESULT_FULL_CHARS) cannot be parsed as
    JSON, so only their head is read: an exit code, ``"success": false`` or a
    failure marker.
    """
    if not isinstance(content, str) or not content:
        return False
    text = content.strip()
    if truncated:
        code = EXIT_CODE_RE.search(text[:600]) if tool_name == "terminal" else None
        if code:
            return int(code.group(1)) != 0
        return '"success": false' in text[:600] or _has_failure_marker(text)
    try:
        data = json.loads(text)
    except ValueError:
        return _has_failure_marker(text)
    if not isinstance(data, dict):
        return _has_failure_marker(text) if isinstance(data, str) else False
    if data.get("guardrail_refusal") is True:
        return False
    if tool_name in FILE_MUTATING_TOOLS and not data.get("error"):
        if (tool_name == "write_file" and "bytes_written" in data) or (tool_name == "patch" and data.get("success") is True):
            return False
    if data.get("user_summary"):
        return True
    if tool_name == "terminal":
        return data.get("exit_code") not in (None, 0)
    error = data.get("error") or data.get("message")
    if error and (data.get("success") is False or "error" in data):
        return True
    if str(data.get("status", "")).lower() in ("failed", "error"):
        return True
    items = data.get("results")
    return isinstance(items, list) and bool(items) and all(isinstance(i, dict) for i in items) and all(i.get("error") for i in items)


def _tool_error_text(content: str) -> str:
    try:
        data = json.loads(content)
    except ValueError:
        return content
    if isinstance(data, dict):
        for key in ("error", "message", "user_summary"):
            if data.get(key):
                return str(data[key])
        if data.get("exit_code") not in (None, 0):
            return f"exit code {data['exit_code']}"
    return content


def _sessions_with_every_tool_failed(con: sqlite3.Connection, where: str, params: tuple) -> Dict[str, Dict[str, Any]]:
    """Sessions (``where`` filters ``sessions s``) that made tool calls and none worked.

    Each comes with its call count and its first failure, ``tool: error``.
    """
    if not {"session_id", "tool_name", "content", "role"}.issubset(table_columns(con, "messages")):
        return {}
    rows = con.execute(
        "SELECT m.session_id, m.tool_name, length(m.content) AS size, "
        f"CASE WHEN length(m.content) <= {TOOL_RESULT_FULL_CHARS} THEN m.content ELSE substr(m.content, 1, 600) END AS body "
        f"FROM messages m JOIN sessions s ON s.id = m.session_id WHERE {where} "
        "AND m.role = 'tool' AND m.tool_name IS NOT NULL AND m.tool_name != '' ORDER BY m.id",
        params,
    ).fetchall()
    sessions: Dict[str, Optional[Dict[str, Any]]] = {}
    for row in rows:
        session_id = str(row["session_id"])
        tool = str(row["tool_name"])
        if not tool_result_failed(tool, row["body"], safe_int(row["size"]) > TOOL_RESULT_FULL_CHARS):
            sessions[session_id] = None  # one call worked
        elif session_id not in sessions:
            sessions[session_id] = {"calls": 1, "first": f"{tool}: {_tool_error_text(str(row['body']))}"}
        elif sessions[session_id] is not None:
            sessions[session_id]["calls"] += 1
    return {session_id: failed for session_id, failed in sessions.items() if failed is not None}


def _store_runs(db: Path, since: float, session_id: Optional[str] = None, now: Optional[float] = None) -> List[Dict[str, Any]]:
    """Every session started since ``since`` (or the one ``session_id``) with its outcome, cost and size."""
    now = time.time() if now is None else now
    if not db.exists():
        return []
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
    con.row_factory = sqlite3.Row
    try:
        cols = table_columns(con, "sessions")
        message_cols = table_columns(con, "messages")
        if not {"id", "started_at"}.issubset(cols):
            return []
        wanted = [c for c in (
            "id", "source", "title", "started_at", "ended_at", "last_activity_at", "end_reason", "tool_call_count", "api_call_count",
            "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
            "actual_cost_usd", "estimated_cost_usd", "parent_session_id",
        ) if c in cols]
        last = ""
        if {"id", "session_id", "role"}.issubset(message_cols):
            finish = "m.finish_reason" if "finish_reason" in message_cols else "NULL"
            pending = "(m.tool_calls IS NOT NULL AND m.tool_calls NOT IN ('', '[]'))" if "tool_calls" in message_cols else "0"
            last = (f", m.role AS last_role, {finish} AS last_finish, {pending} AS last_pending "
                    "FROM sessions s LEFT JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE session_id = s.id)")
        else:
            last = ", NULL AS last_role, NULL AS last_finish, 0 AS last_pending FROM sessions s"
        where, params = ("s.id = ?", (session_id,)) if session_id is not None else ("s.started_at >= ?", (since,))
        rows = con.execute(
            f"SELECT {', '.join('s.' + c for c in wanted)}{last} WHERE {where} ORDER BY s.started_at",
            params,
        ).fetchall()
        # Hermes books a cron run complete when the agent replied; a run whose
        # every tool call failed replied without doing its job.
        cron_tools_failed = _sessions_with_every_tool_failed(con, f"s.source = 'cron' AND {where}", params) if "source" in cols else {}
    except sqlite3.Error as exc:
        log_read_warning("performance run scan failed", exc)
        return []
    finally:
        con.close()
    runs: List[Dict[str, Any]] = []
    for r in rows:
        session_id = row_value(r, "id")
        started = safe_float(row_value(r, "started_at"))
        # A session nobody closed but that has been quiet for a day is over:
        # Hermes reaps it the same way. It ends at its last activity.
        quiet_since = safe_float(row_value(r, "last_activity_at")) or started
        ended = safe_float(row_value(r, "ended_at")) or (quiet_since if now - quiet_since > STALE_SECONDS else 0.0)
        actual = row_value(r, "actual_cost_usd")
        cost = safe_float(actual if actual not in (None, "") else row_value(r, "estimated_cost_usd"))
        source = str(row_value(r, "source") or "session")
        outcome = run_outcome(ended, row_value(r, "end_reason"), row_value(r, "last_role"), bool(row_value(r, "last_pending")), row_value(r, "last_finish"))
        if outcome == "succeeded" and str(session_id) in cron_tools_failed:
            outcome = "failed"
        runs.append({
            "_id": str(session_id),
            "ref": str(session_id) if EXPOSE_LOCAL_LABELS else safe_id(session_id, "session"),
            "label": public_label(row_value(r, "title"), source, "session"),
            "source": source,
            "subagent": source == "subagent",
            "rotated": str(row_value(r, "end_reason") or "") in ROTATED_END_REASONS,
            "started": started,
            "ended": ended or None,
            "duration": max(0.0, ended - started) if ended and started else None,
            "outcome": outcome,
            "end_reason": row_value(r, "end_reason"),
            "tool_calls": safe_int(row_value(r, "tool_call_count")),
            "api_calls": safe_int(row_value(r, "api_call_count")),
            "tokens": sum(safe_int(row_value(r, c)) for c in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")),
            "cost": cost,
        })
    return runs


def _store_tool_outcomes(db: Path, since: float) -> Dict[str, Dict[str, int]]:
    """Calls and failures per tool for sessions started since ``since`` (newest results first)."""
    if not db.exists():
        return {}
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
    con.row_factory = sqlite3.Row
    try:
        message_cols = table_columns(con, "messages")
        if not {"session_id", "tool_name", "content", "role"}.issubset(message_cols):
            return {}
        rows = con.execute(
            "SELECT m.tool_name, length(m.content) AS size, "
            f"CASE WHEN length(m.content) <= {TOOL_RESULT_FULL_CHARS} THEN m.content ELSE substr(m.content, 1, 600) END AS body "
            "FROM messages m JOIN sessions s ON s.id = m.session_id "
            "WHERE s.started_at >= ? AND m.role = 'tool' AND m.tool_name IS NOT NULL AND m.tool_name != '' "
            "ORDER BY m.id DESC LIMIT ?",
            (since, TOOL_RESULT_SCAN_LIMIT),
        ).fetchall()
    except sqlite3.Error as exc:
        log_read_warning("performance tool scan failed", exc)
        return {}
    finally:
        con.close()
    out: Dict[str, Dict[str, int]] = {}
    for row in rows:
        name = redact_text(row["tool_name"], 60)
        stats = out.setdefault(name, {"calls": 0, "failures": 0})
        stats["calls"] += 1
        stats["failures"] += 1 if tool_result_failed(str(row["tool_name"]), row["body"], safe_int(row["size"]) > TOOL_RESULT_FULL_CHARS) else 0
    return out


def percentile(sorted_values: List[float], share: float) -> Optional[float]:
    """Nearest-rank percentile of an ascending list."""
    if not sorted_values:
        return None
    return sorted_values[max(0, math.ceil(len(sorted_values) * share) - 1)]


def _public_run(run: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "ref": run["ref"], "label": run["label"], "source": run["source"], "outcome": run["outcome"],
        "started_at": ts_to_iso(run["started"]), "duration_seconds": run["duration"],
        "tool_calls": run["tool_calls"], "tokens": run["tokens"], "cost_usd": round(run["cost"], 4),
    }


def summarize_runs(runs: List[Dict[str, Any]], tools: Dict[str, Dict[str, int]], days: List[str]) -> Dict[str, Any]:
    """One agent's performance over the window: outcomes, run time, size, cost and tools."""
    top = [r for r in runs if not r["subagent"] and not r["rotated"]]
    finished = [r for r in top if r["outcome"] != "open"]
    counts = {name: sum(1 for r in top if r["outcome"] == name) for name in ("succeeded", "failed", "cut_off", "open")}
    durations = sorted(r["duration"] for r in finished if r["duration"] is not None)
    tool_calls = sum(f["calls"] for f in tools.values())
    tool_failures = sum(f["failures"] for f in tools.values())
    daily: List[Dict[str, Any]] = []
    for day in days:
        on_day = [r for r in top if datetime.fromtimestamp(r["started"], tz=timezone.utc).date().isoformat() == day]
        day_durations = sorted(r["duration"] for r in on_day if r["duration"] is not None and r["outcome"] != "open")
        daily.append({
            "day": day,
            "runs": len(on_day),
            "succeeded": sum(1 for r in on_day if r["outcome"] == "succeeded"),
            "failed": sum(1 for r in on_day if r["outcome"] == "failed"),
            "cut_off": sum(1 for r in on_day if r["outcome"] == "cut_off"),
            "open": sum(1 for r in on_day if r["outcome"] == "open"),
            "median_seconds": statistics.median(day_durations) if day_durations else None,
            "tokens": sum(r["tokens"] for r in on_day),
            "cost_usd": round(sum(r["cost"] for r in on_day), 4),
        })
    return {
        "runs": len(top),
        "subagent_runs": sum(1 for r in runs if r["subagent"]),
        **counts,
        "success_rate": round(counts["succeeded"] / len(finished), 3) if finished else None,
        "median_seconds": statistics.median(durations) if durations else None,
        "p90_seconds": percentile(durations, 0.9),
        "tool_calls_per_run": round(sum(r["tool_calls"] for r in top) / len(top), 1) if top else 0,
        "tokens_per_run": int(sum(r["tokens"] for r in top) / len(top)) if top else 0,
        "cost_usd": round(sum(r["cost"] for r in runs), 4),
        "tool_calls": tool_calls,
        "tool_failures": tool_failures,
        "tool_error_rate": round(tool_failures / tool_calls, 3) if tool_calls else None,
        "tools": [
            {"tool": name, "calls": stats["calls"], "failures": stats["failures"],
             "error_rate": round(stats["failures"] / stats["calls"], 3)}
            for name, stats in sorted(tools.items(), key=lambda kv: (-kv[1]["calls"], kv[0]))[:PERFORMANCE_TOOLS_SHOWN]
        ],
        "daily": daily,
        "slowest": [_public_run(r) for r in sorted((r for r in finished if r["duration"] is not None), key=lambda r: -r["duration"])[:PERFORMANCE_RUNS_SHOWN]],
        "failed_runs": [_public_run(r) for r in sorted((r for r in finished if r["outcome"] in ("failed", "cut_off")), key=lambda r: -r["started"])[:PERFORMANCE_RUNS_SHOWN]],
    }


def build_performance(profiles: List[Dict[str, Any]], days: int, now: Optional[float] = None) -> Dict[str, Any]:
    """Per-agent performance for the last ``days`` UTC days, plus fleet totals."""
    now = time.time() if now is None else now
    day_list = [
        datetime.fromtimestamp(now - offset * 86400, tz=timezone.utc).date().isoformat()
        for offset in range(days - 1, -1, -1)
    ]
    since = datetime.fromisoformat(day_list[0]).replace(tzinfo=timezone.utc).timestamp()
    agents: List[Dict[str, Any]] = []
    all_runs: List[Dict[str, Any]] = []
    all_tools: Dict[str, Dict[str, int]] = {}
    for profile in profiles:
        db = Path(str(profile["_path"])) / "state.db"
        runs = _store_runs(db, since)
        tools = _store_tool_outcomes(db, since)
        all_runs.extend(runs)
        for name, stats in tools.items():
            merged = all_tools.setdefault(name, {"calls": 0, "failures": 0})
            merged["calls"] += stats["calls"]
            merged["failures"] += stats["failures"]
        agents.append({"id": profile["id"], "label": profile["label"], "avatar": agent_avatar(str(profile["label"])), **summarize_runs(runs, tools, day_list)})
    fleet = summarize_runs(all_runs, all_tools, day_list)
    return {
        "days": days,
        "generated_at": now_iso(),
        "fleet": {k: v for k, v in fleet.items() if k not in ("slowest", "failed_runs")},
        "agents": agents,
        "basis": (
            "A run is a top-level session (subagents and sessions that rolled over are counted separately). "
            "Outcome follows Hermes: a run failed when it ended on a provider or agent error, and was cut off "
            "when it ended waiting on a tool or a reply. A scheduled run also failed when every tool call in it failed, "
            "even if Hermes booked it complete. Run time is start to end; Hermes records no per-call latency. "
            "Tool failures use the rule Hermes uses to mark failed tool calls."
        ),
    }


def build_run_detail(ref: str) -> Optional[Dict[str, Any]]:
    """One run step by step: who spoke, which tool, how long each step took."""
    found = resolve_session_ref(ref)
    if found is None:
        return None
    profile = next((p for p in collect_profiles() if p["name"] == found["profile"]), None)
    if profile is None:
        return None
    db = Path(str(profile["_path"])) / "state.db"
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
    con.row_factory = sqlite3.Row
    try:
        session_cols = table_columns(con, "sessions")
        message_cols = table_columns(con, "messages")
        run = next(iter(_store_runs(db, 0.0, found["session_id"])), None)
        wanted = [c for c in ("id", "role", "tool_name", "timestamp", "token_count", "finish_reason", "content") if c in message_cols]
        rows = con.execute(
            f"SELECT {', '.join(wanted)} FROM messages WHERE session_id = ? ORDER BY id LIMIT ?",
            (found["session_id"], RUN_STEP_LIMIT),
        ).fetchall() if {"id", "role"}.issubset(message_cols) else []
        total = con.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?", (found["session_id"],)).fetchone()[0] if "session_id" in message_cols else 0
        has_end = "ended_at" in session_cols
    except sqlite3.Error as exc:
        log_read_warning("run detail read failed", exc)
        return None
    finally:
        con.close()
    if run is None or not has_end:
        return None
    steps: List[Dict[str, Any]] = []
    previous: Optional[float] = run["started"]
    for row in rows:
        ts = safe_float(row_value(row, "timestamp")) or None
        role = str(row_value(row, "role") or "")
        tool = row_value(row, "tool_name")
        content = row_value(row, "content")
        steps.append({
            "at": ts_to_iso(ts),
            "role": role,
            "tool": redact_text(tool, 60) if tool else None,
            "failed": role == "tool" and tool_result_failed(str(tool or ""), content),
            "seconds": round(ts - previous, 1) if ts and previous else None,
            "tokens": safe_int(row_value(row, "token_count")) or None,
            "error": str(row_value(row, "finish_reason") or "").lower() in ERROR_FINISH_REASONS,
            "preview": redact_text(content, 160) if EXPOSE_LOCAL_LABELS and isinstance(content, str) else None,
        })
        previous = ts or previous
    return {
        "run": {**_public_run(run), "end_reason": run["end_reason"], "api_calls": run["api_calls"], "subagent": run["subagent"]},
        "agent": {"id": profile["id"], "label": profile["label"]},
        "steps": steps,
        "steps_total": int(total),
        "tool_failures": sum(1 for s in steps if s["failed"]),
        "content_shown": EXPOSE_LOCAL_LABELS,
    }


# ---------------------------------------------------------------------------
# Olympus' own storage: daily snapshots and fix tracking.
#
# Olympus never writes Hermes state. It keeps its history in the per-plugin
# data directory Hermes provides (<hermes home>/plugin-data/olympus/).
# ---------------------------------------------------------------------------

HISTORY_DB = "history.db"
HISTORY_RETENTION_DAYS = 90
HISTORY_TREND_DAYS = 14
SNAPSHOT_MIN_INTERVAL_SECONDS = 300
SNAPSHOT_FIELDS = (
    "needs_you", "looping", "context_pressure", "failed_runs", "blocked",
    "stale_workers", "spend_24h", "sessions", "tool_calls", "median_run",
)


def olympus_data_dir() -> Path:
    try:
        from plugins.plugin_storage import plugin_data_dir  # type: ignore
    except ImportError:
        # Outside Hermes (unit tests): the same layout Hermes uses.
        path = get_hermes_home() / "plugin-data" / "olympus"
        path.mkdir(parents=True, exist_ok=True)
        return path
    return plugin_data_dir("olympus")


def history_db() -> sqlite3.Connection:
    try:
        from plugins.plugin_storage import plugin_db  # type: ignore
    except ImportError:
        con = sqlite3.connect(olympus_data_dir() / HISTORY_DB, timeout=2.0, check_same_thread=False)
    else:
        con = plugin_db("olympus", HISTORY_DB)
    con.row_factory = sqlite3.Row
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS snapshots (
            day TEXT PRIMARY KEY,
            taken_at REAL NOT NULL,
            needs_you INTEGER, looping INTEGER, context_pressure INTEGER,
            failed_runs INTEGER, blocked INTEGER, stale_workers INTEGER, spend_24h REAL,
            sessions INTEGER, tool_calls INTEGER, median_run REAL
        );
        CREATE TABLE IF NOT EXISTS fixes (
            key TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            kind TEXT NOT NULL,
            baseline INTEGER,
            marked_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at REAL NOT NULL,
            agent TEXT,
            action TEXT NOT NULL,
            target_kind TEXT NOT NULL,
            target_ref TEXT NOT NULL,
            label TEXT NOT NULL,
            ok INTEGER NOT NULL,
            detail TEXT
        );
        """
    )
    # 1.1.0 stores had no agent column on fixes.
    if "agent" not in table_columns(con, "fixes"):
        con.execute("ALTER TABLE fixes ADD COLUMN agent TEXT")
        con.commit()
    return con


ACTIONS_RETAINED = 500


def record_action(con: sqlite3.Connection, entry: Dict[str, Any], now: Optional[float] = None) -> None:
    """Olympus' own log of a control the operator confirmed, and its result."""
    con.execute(
        "INSERT INTO actions (at, agent, action, target_kind, target_ref, label, ok, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            time.time() if now is None else now, entry.get("agent"), entry["action"], entry["target_kind"],
            entry["target_ref"], entry["label"], 1 if entry["ok"] else 0, entry.get("detail"),
        ),
    )
    con.execute("DELETE FROM actions WHERE id NOT IN (SELECT id FROM actions ORDER BY id DESC LIMIT ?)", (ACTIONS_RETAINED,))
    con.commit()


def read_actions(con: sqlite3.Connection, agent: Optional[str] = None, limit: int = AGENT_TIMELINE_LIMIT) -> List[Dict[str, Any]]:
    where, params = ("WHERE agent = ?", (agent, limit)) if agent else ("", (limit,))
    return [
        {**dict(row), "ok": bool(row["ok"])}
        for row in con.execute(f"SELECT * FROM actions {where} ORDER BY id DESC LIMIT ?", params)
    ]


def snapshot_values(scan: Dict[str, Any]) -> Dict[str, Any]:
    tuning = scan["tuning"]
    hq = tuning.get("agent_hq") or {}
    metrics = hq.get("metrics") or {}
    orch_summary = (scan["orchestration"].get("summary") or {}) if isinstance(scan["orchestration"], dict) else {}
    totals = scan["kanban"].get("totals") if isinstance(scan["kanban"].get("totals"), dict) else {}
    return {
        "needs_you": sum(1 for item in as_list(hq.get("recommendations")) if item.get("severity") in ("critical", "warning")),
        "looping": int(metrics.get("looping_sessions") or 0),
        "context_pressure": int(metrics.get("context_pressure_sessions") or 0),
        "failed_runs": int(metrics.get("failed_kanban_runs") or 0),
        "blocked": int(totals.get("blocked") or 0),
        "stale_workers": int(orch_summary.get("stale_workers") or 0),
        "spend_24h": float(metrics.get("spend_24h_usd") or 0.0),
        "sessions": int((metrics.get("window") or {}).get("sessions") or 0),
        "tool_calls": int(metrics.get("total_tool_calls") or 0),
        "median_run": metrics.get("median_duration_seconds"),
    }


def record_snapshot(con: sqlite3.Connection, values: Dict[str, Any], now: Optional[float] = None) -> bool:
    """Upsert today's snapshot (UTC day); at most one write per SNAPSHOT_MIN_INTERVAL."""
    now = time.time() if now is None else now
    day = datetime.fromtimestamp(now, tz=timezone.utc).date().isoformat()
    row = con.execute("SELECT taken_at FROM snapshots WHERE day = ?", (day,)).fetchone()
    if row is not None and now - float(row["taken_at"]) < SNAPSHOT_MIN_INTERVAL_SECONDS:
        return False
    columns = ("day", "taken_at") + SNAPSHOT_FIELDS
    con.execute(
        f"INSERT OR REPLACE INTO snapshots ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
        (day, now) + tuple(values[name] for name in SNAPSHOT_FIELDS),
    )
    cutoff = datetime.fromtimestamp(now - HISTORY_RETENTION_DAYS * 86400, tz=timezone.utc).date().isoformat()
    con.execute("DELETE FROM snapshots WHERE day < ?", (cutoff,))
    con.commit()
    return True


def read_history(con: sqlite3.Connection, now: Optional[float] = None) -> Dict[str, Any]:
    now = time.time() if now is None else now
    since = datetime.fromtimestamp(now - (HISTORY_TREND_DAYS - 1) * 86400, tz=timezone.utc).date().isoformat()
    days = [
        {key: row[key] for key in ("day",) + SNAPSHOT_FIELDS}
        for row in con.execute("SELECT * FROM snapshots WHERE day >= ? ORDER BY day", (since,))
    ]
    return {
        "days": days,
        "recorded_days": len(days),
        "storage": "Olympus plugin data (never Hermes state)",
    }


def mark_fix(con: sqlite3.Connection, item: Dict[str, Any], now: Optional[float] = None, agent: Optional[str] = None) -> None:
    con.execute(
        "INSERT OR REPLACE INTO fixes (key, title, kind, baseline, marked_at, agent) VALUES (?, ?, ?, ?, ?, ?)",
        (item["key"], str(item.get("title") or item["key"]), str(item.get("kind") or "finding"), item.get("count"), time.time() if now is None else now, agent),
    )
    con.commit()


def build_fix_tracking(con: sqlite3.Connection, tuning: Dict[str, Any], now: Optional[float] = None) -> List[Dict[str, Any]]:
    """Compare each finding the operator marked fixed with the current scan."""
    now = time.time() if now is None else now
    current = {item.get("key"): item for item in as_list((tuning.get("agent_hq") or {}).get("recommendations"))}
    out: List[Dict[str, Any]] = []
    for row in con.execute("SELECT * FROM fixes ORDER BY marked_at DESC"):
        item = current.get(row["key"])
        baseline = row["baseline"]
        now_count = item.get("count") if item else 0
        if item is None:
            verdict = "cleared"
        elif baseline is None or now_count is None:
            verdict = "still present"
        elif now_count < baseline:
            verdict = "improved"
        elif now_count > baseline:
            verdict = "worse"
        else:
            verdict = "unchanged"
        out.append({
            "key": row["key"],
            "title": row["title"],
            "kind": row["kind"],
            "baseline": baseline,
            "current": now_count,
            "verdict": verdict,
            "marked_at": ts_to_iso(row["marked_at"]),
            "days_tracked": int((now - float(row["marked_at"])) // 86400),
            "agent": row["agent"],
        })
    return out


def overview_payload(scan: Dict[str, Any]) -> Dict[str, Any]:
    con = history_db()
    try:
        record_snapshot(con, snapshot_values(scan))
        fixes = build_fix_tracking(con, scan["tuning"])
    finally:
        con.close()
    return {
        "generated_at": now_iso(),
        "controls": controls_enabled(),
        "agents": scan["agents"],
        "needs_you": scan["needs_you"],
        "health": scan["health"],
        "tuning": strip_internal(scan["tuning"]),
        "cost_attribution": scan["cost_attribution"],
        "backlog": strip_internal(scan["backlog"]),
        "fixes": fixes,
        "skill_hygiene": strip_internal(scan["skill_hygiene"]),
        "evidence_sources": strip_internal(scan["evidence_sources"]),
        "config_policy": strip_internal(scan["config_policy"]),
    }


# ---------------------------------------------------------------------------
# Alerts for a Hermes no-agent cron job.
#
# `hermes olympus install-alerts` puts a small script in $HERMES_HOME/scripts/
# that calls alert_report(). Hermes cron runs it on the user's schedule and
# delivers its stdout through the user's own delivery target; empty output is
# a silent run. No model is called and Olympus never sends anything itself.
# ---------------------------------------------------------------------------

ALERTS_STATE_FILE = "alerts.json"
ALERT_REPEAT_SECONDS = 6 * 60 * 60
ALERT_RECENT_SECONDS = 24 * 60 * 60
CRON_OVERDUE_SECONDS = 30 * 60
ALERT_SPEND_FLOOR_USD = 1.0
ALERT_SPEND_SPIKE_RATIO = 2.0


def build_alerts(scan: Dict[str, Any], history: Dict[str, Any], now: Optional[float] = None) -> List[Dict[str, str]]:
    """Conditions worth interrupting someone for, each with a stable key."""
    now = time.time() if now is None else now
    alerts: List[Dict[str, str]] = []

    def add(key: str, severity: str, text: str) -> None:
        alerts.append({"key": key, "severity": severity, "text": text})

    for job in scan["cron"]:
        where = " / ".join(str(part) for part in (job.get("profile"), job.get("schedule")) if part)
        name = f"{job.get('label')} ({where})" if where else str(job.get("label"))
        if job.get("state") == "error":
            add(f"cron-failed:{job.get('id')}", "critical", f"Cron job {name} failed: {job.get('last_error') or 'last run reported an error'}.")
            continue
        due = parse_iso_ts(job.get("next_run_at"))
        if job.get("enabled") and due is not None and now - due > CRON_OVERDUE_SECONDS:
            late = int((now - due) // 60)
            add(f"cron-overdue:{job.get('id')}", "critical", f"Cron job {name} is {late} min overdue; the cron ticker may have stopped.")

    for task in kanban_items(scan["kanban"], "_tasks"):
        if task_stale_reason(task, now):
            add(f"worker-stalled:{task.get('id')}", "critical", f"Kanban worker stalled on {task.get('title')} ({task.get('assignee')}): {task_stale_reason(task, now)}.")

    for run in kanban_items(scan["kanban"], "_runs"):
        if is_failed_run(run) and now - safe_float(run.get("_sort_ts")) <= ALERT_RECENT_SECONDS:
            add(f"worker-failed:{run.get('id')}", "warning", f"Kanban worker run {run.get('outcome') or run.get('status')} on task {run.get('task_id')}: {run.get('error') or 'no error text recorded'}.")

    for session in scan["sessions"]:
        if int(session.get("tool_call_count") or 0) >= RUNAWAY_TOOLS_THRESHOLD and now - safe_float(session.get("_last_ts")) <= ALERT_RECENT_SECONDS:
            add(f"looping:{session.get('session_ref')}", "warning", f"A {session.get('label')} session made {session.get('tool_call_count')} tool calls; it may be looping.")

    metrics = (scan["tuning"].get("agent_hq") or {}).get("metrics") or {}
    spend = float(metrics.get("spend_24h_usd") or 0.0)
    today = datetime.fromtimestamp(now, tz=timezone.utc).date().isoformat()
    previous = [float(day.get("spend_24h") or 0.0) for day in as_list(history.get("days")) if day.get("day") != today][-6:]
    if previous and spend >= ALERT_SPEND_FLOOR_USD:
        average = sum(previous) / len(previous)
        if spend >= ALERT_SPEND_SPIKE_RATIO * max(average, 0.01):
            add(f"spend-spike:{today}", "warning", f"Spend spike: ${spend:.2f} in the last 24h against a ${average:.2f}/day average.")
    return alerts


def select_new_alerts(alerts: List[Dict[str, str]], state: Dict[str, float], now: float) -> List[Dict[str, str]]:
    """Alerts not sent within ALERT_REPEAT_SECONDS. Mutates ``state`` to match."""
    active = {alert["key"] for alert in alerts}
    for key in list(state):
        if key not in active:
            del state[key]  # cleared: it can alert again if it comes back
    fresh = [alert for alert in alerts if alert["key"] not in state or now - state[alert["key"]] >= ALERT_REPEAT_SECONDS]
    for alert in fresh:
        state[alert["key"]] = now
    return fresh


def format_alerts(alerts: List[Dict[str, str]]) -> str:
    if not alerts:
        return ""
    ordered = sorted(alerts, key=lambda alert: _severity_rank(alert["severity"]))
    lines = [f"Olympus: {len(ordered)} new alert{'s' if len(ordered) != 1 else ''}"]
    lines += [f"- {alert['text']}" for alert in ordered]
    return "\n".join(lines)


def alert_report(now: Optional[float] = None, *, preview: bool = False) -> str:
    """Text for the cron job to deliver; empty when nothing new needs attention."""
    now = time.time() if now is None else now
    refresh_expose_local_labels()
    scan = scan_hermes()
    con = history_db()
    try:
        history = read_history(con, now)
    finally:
        con.close()
    alerts = build_alerts(scan, history, now)
    if preview:
        return format_alerts(alerts)
    state_path = olympus_data_dir() / ALERTS_STATE_FILE
    loaded = read_json(state_path)
    state = {str(k): float(v) for k, v in loaded.items()} if isinstance(loaded, dict) else {}
    fresh = select_new_alerts(alerts, state, now)
    state_path.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")
    return format_alerts(fresh)


@router.get("/overview")
def overview() -> Dict[str, Any]:
    refresh_expose_local_labels()
    started_at = time.perf_counter()
    scan = scan_hermes()
    payload = overview_payload(scan)
    payload["diagnostics"] = runtime_diagnostics("/overview", started_at, payload, scan["profiles"], scan["sessions"], scan["kanban"])
    return payload


@router.post("/fixes")
def track_fix(key: str) -> Dict[str, Any]:
    """Start tracking a current finding the operator says they fixed.

    The finding's title and count come from a fresh scan, never the request.
    """
    refresh_expose_local_labels()
    scan = scan_hermes()
    item = next((i for i in as_list((scan["tuning"].get("agent_hq") or {}).get("recommendations")) if i.get("key") == key), None)
    if item is None:
        return {"tracked": False, "reason": "finding not in the current scan"}
    queued = next((q for q in scan["needs_you"] if q["key"] == key), None)
    con = history_db()
    try:
        mark_fix(con, item, agent=queued["agent"]["id"] if queued and queued["agent"] else None)
        fixes = build_fix_tracking(con, scan["tuning"])
    finally:
        con.close()
    return {"tracked": True, "fixes": fixes}


@router.delete("/fixes")
def untrack_fix(key: str) -> Dict[str, Any]:
    con = history_db()
    try:
        con.execute("DELETE FROM fixes WHERE key = ?", (key,))
        con.commit()
    finally:
        con.close()
    return {"tracked": False}


@router.get("/agent")
def agent(ref: str) -> Dict[str, Any]:
    """The inspector for one agent (``ref`` is its roster id, e.g. profile:default)."""
    refresh_expose_local_labels()
    scan = scan_hermes()
    con = history_db()
    try:
        actions = read_actions(con, ref)
        fixes = build_fix_tracking(con, scan["tuning"])
    finally:
        con.close()
    detail = build_agent_detail(scan, ref, actions, fixes)
    if detail is None:
        return {"found": False}
    return {"found": True, "generated_at": now_iso(), "controls": controls_enabled(), **detail}


@router.get("/performance")
def performance(days: int = 7) -> Dict[str, Any]:
    """Per-agent run outcomes, run time, size, cost and tool failures (7 or 30 days)."""
    refresh_expose_local_labels()
    if days not in PERFORMANCE_DAYS:
        return {"error": f"days must be one of {', '.join(str(d) for d in PERFORMANCE_DAYS)}"}
    return build_performance(collect_profiles(), days)


@router.get("/run")
def run_detail(ref: str) -> Dict[str, Any]:
    """One run step by step (``ref`` is a public session ref)."""
    refresh_expose_local_labels()
    detail = build_run_detail(ref)
    return {"found": False} if detail is None else {"found": True, **detail}


def resolve_ref(kind: str, ref: str, board: Optional[str] = None) -> Optional[Dict[str, str]]:
    """Raw Hermes ids behind a public ref, read fresh from Hermes' stores."""
    if kind == "cron":
        for raw_profile, home in profile_stores(collect_profiles()):
            data = read_json(home / "cron" / "jobs.json") or {}
            for job in as_list(data.get("jobs") if isinstance(data, dict) else None):
                if isinstance(job, dict) and job.get("id") and public_ref(job["id"], "cron") == ref:
                    return {"job_id": str(job["id"]), "profile": raw_profile}
        return None
    if kind == "task":
        for found_board in discover_kanban_boards():
            if board is not None and found_board["slug"] != board:
                continue
            con = _kanban_conn(kanban_board_db(str(found_board["_slug"])))
            if con is None:
                continue
            try:
                ids = [row["id"] for row in con.execute("SELECT id FROM tasks")]
            except sqlite3.Error as exc:
                log_read_warning("task resolve scan failed", exc)
                continue
            finally:
                con.close()
            for task_id in ids:
                if (str(task_id) if EXPOSE_LOCAL_LABELS else safe_id(task_id, "task")) == ref:
                    return {"task_id": str(task_id), "board": str(found_board["_slug"])}
        return None
    if kind == "profile":
        profile = next((p for p in collect_profiles() if p["id"] == ref), None)
        return {"profile": str(profile["name"])} if profile else None
    return None


@router.get("/resolve")
def resolve(kind: str, ref: str, board: Optional[str] = None) -> Dict[str, Any]:
    """Raw ids for one confirmed control, looked up at click time.

    Payloads carry only public refs; the page asks for the raw cron job id,
    task id and board, or profile name immediately before it calls Hermes'
    own endpoint. Refused when controls are turned off.
    """
    refresh_expose_local_labels()
    if not controls_enabled():
        return {"allowed": False, "reason": "Controls are off (dashboard.olympus.controls is false in config.yaml)."}
    found = resolve_ref(kind, ref, board)
    return {"allowed": True, "found": found is not None, **(found or {})}


@router.post("/actions")
def log_action(action: str, kind: str, ref: str, label: str, ok: bool, agent: Optional[str] = None, detail: Optional[str] = None) -> Dict[str, Any]:
    """Record a control the operator confirmed and what Hermes answered."""
    if action not in ACTION_LABELS or kind not in ("task", "cron"):
        return {"recorded": False, "reason": "not an Olympus control"}
    con = history_db()
    try:
        record_action(con, {
            "agent": agent, "action": action, "target_kind": kind, "target_ref": ref,
            "label": redact_text(label, 120), "ok": ok, "detail": redact_text(detail, 200) if detail else None,
        })
    finally:
        con.close()
    return {"recorded": True}
