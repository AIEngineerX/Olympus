"""Olympus Hermes plugin entry point.

Olympus is a dashboard plugin: its UI lives in ``dashboard/`` and its read-only
API in ``dashboard/plugin_api.py``, which the Hermes dashboard mounts under
``/api/plugins/olympus/``. It registers no agent tools, hooks, middleware, or
commands, so ``register`` has nothing to add to the agent.
"""


def register(ctx):
    return None
