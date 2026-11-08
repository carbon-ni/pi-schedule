# Scheduling design baseline

> Original design for TASK-0007, captured 2026-11-08. This is not the task board.
> README and DEVELOPMENT describe implemented behavior and verification; the
> historical criteria below preserve the design intent, not live progress.

## Problem

Waiting for CI, deployments, or another external operation requires the user to remember to return and ask Pi to check again. Long-running shell sleeps hide this intent, occupy execution, and cannot provide reliable listing, cancellation, or recovery.

## Decision

Build `pi-schedule`, a Pi extension for one-off follow-ups in the original session. The user explicitly selected session-open execution as the MVP. This is a plan, not an active schedule.

Example: “In 30 minutes check CI again.” Pi resolves the relevant repository and PR, records the action, and confirms its ID and exact local due time with timezone. At the due time it initiates a normal Pi turn in that session. Scheduling must not merely display a reminder.

No daemon, cron, external service, spawned Pi process, recurring schedules, worktrees, or cross-session delivery in v1. No intray dependency: this runs inside the target session.

## Reference

[Codex scheduled tasks](https://developers.openai.com/codex/app/automations), accessed 2026-11-08, documents in-chat scheduling, standalone runs, reviewable results, and the requirement to keep the computer and app running for local projects. Borrow explicit action + schedule + destination + visible result, not its full automation platform. The current page is titled “Scheduled tasks | ChatGPT Learn”; product naming has changed.

## User contract

- Natural language is interpreted by the agent into structured tool input. The scheduler validates inputs deterministically; it does not use an LLM to decide whether work is due.
- Both manual and agent-initiated scheduling are first-class. The user may schedule directly through a command or natural language. The agent may schedule a follow-up without asking each time when it is necessary to finish the current authorized task (e.g. CI is still running). This is not permission to invent unrelated monitoring or new work.
- Agent-created tasks must visibly explain why a follow-up is needed, show their due time and target, and remain listable/cancellable. User cancellation stops that follow-up chain; the agent must not silently recreate it. Scheduling does not extend the original action permissions.
- Bound agent follow-up chains with a root task ID, remaining run budget, and expiry shared by every descendant. Proposed default: at most three agent-initiated checks within two hours per root task; the user can explicitly change the budget. Each scheduled check consumes one run; reaching a limit reports the unresolved state and asks the user rather than resetting the budget. A pending-count cap alone is not sufficient.
- Tools: `schedule_task` with create/list/cancel actions. Create takes an explicit instruction and exactly one of positive integer `delay_seconds` or timezone-qualified `run_at`. Return ID, due time, resolved scope, and execution limitation.
- `/schedule in 30m <instruction>` and `/schedule at <ISO-8601-with-offset> <instruction>` create tasks directly without an LLM round trip. `/schedule help`, `/schedule list`, `/schedule cancel <id>`, and `/schedule run <id>` provide discovery, inspection, cancellation, and explicit overdue recovery. Natural-language cancellation uses the same application logic. Repeating run/cancel cannot dispatch twice.
- Support “in 30 minutes” first. Absolute dates require an explicit offset; ask about ambiguous time or target rather than guess. Resolve relative duration against an injected clock at successful creation, not model request start.
- Save a durable instruction: e.g. check CI for `owner/repo` PR 123 and report status/failures. Do not save only “check that again.” Resolve repo/PR identity before create; omit credentials and unnecessary transcript text.
- Confirmation: “Scheduled S-123 for <date/time/timezone> (in 30 minutes): check CI for owner/repo#123. Runs only while this Pi session is open and computer is awake.”
- Current permissions and instructions still apply at execution. “Check CI” does not authorize fixing code, pushing, merging, or cancelling workflow runs. Report blockers; never silently grant access.
- Show pending count/next due time and visible task lifecycle records. Distinguish scheduled, due/waiting, dispatched, cancelled, overdue, and uncertain. Do not claim a check succeeded merely because a prompt was submitted.

## Timing and lifecycle

1. Persist creation before acknowledging it; timer is only a wake-up mechanism. Compare absolute UTC deadlines on every wake, with bounded periodic rechecks to handle clock changes and sleep.
2. Dispatch only when the original session is idle, with no pre-existing queued user work. Recheck eligibility immediately before dispatch. Keep due work in the scheduler until then so cancellation remains meaningful; do not insert uncancellable messages behind an active turn.
3. Order simultaneous due tasks by due time then stable ID. Run one at a time and recheck session/user queue state between runs. Use non-steering delivery defensively; verify actual Pi queue semantics in a spike before implementation.
4. Define a two-minute lateness grace for ordinary event-loop delay. A task delayed beyond that without an observed continuous busy-session wait becomes overdue (e.g. sleep or large forward clock jump). Never run early after a backward clock change. Make this policy explicit in help.
5. Clean up timers on every session shutdown, including reload/new/resume/fork. Restore pending tasks on reload/resume of the same session. If a restored deadline has passed, mark overdue and require `/schedule run <id>`; do not execute a surprise catch-up.
6. Session replacement never redirects a task to the new conversation. Forks do not inherit runnable tasks; branch navigation does not resurrect dispatched or cancelled tasks. Verify session ID and history behavior against the installed Pi API.
7. Mark dispatch intent durably before calling Pi. A crash between persistence and delivery is uncertain: show it and require explicit recovery, never automatically replay. Do not promise exactly-once external effects. Concurrent opens of the same session must fail closed for scheduling unless exclusive ownership is proven.
8. Closing Pi stops execution. Starting another session does not run old tasks. Pending records remain available when the original session is resumed. The feature cannot wake a sleeping computer.

## Design

Keep changes under `pi/agent/extensions/pi-schedule/`, following nearby package conventions and current `@earendil-works/*` imports.

Separate deterministic task validation/state transitions from Pi lifecycle and tool/command adapters. Inject clock, timer, persistence, and delivery at the boundary; avoid building a generic workflow framework.

Proposed record: schema version, task ID, owning session ID, project path and resolved target, instruction, creator (`user` or `agent`), scheduling reason, root/parent task IDs, shared follow-up budget and expiry, created/due timestamps, state, lifecycle timestamps, and failure/uncertainty reason. Creator attribution must come from the command/tool entry point, not a model-supplied authority claim. Explicit user changes to autonomous budgets need a user-controlled command or equivalent verified input; the agent cannot grant itself a larger budget. Limit instruction length and pending count (proposed 8 KiB and 20 per session). Validate persisted records; malformed state disables affected tasks with a visible error rather than silently discarding them.

First investigate whether session custom entries (`pi.appendEntry`) can provide authoritative lifecycle reconstruction across branches and exclusive ownership. They already persist extension data outside model context. Use them if guarantees hold; otherwise use a small private per-session store with atomic writes and an exclusive lock. Choose one source of truth, document retention/deletion and permissions, and do not create a second shadow ledger. Cancelled/dispatched tombstones must not vanish on branch rewind.

Pi integration evidence: `pi.sendUserMessage` initiates a turn when idle and supports `deliverAs: "followUp"` while streaming. `session_start`/`session_shutdown` cover reload and session replacement. Existing `pi-auto` exercises queued messages; `pi-intray` handles cross-process messages but is unnecessary here. Exact API behavior and compatibility must be checked before implementation; no harness changes are proposed.

## Delivery plan (test first)

1. **Prove the boundary:** inspect current Pi docs/examples in full as needed; spike idle/queued-user semantics, session identity, forks, persistence replay, and duplicate session ownership. Finalize storage and delivery policy before coding the scheduler.
2. **Implement deterministic core:** fake-clock tests first for validation, due ordering, cancellation, state transitions, overdue classification, and crash recovery. Add persistence adapter and ownership handling.
3. **Wire Pi:** expose tools/commands, lifecycle cleanup, idle dispatch, and visible task state. Test adapters with fake Pi events; include integration checks for session replacement and reload.
4. **Verify user flow:** short real-session timer checks CI in the same conversation; cancel prevents dispatch; active work is not interrupted; close/resume yields an overdue task without execution. Document help, prerequisites, recovery commands, storage, and limitations.

## Acceptance criteria

- [ ] Direct manual commands and natural-language requests create durable tasks through the same validated scheduling logic, with resolved target and exact due-time confirmation; no shell sleep or background process.
- [ ] The agent can schedule a necessary follow-up to the current task without per-task approval, with visible reason and creator attribution; unrelated work remains outside scope.
- [ ] Agent-created follow-ups share a bounded run budget and expiry across descendants. Cancellation, exhausted budget, and expiry prevent silent recreation; tests cover both allowed follow-ups and rejected scope/budget expansion.
- [ ] An open, awake, idle session runs the specified check at/after due time and returns an ordinary reviewable response in the original conversation.
- [ ] Busy-session work and queued user messages take priority; cancel remains effective until dispatch begins.
- [ ] List/cancel/help/explicit-overdue-run work without relying on natural-language inference; invalid/past/ambiguous inputs have actionable errors.
- [ ] Close, reload, resume, sleep, clock jumps, session replacement, forks, branch rewind, corrupted persistence, and duplicate ownership follow the stated policy.
- [ ] Crash windows are reported as uncertain; no silent retry and no exactly-once claim.
- [ ] Task text is treated as stored user-request data, not system authority; untrusted CI output cannot create further schedules or expand authorization.
- [ ] Tests cover happy and failure paths with fake time and fake delivery; no wall-clock waits or live network dependencies in automated tests.
- [ ] Localized coverage is measured for validation/state transitions and lifecycle adapters; record uncovered risk rather than use source-string tests as coverage.
- [ ] Manual short-timer smoke check and focused regression checks pass; no full repository check is required for planning.

## Future scope (not committed)

General recurring schedules beyond bounded current-task follow-ups; standalone/background execution; results inbox; OS notifications. Each requires its own lifecycle and authorization design.
