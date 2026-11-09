# pi-schedule

**Let your [Pi](https://pi.dev) agents create reminders for themselves.**

CI still running? Deployment not ready? Your agent can set a reminder to check
again and report back—without another prompt from you.

- **Delegate the reminder.** The agent can schedule another check when the current
  task needs one, without asking you each time.
- **Keep the conversation.** The saved request and results stay in the same Pi
  session.
- **Stay in control.** Reminders have visible deadlines, cancellation commands,
  and limits on further checks.

**Pi must stay open and your computer must stay awake.** Reminders are one-off;
there is no background service, recurring schedule, or automatic retry.

## Install

Requires Pi 1.5.x, Node.js 22.18+, and a persistent TUI or RPC session.
Storage relies on Unix file permissions and filesystem behavior; use macOS or Linux.
Pi extensions run with your user permissions, not in a sandbox.

```sh
git clone https://github.com/carbon-ni/pi-schedule.git
cd pi-schedule
npm ci
pi install "$PWD"
```

Start Pi, or run `/reload` in an existing session. Pi also discovers this
repository automatically at `~/.pi/agent/extensions/pi-schedule`.

After the first npm release, install without cloning:

```sh
pi install npm:@carbon-ni/pi-schedule
```

## Let the agent create a reminder

Give Pi a task with an exact target and a clear scope:

> Check CI for owner/repo#123. If it is still running, remind yourself to check
> again in 30 minutes and report failures. Do not modify code.

The agent uses `schedule_task` to save the request for later. It explains why it
created the reminder and confirms the task ID, due time with timezone, target,
and cancellation command. When the reminder runs, findings appear in the same chat.

Reminders stay within the current request and permissions. Checking status does
not authorize code changes, pushes, or merges.

## Create a reminder yourself

Ask Pi directly:

> In 30 minutes, check CI for owner/repo#123 and report failures. Do not modify code.

Or use `/schedule` without a model call:

```text
/schedule in 30m Check CI for owner/repo#123 and report failures; do not modify code
/schedule at 2026-11-09T14:30:00+01:00 Check deployment status for owner/repo
```

Use an explicit timezone offset for `at`.

## Inspect or cancel reminders

Replace `S-<id>` with the ID from the confirmation or task list:

```text
/schedule list
/schedule show S-<id>
/schedule cancel S-<id>
/schedule help
```

Reminders wait while Pi is busy, messages are queued, or extension UI is blocking.
They remain cancellable until dispatch starts. **Dispatched means Pi started the
turn, not that the check succeeded.** Read the conversation for findings or blockers.

### Limit further reminders

Agent-created checks share a default budget of **three checks within two hours**.
Further reminders cannot reset that budget or silently recreate a cancelled chain.
A new explicit user request starts a new authorization scope.

Only you can change a chain's total run limit and expiry from now:

```text
/schedule budget S-<id> 5 3h
```

Maximum explicit budget: 20 checks within 24 hours. Each session allows 20 pending
or overdue tasks, 8 KiB per saved instruction, and 1,000 history records.

## Recover missed reminders

Closing Pi stops execution. Reloading or resuming keeps future reminders, but
missed reminders become overdue. Sleep or forward-clock gaps over two minutes
also require review. Missed reminders do not run automatically.

Inspect the saved request, then explicitly run overdue work when Pi is idle:

```text
/schedule show S-<id>
/schedule run S-<id>
```

An expired agent chain needs a budget extension before it can run.

If dispatch is uncertain, inspect the conversation and any external effects first.
Then acknowledge it without replay:

```text
/schedule dismiss S-<id>
```

Create a fresh reminder only if another check is needed. For storage or lock
errors, follow [security and recovery](docs/SECURITY.md) before using `/reload`.

Each confirmation includes `pi --session-id <id>` to resume from the same project.
Use it if a reminder was created before the first chat message: Pi creates session
files lazily, so the session may not appear in the picker yet.

## Local state and integrations

Reminders are stored in `~/.pi/agent/schedule/`, or
`<PI_CODING_AGENT_DIR>/schedule/` when Pi's agent directory is overridden.
There is no separate scheduler configuration.

State files use mode 600; directories and locks use mode 700. Each session has
one exclusive owner; forked sessions get separate stores. Rewinding history does
not restore cancelled or dispatched reminders. Corrupt state is retained for
recovery; a write failure stops scheduling until reload.

For agent integrations, `schedule_task` supports `create`, `list`, `show`, and
`cancel`. Creation requires an instruction, exact target, reason, and either
`delay_seconds` or timezone-qualified `run_at`.

## Further reading

- [Development](DEVELOPMENT.md): setup, isolated loading, and checks.
- [Releasing](docs/RELEASING.md): npm setup and publishing.
- [Architecture](docs/ARCHITECTURE.md): implementation boundaries.
- [Security and recovery](docs/SECURITY.md): permissions and failure handling.
- [Design baseline](docs/PLAN.md): original requirements.
