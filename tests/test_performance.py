import json
import os
import sqlite3
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from dashboard import plugin_api


# Hermes' message schema (the columns Olympus reads).
MESSAGES_SQL = (
    "CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, "
    "tool_name TEXT, timestamp REAL, token_count INTEGER, finish_reason TEXT)"
)
SESSIONS_SQL = (
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, started_at REAL, ended_at REAL, end_reason TEXT, "
    "last_activity_at REAL, tool_call_count INTEGER, api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, "
    "cache_read_tokens INTEGER, cache_write_tokens INTEGER, actual_cost_usd REAL, estimated_cost_usd REAL, parent_session_id TEXT)"
)


class ToolFailureRuleTest(unittest.TestCase):
    """The same verdicts as Hermes' agent/display._detect_tool_failure."""

    def test_failures(self):
        failed = [
            ("terminal", json.dumps({"output": "", "exit_code": 2})),
            ("web_search", json.dumps({"success": False, "error": "quota exceeded"})),
            ("browser_navigate", json.dumps({"error": "net::ERR_NAME_NOT_RESOLVED"})),
            ("process", json.dumps({"status": "failed"})),
            ("delegate_task", json.dumps({"results": [{"error": "interrupted"}, {"error": "interrupted"}]})),
            ("terminal", json.dumps({"user_summary": "Approval denied"})),
            ("read_file", "Error executing tool 'read_file': timed out after 30s"),
            ("mcp_github", 'tool said {"failed": "rate limited"} and stopped'),
        ]
        for tool, content in failed:
            self.assertTrue(plugin_api.tool_result_failed(tool, content), (tool, content))

    def test_successes(self):
        ok = [
            ("terminal", json.dumps({"output": "done", "exit_code": 0})),
            ("web_extract", json.dumps({"results": [{"url": "a", "error": None}, {"url": "b", "error": "404"}]})),
            ("write_file", json.dumps({"bytes_written": 120})),
            ("patch", json.dumps({"success": True})),
            ("read_file", json.dumps({"guardrail_refusal": True, "error": "repeated identical read"})),
            ("search", json.dumps({"matches": 3, "failed": 0})),
            ("read_file", "plain file text"),
            ("terminal", ""),
        ]
        for tool, content in ok:
            self.assertFalse(plugin_api.tool_result_failed(tool, content), (tool, content))

    def test_truncated_results_are_judged_by_their_head(self):
        self.assertTrue(plugin_api.tool_result_failed("terminal", '{"exit_code": 1, "output": "' + "x" * 600, truncated=True))
        self.assertFalse(plugin_api.tool_result_failed("terminal", '{"exit_code": 0, "output": "' + "x" * 600, truncated=True))
        self.assertTrue(plugin_api.tool_result_failed("web_extract", '{"success": false, "data": "' + "x" * 600, truncated=True))


class RunOutcomeTest(unittest.TestCase):
    def test_outcomes_follow_hermes_session_status(self):
        self.assertEqual(plugin_api.run_outcome(None, None, "assistant", False, "stop"), "open")
        self.assertEqual(plugin_api.run_outcome(10.0, "cli_close", "assistant", False, "stop"), "succeeded")
        self.assertEqual(plugin_api.run_outcome(10.0, "cli_close", "assistant", False, "agent_error"), "failed")
        self.assertEqual(plugin_api.run_outcome(10.0, "cron_incomplete_no_output", "assistant", False, None), "failed")
        self.assertEqual(plugin_api.run_outcome(10.0, "agent_close", "tool", False, None), "cut_off")
        self.assertEqual(plugin_api.run_outcome(10.0, "agent_close", "assistant", True, None), "cut_off")


class PerformanceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)
        (self.home / "config.yaml").write_bytes(b"dashboard:\n  olympus:\n    expose_local_labels: true\n")
        self.now = now = time.time()
        con = sqlite3.connect(self.home / "state.db")
        con.execute(SESSIONS_SQL)
        con.execute(MESSAGES_SQL)
        sessions = [
            # id, source, title, started, ended, end_reason, tools, api, in, out, cost
            ("ok-1", "cli", "Fix the build", now - 3600, now - 3000, "cli_close", 3, 4, 1000, 200, 0.10),
            ("ok-2", "telegram", "Answer a question", now - 7200, now - 7080, "session_reset", 0, 1, 300, 50, 0.02),
            ("bad-1", "cron", "Nightly digest", now - 86400, now - 86400 + 1800, "cron_incomplete_no_output", 1, 2, 500, 0, 0.05),
            ("cut-1", "cli", "Migrate the database", now - 2 * 86400, now - 2 * 86400 + 900, "agent_close", 2, 2, 800, 100, 0.08),
            ("open-1", "cli", "Still going", now - 600, None, None, 1, 1, 100, 10, 0.01),
            ("rot-1", "cli", "Long task part 1", now - 5000, now - 4000, "compression", 5, 6, 9000, 900, 0.40),
            ("sub-1", "subagent", "Read the docs", now - 3500, now - 3400, "cli_close", 1, 1, 100, 10, 0.01),
            ("old-1", "cli", "Last month", now - 20 * 86400, now - 20 * 86400 + 60, "cli_close", 0, 1, 10, 1, 0.0),
        ]
        con.executemany(
            "INSERT INTO sessions (id, source, title, started_at, ended_at, end_reason, tool_call_count, api_call_count, "
            "input_tokens, output_tokens, actual_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            sessions,
        )
        messages = [
            ("ok-1", "user", "fix it", None, None, now - 3590, None),
            ("ok-1", "assistant", "", '[{"id": "1"}]', None, now - 3580, None),
            ("ok-1", "tool", json.dumps({"exit_code": 1, "output": "tests failed"}), None, "terminal", now - 3500, None),
            ("ok-1", "tool", json.dumps({"exit_code": 0, "output": "ok"}), None, "terminal", now - 3200, None),
            ("ok-1", "tool", json.dumps({"bytes_written": 40}), None, "write_file", now - 3100, None),
            ("ok-1", "assistant", "Fixed.", None, None, now - 3010, "stop"),
            ("ok-2", "assistant", "Here you go.", None, None, now - 7090, "stop"),
            ("bad-1", "tool", "Error executing tool 'web_search': timed out after 30s", None, "web_search", now - 86400 + 100, None),
            ("bad-1", "assistant", "", None, None, now - 86400 + 1700, "stop"),
            ("cut-1", "assistant", "", '[{"id": "2"}]', None, now - 2 * 86400 + 800, None),
            ("cut-1", "tool", json.dumps({"success": True}), None, "patch", now - 2 * 86400 + 850, None),
        ]
        con.executemany(
            "INSERT INTO messages (session_id, role, content, tool_calls, tool_name, timestamp, finish_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
            messages,
        )
        con.commit()
        con.close()

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        plugin_api.EXPOSE_LOCAL_LABELS = False
        self.tmp.cleanup()

    def test_a_week_of_runs_per_agent(self):
        report = plugin_api.performance(7)
        default = report["agents"][0]

        # ok-1, ok-2 succeeded; bad-1 failed (cron gave no output); cut-1 cut off;
        # open-1 still running; the rolled-over and subagent sessions and last
        # month's run are not counted as runs.
        self.assertEqual(
            {k: default[k] for k in ("runs", "succeeded", "failed", "cut_off", "open", "subagent_runs", "success_rate")},
            {"runs": 5, "succeeded": 2, "failed": 1, "cut_off": 1, "open": 1, "subagent_runs": 1, "success_rate": 0.5},
        )
        # Finished run times: 120, 600, 900, 1800 seconds.
        self.assertEqual((default["median_seconds"], default["p90_seconds"]), (750.0, 1800.0))
        self.assertEqual(default["tool_calls_per_run"], 1.4)
        # Tools: terminal 1 of 2 failed, web_search 1 of 1, write_file and patch landed.
        tools = {t["tool"]: (t["calls"], t["failures"]) for t in default["tools"]}
        self.assertEqual(tools, {"terminal": (2, 1), "patch": (1, 0), "web_search": (1, 1), "write_file": (1, 0)})
        self.assertEqual(default["tool_error_rate"], 0.4)
        self.assertEqual([r["ref"] for r in default["failed_runs"]], ["bad-1", "cut-1"])
        self.assertEqual(default["slowest"][0]["ref"], "bad-1")
        self.assertEqual(len(default["daily"]), 7)
        today = datetime.fromtimestamp(self.now, tz=timezone.utc).date().isoformat()
        self.assertEqual(default["daily"][-1]["day"], today)
        self.assertEqual(sum(day["runs"] for day in default["daily"]), 5)
        self.assertEqual(report["fleet"]["runs"], 5)
        self.assertIn("no per-call latency", report["basis"])

    def test_this_week_is_compared_with_the_week_before(self):
        # Two runs 9 and 10 days ago, both succeeded, 300 s each: the week
        # before was perfect and quick, so this week reads worse and slower.
        now = self.now
        con = sqlite3.connect(self.home / "state.db")
        con.executemany(
            "INSERT INTO sessions (id, source, title, started_at, ended_at, end_reason, tool_call_count, api_call_count, "
            "input_tokens, output_tokens, actual_cost_usd) VALUES (?, 'cli', ?, ?, ?, 'cli_close', 0, 1, 100, 10, 0.05)",
            [("prev-1", "Earlier run", now - 9 * 86400, now - 9 * 86400 + 300),
             ("prev-2", "Another earlier run", now - 10 * 86400, now - 10 * 86400 + 300)],
        )
        con.commit()
        con.close()

        report = plugin_api.performance(7)
        default = report["agents"][0]
        self.assertEqual(default["runs"], 5, "the earlier runs stay out of this week's figures")
        self.assertEqual({k: default["previous"][k] for k in ("runs", "succeeded", "success_rate", "median_seconds", "cost_usd")},
                         {"runs": 2, "succeeded": 2, "success_rate": 1.0, "median_seconds": 300.0, "cost_usd": 0.1})
        trend = default["trend"]
        self.assertEqual(trend["previous_runs"], 2)
        self.assertEqual(trend["success_rate_points"], -0.5)       # 50% now against 100% before
        self.assertEqual(trend["median_change"], 1.5)              # 750 s against 300 s
        self.assertEqual(trend["p90_change"], 5.0)                 # 1800 s against 300 s
        self.assertEqual(trend["runs_change"], 1.5)                # 5 runs against 2
        self.assertEqual(report["fleet"]["trend"]["success_rate_points"], -0.5)
        self.assertIn("7 days before them", report["basis"])

        # With nothing in the week before, every comparison is absent, not zero.
        month = plugin_api.performance(30)
        self.assertEqual(month["agents"][0]["previous"]["runs"], 0)
        self.assertEqual(month["agents"][0]["trend"]["success_rate_points"], None)
        self.assertEqual(month["agents"][0]["trend"]["median_change"], None)

    def test_a_session_quiet_for_a_day_counts_as_finished(self):
        con = sqlite3.connect(self.home / "state.db")
        con.execute("INSERT INTO sessions (id, source, title, started_at, last_activity_at) VALUES ('quiet-1', 'kanban', 'Abandoned', ?, ?)",
                    (self.now - 3 * 86400, self.now - 3 * 86400 + 1200))
        con.execute("INSERT INTO messages (session_id, role, content, timestamp, finish_reason) VALUES ('quiet-1', 'assistant', 'done', ?, 'stop')",
                    (self.now - 3 * 86400 + 1200,))
        con.commit()
        con.close()

        runs = {r["_id"]: r for r in plugin_api._store_runs(self.home / "state.db", 0.0)}

        # Never closed, silent for three days: finished at its last activity.
        self.assertEqual((runs["quiet-1"]["outcome"], runs["quiet-1"]["duration"]), ("succeeded", 1200.0))
        # Open and active ten minutes ago: still running.
        self.assertEqual((runs["open-1"]["outcome"], runs["open-1"]["duration"]), ("open", None))

    def test_a_cron_run_whose_every_tool_call_failed_counts_as_failed(self):
        # The live test's digest: Hermes booked cron_complete, but the only
        # tool call (read_file) failed and the reply just reported it.
        con = sqlite3.connect(self.home / "state.db")
        con.executemany(
            "INSERT INTO sessions (id, source, title, started_at, ended_at, end_reason) VALUES (?, ?, ?, ?, ?, 'cron_complete')",
            [("cron-all", "cron", "Status digest", self.now - 1200, self.now - 1180),
             ("cron-some", "cron", "Status digest", self.now - 900, self.now - 870),
             ("cli-all", "cli", "Look for a file", self.now - 800, self.now - 790)],
        )
        missing = json.dumps({"content": "", "error": "File not found: status.md"})
        con.executemany(
            "INSERT INTO messages (session_id, role, content, tool_name, timestamp, finish_reason) VALUES (?, ?, ?, ?, ?, ?)",
            [("cron-all", "tool", missing, "read_file", self.now - 1190, None),
             ("cron-all", "assistant", "File not found: status.md", None, self.now - 1181, "stop"),
             ("cron-some", "tool", missing, "read_file", self.now - 890, None),
             ("cron-some", "tool", json.dumps({"content": "two items", "total_lines": 2}), "read_file", self.now - 880, None),
             ("cron-some", "assistant", "Two open items.", None, self.now - 871, "stop"),
             ("cli-all", "tool", missing, "read_file", self.now - 795, None),
             ("cli-all", "assistant", "That file does not exist.", None, self.now - 791, "stop")],
        )
        con.commit()
        con.close()

        runs = {r["_id"]: r["outcome"] for r in plugin_api._store_runs(self.home / "state.db", 0.0)}

        # A scheduled run with no successful tool call did not do its job; one
        # that recovered did, and a chat that only reports a missing file is fine.
        self.assertEqual((runs["cron-all"], runs["cron-some"], runs["cli-all"]), ("failed", "succeeded", "succeeded"))
        self.assertIn("every tool call", plugin_api.performance(7)["basis"])

    def test_thirty_days_include_last_month_and_bad_ranges_are_refused(self):
        self.assertEqual(plugin_api.performance(30)["agents"][0]["runs"], 6)
        self.assertEqual(plugin_api.performance(14), {"error": "days must be one of 7, 30"})

    def test_a_run_step_by_step(self):
        detail = plugin_api.run_detail("ok-1")

        self.assertTrue(detail["found"])
        self.assertEqual(detail["run"]["outcome"], "succeeded")
        self.assertEqual([(s["role"], s["tool"], s["failed"]) for s in detail["steps"]], [
            ("user", None, False), ("assistant", None, False), ("tool", "terminal", True),
            ("tool", "terminal", False), ("tool", "write_file", False), ("assistant", None, False),
        ])
        self.assertEqual([s["seconds"] for s in detail["steps"]], [10.0, 10.0, 80.0, 300.0, 100.0, 90.0])
        self.assertEqual(detail["tool_failures"], 1)
        self.assertEqual(detail["steps"][0]["preview"], "fix it")
        self.assertEqual(plugin_api.run_detail("session:0000000000"), {"found": False})

    def test_content_and_titles_stay_hidden_by_default(self):
        (self.home / "config.yaml").write_bytes(b"")
        report = plugin_api.performance(7)
        detail = plugin_api.run_detail(plugin_api.safe_id("ok-1", "session"))

        text = json.dumps(report) + json.dumps(detail)
        for private in ("Fix the build", "fix it", "Fixed.", "Nightly digest", "ok-1", "tests failed"):
            self.assertNotIn(private, text)
        self.assertTrue(detail["found"])
        self.assertIsNone(detail["steps"][0]["preview"])
        self.assertFalse(detail["content_shown"])


if __name__ == "__main__":
    unittest.main()
