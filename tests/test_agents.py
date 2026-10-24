import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from dashboard import plugin_api


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


SESSIONS_SQL = (
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, started_at REAL, ended_at REAL, end_reason TEXT, "
    "last_activity_at REAL, message_count INTEGER, tool_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, "
    "cache_read_tokens INTEGER, cache_write_tokens INTEGER, actual_cost_usd REAL, parent_session_id TEXT)"
)
MESSAGES_SQL = "CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, tool_name TEXT, timestamp REAL)"
MODEL_CONFIG = b"model:\n  default: test-model\n  provider: test-provider\n"


class AgentsTest(unittest.TestCase):
    """A six-agent Hermes home: one agent in each roster status."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)
        self.now = now = time.time()
        for name in ("coder", "ops", "qa", "quiet", "writer"):
            (self.home / "profiles" / name).mkdir(parents=True)
            (self.home / "profiles" / name / "config.yaml").write_bytes(MODEL_CONFIG)
        self.configure()

        # default: working in a live session with a live subagent.
        con = sqlite3.connect(self.home / "state.db")
        con.execute(SESSIONS_SQL)
        con.execute(MESSAGES_SQL)
        con.executemany("INSERT INTO sessions VALUES (?, ?, ?, ?, NULL, NULL, ?, 6, 4, 1000, 200, 3000, 0, 0.4, ?)", [
            ("live-main", "cli", "Refactor the billing module", now - 300, now - 30, None),
            ("live-sub", "subagent", "Read the billing tests", now - 120, now - 20, "live-main"),
        ])
        # Finished two days ago (outside today's activity), 10 minutes long,
        # with 45 tool calls and $1.50 of spend: it looped and it was costly.
        con.execute("INSERT INTO sessions (id, source, title, started_at, ended_at, end_reason, last_activity_at, tool_call_count, actual_cost_usd) "
                    "VALUES (?, 'cli', ?, ?, ?, 'completed', ?, 45, 1.5)",
                    ("done-1", "Write the summary", now - 2 * 86400, now - 2 * 86400 + 600, now - 2 * 86400 + 600))
        con.executemany("INSERT INTO messages (session_id, role, tool_name, timestamp) VALUES (?, 'tool', ?, ?)", [
            ("live-main", "terminal", now - 200),
            ("live-main", "terminal", now - 190),
            ("live-main", "terminal", now - 180),
            ("live-main", "web_search", now - 100),
        ])
        con.commit()
        con.close()

        cron = lambda home, jobs: (home / "cron").mkdir() or (home / "cron" / "jobs.json").write_bytes(json.dumps({"jobs": jobs}).encode("utf-8"))
        # ops: its gateway is down while a job is scheduled on it.
        cron(self.home / "profiles" / "ops", [{"id": "job-ops-1", "name": "Nightly digest", "enabled": True,
                                               "schedule": {"display": "every day 02:00"}, "next_run_at": iso(now + 3600)}])
        # writer: its scheduled job failed.
        cron(self.home / "profiles" / "writer", [{"id": "job-w-1", "name": "Weekly post", "enabled": True,
                                                  "schedule": {"display": "every monday 09:00"}, "last_status": "error",
                                                  "last_error": "provider timeout", "last_run_at": iso(now - 900),
                                                  "next_run_at": iso(now + 86400)}])

        con = sqlite3.connect(self.home / "kanban.db")
        con.executescript(
            "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, assignee TEXT, created_at INTEGER, started_at INTEGER, "
            "completed_at INTEGER, last_heartbeat_at INTEGER, claim_expires INTEGER, consecutive_failures INTEGER, "
            "last_failure_error TEXT, block_kind TEXT, block_recurrences INTEGER);"
            "CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, "
            "started_at INTEGER, ended_at INTEGER, error TEXT);"
            "CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, run_id INTEGER, kind TEXT, created_at INTEGER);"
        )
        n = int(now)
        con.executemany("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, NULL, ?, 0)", [
            # coder: waiting on a human answer.
            ("t-answer", "Pick a database", "blocked", "coder", n - 86400, n - 80000, None, "needs_input"),
            # coder: blocked on something transient (Hermes retries it; not queued).
            ("t-transient", "Fetch the feed", "blocked", "coder", n - 3600, n - 3500, None, "transient"),
            # qa: running, but its heartbeat stopped two hours ago.
            ("t-stalled", "Run the regression suite", "running", "qa", n - 10000, n - 9000, n - 7200, None),
            # nobody: ready work with no assignee.
            ("t-orphan", "Write the changelog", "ready", None, n - 600, None, None, None),
        ])
        con.executemany("INSERT INTO task_runs (task_id, profile, status, outcome, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)", [
            ("t-answer", "coder", "done", "completed", n - 50000, n - 49000),
            ("t-answer", "coder", "crashed", "crashed", n - 40000, n - 39000),
        ])
        con.executemany("INSERT INTO task_events (task_id, kind, created_at) VALUES (?, ?, ?)", [
            ("t-answer", "claimed", n - 80000),
            ("t-answer", "crashed", n - 39000),
            ("t-answer", "blocked", n - 7200),
        ])
        con.commit()
        con.close()

        # A real gateway process for default that also serves every profile
        # except ops, the way Hermes' multiplexer records it.
        self.gateway = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)", "gateway"])
        (self.home / "gateway.pid").write_bytes(json.dumps({"pid": self.gateway.pid, "kind": "hermes-gateway"}).encode("utf-8"))
        (self.home / "gateway_state.json").write_bytes(json.dumps({"served_profiles": ["coder", "qa", "quiet", "writer"]}).encode("utf-8"))

    def tearDown(self):
        self.gateway.kill()
        self.gateway.wait()
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        plugin_api.EXPOSE_LOCAL_LABELS = False
        self.tmp.cleanup()

    def configure(self, **olympus):
        """Root config.yaml: a model route plus dashboard.olympus settings."""
        lines = [f"    {key}: {str(value).lower()}" for key, value in olympus.items()]
        block = ("dashboard:\n  olympus:\n" + "\n".join(lines) + "\n") if lines else ""
        (self.home / "config.yaml").write_bytes(MODEL_CONFIG + block.encode("utf-8"))

    def labelled_scan(self):
        self.configure(expose_local_labels=True)
        plugin_api.refresh_expose_local_labels()
        return plugin_api.scan_hermes()

    def test_each_agent_states_what_it_is_doing_in_one_word(self):
        scan = self.labelled_scan()

        rows = {row["label"]: row for row in scan["agents"]["agents"]}
        self.assertEqual(
            {label: row["status_label"] for label, row in rows.items()},
            {"Default": "Working", "Coder": "Waiting on you", "Ops": "Offline", "Qa": "Stalled", "Writer": "Failed", "Quiet": "Idle"},
        )
        # Needs-you states sort first, idle last.
        self.assertEqual([row["label"] for row in scan["agents"]["agents"]], ["Coder", "Qa", "Writer", "Ops", "Default", "Quiet"])
        default = rows["Default"]
        self.assertEqual(default["current"]["kind"], "session")
        self.assertEqual(default["current"]["label"], "Refactor the billing module")
        self.assertEqual(default["helpers"], {"subagents": 1, "workers": 0, "cron": 0})
        self.assertTrue(default["live"])
        self.assertEqual(default["activity_7d"][-1], 2)
        self.assertEqual(len(default["activity_7d"]), 7)
        self.assertEqual(rows["Qa"]["current"]["label"], "Run the regression suite")
        self.assertEqual(rows["Qa"]["helpers"]["workers"], 1)
        self.assertFalse(rows["Qa"]["live"])  # a stalled worker is not working
        self.assertEqual(rows["Coder"]["status_reason"], "Pick a database is waiting on your answer")
        self.assertEqual(scan["agents"]["summary"], {"agents": 6, "working": 1, "need_you": 5, "queue": 7, "unattributed": 1})
        # The tool the live session called last is what the agent is doing now.
        self.assertEqual(default["current"]["tool"], "web_search")
        self.assertEqual(default["current"]["tool_at"], iso(self.now - 100))
        self.assertEqual(default["setup"], {"route": "configured", "model": "test-model", "skills": 0, "gateway": "own",
                                            "platforms": [], "max_turns": None, "loop_stop": "unattended only"})
        self.assertEqual((rows["Coder"]["setup"]["gateway"], rows["Ops"]["setup"]["gateway"]), ("shared", "stopped"))
        # Behaviour counts as an issue but does not change what the agent is doing.
        self.assertEqual((default["status"], default["issues"]), ("working", 2))

    def test_the_queue_lists_each_thing_once_with_the_action_that_resolves_it(self):
        scan = self.labelled_scan()

        queue = scan["needs_you"]
        self.assertEqual(
            [(item["kind"], item["agent"]["label"] if item["agent"] else None) for item in queue],
            [("answer", "Coder"), ("stalled", "Qa"), ("cron_failed", "Writer"), ("offline", "Ops"), ("unassigned", None),
             ("behaviour", "Default"), ("behaviour", "Default")],
        )
        answer, stalled, cron_failed, offline, orphan, looping, expensive = queue
        # Session behaviour lands on the agent whose sessions it came from, with
        # those sessions to open; the fleet-wide summaries stay in Checks.
        self.assertEqual(looping["title"], "Looping or tool-thrashing in 1 session")
        self.assertEqual(expensive["title"], "Expensive runs in 1 session ($1.50)")
        self.assertEqual(looping["targets"], [{"kind": "session", "ref": "done-1", "label": "Write the summary", "agent": "profile:default"}])
        self.assertNotIn("An agent is looping or tool-thrashing", [item["title"] for item in queue])
        self.assertIn("An agent is looping or tool-thrashing", [item["title"] for item in scan["tuning"]["agent_hq"]["recommendations"]])
        self.assertEqual([a["id"] for a in answer["actions"]], ["answer"])
        self.assertEqual(answer["actions"][0]["target"], {"kind": "task", "ref": "t-answer", "board": "default", "status": "blocked", "name": "Pick a database"})
        self.assertEqual(answer["since"], iso(int(self.now) - 7200))  # when it blocked, not when it was created
        self.assertEqual([a["id"] for a in stalled["actions"]], ["reclaim", "reassign"])
        self.assertIn("heartbeat stale", stalled["detail"])
        self.assertEqual([a["id"] for a in cron_failed["actions"]], ["run_now", "pause"])
        self.assertEqual(cron_failed["detail"], "provider timeout")
        self.assertEqual(cron_failed["actions"][1]["effect"], "Pause Weekly post for Writer. It will not run until you resume it.")
        self.assertEqual(offline["actions"], [])
        self.assertIn("1 scheduled job waits on it. Start it with: hermes -p ops gateway start", offline["detail"])
        self.assertEqual([a["id"] for a in orphan["actions"]], ["assign"])
        # The blocked-work summary is covered by the per-task items; Checks keeps it.
        titles = [item["title"] for item in queue]
        self.assertNotIn("Clarify blocked work before tuning autonomy upward", titles)
        self.assertIn("Clarify blocked work before tuning autonomy upward",
                      [item["title"] for item in scan["tuning"]["agent_hq"]["recommendations"]])

    def test_labels_and_raw_ids_stay_private_by_default(self):
        scan = plugin_api.scan_hermes()
        payload = plugin_api.overview_payload(scan)

        text = json.dumps({"agents": payload["agents"], "needs_you": payload["needs_you"]})
        for private in ("Pick a database", "Refactor the billing module", "Weekly post", "job-w-1", "t-answer", "coder", "hermes -p ops"):
            self.assertNotIn(private, text)
        self.assertIn("hermes -p <profile> gateway start", text)
        answer = next(item for item in payload["needs_you"] if item["kind"] == "answer")
        hidden = plugin_api.safe_id("t-answer", "task")
        self.assertEqual(answer["title"], f"Task {hidden[5:9]} is waiting on your answer")
        failed = next(item for item in payload["needs_you"] if item["kind"] == "cron_failed")
        self.assertRegex(failed["title"], r"^Job [0-9a-f]{4} failed on its last run$")
        labels = [row["label"] for row in payload["agents"]["agents"]]
        self.assertIn("Profile 1", labels)
        self.assertEqual({row["avatar"] for row in payload["agents"]["agents"] if row["label"].startswith("Profile")}, {"1", "2", "3", "4", "5"})
        self.assertTrue(payload["controls"])

    def test_the_inspector_shows_the_agents_recent_steps_work_and_usage(self):
        self.configure(expose_local_labels=True)

        default = plugin_api.agent("profile:default")
        coder = plugin_api.agent("profile:coder")

        self.assertTrue(default["found"])
        texts = [event["text"] for event in default["timeline"]]
        self.assertIn("Used terminal ×3", texts)
        self.assertIn("Used web_search", texts)
        self.assertIn("Started a subagent: Read the billing tests", texts)
        self.assertIn("Ran Write the summary (10 min)", texts)  # one line per finished session
        self.assertNotIn("Started Write the summary", texts)
        self.assertEqual(texts.index("Used web_search") < texts.index("Used terminal ×3"), True)
        today = default["usage"]["days"][-1]
        self.assertEqual((today["sessions"], today["input_tokens"], today["cache_tokens"], today["output_tokens"]), (2, 2000, 6000, 400))
        self.assertEqual(default["usage"]["cost_7d_usd"], 2.3)
        working = default["working"]
        self.assertEqual(working["top_tools"], [{"tool": "terminal", "calls": 3}, {"tool": "web_search", "calls": 1}])
        self.assertEqual([(s["kind"], s["severity"], s["count"]) for s in working["signals"]], [("looping", "warning", 1), ("expensive", "warning", 1)])
        self.assertEqual((working["sessions"], working["median_run_seconds"]), (3, 600.0))

        self.assertEqual([item["kind"] for item in coder["needs_you"]], ["answer"])
        # Kanban owns the board: the inspector keeps current work and counts.
        self.assertEqual(coder["kanban"], {"running": [], "open": 2, "blocked": 2, "done_7d": 0})
        qa = plugin_api.agent("profile:qa")
        self.assertEqual([(t["title"], [a["id"] for a in t["actions"]]) for t in qa["kanban"]["running"]],
                         [("Run the regression suite", ["reclaim", "reassign"])])
        self.assertEqual(coder["success"]["rate"], 0.5)
        coder_texts = [event["text"] for event in coder["timeline"]]
        self.assertEqual(coder_texts[:3], ["Blocked: Pick a database", "Worker crashed: Pick a database", "Claimed: Pick a database"])

        writer = plugin_api.agent("profile:writer")
        self.assertEqual([a["id"] for a in writer["cron"][0]["actions"]], ["run_now", "pause"])
        self.assertIn({"at": iso(self.now - 900), "kind": "cron", "text": "Ran Weekly post", "detail": "provider timeout", "state": "error"},
                      writer["timeline"])
        self.assertEqual(plugin_api.agent("profile:nobody"), {"found": False})

    def test_refs_resolve_to_raw_ids_only_at_click_time(self):
        scan = plugin_api.scan_hermes()
        queue = {item["kind"]: item for item in scan["needs_you"]}
        cron_ref = queue["cron_failed"]["actions"][0]["target"]["ref"]
        task_target = queue["answer"]["actions"][0]["target"]
        writer_id = queue["cron_failed"]["agent"]["id"]

        self.assertEqual(plugin_api.resolve("cron", cron_ref), {"allowed": True, "found": True, "job_id": "job-w-1", "profile": "writer"})
        self.assertEqual(plugin_api.resolve("task", task_target["ref"], task_target["board"]),
                         {"allowed": True, "found": True, "task_id": "t-answer", "board": "default"})
        self.assertEqual(plugin_api.resolve("profile", writer_id), {"allowed": True, "found": True, "profile": "writer"})
        self.assertEqual(plugin_api.resolve("task", "task:0000000000"), {"allowed": True, "found": False})

        self.configure(controls=False)
        refused = plugin_api.resolve("cron", cron_ref)
        self.assertFalse(refused["allowed"])
        self.assertNotIn("job_id", refused)
        self.assertFalse(plugin_api.overview_payload(plugin_api.scan_hermes())["controls"])

    def test_confirmed_actions_are_logged_and_shown_on_the_agent(self):
        self.configure(expose_local_labels=True)

        self.assertEqual(plugin_api.log_action("pause", "cron", "job-w-1", "Weekly post", True, agent="profile:writer"), {"recorded": True})
        self.assertEqual(plugin_api.log_action("delete", "cron", "job-w-1", "Weekly post", True), {"recorded": False, "reason": "not an Olympus control"})
        plugin_api.log_action("retry", "task", "t-transient", "Fetch the feed", False, agent="profile:coder", detail="409: blocked by parent")

        writer = plugin_api.agent("profile:writer")
        coder = plugin_api.agent("profile:coder")
        self.assertEqual(writer["timeline"][0]["text"], "You chose Pause: Weekly post")
        self.assertEqual(writer["timeline"][0]["state"], "ok")
        failed = next(event for event in coder["timeline"] if event["kind"] == "action")
        self.assertEqual((failed["text"], failed["state"], failed["detail"]), ("You chose Retry: Fetch the feed", "error", "409: blocked by parent"))


class FixStoreMigrationTest(unittest.TestCase):
    def test_a_1_1_0_fix_store_gains_the_agent_column(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved = os.environ.get("HERMES_HOME")
            os.environ["HERMES_HOME"] = tmp
            try:
                data = Path(tmp) / "plugin-data" / "olympus"
                data.mkdir(parents=True)
                old = sqlite3.connect(data / plugin_api.HISTORY_DB)
                old.execute("CREATE TABLE fixes (key TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, baseline INTEGER, marked_at REAL NOT NULL)")
                old.execute("INSERT INTO fixes VALUES ('k', 'An old finding', 'skill', 3, 1.0)")
                old.commit()
                old.close()

                con = plugin_api.history_db()
                try:
                    fixes = plugin_api.build_fix_tracking(con, {"agent_hq": {"recommendations": []}})
                finally:
                    con.close()
            finally:
                if saved is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = saved

        self.assertEqual([(fix["key"], fix["verdict"], fix["agent"]) for fix in fixes], [("k", "cleared", None)])


if __name__ == "__main__":
    unittest.main()
