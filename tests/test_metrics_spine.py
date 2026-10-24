import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from dashboard import plugin_api


class MetricsSpineTest(unittest.TestCase):
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

    def _write_state_db(self, home: Path, rows):
        home.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(home / "state.db")
        con.executescript(
            """
            CREATE TABLE sessions (
              id TEXT, source TEXT, started_at REAL, ended_at REAL, end_reason TEXT,
              message_count INTEGER, tool_call_count INTEGER, api_call_count INTEGER,
              input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
              cache_read_tokens INTEGER, cache_write_tokens INTEGER,
              estimated_cost_usd REAL, actual_cost_usd REAL, title TEXT
            );
            """
        )
        con.executemany(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        con.commit()
        con.close()

    def _write_usage(self, home: Path, data):
        path = home / "skills" / ".usage.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))

    def test_collect_profiles_discovers_siblings_when_home_is_profile_dir(self):
        root = self.home
        default_home = root / "profiles" / "default"
        alpha_home = root / "profiles" / "alpha"
        default_home.mkdir(parents=True, exist_ok=True)
        alpha_home.mkdir(parents=True, exist_ok=True)
        old_home = os.environ["HERMES_HOME"]
        os.environ["HERMES_HOME"] = str(default_home)
        try:
            profiles = plugin_api.collect_profiles()
        finally:
            os.environ["HERMES_HOME"] = old_home
        public = {profile.get("_public_name") for profile in profiles}
        self.assertIn("default", public)
        self.assertIn("profile_1", public)
        self.assertGreaterEqual(len(profiles), 2)

    def test_usage_rollup_is_profile_scoped_and_cost_confidence_is_partial(self):
        now = time.time()
        profile_home = self.home / "profiles" / "alpha"
        self._write_state_db(self.home, [
            ("raw-session-1", "cli", now - 60, now - 10, "completed", 4, 3, 2, 1000, 200, 0, 0, 0, 0.05, None, "private title"),
            ("raw-session-2", "cli", now - 60, None, None, 3, 2, 1, 900, 100, 0, 0, 0, 0.0, None, "open title"),
        ])
        self._write_state_db(profile_home, [
            ("raw-session-3", "telegram", now - 60, now - 5, "completed", 5, 4, 2, 0, 0, 0, 0, 0, 0.0, None, "zero usage"),
        ])
        profiles = [
            {"label": "Default", "_public_name": "default", "_path": str(self.home), "state": "active", "skill_count": 1},
            {"label": "Profile 1", "_public_name": "profile_1", "_path": str(profile_home), "state": "idle", "skill_count": 1},
        ]

        rollup = plugin_api.collect_usage_rollup(profiles, days=30)
        serialized = json.dumps(rollup)

        self.assertEqual(rollup["sessions"], 3)
        self.assertEqual(rollup["api_calls"], 5)
        self.assertEqual(rollup["total_tokens"], 2200)
        self.assertEqual(rollup["zero_usage_suspect_sessions"], 1)
        self.assertEqual(rollup["zero_cost_token_sessions"], 1)
        self.assertEqual(rollup["cost_confidence"], "partial")
        self.assertNotIn("raw-session", serialized)
        self.assertNotIn("private title", serialized)

    def test_skill_metadata_reads_profile_usage_without_raw_skill_names(self):
        now = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
        profile_home = self.home / "profiles" / "alpha"
        self._write_usage(self.home, {
            "private-default-skill": {"created_by": "agent", "created_at": now, "use_count": 2, "view_count": 3, "patch_count": 0, "last_used_at": now},
        })
        self._write_usage(profile_home, {
            "private-alpha-skill": {"created_at": now, "use_count": 0, "view_count": 1, "patch_count": 1, "last_patched_at": now},
        })
        profiles = [
            {"label": "Default", "_public_name": "default", "_path": str(self.home)},
            {"label": "Profile 1", "_public_name": "profile_1", "_path": str(profile_home)},
        ]

        metadata = plugin_api.collect_skill_metadata(profiles)
        serialized = json.dumps(plugin_api.strip_internal(metadata))

        self.assertEqual(metadata["summary"]["usage_sources"], 2)
        self.assertEqual(metadata["summary"]["total_skills"], 2)
        self.assertEqual(metadata["summary"]["agent_created"], 1)
        self.assertEqual(metadata["summary"]["never_used"], 1)
        self.assertIn("profile_1", serialized)
        self.assertNotIn("private-default-skill", serialized)
        self.assertNotIn("private-alpha-skill", serialized)

    def test_metrics_spine_exposes_operational_metrics_not_raw_ledgers(self):
        now = time.time()
        self._write_state_db(self.home, [
            ("raw-session-1", "cli", now - 60, now - 10, "completed", 4, 25, 2, 1000, 200, 0, 0, 0, 0.0, None, "private title"),
        ])
        self._write_usage(self.home, {
            "private-skill": {"created_by": "agent", "created_at": now, "use_count": 0, "view_count": 1, "patch_count": 0},
        })
        profiles = [{"label": "Default", "_public_name": "default", "_path": str(self.home), "state": "active", "skill_count": 1}]
        sessions = [{"state": "completed", "tool_call_count": 25, "message_count": 4, "avg_input_tokens": 500, "duration_seconds": 10}]
        kanban = {"boards": [], "totals": {"blocked": 1, "ready": 0, "running": 0}, "open": 1}
        skill_metadata = plugin_api.collect_skill_metadata(profiles)
        skill_coverage = {"summary": {"forced_skill_tasks": 0}}
        skill_hygiene = plugin_api.build_skill_hygiene(skill_metadata, skill_coverage, kanban)
        profile_fitness = {"summary": {"needs_review": 0, "average_score": 100}}
        performance = plugin_api.build_performance_tracking(sessions, kanban)
        ops_evals = {"summary": {"state": "ok", "score": 100}, "items": []}
        config_policy = {"summary": {"toolsets": 4, "max_turns": 90, "auxiliary_routes": 1}}
        rollup = plugin_api.collect_usage_rollup(profiles)

        spine = plugin_api.build_metrics_spine(
            profiles, sessions, kanban, skill_metadata, skill_coverage,
            skill_hygiene, profile_fitness, performance, ops_evals,
            config_policy, rollup,
        )
        serialized = json.dumps(plugin_api.strip_internal(spine))

        self.assertEqual(spine["schema_version"], "olympus.metrics_spine.v1")
        self.assertEqual(spine["window"]["ledger_owner"], "/analytics")
        self.assertEqual(spine["coverage"]["config_grounding"]["toolsets"], 4)
        self.assertEqual(spine["coverage"]["config_grounding"]["auxiliary_routes"], 1)
        self.assertNotIn("enabled_toolsets", spine["coverage"]["config_grounding"])
        self.assertEqual(spine["usage"]["cost_confidence"], "missing")
        self.assertEqual(spine["skills"]["agent_created"], 1)
        self.assertIn("Hermes Analytics owns raw usage and cost ledgers", spine["usage"]["note"])
        self.assertNotIn("raw-session-1", serialized)
        self.assertNotIn("private title", serialized)
        self.assertNotIn("private-skill", serialized)
        self.assertNotIn(str(self.home), serialized)
        self.assertNotIn("daily_bars", serialized)
        self.assertNotIn("leaderboard", serialized.lower())

    def test_metrics_spine_sources_stale_workers_from_orchestration(self):
        # Regression: stale_workers is produced by build_orchestration().summary,
        # never by the collect_kanban dict, so build_metrics_spine must read it
        # from the orchestration it is handed. With the bug it was always 0.
        profiles = [{"label": "Default", "_public_name": "default", "_path": str(self.home), "state": "active", "skill_count": 1}]
        sessions = [{"state": "completed", "tool_call_count": 1, "message_count": 1, "avg_input_tokens": 10, "duration_seconds": 5}]
        kanban = {"boards": [], "totals": {"blocked": 0, "ready": 1, "running": 1}, "open": 2}  # no stale_workers key
        orchestration = {"summary": {"stale_workers": 2, "blocked": 0}}

        spine = plugin_api.build_metrics_spine(
            profiles, sessions, kanban,
            plugin_api.collect_skill_metadata(profiles),
            {"summary": {"forced_skill_tasks": 0}},
            {"summary": {}},
            {"summary": {"needs_review": 0, "average_score": 100}},
            plugin_api.build_performance_tracking(sessions, kanban),
            {"summary": {"state": "ok", "score": 100}, "items": []},
            {"summary": {"toolsets": 0, "max_turns": 0, "auxiliary_routes": 0}},
            plugin_api.collect_usage_rollup(profiles),
            orchestration=orchestration,
        )

        self.assertEqual(spine["work"]["stale_workers"], 2)


    def test_usage_rollup_counts_cached_prompt_tokens_like_hermes(self):
        # Hermes CanonicalUsage: prompt = input + cache_read + cache_write,
        # total = prompt + output; reasoning is part of output, not added.
        now = time.time()
        self._write_state_db(self.home, [
            ("s1", "cli", now - 60, now - 10, "completed", 4, 3, 2, 1000, 1000, 500, 99000, 0, 0.5, None, "t"),
        ])
        profiles = [{"label": "Default", "_public_name": "default", "_path": str(self.home)}]

        rollup = plugin_api.collect_usage_rollup(profiles, days=30)

        self.assertEqual(rollup["total_tokens"], 101000)

    def test_usage_rollup_counts_each_costed_session_once(self):
        now = time.time()
        self._write_state_db(self.home, [
            ("s1", "cli", now - 60, now - 10, "completed", 4, 3, 2, 1000, 200, 0, 0, 0, 0.04, 0.05, "both costs"),
            ("s2", "cli", now - 60, now - 10, "completed", 4, 3, 2, 1000, 200, 0, 0, 0, 0.03, None, "estimate only"),
        ])
        profiles = [{"label": "Default", "_public_name": "default", "_path": str(self.home)}]

        rollup = plugin_api.collect_usage_rollup(profiles, days=30)

        self.assertEqual(rollup["costed_sessions"], 2)
        self.assertEqual(rollup["actual_costed_sessions"], 1)
        self.assertEqual(rollup["estimated_costed_sessions"], 1)
        self.assertEqual(rollup["cost_confidence"], "estimated")

    def test_one_actual_cost_session_does_not_hide_uncosted_token_sessions(self):
        now = time.time()
        self._write_state_db(self.home, [
            ("s1", "cli", now - 60, now - 10, "completed", 4, 3, 2, 1000, 200, 0, 0, 0, None, 0.05, "actual"),
            ("s2", "cli", now - 60, now - 10, "completed", 4, 3, 2, 1000, 200, 0, 0, 0, None, None, "no cost"),
        ])
        profiles = [{"label": "Default", "_public_name": "default", "_path": str(self.home)}]

        rollup = plugin_api.collect_usage_rollup(profiles, days=30)

        self.assertEqual(rollup["costed_sessions"], 1)
        self.assertEqual(rollup["cost_confidence"], "partial")
        self.assertEqual(rollup["state"], "warning")

    def test_all_actual_cost_coverage_reports_actual(self):
        now = time.time()
        self._write_state_db(self.home, [
            ("s1", "cli", now - 60, now - 10, "completed", 4, 3, 2, 1000, 200, 0, 0, 0, None, 0.05, "actual"),
        ])
        profiles = [{"label": "Default", "_public_name": "default", "_path": str(self.home)}]

        self.assertEqual(plugin_api.collect_usage_rollup(profiles, days=30)["cost_confidence"], "actual")

    def _write_live_sessions(self, rows):
        con = sqlite3.connect(self.home / "state.db")
        con.executescript(
            """
            CREATE TABLE sessions (
              id TEXT, source TEXT, started_at REAL, ended_at REAL, last_activity_at REAL,
              message_count INTEGER, tool_call_count INTEGER, api_call_count INTEGER,
              input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
              cache_read_tokens INTEGER, cache_write_tokens INTEGER, title TEXT
            );
            """
        )
        con.executemany("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
        con.commit()
        con.close()

    def test_session_tokens_and_context_pressure_include_cache_buckets(self):
        now = time.time()
        self._write_live_sessions([
            ("s1", "cli", now - 600, now - 10, now - 10, 4, 3, 2, 1000, 1000, 500, 99000, 0, "t"),
        ])

        session = plugin_api.collect_sessions()[0]

        self.assertEqual(session["prompt_tokens"], 100000)
        self.assertEqual(session["total_tokens"], 101000)
        self.assertEqual(session["avg_input_tokens"], 50000)

    def test_long_running_session_with_recent_activity_is_active_and_sorted_first(self):
        now = time.time()
        self._write_live_sessions([
            ("newer-idle", "cli", now - 3 * 3600, now - 3 * 3600 + 30, now - 3 * 3600 + 30, 1, 0, 1, 10, 10, 0, 0, 0, "idle"),
            ("long-running", "cli", now - 5 * 86400, None, now - 30, 50, 20, 30, 10, 10, 0, 0, 0, "busy"),
        ])

        sessions = plugin_api.collect_sessions()

        self.assertEqual(sessions[0]["session_ref"], plugin_api.safe_id("long-running", "session"))
        self.assertEqual(sessions[0]["state"], "active")
        self.assertEqual(sessions[1]["state"], "completed")


    def _named_profile_layout(self):
        # Hermes layout: the root is the default profile; named profiles live
        # in <root>/profiles/<name>, each with its own cron and state stores.
        (self.home / "config.yaml").write_bytes(b"model: {}\n")
        coder = self.home / "profiles" / "coder"
        li = self.home / "profiles" / "li"
        for home in (coder, li):
            home.mkdir(parents=True)
        (self.home / "profiles" / ".deleted").mkdir()
        return coder, li

    def test_launching_from_a_named_profile_keeps_its_identity_and_the_root(self):
        coder, _li = self._named_profile_layout()
        os.environ["HERMES_HOME"] = str(coder)

        profiles = plugin_api.collect_profiles()

        by_name = {p["name"]: p for p in profiles}
        self.assertEqual(sorted(by_name), ["coder", "default", "li"])
        self.assertEqual(Path(by_name["default"]["_path"]), self.home)
        self.assertTrue(by_name["coder"]["dashboard_home"])
        self.assertFalse(by_name["default"]["dashboard_home"])

    def test_cron_and_sessions_are_read_from_every_profile_store(self):
        coder, li = self._named_profile_layout()
        now = time.time()
        for home, job_id in ((self.home, "root-job"), (coder, "coder-job")):
            (home / "cron").mkdir(parents=True)
            (home / "cron" / "jobs.json").write_bytes(json.dumps({"jobs": [
                {"id": job_id, "name": job_id, "enabled": True, "last_status": "error", "last_error": "Request timed out"},
            ]}).encode("utf-8"))
        self._write_state_db(self.home, [
            ("root-cli", "cli", now - 60, now - 10, "completed", 4, 45, 2, 10, 10, 0, 0, 0, 0.0, None, "t"),
        ])
        self._write_state_db(coder, [
            ("coder-tg", "telegram", now - 30, now - 5, "completed", 4, 3, 2, 10, 10, 0, 0, 0, 0.0, None, "t"),
        ])
        profiles = plugin_api.collect_profiles()

        cron = plugin_api.collect_cron(profiles)
        sessions = plugin_api.collect_sessions(10, profiles)

        self.assertEqual(sorted(job["_profile"] for job in cron), ["coder", "default"])
        self.assertEqual([s["_profile"] for s in sessions], ["coder", "default"])
        coverage = plugin_api.build_skill_coverage(profiles, sessions, {})
        issues = {row["id"]: row["top_issue"] for row in coverage["profiles"]}
        li_id = next(p["id"] for p in profiles if p["name"] == "li")
        # The looping "cli" session belongs to default; a profile named "li"
        # must not claim it through a substring match.
        self.assertIn("tool pressure", issues["profile:default"])
        self.assertNotIn("tool pressure", issues[li_id])

    def test_session_profile_matching_is_exact(self):
        session = {"_profile": "default", "source": "cli", "label": "cli"}

        self.assertTrue(plugin_api.session_matches_profile(session, "default"))
        self.assertFalse(plugin_api.session_matches_profile(session, "li"))


    def test_profiles_served_by_the_default_multiplexer_read_as_running(self):
        # A satellite profile has no gateway.pid of its own; the live default
        # gateway lists it in gateway_state.json served_profiles.
        import subprocess
        import sys

        (self.home / "config.yaml").write_bytes(b"model: {}\n")
        for name in ("coder", "solo"):
            (self.home / "profiles" / name).mkdir(parents=True)
        gateway = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", "gateway"])
        try:
            (self.home / "gateway.pid").write_bytes(json.dumps({"pid": gateway.pid, "kind": "hermes-gateway"}).encode("utf-8"))
            (self.home / "gateway_state.json").write_bytes(json.dumps({"served_profiles": ["default", "coder"]}).encode("utf-8"))

            by_name = {p["name"]: p for p in plugin_api.collect_profiles()}
        finally:
            gateway.kill()
            gateway.wait()

        self.assertEqual((by_name["default"]["gateway_state"], by_name["default"]["gateway_mode"]), ("running", "own"))
        self.assertEqual((by_name["coder"]["gateway_state"], by_name["coder"]["gateway_mode"]), ("running", "multiplexed"))
        self.assertEqual((by_name["solo"]["gateway_state"], by_name["solo"]["gateway_mode"]), ("stopped", None))

    def test_served_profiles_are_ignored_when_the_default_gateway_is_down(self):
        (self.home / "gateway_state.json").write_bytes(json.dumps({"served_profiles": ["coder"]}).encode("utf-8"))

        self.assertEqual(plugin_api.multiplexed_profile_names(self.home, "stopped"), set())
        self.assertEqual(plugin_api.multiplexed_profile_names(self.home, "running"), {"coder"})


if __name__ == "__main__":
    unittest.main()
