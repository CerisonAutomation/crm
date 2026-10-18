---
name: zenith-release
description: Run the pre-merge release gate and produce the release evidence package. Use before merging to main, cutting a release, or when asked for production readiness.
---

# zenith-release

Verification over assertion. No gate passes on claims. Every row needs a command and its output.

## Gate commands

Run from the repo root (`src/` submodule):

```
bun run check-types
bun run lint
bun run lint:slop
bun run test --concurrency=1
```

`lint:slop` enforces the custom oxlint anti-slop rules in `tools/oxlint/anti-slop/`. It is red tree-wide until the migration burns down. A red slop gate blocks release but never justifies weakening the rules. Record the count, fix your own files, leave others untouched.

## Evidence package

Write `evidence/<date>-<scope>.md` with exactly these rows. One line each. File and line, or command output. No prose.

```
Gate | Result | Evidence
Types | PASS/FAIL |
Lint | PASS/FAIL |
Slop | PASS/FAIL | (count + trend vs last run)
Tests | PASS/FAIL |
Migrations | PASS/FAIL | (forward + rollback verified, or N/A)
Security | PASS/FAIL | (auth on routes, RLS, secrets scan)
```

## Release policy

Block release when any row reads FAIL, when authorization or tenant isolation is unverified, or when a required migration has no rollback. A coverage checklist is not proof. Partial verification is reported as partial, never as done.
