import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from dashboard import plugin_api


SESSIONS_SQL = (
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, started_at REAL, ended_at REAL, end_reason TEXT, "
    "last_activity_at REAL, message_count INTEGER, tool_call_count INTEGER, parent_session_id TEXT)"
)
MESSAGES_SQL = "CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_name TEXT, timestamp REAL)"
MODEL_CONFIG = b"model:\n  default: test-model\n  provider: test-provider\n"
LABELS_ON = MODEL_CONFIG + b"dashboard:\n  olympus:\n    expose_local_labels: true\n"

# The shape Hermes v0.22.5 writes (checked on the rig 2026-10-30): a header,
# then one "HH:MM:SS role     | text" line per event.
TRANSCRIPT = """=== Hermes subagent live transcript ===
delegation: deleg_test   task: 1
goal: Patch the retry loop
started: 2026-10-30 12:33:38
(append-only; streams while the subagent runs — tail -f me)
========================================
12:33:38 user     | kickoff: Patch the retry loop
12:33:38 start    | Patch the retry loop
12:33:43 tool     | -> read_file(src/retry.py)
12:33:44 result   | read_file ok 1.1s: {"content": "1|x", "total_lines": 1}
12:33:50 tool     | -> terminal(npm test)
12:33:58 result   | terminal ERROR 8.0s: {"exit_code": 1, "output": "1 failed"}
12:33:59 think    | The test still fails.
"""


def local_stamp(ts: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))


class LiveTranscriptTest(unittest.TestCase):
    def test_parses_event_lines_and_skips_the_header(self):
        self.assertIsNone(plugin_api.parse_live_transcript_line("=== Hermes subagent live transcript ==="))
        self.assertIsNone(plugin_api.parse_live_transcript_line("goal: Patch the retry loop"))
        parsed = plugin_api.parse_live_transcript_line("12:33:43 tool     | -> read_file(src/retry.py)")
        self.assertEqual(parsed, {"clock": "12:33:43", "role": "tool", "text": "-> read_file(src/retry.py)"})
        parsed = plugin_api.parse_live_transcript_line("12:33:45 assistant| The file was read.")
        self.assertEqual(parsed["role"], "assistant")

    def test_tail_reports_the_last_tool_call_counts_and_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "task-1.log"
            path.write_text(TRANSCRIPT, encoding="utf-8")
            tail = plugin_api.read_live_transcript_tail(path)
        self.assertEqual(tail["last_tool"], {"name": "terminal", "args": "npm test", "clock": "12:33:50"})
        self.assertEqual(tail["calls"], 2)
        self.assertEqual(tail["errors"], 1)
        self.assertIsNone(tail["final"])

    def test_tail_reads_only_the_end_of_a_long_transcript(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "task-0.log"
            filler = "".join(f"12:00:{i % 60:02d} think    | line {i}\n" for i in range(400))
            path.write_text(TRANSCRIPT.split("========================================\n")[0] + filler
                            + "12:40:00 tool     | -> write_file(out.txt)\n"
                            + "12:40:01 final    | end status=completed exit_reason=completed\n", encoding="utf-8")
            tail = plugin_api.read_live_transcript_tail(path, max_bytes=300)
        self.assertEqual(tail["last_tool"]["name"], "write_file")
        self.assertEqual(tail["final"], "end status=completed exit_reason=completed")

    def test_missing_or_unreadable_transcript_is_empty(self):
        tail = plugin_api.read_live_transcript_tail(Path(tempfile.gettempdir()) / "olympus-no-such-task.log")
        self.assertEqual(tail, {"last_tool": None, "calls": 0, "errors": 0, "final": None})


class LiveViewTest(unittest.TestCase):
    """One agent with an open run and three subagents, one idle agent."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)
        self.now = now = time.time()
        (self.home / "profiles" / "coder").mkdir(parents=True)
        (self.home / "profiles" / "coder" / "config.yaml").write_bytes(MODEL_CONFIG)
        (self.home / "config.yaml").write_bytes(LABELS_ON)

        con = sqlite3.connect(self.home / "state.db")
        con.execute(SESSIONS_SQL)
        con.execute(MESSAGES_SQL)
        con.executemany("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, 6, 4, ?)", [
            ("run-1", "cli", "Fix flaky checkout test", now - 600, None, None, now - 5, None),
            ("child-a", "subagent", "Subagent: Reproduce the failure", now - 190, now - 60, "completed", now - 60, "run-1"),
            ("child-b", "subagent", "Subagent: Patch the retry loop", now - 180, None, None, now - 10, "run-1"),
            ("child-c", "subagent", "Subagent: Run the suite", now - 170, now - 40, "error", now - 40, "run-1"),
            ("old-1", "cli", "Write the summary", now - 7200, now - 7000, "completed", now - 7000, None),
            ("stale-1", "cron", "Nightly digest", now - 9000, None, None, now - 8000, None),
        ])
        con.executemany("INSERT INTO messages (session_id, role, content, tool_name, timestamp) VALUES (?, 'tool', ?, ?, ?)", [
            ("run-1", '{"results": []}', "delegate_task", now - 500),
            ("child-a", '{"content": "ok"}', "read_file", now - 90),
            ("child-b", '{"content": "1|x"}', "read_file", now - 30),
            ("child-b", '{"exit_code": 1, "output": "1 failed"}', "terminal", now - 10),
            ("child-c", '{"error": "no such file", "success": false}', "read_file", now - 45),
        ])
        con.commit()
        con.close()

        live = self.home / "cache" / "delegation" / "live" / "deleg_test"
        live.mkdir(parents=True)
        (live / "task-1.log").write_text(TRANSCRIPT, encoding="utf-8")
        (live / "manifest.json").write_text(json.dumps({
            "delegation_id": "deleg_test",
            "started": local_stamp(now - 200),
            "task_count": 3,
            "model": "test-model",
            "tasks": [
                {"index": 0, "goal": "Reproduce the failure", "log": str(live / "task-0.log"), "status": "completed", "exit_reason": "completed"},
                {"index": 1, "goal": "Patch the retry loop", "log": str(live / "task-1.log"), "status": "running"},
                {"index": 2, "goal": "Run the suite", "log": str(live / "task-2.log"), "status": "failed", "exit_reason": "error"},
            ],
        }), encoding="utf-8")
        plugin_api.refresh_expose_local_labels()

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        plugin_api.refresh_expose_local_labels()
        self.tmp.cleanup()

    def live(self):
        return plugin_api.build_live(plugin_api.collect_profiles(), now=self.now)

    def test_one_lane_for_the_working_agent_and_the_idle_agent_listed(self):
        payload = self.live()
        self.assertEqual([lane["agent"]["id"] for lane in payload["lanes"]], ["profile:default"])
        self.assertEqual([agent["id"] for agent in payload["idle"]], ["profile:coder"])
        self.assertEqual(payload["summary"], {"runs": 1, "children": 1, "agents_running": 1})
        self.assertEqual(payload["poll_seconds"], plugin_api.LIVE_POLL_SECONDS)

    def test_open_run_with_its_children_in_start_order(self):
        run = self.live()["lanes"][0]["runs"][0]
        self.assertEqual(run["source"], "cli")
        self.assertEqual(run["label"], "Fix flaky checkout test")
        self.assertEqual(run["last_tool"]["name"], "delegate_task")
        self.assertEqual([c["label"] for c in run["children"]], ["Reproduce the failure", "Patch the retry loop", "Run the suite"])
        self.assertEqual([c["status"] for c in run["children"]], ["done", "running", "failed"])
        self.assertIsNotNone(run["children"][0]["ended_at"])
        self.assertIsNone(run["children"][1]["ended_at"])

    def test_finished_and_stale_runs_are_not_live(self):
        labels = [run["label"] for lane in self.live()["lanes"] for run in lane["runs"]]
        self.assertEqual(labels, ["Fix flaky checkout test"])

    def test_batch_progress_comes_from_the_manifest(self):
        run = self.live()["lanes"][0]["runs"][0]
        self.assertEqual(run["batch"], {"done": 1, "failed": 1, "running": 1, "total": 3})

    def test_running_child_takes_its_last_tool_and_args_from_the_live_transcript(self):
        child = self.live()["lanes"][0]["runs"][0]["children"][1]
        self.assertEqual(child["last_tool"], {"name": "terminal", "args": "npm test", "at": None})
        self.assertEqual(child["errors"], 1)

    def test_ticks_cover_the_last_minute_of_the_run_and_its_children(self):
        run = self.live()["lanes"][0]["runs"][0]
        # child-c's failed read, child-b's read, child-b's failing test run; child-a's read is older than a minute.
        self.assertEqual([tick["error"] for tick in run["ticks"]], [True, False, True])
        for tick in run["ticks"]:
            self.assertGreaterEqual(plugin_api.parse_iso_ts(tick["at"]), self.now - plugin_api.LIVE_WINDOW_SECONDS)

    def test_hidden_labels_hide_titles_args_and_raw_ids(self):
        (self.home / "config.yaml").write_bytes(MODEL_CONFIG)
        plugin_api.refresh_expose_local_labels()
        payload = self.live()
        text = json.dumps(payload)
        for private in ("Fix flaky", "Patch the retry", "npm test", "src/retry", "run-1", "child-b", "deleg_test"):
            self.assertNotIn(private, text)
        for key in ('"session_id"', '"run_id"', '"cwd"', '"workspace_path"', '"_name"'):
            self.assertNotIn(key, text)
        child = payload["lanes"][0]["runs"][0]["children"][1]
        self.assertNotIn("args", child["last_tool"])
        self.assertEqual(child["last_tool"]["name"], "terminal")
        self.assertEqual(payload["lanes"][0]["runs"][0]["batch"]["total"], 3)

    def test_batch_links_through_titles_hermes_cut_and_numbered(self):
        # Seen on the rig: Hermes keeps "Subagent: <goal cut with an ellipsis>" and numbers a repeat " #2".
        con = sqlite3.connect(self.home / "state.db")
        con.execute("UPDATE sessions SET title = 'Subagent: Patch the retry lo…' WHERE id = 'child-b'")
        con.execute("UPDATE sessions SET title = 'Subagent: Run the suite #2' WHERE id = 'child-c'")
        con.commit()
        con.close()
        run = self.live()["lanes"][0]["runs"][0]
        self.assertEqual(run["batch"], {"done": 1, "failed": 1, "running": 1, "total": 3})
        self.assertEqual(run["children"][1]["last_tool"]["args"], "npm test")

    def test_no_internal_keys_leave_the_payload(self):
        text = json.dumps(self.live())
        self.assertNotIn('"_', text)


if __name__ == "__main__":
    unittest.main()
