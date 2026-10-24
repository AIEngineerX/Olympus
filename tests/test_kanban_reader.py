import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from dashboard import plugin_api

PROFILES = [{"name": "default", "_public_name": "default", "gateway_state": "running", "state": "active"}]


def write_board(db: Path, tasks, runs=()):
    db.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db)
    con.executescript(
        """
        CREATE TABLE tasks (
          id TEXT, title TEXT, status TEXT, assignee TEXT, priority INTEGER,
          created_at INTEGER, started_at INTEGER, completed_at INTEGER,
          consecutive_failures INTEGER, last_heartbeat_at INTEGER, claim_expires INTEGER
        );
        CREATE TABLE task_runs (
          id TEXT, task_id TEXT, profile TEXT, status TEXT, outcome TEXT,
          started_at INTEGER, ended_at INTEGER, error TEXT
        );
        """
    )
    con.executemany("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", tasks)
    con.executemany("INSERT INTO task_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)", runs)
    con.commit()
    con.close()


def done_task(task_id, ts):
    return (task_id, task_id, "done", "default", 0, ts - 60, ts - 30, ts, 0, None, None)


class KanbanReaderTest(unittest.TestCase):
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
        self.tmp.cleanup()

    def test_missing_board_database_is_reported_missing_not_healthy(self):
        kanban = plugin_api.collect_kanban(PROFILES)

        self.assertEqual(kanban["boards"][0]["state"], "missing")
        self.assertEqual(plugin_api.kanban_store_state(kanban), "missing")
        evidence = plugin_api.build_evidence_sources(PROFILES, [], [], [], kanban)
        source = next(item for item in evidence["items"] if item["id"] == "hermes_kanban")
        self.assertFalse(source["present"])
        self.assertEqual(source["state"], "missing")

    def test_unreadable_board_database_is_an_error_with_attention(self):
        (self.home / "kanban.db").write_bytes(b"this is not a sqlite database" * 64)

        kanban = plugin_api.collect_kanban(PROFILES)

        board = kanban["boards"][0]
        self.assertEqual(board["state"], "error")
        self.assertTrue(board["error"])
        self.assertEqual(plugin_api.kanban_store_state(kanban), "warning")
        self.assertTrue(any("Could not read Kanban board" in item["label"] for item in kanban["attention"]))
        evidence = plugin_api.build_evidence_sources(PROFILES, [], [], [], kanban)
        source = next(item for item in evidence["items"] if item["id"] == "hermes_kanban")
        self.assertEqual(source["state"], "warning")

    def test_old_running_task_survives_many_newer_completed_tasks(self):
        now = int(time.time())
        tasks = [done_task(f"done-{i}", now - i) for i in range(450)]
        tasks.append(("old-running", "old running", "running", "default", 0, now - 7200, now - 7000, None, 0, now - 5000, None))
        write_board(self.home / "kanban.db", tasks)

        kanban = plugin_api.collect_kanban(PROFILES)

        running = [t for t in kanban["_tasks"] if t["status"] == "running"]
        self.assertEqual(len(running), 1)
        self.assertTrue(any("Stale running task" in item["label"] for item in kanban["attention"]))
        closed = [t for t in kanban["_tasks"] if t["status"] == "done"]
        self.assertEqual(len(closed), plugin_api.KANBAN_CLOSED_TASK_SAMPLE)

    def test_later_boards_are_not_hidden_behind_the_default_board(self):
        now = int(time.time())
        write_board(self.home / "kanban.db", [done_task(f"default-{i}", now - 3600 - i) for i in range(20)])
        named = self.home / "kanban" / "boards" / "ops" / "kanban.db"
        write_board(
            named,
            [("ops-running", "ops running", "running", "default", 0, now - 120, now - 60, None, 0, now - 5, None)],
            [("run-failed", "ops-running", "default", "failed", "crashed", now - 50, now - 40, "Traceback")],
        )

        kanban = plugin_api.collect_kanban(PROFILES)

        ops_board = next(b for b in kanban["boards"] if b.get("_slug") == "ops")
        self.assertIn(ops_board["slug"], {t["board"] for t in kanban["_tasks"] if t["status"] == "running"})
        self.assertEqual(kanban["recent_tasks"][0]["board"], ops_board["slug"])
        self.assertEqual(len(kanban["recent_tasks"]), plugin_api.KANBAN_DISPLAY_SAMPLE)
        self.assertEqual([r["outcome"] for r in kanban["_runs"]], ["crashed"])
        orchestration = plugin_api.build_orchestration(kanban)
        self.assertGreaterEqual(int(orchestration["summary"].get("failed_runs") or 0), 1)

    def test_in_flight_runs_are_read_even_when_many_runs_finished_later(self):
        now = int(time.time())
        runs = [(f"finished-{i}", "t", "default", "done", "completed", now - 100 + i, now - 50 + i, None) for i in range(150)]
        runs.append(("in-flight", "t", "default", "running", None, now - 10_000, None, None))
        write_board(self.home / "kanban.db", [("t", "t", "running", "default", 0, now - 10_000, now - 10_000, None, 0, now - 5, None)], runs)

        kanban = plugin_api.collect_kanban(PROFILES)

        self.assertEqual(len(kanban["active_workers"]), 1)
        self.assertEqual(len(kanban["_runs"]), 1 + plugin_api.KANBAN_FINISHED_RUN_SAMPLE)


    def test_minimal_schema_with_one_timestamp_column_still_reads(self):
        # SQLite COALESCE needs two arguments; a schema with only created_at
        # must not fail the whole board scan.
        con = sqlite3.connect(self.home / "kanban.db")
        con.executescript("CREATE TABLE tasks (id TEXT, title TEXT, status TEXT, assignee TEXT, created_at INTEGER);")
        con.execute("INSERT INTO tasks VALUES ('t1', 'x', 'ready', 'default', 1)")
        con.execute("INSERT INTO tasks VALUES ('t2', 'y', 'done', 'default', 2)")
        con.commit()
        con.close()

        kanban = plugin_api.collect_kanban(PROFILES)

        self.assertNotIn("error", kanban["boards"][0])
        self.assertEqual(sorted(t["status"] for t in kanban["_tasks"]), ["done", "ready"])
        self.assertEqual(kanban["assignee_load"][0]["open"], 1)


if __name__ == "__main__":
    unittest.main()
