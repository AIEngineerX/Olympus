"""Olympus Hermes plugin entry point.

Olympus is a dashboard plugin: its UI lives in ``dashboard/`` and its read-only
API in ``dashboard/plugin_api.py``, which the Hermes dashboard mounts under
``/api/plugins/olympus/``. ``register`` adds one CLI command, ``hermes olympus``,
for alerts. Olympus registers no agent tools, hooks, or middleware.
"""
import importlib.util
import shutil
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent
ALERT_SCRIPT = "olympus_alerts.py"


def _plugin_api():
    spec = importlib.util.spec_from_file_location("olympus_plugin_api", PLUGIN_DIR / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _setup(parser):
    sub = parser.add_subparsers(dest="olympus_command", required=True)
    alerts = sub.add_parser("alerts", help="Print new Olympus alerts (what the alert cron job delivers)")
    alerts.add_argument("--preview", action="store_true", help="Show every current alert without marking it as sent")
    install = sub.add_parser("install-alerts", help="Install the Olympus alert script for a Hermes no-agent cron job")
    install.add_argument("--deliver", required=True, help="Delivery target, as for `hermes cron create --deliver` (e.g. telegram)")
    install.add_argument("--every", default="15m", help="How often to check (default: 15m)")


def _handle(args):
    plugin_api = _plugin_api()
    if args.olympus_command == "alerts":
        report = plugin_api.alert_report(preview=args.preview)
        print(report or "Olympus: no new alerts.")
        return 0
    scripts = plugin_api.get_hermes_home() / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    target = scripts / ALERT_SCRIPT
    shutil.copyfile(PLUGIN_DIR / "alerts" / ALERT_SCRIPT, target)
    print(f"Installed {target}")
    print("Create the cron job (no model runs; Hermes delivers the output and stays silent when nothing is new):")
    print(f'  hermes cron create --no-agent --script {ALERT_SCRIPT} --name "Olympus alerts" --deliver {args.deliver} "{args.every}"')
    return 0


def register(ctx):
    ctx.register_cli_command(
        "olympus",
        "Olympus alerts: cron failures, stalled workers, spend spikes",
        _setup,
        _handle,
        description="Check Olympus alerts now, or install the script a Hermes no-agent cron job runs to deliver them.",
    )
