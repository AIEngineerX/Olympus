import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from dashboard import plugin_api


class BriefDataTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        plugin_api.EXPOSE_LOCAL_LABELS = False
        self.tmp.cleanup()

    def _sessions(self, home, rows):
        home.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(home / "state.db")
        con.executescript(
            """
            CREATE TABLE sessions (
              id TEXT, source TEXT, title TEXT, started_at REAL, ended_at REAL, last_activity_at REAL,
              tool_call_count INTEGER, message_count INTEGER, input_tokens INTEGER, output_tokens INTEGER,
              api_call_count INTEGER, actual_cost_usd REAL
            );
            """
        )
        con.executemany("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
        con.commit()
        con.close()

    def test_sessions_outside_the_window_are_not_scanned(self):
        now = time.time()
        self._sessions(self.home, [
            ("fresh", "cli", "t", now - 3600, now - 3500, now - 3500, 45, 4, 10, 10, 1, 0.5),
            ("old", "cli", "t", now - 10 * 86400, now - 10 * 86400 + 60, now - 10 * 86400 + 60, 90, 4, 10, 10, 1, 9.0),
        ])

        sessions = plugin_api.collect_sessions(200, since=now - plugin_api.SESSION_WINDOW_DAYS * 86400)

        self.assertEqual([s["session_ref"] for s in sessions], [plugin_api.safe_id("fresh", "session")])

    def test_metrics_report_the_window_and_spend_in_the_last_day(self):
        now = time.time()
        self._sessions(self.home, [
            ("today-a", "cli", "t", now - 7200, now - 7100, now - 7100, 3, 4, 10, 10, 1, 0.25),
            ("today-b", "cli", "t", now - 3600, now - 3500, now - 3500, 3, 4, 10, 10, 1, 0.5),
            ("three-days", "cli", "t", now - 3 * 86400, now - 3 * 86400 + 60, now - 3 * 86400 + 60, 3, 4, 10, 10, 1, 4.0),
        ])
        sessions = plugin_api.collect_sessions(200, since=now - plugin_api.SESSION_WINDOW_DAYS * 86400)

        metrics = plugin_api.build_metrics(sessions)

        self.assertEqual(metrics["window"]["sessions"], 3)
        self.assertEqual(metrics["window"]["label"], "last 7 days, 3 sessions")
        self.assertFalse(metrics["window"]["capped"])
        self.assertEqual(metrics["spend_24h_usd"], 0.75)
        self.assertEqual(metrics["sessions_24h"], 2)
        self.assertEqual(metrics["total_cost_usd"], 4.75)

    def test_tuning_items_point_at_the_sessions_behind_them(self):
        now = time.time()
        self._sessions(self.home, [
            ("looper", "cli", "t", now - 3600, now - 3500, now - 3500, 64, 4, 10, 10, 1, 0.1),
        ])
        sessions = plugin_api.collect_sessions(200)

        items = plugin_api.detect_friction(sessions, {})

        looping = next(item for item in items if item["title"] == "An agent is looping or tool-thrashing")
        self.assertEqual(looping["targets"], [{"kind": "session", "ref": plugin_api.safe_id("looper", "session"), "label": "cli"}])
        self.assertNotIn("looper", json.dumps(looping))

    def test_open_session_resolves_a_hashed_ref_across_profiles(self):
        now = time.time()
        self._sessions(self.home, [("root-session", "cli", "t", now - 60, now - 30, now - 30, 1, 1, 1, 1, 1, 0.0)])
        self._sessions(self.home / "profiles" / "coder", [("coder session/1", "cli", "t", now - 60, now - 30, now - 30, 1, 1, 1, 1, 1, 0.0)])

        found = plugin_api.open_session(plugin_api.safe_id("coder session/1", "session"))

        self.assertEqual(found, {"href": "/chat?resume=coder%20session%2F1&profile=coder", "session_id": "coder session/1", "profile": "coder"})
        self.assertEqual(plugin_api.open_session("session:0000000000"), {"href": None})

    def test_open_session_accepts_raw_ids_only_when_labels_are_exposed(self):
        now = time.time()
        self._sessions(self.home, [("raw-id", "cli", "t", now - 60, now - 30, now - 30, 1, 1, 1, 1, 1, 0.0)])

        self.assertEqual(plugin_api.resolve_session_ref("raw-id"), None)
        plugin_api.EXPOSE_LOCAL_LABELS = True
        self.assertEqual(plugin_api.resolve_session_ref("raw-id"), {"session_id": "raw-id", "profile": "default"})


if __name__ == "__main__":
    unittest.main()
