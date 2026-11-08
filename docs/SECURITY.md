# Trust boundaries

The core is not a security sandbox. Pi extensions run with user permissions.

## Current boundary

Caller supplies typed state, action, and trusted context. The core validates
creation inputs, times, ownership, instruction byte limit, pending-count limit,
and chain budgets. Transitions return new state and have no filesystem,
network, subprocess, or model effects. Instructions are data, not shell code.

Creation reason and matching project/target do not prove that an instruction is
authorized. The Pi adapter must preserve current user permissions and distinguish
untrusted CI output from user intent. “Check CI” never grants authority to push,
merge, modify code, or create unrelated monitoring.

## Required before runtime integration

- Derive creator and owning session from the command/tool entrypoint, not model
  arguments. Natural-language agent tools must not claim to be a manual command.
- Derive root/parent from the executing scheduled turn. Do not let the agent omit
  a parent to reset a chain budget or bypass user cancellation.
- Support user-controlled budget changes without letting agents approve their own
  extension. Current three-run/two-hour constants are provisional core defaults.
- Validate untrusted persisted state before calling core transitions. State is
  currently an in-memory typed object, not a supported public import format.
- Lock ownership before dispatch. Respect active turns and queued user work.
- Persist the uncertain dispatch intent before model delivery. A crash at the
  boundary requires explicit inspection, not replay. Delivery acknowledgement
  means dispatched, not successful task completion.
- Keep one private local store, omit credentials, document retention/deletion,
  and never resurrect cancelled/dispatched tasks after branch navigation.
- Add overdue/sleep/clock-jump policy before connecting dueTasks to a timer.
  dueTasks only orders candidates; it does not authorize execution.

No credentials, transcript export, telemetry, or third-party service is needed
by the current core. Automated tests do not make external calls.
