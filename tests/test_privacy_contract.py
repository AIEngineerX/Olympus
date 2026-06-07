import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from dashboard import plugin_api


class PrivacyContractTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.old_home = os.environ.get("HERMES_HOME")
        self.old_kanban = os.environ.get("HERMES_KANBAN_HOME")
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)

    def tearDown(self):
        if self.old_home is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self.old_home
        if self.old_kanban is None:
            os.environ.pop("HERMES_KANBAN_HOME", None)
        else:
            os.environ["HERMES_KANBAN_HOME"] = self.old_kanban
        self.tmp.cleanup()

    def test_cron_ids_are_public_refs_when_local_labels_are_hidden(self):
        cron_dir = self.home / "cron"
        cron_dir.mkdir(parents=True)
        (cron_dir / "jobs.json").write_text(json.dumps({
            "jobs": [{
                "id": "raw-cron-job-123",
                "name": "private cron name",
                "enabled": True,
                "profile": "default",
            }]
        }))

        payload = plugin_api.collect_cron([])
        serialized = json.dumps(payload)

        self.assertNotIn("raw-cron-job-123", serialized)
        self.assertIn("cron:", payload[0]["id"])
        self.assertEqual(payload[0]["id"], payload[0]["job_id"])

    def test_kanban_worker_run_and_pid_ids_are_public_refs_when_local_labels_are_hidden(self):
        db = self.home / "kanban.db"
        con = sqlite3.connect(db)
        now = int(time.time())
        con.executescript(
            """
            CREATE TABLE tasks (
              id TEXT, title TEXT, status TEXT, assignee TEXT, priority INTEGER,
              created_at INTEGER, started_at INTEGER, completed_at INTEGER,
              consecutive_failures INTEGER, last_failure_error TEXT,
              worker_pid INTEGER, claim_expires INTEGER, last_heartbeat_at INTEGER,
              current_run_id TEXT, max_runtime_seconds INTEGER, session_id TEXT
            );
            CREATE TABLE task_runs (
              id TEXT, task_id TEXT, profile TEXT, step_key TEXT, status TEXT,
              outcome TEXT, worker_pid INTEGER, last_heartbeat_at INTEGER,
              started_at INTEGER, ended_at INTEGER, error TEXT, summary TEXT
            );
            CREATE TABLE task_events (
              id TEXT, task_id TEXT, run_id TEXT, kind TEXT, created_at INTEGER
            );
            """
        )
        con.execute(
            "INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "raw-task-id-abc", "private task", "running", "default", 0,
                now - 60, now - 30, None, 0, None, 43210, now + 600,
                now - 10, "raw-current-run-abc", 3600, "raw-session-abc",
            ),
        )
        con.execute(
            "INSERT INTO task_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "raw-run-id-abc", "raw-task-id-abc", "default", "step",
                "running", None, 54321, now - 5, now - 30, None, None, None,
            ),
        )
        con.execute(
            "INSERT INTO task_events VALUES (?, ?, ?, ?, ?)",
            ("raw-event-id-abc", "raw-task-id-abc", "raw-run-id-abc", "claimed", now),
        )
        con.commit()
        con.close()

        payload = plugin_api.collect_kanban([{"name": "default", "_public_name": "default", "gateway_state": "running"}])
        serialized = json.dumps(payload)

        for raw in ("raw-task-id-abc", "raw-current-run-abc", "raw-run-id-abc", "raw-event-id-abc", "43210", "54321"):
            self.assertNotIn(raw, serialized)
        for raw_key in ('"worker_pid"', '"current_run_id"'):
            self.assertNotIn(raw_key, serialized)
        self.assertIn("run:", serialized)
        self.assertIn("pid:", serialized)

    def test_log_tail_warnings_are_not_described_as_recent(self):
        logs = self.home / "logs"
        logs.mkdir(parents=True)
        (logs / "agent.log").write_text("old line: failed to connect\n")

        health = plugin_api.collect_health([{"gateway_state": "running"}], [])

        self.assertIn("Log tail", health["summary"])
        self.assertNotIn("Recent Hermes logs", health["summary"])
        self.assertEqual(health["log_scan_window"], "last 8KB per log file")


if __name__ == "__main__":
    unittest.main()
