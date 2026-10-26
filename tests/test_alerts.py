import argparse
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from dashboard import plugin_api

REPO = Path(__file__).resolve().parents[1]


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


class AlertsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)
        self.now = time.time()

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def _cron(self, jobs):
        (self.home / "cron").mkdir(exist_ok=True)
        (self.home / "cron" / "jobs.json").write_bytes(json.dumps({"jobs": jobs}).encode("utf-8"))

    def _sessions(self, rows):
        con = sqlite3.connect(self.home / "state.db")
        con.executescript("CREATE TABLE sessions (id TEXT, source TEXT, started_at REAL, ended_at REAL, last_activity_at REAL, tool_call_count INTEGER, actual_cost_usd REAL);")
        con.executemany("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
        con.commit()
        con.close()

    def _kanban(self):
        now = int(self.now)
        con = sqlite3.connect(self.home / "kanban.db")
        con.executescript(
            """
            CREATE TABLE tasks (id TEXT, title TEXT, status TEXT, assignee TEXT, created_at INTEGER,
              started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER);
            CREATE TABLE task_runs (id TEXT, task_id TEXT, profile TEXT, status TEXT, outcome TEXT,
              started_at INTEGER, ended_at INTEGER, error TEXT);
            """
        )
        con.execute("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ("t-stuck", "stuck task", "running", "default", now - 9000, now - 9000, None, now - 7200))
        con.execute("INSERT INTO task_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ("r-1", "t-stuck", "default", "failed", "crashed", now - 600, now - 300, "Traceback"))
        con.commit()
        con.close()

    def _seed_everything(self):
        self._cron([
            {"id": "job-err", "name": "digest", "enabled": True, "last_status": "error", "last_error": "Request timed out"},
            {"id": "job-late", "name": "sync", "enabled": True, "next_run_at": iso(self.now - 2 * 3600)},
            {"id": "job-paused", "name": "old", "enabled": False, "next_run_at": iso(self.now - 9 * 3600)},
            {"id": "job-fine", "name": "fine", "enabled": True, "next_run_at": iso(self.now + 600)},
        ])
        self._sessions([("sess-raw-xyz", "cli", self.now - 900, self.now - 600, self.now - 600, 72, 3.0)])
        self._kanban()

    def test_build_alerts_covers_cron_workers_loops_and_spend(self):
        self._seed_everything()
        scan = plugin_api.scan_hermes()
        today = datetime.fromtimestamp(self.now, tz=timezone.utc).date().isoformat()
        history = {"days": [{"day": f"2026-01-0{i}", "spend_24h": 0.5} for i in range(1, 7)] + [{"day": today, "spend_24h": 3.0}]}

        keys = {alert["key"].split(":")[0] for alert in plugin_api.build_alerts(scan, history, self.now)}

        self.assertEqual(keys, {"cron-failed", "cron-overdue", "worker-stalled", "worker-failed", "looping", "spend-spike"})
        texts = " ".join(alert["text"] for alert in plugin_api.build_alerts(scan, history, self.now))
        for raw in ("job-err", "digest", "stuck task", "sess-raw-xyz", "Traceback"):
            self.assertNotIn(raw, texts)
        self.assertIn("timeout (details hidden)", texts)

    def test_alerts_are_sent_once_until_they_clear_or_six_hours_pass(self):
        state = {}
        first = [{"key": "a", "severity": "critical", "text": "A"}, {"key": "b", "severity": "warning", "text": "B"}]

        self.assertEqual(len(plugin_api.select_new_alerts(first, state, 1000.0)), 2)
        self.assertEqual(plugin_api.select_new_alerts(first, state, 1060.0), [])
        self.assertEqual([a["key"] for a in plugin_api.select_new_alerts(first[:1], state, 1120.0)], [])
        self.assertNotIn("b", state)
        self.assertEqual([a["key"] for a in plugin_api.select_new_alerts(first, state, 1180.0)], ["b"])
        self.assertEqual([a["key"] for a in plugin_api.select_new_alerts(first, state, 1000.0 + plugin_api.ALERT_REPEAT_SECONDS)], ["a"])

    def test_report_records_state_in_plugin_data_and_preview_does_not(self):
        self._cron([{"id": "job-err", "name": "digest", "enabled": True, "last_status": "error", "last_error": "boom"}])

        preview = plugin_api.alert_report(preview=True)
        self.assertIn("Olympus: 1 new alert", preview)
        self.assertFalse((self.home / "plugin-data" / "olympus" / plugin_api.ALERTS_STATE_FILE).exists())

        self.assertIn("Cron job", plugin_api.alert_report())
        self.assertEqual(plugin_api.alert_report(), "")
        self.assertTrue((self.home / "plugin-data" / "olympus" / plugin_api.ALERTS_STATE_FILE).exists())

    def test_installed_script_runs_as_a_no_agent_cron_job_would(self):
        plugin_dir = self.home / "plugins" / "olympus"
        shutil.copytree(REPO / "dashboard", plugin_dir / "dashboard")
        shutil.copytree(REPO / "alerts", plugin_dir / "alerts")
        shutil.copyfile(REPO / "__init__.py", plugin_dir / "__init__.py")
        spec = importlib.util.spec_from_file_location("olympus_entry", plugin_dir / "__init__.py")
        entry = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(entry)
        parser = argparse.ArgumentParser(prog="hermes olympus")
        entry._setup(parser)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            entry._handle(parser.parse_args(["install-alerts", "--deliver", "telegram", "--every", "30m"]))
        self.assertIn('hermes cron create --no-agent --script olympus_alerts.py --name "Olympus alerts" --deliver telegram "30m"', out.getvalue())
        script = self.home / "scripts" / "olympus_alerts.py"
        self.assertTrue(script.exists())

        self._cron([{"id": "job-err", "name": "digest", "enabled": True, "last_status": "error", "last_error": "boom"}])
        env = {k: v for k, v in os.environ.items() if k not in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        first = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, env=env, cwd=str(self.home))
        second = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, env=env, cwd=str(self.home))

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("Olympus: 1 new alert", first.stdout)
        self.assertEqual(second.stdout, "")


if __name__ == "__main__":
    unittest.main()
