export type Creator = "user" | "agent";
export type Status = "pending" | "uncertain" | "dispatched" | "cancelled" | "overdue";

export interface Task {
  id: string;
  sessionId: string;
  creator: Creator;
  instruction: string;
  projectPath: string;
  target: string;
  reason?: string;
  parentId?: string;
  rootId: string;
  createdAt: number;
  dueAt: number;
  status: Status;
}

export interface Chain {
  usedRuns: number;
  maxRuns: number;
  expiresAt: number;
  cancelled: boolean;
}

export interface State {
  version: 1;
  tasks: Record<string, Task>;
  chains: Record<string, Chain>;
  activeRootId?: string;
}

export interface CreateRequest {
  instruction: string;
  projectPath: string;
  target: string;
  delaySeconds?: number;
  runAt?: string;
  reason?: string;
  parentId?: string;
}

/** Attribution must be supplied by a trusted adapter, never by model arguments. */
export interface CreateContext {
  now: number;
  id: string;
  sessionId: string;
  creator: Creator;
}

const MAX_PENDING = 20;
const MAX_INSTRUCTION_BYTES = 8192;
const MAX_AGENT_RUNS = 3;
const CHAIN_LIFETIME_MS = 2 * 60 * 60 * 1000;

export function emptyState(): State {
  return { version: 1, tasks: {}, chains: {} };
}

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must not be blank.`);
  }
}

function requireTime(value: number): void {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 8.64e15) {
    throw new Error("Time must be a valid integer timestamp in milliseconds.");
  }
}

function getOwn<T>(records: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(records, key) ? records[key] : undefined;
}

function ownedTask(state: State, id: string, sessionId: string): Task {
  const task = getOwn(state.tasks, id);
  if (!task || task.sessionId !== sessionId) {
    throw new Error("Task not found in this session. Use /schedule list.");
  }
  return task;
}

function deadline(request: CreateRequest, now: number): number {
  if ((request.delaySeconds !== undefined) === (request.runAt !== undefined)) {
    throw new Error("Choose exactly one of delaySeconds or runAt.");
  }

  let dueAt: number;
  if (request.delaySeconds !== undefined) {
    if (!Number.isSafeInteger(request.delaySeconds) || request.delaySeconds <= 0) {
      throw new Error("delaySeconds must be a positive integer.");
    }
    dueAt = now + request.delaySeconds * 1000;
  } else {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
        request.runAt!,
      );
    if (!match) {
      throw new Error("runAt needs an ISO-8601 timestamp with seconds and timezone offset.");
    }
    // Date.parse normalizes impossible dates such as February 30; reject them.
    const calendar = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.getUTCDate() !== Number(match[3])) {
      throw new Error("runAt must contain a real calendar date.");
    }
    dueAt = Date.parse(request.runAt!);
  }

  requireTime(dueAt);
  if (dueAt <= now) throw new Error("Due time must be in the future.");
  return dueAt;
}

export function createTask(state: State, request: CreateRequest, ctx: CreateContext): State {
  requireTime(ctx.now);
  requireText(ctx.id, "Task ID");
  requireText(ctx.sessionId, "Session ID");
  requireText(request.instruction, "Instruction");
  requireText(request.projectPath, "Project path");
  requireText(request.target, "Target");
  if (new TextEncoder().encode(request.instruction).length > MAX_INSTRUCTION_BYTES) {
    throw new Error("Instruction must not exceed 8192 UTF-8 bytes.");
  }
  if (getOwn(state.tasks, ctx.id)) throw new Error("Task ID already exists.");
  const pending = Object.values(state.tasks).filter(
    (t) => t.sessionId === ctx.sessionId && (t.status === "pending" || t.status === "overdue"),
  );
  if (pending.length >= MAX_PENDING)
    throw new Error("Limit of 20 pending tasks reached. Use /schedule list.");

  const dueAt = deadline(request, ctx.now);
  if (ctx.creator === "agent") requireText(request.reason!, "Agent scheduling reason");

  const parent =
    request.parentId === undefined ? undefined : ownedTask(state, request.parentId, ctx.sessionId);
  if (parent && parent.status !== "dispatched") {
    throw new Error("Follow-up parent must have been dispatched.");
  }
  if (parent && (parent.target !== request.target || parent.projectPath !== request.projectPath)) {
    throw new Error("Follow-up scope must match the original project and target.");
  }
  const rootId = parent?.rootId ?? ctx.id;
  const chain = parent
    ? state.chains[rootId]
    : {
        usedRuns: 0,
        maxRuns: MAX_AGENT_RUNS,
        expiresAt: ctx.now + CHAIN_LIFETIME_MS,
        cancelled: false,
      };
  if (chain.cancelled) throw new Error("Follow-up chain is cancelled.");
  if (parent && pending.some((t) => t.rootId === rootId)) {
    throw new Error("This chain already has a pending follow-up. Use /schedule list.");
  }
  const consumesBudget = ctx.creator === "agent" || parent !== undefined;
  if (consumesBudget && chain.usedRuns >= chain.maxRuns) {
    throw new Error("Follow-up run budget exhausted. Ask the user before scheduling more work.");
  }
  if (consumesBudget && dueAt >= chain.expiresAt) {
    throw new Error("Follow-up deadline exceeds chain expiry. Report unresolved work to the user.");
  }

  const task: Task = {
    id: ctx.id,
    sessionId: ctx.sessionId,
    creator: ctx.creator,
    instruction: request.instruction,
    projectPath: request.projectPath,
    target: request.target,
    reason: request.reason,
    parentId: request.parentId,
    rootId,
    createdAt: ctx.now,
    dueAt,
    status: "pending",
  };
  return {
    ...state,
    tasks: { ...state.tasks, [task.id]: task },
    chains: {
      ...state.chains,
      [rootId]: {
        ...chain,
        usedRuns: chain.usedRuns + Number(consumesBudget),
      },
    },
  };
}

export function dueTasks(state: State, now: number, sessionId: string): Task[] {
  requireTime(now);
  return Object.values(state.tasks)
    .filter((t) => t.sessionId === sessionId && t.status === "pending" && t.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => ({ ...t }));
}

export function cancelTask(state: State, id: string, sessionId: string): State {
  const task = ownedTask(state, id, sessionId);
  if (task.status === "uncertain") {
    throw new Error("Dispatch may already have started; inspect the conversation before recovery.");
  }
  const tasks = { ...state.tasks };
  for (const candidate of Object.values(tasks)) {
    if (
      candidate.rootId === task.rootId &&
      (candidate.status === "pending" || candidate.status === "overdue")
    ) {
      tasks[candidate.id] = { ...candidate, status: "cancelled" };
    }
  }
  return {
    ...state,
    tasks,
    chains: { ...state.chains, [task.rootId]: { ...state.chains[task.rootId], cancelled: true } },
  };
}

/** Persist this returned intent before delivery; never automatically replay it. */
export function beginDispatch(state: State, id: string, sessionId: string, now: number): State {
  requireTime(now);
  const task = ownedTask(state, id, sessionId);
  if (task.status !== "pending" || task.dueAt > now) {
    throw new Error("Task must be pending and due before dispatch.");
  }
  const chain = state.chains[task.rootId];
  if (
    chain.cancelled ||
    ((task.creator === "agent" || task.parentId !== undefined) && now >= chain.expiresAt)
  ) {
    throw new Error("Follow-up chain is cancelled or expired. Report unresolved work to the user.");
  }
  return { ...state, tasks: { ...state.tasks, [id]: { ...task, status: "uncertain" } } };
}

export function confirmDispatch(state: State, id: string, sessionId: string): State {
  const task = ownedTask(state, id, sessionId);
  if (task.status !== "uncertain") throw new Error("No dispatch intent to acknowledge.");
  return { ...state, tasks: { ...state.tasks, [id]: { ...task, status: "dispatched" } } };
}
