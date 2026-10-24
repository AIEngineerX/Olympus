import hashlib
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from dashboard import plugin_api

DAY = 86400


def values(**overrides):
    base = {name: 0 for name in plugin_api.SNAPSHOT_FIELDS}
    base.update(spend_24h=0.0, median_run=None)
    base.update(overrides)
    return base


class HistoryStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)
        self.con = plugin_api.history_db()

    def tearDown(self):
        self.con.close()
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def test_history_lives_in_the_plugin_data_directory(self):
        self.assertTrue((self.home / "plugin-data" / "olympus" / plugin_api.HISTORY_DB).exists())

    def test_snapshot_writes_are_throttled_within_a_day(self):
        now = 1_800_000_000.0
        self.assertTrue(plugin_api.record_snapshot(self.con, values(score=70), now))
        self.assertFalse(plugin_api.record_snapshot(self.con, values(score=60), now + 60))
        self.assertTrue(plugin_api.record_snapshot(self.con, values(score=65), now + plugin_api.SNAPSHOT_MIN_INTERVAL_SECONDS + 1))

        rows = self.con.execute("SELECT day, score FROM snapshots").fetchall()
        self.assertEqual([(r["day"], r["score"]) for r in rows], [(rows[0]["day"], 65)])

    def test_trend_reports_the_score_change_over_seven_days(self):
        now = 1_800_000_000.0
        for days_ago, score in ((8, 40), (7, 55), (3, 60), (0, 72)):
            plugin_api.record_snapshot(self.con, values(score=score), now - days_ago * DAY)

        history = plugin_api.read_history(self.con, now)

        self.assertEqual([d["score"] for d in history["days"]], [40, 55, 60, 72])
        self.assertEqual(history["score_change_7d"], 72 - 55)

    def test_snapshots_older_than_retention_are_pruned(self):
        now = 1_800_000_000.0
        plugin_api.record_snapshot(self.con, values(score=10), now - (plugin_api.HISTORY_RETENTION_DAYS + 5) * DAY)
        plugin_api.record_snapshot(self.con, values(score=90), now)

        self.assertEqual(self.con.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0], 1)

    def test_fix_verdicts_compare_the_marked_count_with_the_current_scan(self):
        def item(key, count):
            return {"key": key, "title": key, "kind": "skill", "count": count}

        for key, count in (("improved", 4), ("worse", 1), ("same", 2), ("gone", 3), ("presence", None)):
            plugin_api.mark_fix(self.con, item(key, count), now=1_800_000_000.0)
        tuning = {"agent_hq": {"recommendations": [item("improved", 1), item("worse", 3), item("same", 2), item("presence", None)]}}

        verdicts = {f["key"]: f["verdict"] for f in plugin_api.build_fix_tracking(self.con, tuning, now=1_800_000_000.0 + 2 * DAY)}

        self.assertEqual(verdicts, {"improved": "improved", "worse": "worse", "same": "unchanged", "gone": "cleared", "presence": "still present"})


class FixTrackingRouteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)
        now = time.time()
        con = sqlite3.connect(self.home / "state.db")
        con.executescript(
            "CREATE TABLE sessions (id TEXT, source TEXT, started_at REAL, ended_at REAL, last_activity_at REAL, tool_call_count INTEGER, message_count INTEGER);"
        )
        con.executemany("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)", [
            ("loop-a", "cli", now - 600, now - 300, now - 300, 55, 4),
            ("loop-b", "cli", now - 900, now - 800, now - 800, 61, 4),
        ])
        con.commit()
        con.close()

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def _state_hash(self):
        return hashlib.sha256((self.home / "state.db").read_bytes()).hexdigest()

    def test_overview_records_history_without_touching_hermes_state(self):
        before = self._state_hash()

        payload = plugin_api.overview()

        self.assertEqual(self._state_hash(), before)
        self.assertEqual(payload["history"]["recorded_days"], 1)
        self.assertEqual(payload["fixes"], [])

    def test_marking_a_finding_fixed_then_clearing_it(self):
        key = plugin_api.tuning_key("skill", "An agent is looping or tool-thrashing")

        self.assertEqual(plugin_api.track_fix("not-a-current-finding"), {"tracked": False, "reason": "finding not in the current scan"})
        result = plugin_api.track_fix(key)
        self.assertTrue(result["tracked"])
        self.assertEqual(result["fixes"][0]["baseline"], 2)
        self.assertEqual(result["fixes"][0]["verdict"], "unchanged")

        con = sqlite3.connect(self.home / "state.db")
        con.execute("UPDATE sessions SET tool_call_count = 3")
        con.commit()
        con.close()

        fixes = plugin_api.overview()["fixes"]
        self.assertEqual((fixes[0]["key"], fixes[0]["verdict"], fixes[0]["current"]), (key, "cleared", 0))

        plugin_api.untrack_fix(key)
        self.assertEqual(plugin_api.overview()["fixes"], [])


if __name__ == "__main__":
    unittest.main()
