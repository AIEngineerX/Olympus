"""Olympus alerts for a Hermes no-agent cron job.

Installed into $HERMES_HOME/scripts/ by `hermes olympus install-alerts`. Hermes
cron runs it on schedule and delivers whatever it prints; printing nothing makes
the run silent. It loads the installed Olympus plugin's backend and
prints only alerts that were not already sent in the last six hours.
"""
import importlib.util
import os
from pathlib import Path

home = Path(__file__).resolve().parents[1]
os.environ.setdefault("HERMES_HOME", str(home))
api_path = home / "plugins" / "olympus" / "dashboard" / "plugin_api.py"
spec = importlib.util.spec_from_file_location("olympus_plugin_api", api_path)
plugin_api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin_api)

report = plugin_api.alert_report()
if report:
    print(report)
