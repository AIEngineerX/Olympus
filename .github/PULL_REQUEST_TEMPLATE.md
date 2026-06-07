<!-- Thanks for contributing to Olympus. Keep changes scoped and read-only. -->

## Summary

<!-- What does this change and why? Link any related issue. -->

## Type

- [ ] `feat` — new capability
- [ ] `fix` — bug fix
- [ ] `chore` — tooling / maintenance
- [ ] `docs` — documentation only

## Verification

- [ ] `npm run verify`
- [ ] `npm run test:visual`
- [ ] `npm run test:live` when live data paths, layout, routes, or plugin mounting changed
- [ ] `npm run test:security` when payload shape, redaction, labels, config, skills, or evidence sources changed
- [ ] Exercised any changed data path against a real `$HERMES_HOME` (or fixture) — no mocks

## Read-only & privacy checklist

- [ ] No mutation routes (no writes to Hermes state)
- [ ] No secrets in responses (untrusted text runs through `redact_text`)
- [ ] No local paths in public responses; no shell execution from request paths
- [ ] Local labels stay hidden unless `OLYMPUS_EXPOSE_LOCAL_LABELS=1`
- [ ] HermesOS assumptions (schemas/env vars/paths) validated against the real source

## Notes

<!-- Anything reviewers should know: trade-offs, follow-ups, screenshots. -->
