# Architecture

## Ownership

```text
src/index.ts                  Pi package entrypoint
  └─ src/infra/extension.ts    Pi lifecycle, commands/tools, UI, timer wiring
       ├─ src/cli/             Manual command parsing
       ├─ src/lib/             Shared task presentation and output bounds
       ├─ src/application/     Runtime orchestration and Store boundary
       │    └─ src/domain/    Pure task/chain state transitions
       └─ src/infra/          FileStore, lock ownership, state decoding
            └─ domain types
fixtures/                     Isolated smoke-test controls, never auto-loaded
scripts/                      Gates, hooks, native-test discovery, RPC smoke
docs/                         Design, architecture, security contracts
```

Tests are colocated with their subject. Add a shared helper to `src/lib` only
when it has a real shared responsibility. Do not add workflow-engine or service
layers for a one-session capability.

## Dependency direction

The domain owns tasks, chains, and transitions. It has no infrastructure imports.
The application owns timing policy, trusted parent association, and the Store
interface. Infrastructure implements that interface and validates JSON before
passing state inward. The Pi adapter composes the runtime with the file store
and translates host events, user commands, and tool calls. Presentation depends
only on domain values. CLI parsing has no runtime dependencies.

## Creation and delivery

1. CLI parsing or the tool adapter provides a saved instruction and deadline.
   The entrypoint assigns creator/session/project; the runtime assigns a trusted
   chain root and parent.
2. Pure transitions validate and produce a new snapshot. FileStore validates
   schema and graph invariants, writes a private temporary file, fsyncs it,
   atomically renames, then fsyncs the directory. Only then acknowledge creation.
3. The timer asks the runtime to evaluate UTC deadlines. Host idle, queue, and
   blocking-UI checks gate dispatch. Due tasks remain cancellable in our store.
4. Persist uncertain dispatch intent before calling Pi. Only Pi's matching
   `before_agent_start` event acknowledges the scheduled turn. An asynchronous
   send failure leaves uncertainty instead of a false success or automatic retry.
5. A scheduled turn binds descendants to its persisted chain. Only a new explicit
   human-input run clears that association; an agent cannot omit its parent to
   acquire a fresh budget.

## Why not session entries?

Pi histories can branch or fork, while cancellation and dispatch tombstones must
not rewind. Session entries also do not provide exclusive cross-process ownership.
The authoritative state is therefore one per-session sidecar plus an exclusive
lock, not a branch projection or duplicated session ledger. Forks have different
session IDs and do not inherit runnable work.

Pi can delay writing a new session file until chat starts. Scheduler state is
still durable; confirmations include `pi --session-id <id>` for explicit resume.
No task runs in another conversation merely because the project path matches.
