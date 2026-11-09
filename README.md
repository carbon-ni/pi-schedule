# pi-schedule

Let your [Pi](https://pi.dev) agents create reminders for themselves.

CI still running? Deployment not ready? Your agent can schedule a reminder to
check again, then return to the task in the same conversation. You do not need
to keep prompting it to follow up.

**Keep the Pi session open and the computer awake.** There is no background
service, recurring schedule, or automatic retry.

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

Start Pi, or run `/reload` in an existing session. If the repository is already
at `~/.pi/agent/extensions/pi-schedule`, Pi discovers it without `pi install`.

After the first npm release, install without cloning:

```sh
pi install npm:@carbon-ni/pi-schedule
```

## Let the agent remind itself

Give Pi a task with an exact target and a clear scope:

> Check CI for owner/repo#123. If it is still running, remind yourself to check
> again in 30 minutes and report failures. Do not modify code.

The agent uses `schedule_task` to save a reminder and resume the check later.
It can also create reminders when a follow-up is necessary for the current task,
without asking you each time. Each reminder includes a reason, task ID, due time
with timezone, target, and cancellation command. Results appear in the same chat.

Reminders stay within the current request and permissions. A status check does
not authorize code changes, pushes, or merges. Follow-up limits prevent an
unbounded chain of reminders.

## Schedule a reminder yourself

You can also ask Pi directly:

> In 30 minutes, check CI for owner/repo#123 and report failures. Do not modify code.

Or schedule without a model call using `/schedule`:

```text
/schedule in 30m Check CI for owner/repo#123 and report failures; do not modify code
/schedule at 2026-11-09T14:30:00+01:00 Check deployment status for owner/repo
/schedule list
```

Use an explicit timezone offset for `at`. Replace `S-<id>` below with the ID from
the confirmation or task list:

```text
/schedule show S-<id>
/schedule cancel S-<id>
/schedule help
```

Tasks wait while Pi is busy, messages are queued, or extension UI is blocking.
They remain cancellable until dispatch starts. **Dispatched means Pi started the
turn, not that the check succeeded.** Read the conversation for findings or blockers.

## Recover missed work

Closing Pi stops execution. Reloading or resuming keeps future tasks, but missed
tasks become overdue. Sleep or forward-clock gaps over two minutes also require
review; missed work does not run automatically.

Inspect the saved request, then explicitly run overdue work when Pi is idle:

```text
/schedule show S-<id>
/schedule run S-<id>
```

If dispatch is uncertain, inspect the conversation and any external effects first.
Then acknowledge it without replay:

```text
/schedule dismiss S-<id>
```

Create a fresh task only if another check is needed. For storage or lock errors,
follow [security and recovery](docs/SECURITY.md) before using `/reload`.

Each confirmation includes `pi --session-id <id>` to resume from the same project.
Use it if a task was scheduled before the first chat message: Pi creates session
files lazily, so the session may not appear in the picker yet.

## Control follow-up limits

Agent-created checks share a default budget of **three checks within two hours**.
Follow-ups cannot reset that budget or silently recreate a cancelled chain. A new
explicit user request starts a new authorization scope.

Only you can change a chain's total run limit and expiry from now:

```text
/schedule budget S-<id> 5 3h
```

An expired chain needs a budget extension before it can run. Maximum explicit
budget: 20 checks within 24 hours. Each session allows 20 pending or overdue tasks,
8 KiB per saved instruction, and 1,000 history records.

For agent integrations, `schedule_task` supports `create`, `list`, `show`, and
`cancel`. Creation requires an instruction, exact target, reason, and either
`delay_seconds` or timezone-qualified `run_at`.

## Local state

Tasks stay in `~/.pi/agent/schedule/`, or `<PI_CODING_AGENT_DIR>/schedule/` when
Pi's agent directory is overridden. There is no separate scheduler configuration.

State files use mode 600; directories and locks use mode 700. Each session has one
exclusive owner. Forked sessions get separate stores. Rewinding history does not
restore cancelled or dispatched tasks. Corrupt state is retained for recovery;
a write failure stops scheduling until reload.

## Development

See [development](DEVELOPMENT.md) for setup, isolated loading, and checks;
[releasing](docs/RELEASING.md) for npm setup and publishing;
[architecture](docs/ARCHITECTURE.md) for implementation boundaries;
[security and recovery](docs/SECURITY.md) for permissions and failure handling;
and [design baseline](docs/PLAN.md) for the original requirements.
