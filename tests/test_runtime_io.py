import inspect
import os
import tempfile
import unittest
from pathlib import Path

from dashboard import plugin_api


class RuntimeIoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.old_home = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = str(self.home)

    def tearDown(self):
        if self.old_home is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self.old_home
        self.tmp.cleanup()

    def test_read_text_returns_only_the_requested_tail_bytes(self):
        log = self.home / "agent.log"
        head = "Traceback: early failure that scrolled away\n"
        filler = "x" * 200_000 + "\n"
        tail = "INFO all quiet at the end\n"
        log.write_bytes((head + filler + tail).encode("utf-8"))

        text = plugin_api.read_text(log, 64)

        self.assertEqual(len(text.encode("utf-8")), 64)
        self.assertTrue(text.endswith(tail))
        self.assertNotIn("Traceback", text)

    def test_read_text_returns_whole_file_when_smaller_than_limit(self):
        log = self.home / "small.log"
        log.write_bytes("short log\n".encode("utf-8"))

        self.assertEqual(plugin_api.read_text(log, 8000), "short log\n")

    def test_read_text_tolerates_a_multibyte_character_cut_by_the_window(self):
        log = self.home / "utf8.log"
        log.write_bytes("é".encode("utf-8") * 10)

        text = plugin_api.read_text(log, 5)

        self.assertEqual(text, "\ufffd" + "éé")

    def test_health_scan_ignores_failures_before_the_log_window(self):
        logs = self.home / "logs"
        logs.mkdir()
        (logs / "agent.log").write_bytes(("Traceback (most recent call last)\n" + "ok\n" * 10_000).encode("utf-8"))

        health = plugin_api.collect_health([{"gateway_state": "running"}], [])

        self.assertEqual(health["recent_error_terms"], [])
        self.assertEqual(health["status"], "ok")

    def test_routes_are_sync_so_fastapi_runs_them_in_its_threadpool(self):
        # The collectors do blocking SQLite and file I/O; an async route would
        # run them on the event loop and stall every other dashboard request.
        for route in (plugin_api.health, plugin_api.overview, plugin_api.tuning):
            self.assertFalse(inspect.iscoroutinefunction(route), route.__name__)


if __name__ == "__main__":
    unittest.main()
