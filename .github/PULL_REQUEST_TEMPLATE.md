<!-- Thanks for contributing to Olympus. Keep changes scoped, and say which problem in PRODUCT.md this solves. -->

## Summary

<!-- What does this change, and which problem in PRODUCT.md does it solve? Link the Hermes issues that show people have it. -->

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

## Safety & privacy checklist

- [ ] No writes to Hermes files or databases; any change to Hermes goes through a Hermes endpoint, confirmed, logged and covered by `dashboard.olympus.controls`
- [ ] No secrets in responses (untrusted text runs through `redact_text`)
- [ ] No local paths in public responses; no shell execution from request paths
- [ ] Local labels stay hidden unless `dashboard.olympus.expose_local_labels: true`
- [ ] HermesOS assumptions (schemas/env vars/paths) validated against the real source

## Notes

<!-- Anything reviewers should know: trade-offs, follow-ups, screenshots. -->
