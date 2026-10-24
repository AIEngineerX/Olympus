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

3. Start with **Agents**: your agents, what each is doing, and Needs you,
   everything waiting on a person. **Performance** shows how reliably each
   agent's runs succeed; **Checks** holds findings, backlog, skills, policy and
   spend.

4. Optional alerts for failed or stalled cron jobs, stalled workers, looping
   sessions and spend spikes, delivered by a Hermes no-agent cron job:

   ```bash
   hermes olympus install-alerts --deliver telegram
   ```

Olympus reads local Hermes state (sessions, Kanban, cron, config, log tails)
and never writes Hermes files or databases. Its controls (pause, resume or run
a cron job; answer, retry, reclaim or reassign a Kanban task) each ask you to
confirm, then call Hermes' own API. To turn them off, or to show session titles,
task titles, cron names, model labels and paths on a private machine (hidden by
default), set this in `config.yaml`:

```yaml
dashboard:
  olympus:
    controls: false            # no controls
    expose_local_labels: true  # show local labels
```

Olympus' own data lives in `$HERMES_HOME/plugin-data/olympus/`. Keep the Hermes
dashboard on localhost; do not expose it to the internet.
