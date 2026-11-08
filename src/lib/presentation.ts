import type { Task, Chain } from "../domain/scheduler.ts";

export function summary(task: Task): string {
  const due = new Date(task.dueAt).toLocaleString(undefined, { timeZoneName: "short" });
  return `${task.id} [${task.status}] ${due} — ${JSON.stringify(task.target.slice(0, 512))} (${task.creator})`;
}

export function details(task: Task, chain: Chain): string {
  return [
    summary(task),
    "Project: " + JSON.stringify(task.projectPath),
    "Saved request: " + JSON.stringify(task.instruction),
    "Reason: " + JSON.stringify(task.reason ?? "Explicit manual schedule"),
    `Root: ${task.rootId}. Agent checks: ${chain.usedRuns}/${chain.maxRuns}.`,
    "Chain expiry: " + new Date(chain.expiresAt).toISOString(),
  ].join("\n");
}

export function listTasks(tasks: Task[]): string {
  const active = tasks.filter((t) => ["pending", "overdue", "uncertain"].includes(t.status));
  const terminal = tasks
    .filter((t) => !["pending", "overdue", "uncertain"].includes(t.status))
    .reverse();
  const visible = [...active, ...terminal].slice(0, 100);
  return (
    visible.map(summary).join("\n") || "No scheduled tasks. Use /schedule in 30m <instruction>."
  );
}

export function boundOutput(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= 50 * 1024) return text;
  return (
    new TextDecoder().decode(bytes.subarray(0, 50 * 1024 - 100)) +
    "\n[Output truncated; use /schedule show <id> to inspect a task.]"
  );
}
