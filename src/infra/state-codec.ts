import { Type } from "typebox";
import { Check } from "typebox/value";
import type { State } from "../domain/scheduler.ts";

const text = Type.String({ minLength: 1, maxLength: 8192 });
const time = Type.Integer({ minimum: -8.64e15, maximum: 8.64e15 });
const taskSchema = Type.Object(
  {
    id: text,
    sessionId: text,
    creator: Type.Union([Type.Literal("user"), Type.Literal("agent")]),
    instruction: text,
    projectPath: text,
    target: text,
    reason: Type.Optional(text),
    parentId: Type.Optional(text),
    rootId: text,
    createdAt: time,
    dueAt: time,
    status: Type.Union(
      ["pending", "uncertain", "dispatched", "cancelled", "overdue"].map((v) => Type.Literal(v)),
    ),
  },
  { additionalProperties: false },
);
const chainSchema = Type.Object(
  {
    usedRuns: Type.Integer({ minimum: 0, maximum: 20 }),
    maxRuns: Type.Integer({ minimum: 1, maximum: 20 }),
    expiresAt: time,
    cancelled: Type.Boolean(),
  },
  { additionalProperties: false },
);
const stateSchema = Type.Object(
  {
    version: Type.Literal(1),
    tasks: Type.Record(Type.String(), taskSchema),
    chains: Type.Record(Type.String(), chainSchema),
    activeRootId: Type.Optional(text),
  },
  { additionalProperties: false },
);

/** Decode at the filesystem boundary, including graph invariants beyond JSON shape. */
export function decodeState(raw: string, sessionId: string, projectPath: string): State {
  const data: unknown = JSON.parse(raw);
  if (!Check(stateSchema, data))
    throw new Error("Invalid scheduler state schema. Restore a backup; no tasks were discarded.");
  const state = data as State;
  const tasks = Object.values(state.tasks);
  if (tasks.length > 1000 || Object.keys(state.chains).length > 1000)
    throw new Error("Scheduler history is too large.");
  for (const [id, task] of Object.entries(state.tasks)) {
    if (
      id !== task.id ||
      task.sessionId !== sessionId ||
      task.projectPath !== projectPath ||
      !Object.hasOwn(state.chains, task.rootId) ||
      Buffer.byteLength(task.instruction) > 8192 ||
      !task.instruction.trim() ||
      !task.target.trim() ||
      task.dueAt <= task.createdAt
    ) {
      throw new Error("Invalid task ownership, scope, deadline, or chain.");
    }
    const root = Object.hasOwn(state.tasks, task.rootId) ? state.tasks[task.rootId] : undefined;
    if (!root || root.rootId !== root.id || root.parentId) throw new Error("Invalid root task.");
    if (task.creator === "agent" && !task.reason?.trim())
      throw new Error("Missing agent scheduling reason.");
    if (task.parentId !== undefined) {
      const parent = Object.hasOwn(state.tasks, task.parentId)
        ? state.tasks[task.parentId]
        : undefined;
      if (
        !parent ||
        parent.rootId !== task.rootId ||
        parent.target !== task.target ||
        parent.createdAt > task.createdAt ||
        parent.status !== "dispatched"
      )
        throw new Error("Invalid follow-up parent.");
    }
  }
  for (const [rootId, chain] of Object.entries(state.chains)) {
    if (!Object.hasOwn(state.tasks, rootId) || chain.usedRuns > chain.maxRuns)
      throw new Error("Invalid chain budget.");
    const members = tasks.filter((t) => t.rootId === rootId);
    const used = members.filter((t) => t.creator === "agent" || t.parentId !== undefined).length;
    if (
      used !== chain.usedRuns ||
      (chain.cancelled && members.some((t) => ["pending", "overdue"].includes(t.status)))
    ) {
      throw new Error("Inconsistent chain history.");
    }
  }
  if (state.activeRootId !== undefined && !Object.hasOwn(state.chains, state.activeRootId)) {
    throw new Error("Unknown active follow-up chain.");
  }
  if (tasks.filter((t) => ["pending", "overdue"].includes(t.status)).length > 20)
    throw new Error("Too many pending tasks.");
  return structuredClone(state);
}
