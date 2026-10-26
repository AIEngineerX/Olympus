import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from dashboard import plugin_api


class ProfileRoleTest(unittest.TestCase):
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


    def test_role_text_appears_only_when_labels_are_exposed(self):
        plugin_api.EXPOSE_LOCAL_LABELS = True

        role = plugin_api.profile_role(self.home)

        self.assertEqual(role, {"role_state": "described", "role": "Coordinates the team and writes release notes"})



if __name__ == "__main__":
    unittest.main()
