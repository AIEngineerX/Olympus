import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from dashboard import plugin_api


class FleetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)
        now = time.time()
        (self.home / "profile.yaml").write_bytes(b"description: Coordinates the team and writes release notes\n")
        coder = self.home / "profiles" / "coder"
        coder.mkdir(parents=True)
        (coder / "profile.yaml").write_bytes(b"description: Fixes bugs\ndescription_auto: true\n")
        (self.home / "profiles" / "ops").mkdir()
        for home, rows in ((self.home, [("a", now - 600, 0.5), ("b", now - 300, 0.25)]), (coder, [("c", now - 100, 1.0)])):
            con = sqlite3.connect(home / "state.db")
            con.execute("CREATE TABLE sessions (id TEXT, source TEXT, started_at REAL, ended_at REAL, last_activity_at REAL, actual_cost_usd REAL)")
            con.executemany("INSERT INTO sessions VALUES (?, 'cli', ?, ?, ?, ?)", [(i, ts - 60, ts, ts, cost) for i, ts, cost in rows])
            con.commit()
            con.close()
        con = sqlite3.connect(self.home / "kanban.db")
        con.executescript("CREATE TABLE tasks (id TEXT, title TEXT, status TEXT, assignee TEXT, created_at INTEGER);")
        con.execute("INSERT INTO tasks VALUES ('t1', 'ship it', 'ready', 'coder', ?)", (int(now),))
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

    def test_fleet_rows_join_role_route_work_and_spend(self):
        scan = plugin_api.scan_hermes()

        rows = {row["id"]: row for row in scan["fleet"]["profiles"]}
        default = rows["profile:default"]
        self.assertEqual((default["role_state"], default["role"]), ("described", None))
        self.assertEqual((default["sessions_7d"], default["spend_7d_usd"]), (2, 0.75))
        coder = next(row for row in rows.values() if row["sessions_7d"] == 1)
        self.assertEqual((coder["role_state"], coder["open"], coder["spend_7d_usd"]), ("auto", 1, 1.0))
        self.assertEqual(scan["fleet"]["summary"], {"profiles": 3, "needs_review": scan["fleet"]["summary"]["needs_review"], "roles_missing": 1, "roles_unreviewed": 1})
        self.assertNotIn("release notes", json.dumps(scan["fleet"]))

    def test_role_text_appears_only_when_labels_are_exposed(self):
        plugin_api.EXPOSE_LOCAL_LABELS = True

        role = plugin_api.profile_role(self.home)

        self.assertEqual(role, {"role_state": "described", "role": "Coordinates the team and writes release notes"})

    def test_missing_roles_become_a_finding_once_work_is_routed(self):
        scan = plugin_api.scan_hermes()

        titles = [item["title"] for item in scan["tuning"]["agent_hq"]["recommendations"]]
        self.assertIn("Describe each profile's role", titles)


if __name__ == "__main__":
    unittest.main()
