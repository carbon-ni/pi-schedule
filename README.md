# pi-schedule

One-off scheduled follow-ups for [Pi](https://pi.dev), in the original conversation.

## Start

Supports macOS and Linux. Requires Pi 1.5.x, Node.js 22.18+, a persistent
TUI/RPC session, and an awake computer. Pi extensions run with your user permissions; this is not a sandbox.

```sh
make setup                 # locked dependencies + versioned Git hooks
make try                   # isolated Pi load, without other extensions
```

When this repository is in `~/.pi/agent/extensions/pi-schedule`, Pi discovers its
package manifest. Use **/reload** in an existing session. Otherwise install it:

```sh
pi install /absolute/path/to/pi-schedule
```

## Schedule work

Manual commands do not need a model call:

```text
/schedule in 30m Check CI for owner/repo#123 and report failures; do not modify code
/schedule at 2026-11-09T14:30:00+01:00 Check deployment status
/schedule list
/schedule show S-<id>
/schedule cancel S-<id>
/schedule help
```

Or ask Pi: **“In 30 minutes, check CI again.”** The agent resolves the exact
target and calls `schedule_task`. It can also schedule a necessary follow-up
when CI is still running, without asking each time. Each agent-created task
explains why. The tool supports `create`, `list`, `show`, and `cancel`.

Agent follow-ups share a default budget of **three agent-created checks within
two hours**. Descendants cannot reset it or silently recreate a cancelled chain.
A new explicit user request starts a new authorization scope. You can change
a chain's total run limit and expiry from now with:

```text
/schedule budget S-<id> 5 3h
```

Limits: 20 pending/overdue tasks, 8 KiB saved instructions, 1,000 history records
per session. Explicit user budget controls allow up to 20 checks / 24 hours.

## Execution and recovery

- Confirmation includes task ID, local due time with timezone, target, creator,
  cancellation command, and session-resume command.
- A one-second timer checks absolute deadlines. Active agent work, queued
  messages, and blocking extension UI take priority.
- Tasks stay cancellable until dispatch starts. Dispatched means Pi started
  the turn, **not** that the requested check succeeded. Findings appear in chat.
- Closing Pi stops execution. Reload/resume keeps future tasks, but missed tasks
  become overdue. Sleep/forward-clock gaps over two minutes also require review.
  Small scheduling delays are tolerated; continuously observed busy work can
  wait longer. No daemon, recurrence, automatic missed-run catch-up, or retries.
- Inspect saved work before explicit recovery:

```text
/schedule show S-<id>
/schedule run S-<id>         # overdue work, when idle
```

An expired agent chain needs an explicit budget extension before it can run.
An uncertain dispatch is never replayed automatically. Inspect the conversation,
then `/schedule dismiss S-<id>` to acknowledge uncertainty without replaying it.
If needed, create a fresh manual task after checking for prior effects.

Pi creates new session files lazily. If you scheduled manually before the first
ordinary chat message, use the confirmation's `pi --session-id <id>` from the
same project to resume; the session may not appear in the picker yet.

## Private local state

Tasks live in `<Pi agent directory>/schedule/`, default
`~/.pi/agent/schedule/`. `PI_CODING_AGENT_DIR` changes the parent using Pi's
standard configuration behavior. There is no second scheduler config file.

State files are mode 600, directory/locks mode 700. One session owner holds an
exclusive lock. A clone/fork gets its own store; rewinding history does not
resurrect cancelled or dispatched tasks. Corrupt state stops scheduling without
discarding the file. A write failure stops the runtime until reload.

See [security and recovery](docs/SECURITY.md), [architecture](docs/ARCHITECTURE.md),
and [development](DEVELOPMENT.md). The [design baseline](docs/PLAN.md) records
the original requirements.
