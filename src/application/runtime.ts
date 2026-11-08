import {
  emptyState,
  createTask,
  cancelTask,
  dueTasks,
  beginDispatch,
  confirmDispatch,
  type State,
  type Task,
  type Creator,
  type CreateRequest,
} from "../domain/scheduler.ts";

export interface Store {
  load(): State;
  save(state: State): void;
  close(): void;
}

interface Dependencies {
  now(): number;
  id(): string;
  available(): boolean;
  deliver(task: Task): void;
  notify(message: string): void;
}

const GRACE_MS = 120_000;

export class Runtime {
  private state = emptyState();
  private closed = false;
  private lastTick: number;
  private waiting = new Set<string>();
  private parentId?: string;

  private readonly store: Store;
  readonly sessionId: string;
  private readonly projectPath: string;
  private readonly deps: Dependencies;

  constructor(store: Store, sessionId: string, projectPath: string, deps: Dependencies) {
    this.store = store;
    this.sessionId = sessionId;
    this.projectPath = projectPath;
    this.deps = deps;
    this.lastTick = deps.now();
  }

  start(): void {
    this.state = this.store.load();
    const now = this.deps.now();
    const tasks = { ...this.state.tasks };
    for (const task of Object.values(tasks)) {
      if (task.status === "pending" && task.dueAt <= now) {
        tasks[task.id] = { ...task, status: "overdue" };
      }
    }
    this.commit({ ...this.state, tasks });
    for (const task of this.list().filter((t) => ["overdue", "uncertain"].includes(t.status))) {
      this.deps.notify(`${task.id} is ${task.status}. Inspect /schedule list before recovery.`);
    }
  }

  get stopped(): boolean {
    return this.closed;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Scheduler is closed. Reload Pi before scheduling.");
  }

  private commit(next: State): void {
    this.assertOpen();
    try {
      this.store.save(next);
    } catch (error) {
      this.closed = true;
      try {
        this.store.close();
      } catch {
        /* Preserve the persistence failure; stale ownership fails closed. */
      }
      throw new Error(
        `Scheduler stopped after persistence failure: ${String(error)}. Use /reload before retrying.`,
        { cause: error },
      );
    }
    this.state = next;
  }

  private task(id: string): Task {
    const task = Object.hasOwn(this.state.tasks, id) ? this.state.tasks[id] : undefined;
    if (!task || task.sessionId !== this.sessionId)
      throw new Error("Unknown task. Use /schedule list.");
    return task;
  }

  list(): Task[] {
    return Object.values(this.state.tasks).map((t) => ({ ...t }));
  }

  inspect(id: string): { task: Task; chain: State["chains"][string] } {
    const task = this.task(id);
    return { task: { ...task }, chain: { ...this.state.chains[task.rootId] } };
  }

  newUserRequest(): void {
    this.parentId = undefined;
    this.commit({ ...this.state, activeRootId: undefined });
  }

  scheduledTurn(id: string): void {
    const task = this.task(id);
    if (task.status === "uncertain") this.commit(confirmDispatch(this.state, id, this.sessionId));
    else if (task.status !== "dispatched")
      throw new Error("No dispatch intent for this scheduled turn.");
    this.parentId = id;
    this.commit({ ...this.state, activeRootId: task.rootId });
  }

  create(request: Omit<CreateRequest, "projectPath" | "parentId">, creator: Creator): Task {
    this.assertOpen();
    if (Object.keys(this.state.tasks).length >= 1000) {
      throw new Error("Session task history limit reached (1000). Start a new Pi session.");
    }
    let parentId: string | undefined;
    if (creator === "agent" && this.state.activeRootId) {
      const chain = this.state.chains[this.state.activeRootId];
      if (chain.cancelled)
        throw new Error("Follow-up chain is cancelled. Wait for a new user request.");
      if (
        this.list().some(
          (t) =>
            t.rootId === this.state.activeRootId &&
            ["pending", "overdue", "uncertain"].includes(t.status),
        )
      ) {
        throw new Error("Chain already has pending or uncertain work. Use /schedule list.");
      }
      parentId =
        this.parentId ??
        this.list()
          .filter((t) => t.rootId === this.state.activeRootId && t.status === "dispatched")
          .at(-1)?.id;
      if (!parentId) throw new Error("No dispatched parent. Wait for the scheduled check.");
    }
    const id = this.deps.id();
    const next = createTask(
      this.state,
      { ...request, projectPath: this.projectPath, parentId },
      {
        id,
        sessionId: this.sessionId,
        creator,
        now: this.deps.now(),
      },
    );
    if (creator === "agent") next.activeRootId = next.tasks[id].rootId;
    this.commit(next);
    return { ...this.state.tasks[id] };
  }

  cancel(id: string): void {
    this.commit(cancelTask(this.state, id, this.sessionId));
    this.waiting.delete(id);
  }

  dismiss(id: string): void {
    const task = this.task(id);
    if (task.status !== "uncertain")
      throw new Error("Only uncertain dispatches need /schedule dismiss <id>.");
    this.commit(
      cancelTask(
        { ...this.state, tasks: { ...this.state.tasks, [id]: { ...task, status: "pending" } } },
        id,
        this.sessionId,
      ),
    );
  }

  budget(id: string, runs: number, seconds: number): void {
    const task = this.task(id);
    if (
      !Number.isSafeInteger(runs) ||
      runs < 1 ||
      runs > 20 ||
      !Number.isSafeInteger(seconds) ||
      seconds < 1 ||
      seconds > 86400
    ) {
      throw new Error("Usage: /schedule budget <id> <1..20 runs> <duration up to 24h>.");
    }
    const chain = this.state.chains[task.rootId];
    if (runs < chain.usedRuns) throw new Error("Budget cannot be lower than already used runs.");
    this.commit({
      ...this.state,
      chains: {
        ...this.state.chains,
        [task.rootId]: { ...chain, maxRuns: runs, expiresAt: this.deps.now() + seconds * 1000 },
      },
    });
  }

  run(id: string): void {
    const task = this.task(id);
    if (task.status !== "overdue")
      throw new Error(`Task is ${task.status}; only overdue work can be explicitly run.`);
    if (!this.deps.available() || this.list().some((t) => t.status === "uncertain")) {
      throw new Error("Wait until Pi is idle and resolve uncertain dispatches first.");
    }
    this.dispatch(task);
  }

  private dispatch(task: Task): void {
    const pending = {
      ...this.state,
      tasks: { ...this.state.tasks, [task.id]: { ...task, status: "pending" as const } },
    };
    this.commit(beginDispatch(pending, task.id, this.sessionId, this.deps.now()));
    // Only the actual Pi run-start event acknowledges delivery. A void API call cannot.
    try {
      this.deps.deliver(task);
    } catch (error) {
      this.deps.notify(
        `${task.id} dispatch uncertain: ${String(error)}. Inspect before /schedule dismiss ${task.id}.`,
      );
    }
  }

  tick(): void {
    if (this.closed) return;
    const now = this.deps.now();
    const gap = now - this.lastTick > GRACE_MS;
    this.lastTick = now;
    const available = this.deps.available();
    const due = dueTasks(this.state, now, this.sessionId);
    for (const task of due) {
      const chain = this.state.chains[task.rootId];
      const expired =
        (task.creator === "agent" || task.parentId !== undefined) && now >= chain.expiresAt;
      if (expired || gap || (now - task.dueAt > GRACE_MS && !this.waiting.has(task.id))) {
        this.commit({
          ...this.state,
          tasks: { ...this.state.tasks, [task.id]: { ...task, status: "overdue" } },
        });
        this.waiting.delete(task.id);
        this.deps.notify(
          `${task.id} overdue${expired ? " (chain expired)" : ""}. Inspect /schedule list; use /schedule run ${task.id} when ready.`,
        );
        continue;
      }
      if (!available) {
        this.waiting.add(task.id);
        continue;
      }
      if (this.list().some((t) => t.status === "uncertain")) return;
      this.dispatch(task);
      this.waiting.delete(task.id);
      return;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.store.close();
  }
}
