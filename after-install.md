# Olympus installed

1. Enable it (plugins are opt-in):

   ```bash
   hermes plugins enable olympus
   ```

2. Open the dashboard and pick the **Olympus** tab:

   ```bash
   hermes dashboard
   ```

   Default address: `http://127.0.0.1:9119/olympus`. If the tab or its data
   does not appear, restart `hermes dashboard` once.

3. Read the Brief tab first: the readiness score, what needs review, and the
   Hermes page that owns each fix. Agents, Skills, Kanban, Policy and
   Diagnostics hold the detail.

Olympus only reads local Hermes state (sessions, Kanban, cron, config, log
tails). It never changes Hermes and makes no network calls. Session titles,
task titles, cron names, model labels and paths are hidden by default; to show
them on a private machine, set this in `config.yaml`:

```yaml
dashboard:
  olympus:
    expose_local_labels: true
```

Keep the Hermes dashboard on localhost; do not expose it to the internet.
