import os
import tempfile
import unittest
from pathlib import Path

from dashboard import plugin_api


class ConfigPolicyTest(unittest.TestCase):
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

    def _policy(self, root_yaml, profile_yaml=None):
        (self.home / "config.yaml").write_bytes(root_yaml.encode("utf-8"))
        profiles = [{"name": "default", "_path": str(self.home)}]
        if profile_yaml is not None:
            coder = self.home / "profiles" / "coder"
            coder.mkdir(parents=True)
            (coder / "config.yaml").write_bytes(profile_yaml.encode("utf-8"))
            profiles.append({"name": "coder", "_path": str(coder)})
        return plugin_api.collect_config_policy(profiles, [], {})

    def _titles(self, policy):
        return {item["title"]: item["severity"] for item in policy["findings"]}

    def test_hermes_defaults_hard_stop_unattended_sessions(self):
        policy = self._policy("agent:\n  max_turns: 120\n")

        summary = policy["summary"]
        self.assertTrue(summary["hard_loop_stop"])
        self.assertFalse(summary["interactive_hard_stop"])
        titles = self._titles(policy)
        self.assertNotIn("Unattended sessions have no loop hard stop", titles)
        self.assertEqual(titles["Interactive sessions only warn on tool loops"], "info")
        loop = next(item for item in policy["settings"] if item["id"] == "loop_guard")
        self.assertEqual(loop["value"], "unattended only")
        self.assertEqual(loop["state"], "ok")

    def test_disabling_unattended_hard_stop_with_high_turns_is_a_warning(self):
        policy = self._policy(
            "agent:\n  max_turns: 120\ntool_loop_guardrails:\n  non_interactive_hard_stop_enabled: false\n"
        )

        self.assertFalse(policy["summary"]["hard_loop_stop"])
        self.assertEqual(self._titles(policy)["Unattended sessions have no loop hard stop"], "warning")

    def test_hard_stop_enabled_covers_all_sessions(self):
        policy = self._policy(
            "agent:\n  max_turns: 120\ntool_loop_guardrails:\n  hard_stop_enabled: true\n  non_interactive_hard_stop_enabled: false\n"
        )

        self.assertTrue(policy["summary"]["hard_loop_stop"])
        self.assertTrue(policy["summary"]["interactive_hard_stop"])
        self.assertEqual(self._titles(policy), {})
        loop = next(item for item in policy["settings"] if item["id"] == "loop_guard")
        self.assertEqual(loop["value"], "all sessions")

    def test_one_profile_turning_off_unattended_stops_breaks_coverage(self):
        policy = self._policy(
            "agent:\n  max_turns: 120\n",
            "tool_loop_guardrails:\n  non_interactive_hard_stop_enabled: false\n",
        )

        self.assertFalse(policy["summary"]["hard_loop_stop"])

    def test_low_turn_limits_raise_no_loop_findings(self):
        policy = self._policy("agent:\n  max_turns: 40\n")

        self.assertEqual(self._titles(policy), {})


if __name__ == "__main__":
    unittest.main()
