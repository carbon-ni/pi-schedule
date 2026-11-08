# Security and recovery

## Trust boundaries

Pi extensions execute with user permissions. This scheduler is not a sandbox,
and it does not prevent a malicious extension or another process running as the
same user from modifying files or invoking commands.

The tool schema accepts action, instruction, target, reason, deadline, and ID.
It does not accept creator, project path, session identity, root/parent, or budget.
The Pi adapter assigns those at trusted entrypoints. Agent-created roots remain
associated with the current request across reloads; scheduled turns bind the
actual dispatched parent, so omitting a model-supplied parent cannot reset limits.

Checking CI does not grant permission to fix, push, merge, cancel jobs, or start
unrelated monitoring. The scheduled prompt and tool guidelines preserve this
boundary. Scope matching and scheduling reasons are not proof of user intent;
semantic authorization still depends on the agent obeying current instructions.
Untrusted CI output is data, not a new scheduling authorization.

## Assets and controls

- Saved instructions may contain private project details. State stays local;
  do not include credentials or unnecessary transcript content.
- Directory and lock modes are 700; snapshots are 600. Final directory/file
  symlinks and non-private files are rejected. Parent paths belong to trusted Pi
  configuration. Atomic writes do not follow a supplied state-file symlink.
- A session has one exclusive owner. No automatic stale-lock deletion or replay.
- JSON schema, task/chain relationships, session/project identity, text bounds,
  history counts, and budgets are validated before restored state can run.
- A write failure stops scheduling until reload. A crash after a write but
  before delivery is uncertain; exactly-once external effects are not promised.
- Task summaries escape control characters; tool output is bounded to 50 KiB
  with a truncation notice. All active work appears before terminal history.
- No credentials, telemetry, external scheduler, or additional third-party
  service is used. The model handling a scheduled turn sees its saved request
  under the user's existing Pi provider settings.

## Lock and corruption recovery

Start with the exact path printed in the runtime error. The lock contains
`owner.json` with PID/token; the corresponding JSON snapshot is authoritative.

1. Close the other Pi session normally; reload this one.
2. After a crash, inspect `owner.json` and verify its PID no longer exists.
   For example, `ps -p <pid> -o pid=,command=` (PID reuse is possible, so inspect
   the process, not only whether a PID exists).
3. Only after verifying no live owner, remove that lock's `owner.json` using
   `rm -- <lock-path>/owner.json`, then `rmdir -- <lock-path>`, then `/reload`.
   Do not remove a lock just to silence an error.
4. For corrupt JSON, stop the owner and retain a private backup. Restore a known
   good snapshot or explicitly discard the affected session's schedules. The
   extension never overwrites corrupt data with an empty state automatically.

Uncertain work: `/schedule show <id>`, inspect the conversation/external effects,
then `/schedule dismiss <id>` without replay. If a new check is needed, create it
explicitly after inspection.

## Retention and deletion

History and cancellation/dispatch tombstones remain for the session's lifetime
(up to 1,000 records). No automatic pruning or transcript export occurs. Cancel
pending work before closing the session. To delete saved instructions, close its
owner and delete the corresponding JSON snapshot after checking its task/session
IDs. Do not delete active snapshots or tombstones to reset agent limits.

The Pi agent directory may be a symlink into a config repository. That repository
must ignore its `schedule/` directory, just as it ignores session/auth data.
This parent checkout explicitly ignores `pi/agent/schedule/`.

## Supply chain

Direct development dependencies are exact-pinned; npm's lockfile pins transitives.
Install scripts are disabled. Host Pi and TypeBox are peer dependencies, not a
second bundled runtime. `make security` audits the full installed graph.
The minimatch 11.0.4 override addresses GHSA-g3hv-75wg-m249 in lint dependencies;
remove it only when upstream constraints require patched versions.
