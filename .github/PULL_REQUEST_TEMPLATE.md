<!-- Thanks for contributing to Olympus. Keep changes scoped and read-only. -->

## Summary

<!-- What does this change and why? Link any related issue. -->

## Type

- [ ] `feat` — new capability
- [ ] `fix` — bug fix
- [ ] `chore` — tooling / maintenance
- [ ] `docs` — documentation only

## Verification

- [ ] `python3 -m py_compile dashboard/plugin_api.py`
- [ ] `node --check dashboard/dist/index.js`
- [ ] `git diff --check`
- [ ] Exercised any changed data path against a real `$HERMES_HOME` (or fixture) — no mocks

## Read-only & privacy checklist

- [ ] No mutation routes (no writes to Hermes state)
- [ ] No secrets in responses (untrusted text runs through `redact_text`)
- [ ] No local paths in public responses; no shell execution from request paths
- [ ] Local labels stay hidden unless `OLYMPUS_EXPOSE_LOCAL_LABELS=1`
- [ ] HermesOS assumptions (schemas/env vars/paths) validated against the real source

## Notes

<!-- Anything reviewers should know: trade-offs, follow-ups, screenshots. -->
