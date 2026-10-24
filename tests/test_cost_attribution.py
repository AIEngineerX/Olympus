import json
import os
import sqlite3
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from dashboard import plugin_api


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


class CostAttributionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)
        self.now = time.time()
        con = sqlite3.connect(self.home / "state.db")
        con.executescript(
            """
            CREATE TABLE sessions (id TEXT, source TEXT, started_at REAL, ended_at REAL, last_activity_at REAL,
              actual_cost_usd REAL, estimated_cost_usd REAL);
            CREATE TABLE session_model_usage (session_id TEXT, model TEXT, task TEXT, api_call_count INTEGER,
              input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
              actual_cost_usd REAL, estimated_cost_usd REAL, first_seen REAL, last_seen REAL);
            """
        )
        now = self.now
        con.executemany("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)", [
            ("cron-1", "cron", now - 3600, now - 3500, now - 3500, 2.0, None),
            ("cron-2", "cron", now - 7200, now - 7100, now - 7100, None, 2.0),
            ("cron-old", "cron", now - 30 * 86400, now - 30 * 86400, now - 30 * 86400, 50.0, None),
            ("chat-1", "cli", now - 600, now - 500, now - 500, 1.0, None),
        ])
        con.executemany("INSERT INTO session_model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            ("chat-1", "m", "background_review", 4, 1000, 200, 0, 0, 0.0, 0.6, now - 600, now - 500),
            ("chat-1", "m", "", 10, 5000, 900, 0, 0, 0.4, 0.0, now - 600, now - 500),
            ("chat-1", "m", "title_generation", 1, 100, 10, 0, 0, 0.02, 0.0, now - 40 * 86400, now - 40 * 86400),
        ])
        con.commit()
        con.close()
        (self.home / "cron").mkdir()
        (self.home / "cron" / "jobs.json").write_bytes(json.dumps({"jobs": [
            {"id": "job-big", "name": "nightly digest", "enabled": True},
            {"id": "job-small", "name": "uptime ping", "enabled": True},
        ]}).encode("utf-8"))
        audit = [
            {"ts": iso(now - 3600), "job_id": "job-big", "total_tokens": 30000, "duration_ms": 40000, "error": None},
            {"ts": iso(now - 7200), "job_id": "job-big", "total_tokens": 50000, "duration_ms": 50000, "error": "timed out"},
            {"ts": iso(now - 1800), "job_id": "job-small", "prompt_tokens": 15000, "completion_tokens": 5000, "duration_ms": 2000, "response_silent": True},
            {"ts": iso(now - 20 * 86400), "job_id": "job-small", "total_tokens": 999999},
        ]
        (self.home / "cron" / "usage_audit.jsonl").write_bytes(
            ("\n".join(json.dumps(line) for line in audit) + "\nnot json\n").encode("utf-8")
        )

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def _attribution(self):
        profiles = plugin_api.collect_profiles()
        cron = plugin_api.collect_cron(profiles)
        since = self.now - plugin_api.SESSION_WINDOW_DAYS * 86400
        sessions = plugin_api.collect_sessions(200, profiles, since=since)
        return plugin_api.collect_cost_attribution(profiles, cron, sessions, since)

    def test_cron_cost_is_shared_across_jobs_by_token_share(self):
        attribution = self._attribution()

        cron = attribution["cron"]
        self.assertEqual(cron["total_cost_usd"], 4.0)
        jobs = {job["label"]: job for job in cron["jobs"]}
        big = jobs[plugin_api.public_ref("job-big", "cron")]
        small = jobs[plugin_api.public_ref("job-small", "cron")]
        self.assertEqual((big["fires"], big["tokens"], big["errors"], big["est_cost_usd"]), (2, 80000, 1, 3.2))
        self.assertEqual((small["fires"], small["tokens"], small["silent_runs"], small["est_cost_usd"]), (1, 20000, 1, 0.8))
        self.assertEqual(big["avg_duration_seconds"], 45.0)
        self.assertEqual(cron["jobs"][0]["label"], big["label"])

    def test_background_tasks_are_grouped_and_windowed(self):
        background = self._attribution()["background"]

        self.assertEqual(background["tasks"], [{"task": "background_review", "calls": 4, "tokens": 1200, "cost_usd": 0.6}])
        self.assertEqual(background["total_cost_usd"], 0.6)

    def test_a_dominant_cron_job_becomes_a_finding(self):
        findings = plugin_api.cost_findings(self._attribution())

        titles = [item["title"] for item in findings]
        self.assertIn("One scheduled job drives most cron spend", titles)
        finding = findings[titles.index("One scheduled job drives most cron spend")]
        self.assertIn("80%", finding["detail"])
        self.assertEqual(finding["recommended_view"], "/cron")

    def test_attribution_does_not_leak_raw_job_ids_or_names(self):
        serialized = json.dumps(self._attribution())

        for raw in ("job-big", "job-small", "nightly digest", "uptime ping"):
            self.assertNotIn(raw, serialized)


if __name__ == "__main__":
    unittest.main()
