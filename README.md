# pi-schedule

Session-scoped scheduled follow-ups for [Pi](https://pi.dev).

**Status: core under development. Not yet a loadable Pi extension.** No timer,
persistence, command, or agent tool is wired up yet. Do not expect this checkout
to execute scheduled work.

## Intended use

- Manual: `/schedule in 30m check CI for owner/repo#123`.
- Natural language: “In 30 minutes, check CI again.”
- Agent-initiated: when CI is still running, schedule a bounded follow-up within
  the current authorized task and explain why.

Tasks run only in the original open Pi session while the computer is awake.
They do not interrupt active work. Missed tasks require explicit recovery.
This is not a background service or general recurring-job platform.

## Develop

Requires Node.js 22.18+ and npm. The Nix shell provides Node.js 24 and Git.

```sh
nix develop                 # optional when Node is already installed
npm ci                      # dependency install scripts are disabled
npm test                    # deterministic core tests; no sleeps/network
npm run typecheck
npm run test:coverage       # inspect scheduler.ts separately from test coverage
```

Runtime core has no external dependencies. Development uses TypeScript and
Node type definitions. No Pi package entrypoint is declared until integration
exists, so an incomplete scheduler cannot silently load into your sessions.

## Implemented

- Immutable task state transitions and explicit session ownership.
- Relative and timezone-qualified absolute deadlines, deterministic due ordering.
- Cancellation of a follow-up chain and rejection of duplicate delivery.
- Agent scheduling reason, scope checks, three-run/two-hour shared chain budget.
- Dispatch intent marked uncertain before delivery acknowledgement. The adapter
  must persist this intent before delivery; the core itself performs no I/O.

## Next

1. Verify installed Pi lifecycle, user-queue, history, and ownership semantics.
2. Select one durable store; validate persisted data and lock session ownership.
3. Wire timers, overdue policy, tools, manual commands, and visible state.
4. Verify open-session delivery and close/resume recovery end to end.

See [implementation plan](docs/PLAN.md) and [trust boundaries](docs/SECURITY.md).
