import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import plugin_api  # noqa: E402

MODEL_CONFIG = b"model:\n  default: test-model\n  provider: test-provider\n"
HERMES_AVAILABLE = importlib.util.find_spec("hermes_cli") is not None


class GatewayDetectionTest(unittest.TestCase):
    """Which gateways a profile has configured comes from Hermes, never from
    Olympus parsing `.env` itself (plugin catalog rule 11)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.saved = {key: os.environ.get(key) for key in ("HERMES_HOME", "HERMES_KANBAN_HOME")}
        os.environ["HERMES_HOME"] = str(self.home)
        os.environ["HERMES_KANBAN_HOME"] = str(self.home)
        (self.home / "config.yaml").write_bytes(MODEL_CONFIG + b"dashboard:\n  olympus:\n    expose_local_labels: true\n")
        plugin_api.refresh_expose_local_labels()
        # env-only: the token lives in .env, config.yaml says nothing about platforms.
        env_only = self.home / "profiles" / "envonly"
        env_only.mkdir(parents=True)
        (env_only / "config.yaml").write_bytes(MODEL_CONFIG)
        (env_only / ".env").write_text("TELEGRAM_BOT_TOKEN=not-a-real-token\n", encoding="utf-8")
        # config-only: enabled in config.yaml, no .env at all.
        config_only = self.home / "profiles" / "configonly"
        config_only.mkdir(parents=True)
        (config_only / "config.yaml").write_bytes(MODEL_CONFIG + b"platforms:\n  discord:\n    enabled: true\n")

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def gateways(self):
        profiles = plugin_api.collect_profiles()
        rows = plugin_api.collect_gateways(profiles)
        return {(row["profile"], row["platform"]): row for row in rows}

    def test_olympus_never_parses_env_files(self):
        self.assertFalse(hasattr(plugin_api, "env_keys"))
        source = (Path(plugin_api.__file__)).read_text(encoding="utf-8")
        self.assertNotIn('".env"', source.replace("# ", ""), "plugin_api.py must not touch .env files itself")

    def test_config_enabled_platform_is_a_gateway(self):
        rows = self.gateways()
        self.assertIn(("configonly", "discord"), rows)
        self.assertTrue(rows[("configonly", "discord")]["enabled"])

    @unittest.skipUnless(HERMES_AVAILABLE, "needs hermes_cli: Hermes reports env-configured platforms")
    def test_env_configured_platform_comes_from_hermes(self):
        rows = self.gateways()
        self.assertIn(("envonly", "telegram"), rows)
        self.assertTrue(rows[("envonly", "telegram")]["configured"])

    @unittest.skipIf(HERMES_AVAILABLE, "standalone only: without Hermes, .env is never read")
    def test_without_hermes_env_is_not_read(self):
        rows = self.gateways()
        self.assertNotIn(("envonly", "telegram"), rows)


if __name__ == "__main__":
    unittest.main()
