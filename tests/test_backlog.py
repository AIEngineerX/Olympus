import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from dashboard import plugin_api

PROFILES = [{"name": "default", "_public_name": "default", "gateway_state": "running", "state": "active"}]
DAY = 86400


class BacklogTriageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)
        self.now = int(time.time())
        con = sqlite3.connect(self.home / "kanban.db")
        con.executescript(
            "CREATE TABLE tasks (id TEXT, title TEXT, status TEXT, assignee TEXT, created_at INTEGER, block_kind TEXT, block_recurrences INTEGER);"
        )
        rows = [
            ("q1", "secret question one", "blocked", "default", self.now - 5 * DAY, "needs_input", 1),
            ("q2", "question two", "blocked", "default", self.now - 2 * DAY, "needs_input", 1),
            ("q3", "question three", "blocked", "coder", self.now - 1 * DAY, "needs_input", 2),
            ("c1", "needs api", "blocked", "coder", self.now - DAY, "capability", 1),
            ("t1", "flaky", "blocked", "default", self.now - 3600, "transient", 1),
            ("u1", "why", "blocked", "default", self.now - 3600, None, 0),
            ("r1", "looped", "triage", "default", self.now - 3600, "needs_input", 2),
            ("d1", "after parent", "todo", "default", self.now - 3600, "dependency", 0),
            ("n1", "normal ready", "ready", "default", self.now - 3600, None, 0),
        ]
        con.executemany("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
        con.commit()
        con.close()

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def test_backlog_groups_by_who_has_to_act(self):
        triage = plugin_api.build_backlog_triage(plugin_api.collect_kanban(PROFILES), now=self.now)

        groups = {group["kind"]: group for group in triage["groups"]}
        self.assertEqual(list(groups), ["needs_input", "capability", "transient", "untyped", "triage", "dependency"])
        needs = groups["needs_input"]
        self.assertEqual((needs["count"], needs["oldest_days"], needs["stale"], needs["repeat_blocks"]), (3, 5, 1, 1))
        self.assertEqual(needs["assignees"][0], {"assignee": "default", "count": 2})
        self.assertEqual(triage["summary"], {"groups": 6, "tasks": 8, "needs_you": 6})
        self.assertNotIn("secret question", json.dumps(triage))

    def test_needs_input_and_capability_groups_become_findings(self):
        triage = plugin_api.build_backlog_triage(plugin_api.collect_kanban(PROFILES), now=self.now)

        titles = [item["title"] for item in plugin_api.backlog_findings(triage)]

        self.assertEqual(titles, ["3 Kanban tasks are waiting on your answer", "Agents are blocked on missing tools or permissions"])

    def test_empty_backlog_has_no_groups(self):
        triage = plugin_api.build_backlog_triage({"_tasks": [{"status": "ready"}]}, now=self.now)

        self.assertEqual(triage["groups"], [])
        self.assertEqual(plugin_api.backlog_findings(triage), [])


if __name__ == "__main__":
    unittest.main()
