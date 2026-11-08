# Development

## One command per lifecycle stage

Use Node.js 22.18+ (Nix provides 24), npm 10.9.9, Git, and Pi 1.5.x. Use
`nix develop` if Node is unavailable. If your npm differs, use
`npx --yes npm@10.9.9 ci` before installing hooks.

| Stage             | Command                                | Enforcement                                                       |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Discover commands | `make help`                            | Copyable local commands                                           |
| Install           | `make setup`                           | Locked dependencies, install scripts disabled, versioned hooks    |
| Verify hooks      | `make hooks-check`                     | Checks hook path and executability                                |
| During work       | `fzz --log-file .tmp/funzzy/tests.log` | Same normal gate on changes                                       |
| Normal gate       | `make check`                           | Pre-commit, pre-push, watcher, CI                                 |
| Format            | `make format` / `make format-write`    | Explicit manual/release check                                     |
| Coverage          | `make coverage`                        | Explicit budgets: 85% lines/functions, 75% branches               |
| Security          | `make security`                        | Native dependency audit; high severity blocks                     |
| Real Pi smoke     | `node scripts/smoke.mjs`               | Explicit isolated RPC test with local deterministic HTTP provider |
| Release           | `make release-check`                   | Normal gate + format, coverage, audit, package dry run            |

Coverage preloads every production module so newly added, unimported code does
not disappear from the report. Keep module evaluation free of external effects;
start resources through explicit lifecycle adapters.

The normal gate is lint, typecheck, and deterministic tests only. Success prints
exactly `true`. Failure prints `false` first, then at most 40 diagnostic lines.
Hooks strip Git redirect variables so scratch repositories cannot touch the
submodule index. Commit subjects follow Conventional Commits.

CI invokes the same normal gate on main pushes and pull requests. Semver
`v*` tags additionally invoke the local release gate; no publishing or tag
creation is automatic. Review the package dry run before publishing. Pi is a
host peer dependency; TypeBox is also host-provided. Development versions and
direct tooling are pinned; the lockfile pins their dependency graph.

## Definition of done

- Behavior and failure paths have deterministic tests; use fake time, not sleeps.
- The watcher normal gate passes for the current revision.
- Coverage and audit pass for the changed scope; uncovered risk is recorded.
- Runtime changes pass the explicit Pi smoke test; this uses no real credentials
  and no user session. Human TUI review remains a separate check.
- Formatting passes and docs describe actual behavior and recovery.
- Commit/push the submodule before updating its parent pointer. Never amend.
- Update TASK-0007 on the separate planning board when its criteria are met.

## Boundaries and configuration

Domain state transitions do not import infrastructure, Pi, TypeBox, or Node
modules. ESLint enforces inward imports for production domain files. Changes to
that rule require both a passing baseline and a forbidden-import probe that
fails lint. Tests import external test helpers; they are not production layers.

There is one versioned watcher config and one lint/type/test gate. Runtime
defaults are defined in source; Pi's agent-directory default is overridden only
by Pi's standard `PI_CODING_AGENT_DIR`. Budget changes use the manual command;
there is no competing environment or JSON budget policy.

`skipLibCheck` skips inconsistent third-party declaration internals, including
Pi's generated JSON model declarations under NodeNext. Our source, fixtures,
and integration calls remain strictly typechecked.

## Do not

- Do not use shell sleeps for scheduling, run a hidden daemon, steer active work,
  or silently execute missed/uncertain tasks.
- Do not reconstruct terminal scheduler state from an active history branch.
- Do not let model parameters set creator, session ownership, root, or budget.
- Do not claim that a submitted prompt proves a successful check.
- Do not force-add runtime state, credentials, logs, or coverage output.
- Do not bypass a failing implementation hook. Fix it and use the same gate as CI.

## Failure → recovery

- Dependencies unavailable → `npm ci` (network is required for installation).
- Hooks absent → `make setup && make hooks-check`.
- Format failure → `make format-write && make format`.
- Type/lint/test failure → `make check`; read bounded diagnostics and run the
  relevant individual command from `make help`.
- Watcher unavailable → `fzz run -- @agent-final`; it uses the same normal gate.
- Missing Pi → install Pi 1.5.x, then `make try`.
- Runtime/storage/lock failure → use [security recovery](docs/SECURITY.md), then
  `/reload`. Never delete an active process's lock.
- Audit failure → `npm audit`; review advisories and pin a targeted correction.
  Do not use `npm audit fix --force`.
- Coverage failure → `make coverage`; add behavioral cases, not config-string
  assertions or a lower threshold.
