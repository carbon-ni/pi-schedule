export const help = `Schedule one-off work in this open Pi session.
Requires a writable private store and an awake computer. No background service.

/schedule in 30m Check CI for owner/repo#123 and report failures
/schedule at 2026-11-09T14:30:00+01:00 Check deployment status
/schedule list
/schedule show S-123                Inspect saved request and chain budget
/schedule cancel S-123
/schedule run S-123                 Explicitly run overdue work when idle
/schedule dismiss S-123             Dismiss an uncertain dispatch after inspection
/schedule budget S-123 5 3h         User-only: total chain runs and expiry from now

Use a complete instruction with the exact PR/project. Natural language uses
schedule_task; agent-created checks explain why and default to 3 runs / 2 hours.
Current permissions still apply. Closing Pi stops execution. Reload/resume of
missed work or a sleep/clock gap over 2 minutes marks it overdue; no auto catch-up.
Dispatched means Pi started the turn, not that the requested check succeeded.
Inspect uncertain work before dismissing; it is never automatically replayed.`;

export type Command =
  | { action: "help" | "list" }
  | { action: "cancel" | "run" | "dismiss" | "show"; id: string }
  | { action: "budget"; id: string; runs: number; seconds: number }
  | { action: "create"; instruction: string; delaySeconds?: number; runAt?: string };

function invalid(): never {
  throw new Error("Invalid schedule command. Use /schedule help for examples.");
}

export function duration(text: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(text);
  if (!match) return invalid();
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = Number(match[1]) * units[match[2]];
  if (!Number.isSafeInteger(seconds) || seconds < 1) return invalid();
  return seconds;
}

export function parseCommand(text: string): Command {
  const parts = text.trim().split(/\s+/);
  const [action, arg, ...rest] = parts;
  if ((!action || action === "help" || action === "list") && !arg)
    return { action: action === "list" ? "list" : "help" };
  if (["cancel", "run", "dismiss", "show"].includes(action) && arg && rest.length === 0) {
    return { action: action as "cancel" | "run" | "dismiss" | "show", id: arg };
  }
  if (action === "budget" && arg && rest.length === 2 && /^\d+$/.test(rest[0])) {
    return { action: "budget", id: arg, runs: Number(rest[0]), seconds: duration(rest[1]) };
  }
  if ((action === "in" || action === "at") && arg && rest.length > 0) {
    return {
      action: "create",
      instruction: rest.join(" "),
      ...(action === "in" ? { delaySeconds: duration(arg) } : { runAt: arg }),
    };
  }
  return invalid();
}
