"""Regenerate tests/fixtures/olympus-fixture-agents.js from a real Olympus scan.

Seeds a temporary Hermes home with seven agents (one per roster status plus
a busy coder), runs the real backend over it with local labels shown, and
writes the roster, the Needs-you queue and every agent's inspector payload.
The visual fixture loads this file, so its data always has the shape the
backend produces.

    python scripts/build-fixture-agents.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

OUT = ROOT / "tests" / "fixtures" / "olympus-fixture-agents.js"
MODEL = "model:\n  default: claude-sonnet-5-5\n  provider: anthropic\n"
ROLES = {
    "default": "Coordinates the team and writes the weekly update",
    "researcher": "Market and pricing research",
    "coder": "Fixes bugs and ships small features",
    "ops": "Backups, uptime and scheduled maintenance",
    "reviewer": "Reviews pull requests before merge",
    "writer": "Changelog and release notes",
    "analyst": "Support ticket and usage analysis",
}


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def seed(home: Path, now: float) -> None:
    for name, role in ROLES.items():
        profile = home if name == "default" else home / "profiles" / name
        profile.mkdir(parents=True, exist_ok=True)
        (profile / "config.yaml").write_bytes(MODEL.encode("utf-8"))
        (profile / "profile.yaml").write_bytes(f"description: {role}\n".encode("utf-8"))
    (home / "config.yaml").write_bytes((MODEL + "dashboard:\n  olympus:\n    expose_local_labels: true\n").encode("utf-8"))

    def sessions(profile: Path, rows: list[tuple]) -> None:
        con = sqlite3.connect(profile / "state.db")
        con.execute(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, started_at REAL, ended_at REAL, end_reason TEXT, "
            "last_activity_at REAL, message_count INTEGER, tool_call_count INTEGER, api_call_count INTEGER, input_tokens INTEGER, "
            "output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, actual_cost_usd REAL, parent_session_id TEXT)"
        )
        con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL, token_count INTEGER, finish_reason TEXT)")
        con.executemany("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, 12, 6, 8, ?, ?, ?, 0, ?, ?)", rows)
        con.commit()
        con.close()

    def history(prefix: str, days: int, per_day: int, scale: int) -> list[tuple]:
        rows = []
        for day in range(1, days):
            for n in range(per_day + (day % 3)):
                start = now - day * 86400 - n * 3600
                length = 120 + ((day * 7 + n * 13 + len(prefix) * 5) % 24) * 60  # 2 to 25 minutes
                rows.append((f"{prefix}-{day}-{n}", "cli", None, start, start + length, "completed", start + length,
                             scale * (2 + n), scale // 2, scale * 6, round(scale / 40000, 4), None))
        return rows

    sessions(home, history("d", 7, 2, 18000) + [
        ("live-main", "cli", "Draft the weekly investor update", now - 1500, None, None, now - 40, 22000, 6100, 90000, 0.62, None),
        ("live-sub", "subagent", "Collect revenue numbers", now - 400, None, None, now - 25, 8000, 900, 12000, 0.11, "live-main"),
    ])
    con = sqlite3.connect(home / "state.db")
    tools = ["read_file", "read_file", "read_file", "web_search", "terminal", "terminal", "write_file", "delegate_task"]
    con.executemany("INSERT INTO messages (session_id, role, tool_name, timestamp) VALUES ('live-main', 'tool', ?, ?)",
                    [(tool, now - 1400 + idx * 150) for idx, tool in enumerate(tools)])
    con.executemany("INSERT INTO messages (session_id, role, tool_name, timestamp) VALUES ('live-sub', 'tool', ?, ?)",
                    [("web_extract", now - 300), ("web_extract", now - 200)])
    con.commit()
    con.close()
    sessions(home / "profiles" / "researcher", history("r", 7, 1, 30000) + [
        # This morning's digest: Hermes booked it complete, but its only tool
        # call failed and the reply just said so.
        ("r-digest", "cron", "Morning market digest · 07:30", now - 5 * 3600 - 40, now - 5 * 3600 - 2, "cron_complete",
         now - 5 * 3600 - 2, 26000, 300, 0, 0.03, None),
    ])
    con = sqlite3.connect(home / "profiles" / "researcher" / "state.db")
    con.executemany(
        "INSERT INTO messages (session_id, role, tool_name, content, tool_calls, finish_reason, timestamp) VALUES ('r-digest', ?, ?, ?, ?, ?, ?)",
        [
            ("assistant", None, "", '[{"id": "s1"}]', None, now - 5 * 3600 - 35),
            ("tool", "web_search", json.dumps({"success": False, "error": "Search quota exceeded for this month"}), None, None, now - 5 * 3600 - 20),
            ("assistant", None, "Search is unavailable today, so there is no digest.", None, "stop", now - 5 * 3600 - 3),
        ],
    )
    con.commit()
    con.close()
    sessions(home / "profiles" / "coder", history("c", 7, 3, 24000) + [
        ("coder-kanban", "kanban", "Fix flaky checkout test", now - 2400, None, None, now - 60, 30000, 7000, 140000, 0.88, None),
    ])
    # Behaviour only Olympus sees: a coder run that looped (58 tool calls,
    # $2.40) and a researcher run that re-sent a huge context every call.
    for profile, row in (
        (home / "profiles" / "coder", ("c-loop", "kanban", "Retry the flaky test until green", now - 3 * 86400, now - 3 * 86400 + 2700,
                                       "completed", now - 3 * 86400 + 2700, 34, 58, 40, 90000, 21000, 2600000, 0, 2.4, None)),
        (home / "profiles" / "researcher", ("r-context", "cli", "Read every competitor pricing page", now - 2 * 86400, now - 2 * 86400 + 1800,
                                            "completed", now - 2 * 86400 + 1800, 48, 14, 9, 40000, 8000, 720000, 0, 0.9, None)),
    ):
        con = sqlite3.connect(profile / "state.db")
        con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", row)
        con.commit()
        con.close()
    # How those two runs ended, plus tool results Hermes' failure rule reads:
    # the coder loop died on an agent error after failing terminal calls; the
    # researcher run was cut off waiting on a tool.
    con = sqlite3.connect(home / "profiles" / "coder" / "state.db")
    start = now - 3 * 86400
    loop = [("user", None, "Get the checkout test green", None, None, start + 5)]
    for step in range(12):
        loop.append(("assistant", None, "", '[{"id": "t%d"}]' % step, None, start + 20 + step * 200))
        loop.append(("tool", "terminal", json.dumps({"exit_code": 1, "output": "1 failed"}) if step % 3 else json.dumps({"exit_code": 0, "output": "ok"}), None, None, start + 120 + step * 200))
    loop.append(("tool", "read_file", "def test_checkout(): ...", None, None, start + 2550))
    loop.append(("assistant", None, "", None, "agent_error", start + 2690))
    con.executemany(
        "INSERT INTO messages (session_id, role, tool_name, content, tool_calls, finish_reason, timestamp) VALUES ('c-loop', ?, ?, ?, ?, ?, ?)",
        loop,
    )
    con.commit()
    con.close()
    con = sqlite3.connect(home / "profiles" / "researcher" / "state.db")
    start = now - 2 * 86400
    con.executemany(
        "INSERT INTO messages (session_id, role, tool_name, content, tool_calls, finish_reason, timestamp) VALUES ('r-context', ?, ?, ?, ?, ?, ?)",
        [
            ("user", None, "Read every competitor pricing page", None, None, start + 5),
            ("assistant", None, "", '[{"id": "w1"}]', None, start + 30),
            ("tool", "web_extract", json.dumps({"results": [{"url": "a", "error": None}]}), None, None, start + 400),
            ("assistant", None, "", '[{"id": "w2"}]', None, start + 420),
            ("tool", "web_extract", json.dumps({"success": False, "error": "403 forbidden"}), None, None, start + 1790),
        ],
    )
    con.commit()
    con.close()
    sessions(home / "profiles" / "reviewer", history("v", 5, 1, 12000))
    sessions(home / "profiles" / "writer", history("w", 4, 1, 9000))
    sessions(home / "profiles" / "analyst", history("a", 3, 1, 6000))

    def cron(profile: Path, jobs: list[dict]) -> None:
        (profile / "cron").mkdir(exist_ok=True)
        (profile / "cron" / "jobs.json").write_bytes(json.dumps({"jobs": jobs}).encode("utf-8"))

    cron(home / "profiles" / "researcher", [
        {"id": "job-digest", "name": "Morning market digest", "enabled": True, "schedule": {"display": "every day 07:30"},
         "last_status": "ok", "last_run_at": iso(now - 5 * 3600), "next_run_at": iso(now + 19 * 3600)},
        {"id": "job-competitors", "name": "Competitor price watch", "enabled": False, "schedule": {"display": "every monday 09:00"},
         "last_status": "ok", "last_run_at": iso(now - 6 * 86400), "next_run_at": None},
    ])
    cron(home / "profiles" / "ops", [
        {"id": "job-backup", "name": "Nightly backup check", "enabled": True, "schedule": {"display": "every day 02:00"},
         "last_status": "ok", "last_run_at": iso(now - 20 * 3600), "next_run_at": iso(now + 4 * 3600)},
    ])
    cron(home / "profiles" / "writer", [
        {"id": "job-changelog", "name": "Publish changelog", "enabled": True, "schedule": {"display": "every friday 16:00"},
         "last_status": "error", "last_error": "Telegram delivery failed: chat not found", "last_run_at": iso(now - 2 * 3600),
         "next_run_at": iso(now + 7 * 86400)},
    ])

    n = int(now)
    con = sqlite3.connect(home / "kanban.db")
    con.executescript(
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, assignee TEXT, created_at INTEGER, started_at INTEGER, "
        "completed_at INTEGER, last_heartbeat_at INTEGER, claim_expires INTEGER, consecutive_failures INTEGER, "
        "last_failure_error TEXT, block_kind TEXT, block_recurrences INTEGER);"
        "CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, "
        "started_at INTEGER, ended_at INTEGER, error TEXT);"
        "CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, run_id INTEGER, kind TEXT, payload TEXT, created_at INTEGER);"
    )
    tasks = [
        ("t-pricing", "Which market should the pricing study cover?", "blocked", "researcher", n - 3 * 86400, n - 2 * 86400, None, None, None, 0, None, "needs_input"),
        ("t-checkout", "Fix flaky checkout test", "running", "coder", n - 7200, n - 2400, None, n - 60, n + 1800, 0, None, None),
        ("t-preview", "Deploy the preview build", "blocked", "coder", n - 86400, n - 80000, None, None, None, 0, None, "capability"),
        ("t-search", "Add search to the docs site", "done", "coder", n - 4 * 86400, n - 3 * 86400, n - 2 * 86400, None, None, 0, None, None),
        ("t-pr412", "Review PR 412: payment retries", "running", "reviewer", n - 18000, n - 14000, None, n - 7600, n - 3600, 0, None, None),
        ("t-tickets", "Summarise this week's support tickets", "ready", None, n - 1800, None, None, None, None, 0, None, None),
        ("t-release", "Draft release notes for 2.4", "ready", "writer", n - 5000, None, None, None, None, 0, None, None),
    ]
    con.executemany("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)", tasks)
    con.executemany("INSERT INTO task_runs (task_id, profile, status, outcome, started_at, ended_at, error) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        ("t-search", "coder", "done", "completed", n - 3 * 86400, n - 2 * 86400, None),
        ("t-preview", "coder", "crashed", "crashed", n - 80000, n - 79000, "permission denied: deploy token missing"),
        ("t-preview", "coder", "blocked", "blocked", n - 78000, n - 77000, None),
        ("t-checkout", "coder", "running", None, n - 2400, None, None),
        ("t-pr412", "reviewer", "running", None, n - 14000, None, None),
    ])
    con.executemany("INSERT INTO task_events (task_id, kind, created_at) VALUES (?, ?, ?)", [
        ("t-pricing", "claimed", n - 2 * 86400),
        ("t-checkout", "claimed", n - 2400),
        ("t-checkout", "spawned", n - 2390),
        ("t-preview", "crashed", n - 79000),
        ("t-preview", "blocked", n - 77000),
        ("t-search", "completed", n - 2 * 86400),
        ("t-pr412", "claimed", n - 14000),
    ])
    con.execute(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t-pricing', 'blocked', ?, ?)",
        (json.dumps({"reason": "Should the study cover the US only, or the US and the EU? The brief mentions both.", "kind": "needs_input"}), n - 26 * 3600),
    )
    con.commit()
    con.close()


def scan(home: Path) -> dict:
    """The roster, queue and every inspector payload for one Hermes home."""
    from dashboard import plugin_api

    os.environ["HERMES_HOME"] = str(home)
    os.environ["HERMES_KANBAN_HOME"] = str(home)
    plugin_api.refresh_expose_local_labels()
    overview = plugin_api.overview_payload(plugin_api.scan_hermes())
    performance = {str(days): plugin_api.performance(days) for days in plugin_api.PERFORMANCE_DAYS}
    refs = {
        run["ref"]
        for report in performance.values()
        for agent in report["agents"]
        for run in agent["failed_runs"] + agent["slowest"]
    }
    return {
        "generated_at": overview["generated_at"],
        "controls": overview["controls"],
        "agents": overview["agents"],
        "needs_you": overview["needs_you"],
        "details": {row["id"]: plugin_api.agent(row["id"]) for row in overview["agents"]["agents"]},
        "performance": performance,
        "runs": {ref: plugin_api.run_detail(ref) for ref in sorted(refs)},
    }


def main() -> None:
    variants = {}
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "team"
        fresh = Path(tmp) / "fresh"
        fresh.mkdir()
        (fresh / "config.yaml").write_bytes(MODEL.encode("utf-8"))
        seed(home, time.time())
        # A real process stands in for the default gateway, serving every
        # profile except ops (whose gateway is down).
        gateway = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)", "gateway"])
        try:
            (home / "gateway.pid").write_bytes(json.dumps({"pid": gateway.pid, "kind": "hermes-gateway"}).encode("utf-8"))
            served = [name for name in ROLES if name not in ("default", "ops")]
            (home / "gateway_state.json").write_bytes(json.dumps({"served_profiles": served}).encode("utf-8"))
            variants["labelled"] = scan(home)
            # The same team with local labels hidden, as on a shared machine.
            (home / "config.yaml").write_bytes(MODEL.encode("utf-8"))
            variants["hidden"] = scan(home)
            variants["fresh"] = scan(fresh)
        finally:
            gateway.kill()
            gateway.wait()
    OUT.write_bytes((
        "// Generated by scripts/build-fixture-agents.py from real Olympus scans. Do not edit by hand.\n"
        "window.__OLYMPUS_FIXTURE_AGENTS__ = " + json.dumps(variants, indent=1, ensure_ascii=False) + ";\n"
    ).encode("utf-8"))
    for name, payload in variants.items():
        print(f"{name}: {len(payload['agents']['agents'])} agents, {len(payload['needs_you'])} queue items")


if __name__ == "__main__":
    main()
