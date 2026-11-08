import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTask, cancelTask, dueTasks, beginDispatch, confirmDispatch, emptyState,
  type CreateRequest, type State,
} from "./scheduler.ts";

const now = Date.parse("2026-11-08T10:00:00Z");
const context = { now, id: "S-1", sessionId: "session-1", creator: "user" as const };
const request: CreateRequest = {
  instruction: "Check CI for carbon-ni/pi-schedule#123 and report status.",
  projectPath: "/projects/pi-schedule",
  target: "carbon-ni/pi-schedule#123",
  delaySeconds: 1800,
};

function scheduled() {
  return createTask(emptyState(), request, context);
}

test("creates a session-owned description with an exact deadline without mutating state", () => {
  const state = emptyState();

  const result = createTask(state, request, context);

  assert.equal(result.tasks["S-1"].dueAt, now + 1_800_000);
  assert.equal(result.tasks["S-1"].sessionId, "session-1");
  assert.equal(result.tasks["S-1"].creator, "user");
  assert.equal(result.tasks["S-1"].instruction, request.instruction);
  assert.deepEqual(state, emptyState());
});

test("normalizes an absolute timestamp with an explicit offset", () => {
  const result = createTask(emptyState(), {
    ...request, delaySeconds: undefined, runAt: "2026-11-08T12:30:00+02:00",
  }, context);

  assert.equal(result.tasks["S-1"].dueAt, now + 1_800_000);
});

test("rejects invalid timing without changing state", () => {
  const state = emptyState();
  const invalid = [
    { delaySeconds: undefined },
    { runAt: "2026-11-08T12:00:00Z" },
    { delaySeconds: 0 }, { delaySeconds: -1 }, { delaySeconds: 1.5 },
    { delaySeconds: Infinity }, { delaySeconds: Number.MAX_SAFE_INTEGER },
    { delaySeconds: undefined, runAt: "2026-11-08T12:00:00" },
    { delaySeconds: undefined, runAt: "not-a-date" },
    { delaySeconds: undefined, runAt: "2026-11-08T09:00:00Z" },
    { delaySeconds: undefined, runAt: "2026-02-30T12:00:00Z" },
  ];

  for (const timing of invalid) {
    assert.throws(() => createTask(state, { ...request, ...timing }, context));
  }
  assert.deepEqual(state, emptyState());
});

test("rejects blank scope, oversized instructions, invalid clocks and duplicate IDs", () => {
  for (const fields of [
    { instruction: " " }, { instruction: "x".repeat(8193) },
    { target: "" }, { projectPath: "" },
  ]) {
    assert.throws(() => createTask(emptyState(), { ...request, ...fields }, context));
  }
  assert.throws(() => createTask(emptyState(), request, { ...context, sessionId: "" }));
  assert.throws(() => createTask(emptyState(), request, { ...context, id: "" }));
  assert.throws(() => createTask(emptyState(), request, { ...context, now: NaN }));
  assert.throws(() => createTask(scheduled(), request, context));
});

test("lists due work by deadline then stable ID and never runs early", () => {
  let state = scheduled();
  state = createTask(state, request, { ...context, id: "S-2" });
  state = createTask(state, { ...request, delaySeconds: 60 }, { ...context, id: "S-3" });

  assert.deepEqual(dueTasks(state, now, "session-1"), []);
  assert.deepEqual(dueTasks(state, now + 1_800_000, "session-1").map(t => t.id),
    ["S-3", "S-1", "S-2"]);
  assert.deepEqual(dueTasks(state, now + 1_800_000, "other-session"), []);
});

test("cancellation is idempotent and prevents dispatch", () => {
  const state = scheduled();

  const cancelled = cancelTask(state, "S-1", "session-1");

  assert.equal(cancelled.tasks["S-1"].status, "cancelled");
  assert.equal(state.tasks["S-1"].status, "pending");
  assert.deepEqual(cancelTask(cancelled, "S-1", "session-1"), cancelled);
  assert.deepEqual(dueTasks(cancelled, now + 1_800_000, "session-1"), []);
  assert.throws(() => beginDispatch(cancelled, "S-1", "session-1", now + 1_800_000));
});

test("dispatch intent is uncertain until delivery is acknowledged, and cannot replay", () => {
  const state = scheduled();

  const claimed = beginDispatch(state, "S-1", "session-1", now + 1_800_000);
  const delivered = confirmDispatch(claimed, "S-1", "session-1");

  assert.equal(claimed.tasks["S-1"].status, "uncertain");
  assert.equal(delivered.tasks["S-1"].status, "dispatched");
  assert.deepEqual(dueTasks(claimed, now + 1_800_000, "session-1"), []);
  assert.throws(() => beginDispatch(claimed, "S-1", "session-1", now + 1_800_000));
  assert.throws(() => beginDispatch(delivered, "S-1", "session-1", now + 1_800_000));
  assert.throws(() => cancelTask(claimed, "S-1", "session-1"));
  assert.throws(() => confirmDispatch(state, "S-1", "session-1"));
});

test("rejects early dispatch, unknown tasks and cross-session mutations", () => {
  const state = scheduled();

  assert.throws(() => beginDispatch(state, "S-1", "session-1", now));
  assert.throws(() => cancelTask(state, "missing", "session-1"));
  assert.throws(() => cancelTask(state, "S-1", "other-session"));
  assert.throws(() => beginDispatch(state, "S-1", "other-session", now + 1_800_000));
  assert.throws(() => confirmDispatch(state, "S-1", "other-session"));
});

function agentChild(state: State, parentId: string, id: string, time: number) {
  return createTask(state, { ...request, delaySeconds: 60, parentId,
    reason: "CI is still running." },
    { ...context, id, now: time, creator: "agent" });
}

test("agent scheduling requires a visible reason and respects original scope", () => {
  assert.throws(() => createTask(emptyState(), request, { ...context, creator: "agent" }));
  const time = now + 1_800_000;
  const state = confirmDispatch(beginDispatch(scheduled(), "S-1", "session-1", time),
    "S-1", "session-1");
  assert.throws(() => createTask(state, { ...request, parentId: "S-1", reason: "Waiting",
    target: "different/repo#1" }, { ...context, now: time, id: "S-2", creator: "agent" }), /scope/);
  assert.throws(() => createTask(state, { ...request, parentId: "S-1", reason: "Waiting",
    projectPath: "/other-project" }, { ...context, now: time, id: "S-2", creator: "agent" }), /scope/);
});

test("agent-created roots consume budget and expire after two hours", () => {
  const state = createTask(emptyState(), { ...request, reason: "CI is running" },
    { ...context, creator: "agent" });

  assert.equal(state.chains["S-1"].usedRuns, 1);
  assert.equal(state.chains["S-1"].expiresAt, now + 7_200_000);
  assert.equal(state.tasks["S-1"].reason, "CI is running");
  assert.throws(() => createTask(emptyState(), { ...request,
    delaySeconds: 7201, reason: "CI is running" }, { ...context, creator: "agent" }));
});

test("descendants share a three-run budget instead of resetting it", () => {
  let state = scheduled();
  let parent = "S-1";
  let time = now + 1_800_000;
  for (let i = 2; i <= 4; i++) {
    state = confirmDispatch(beginDispatch(state, parent, "session-1", time), parent, "session-1");
    const id = `S-${i}`;
    state = agentChild(state, parent, id, time);
    parent = id;
    time += 60_000;
  }
  state = confirmDispatch(beginDispatch(state, parent, "session-1", time), parent, "session-1");

  assert.equal(state.chains["S-1"].usedRuns, 3);
  assert.equal(state.tasks["S-4"].rootId, "S-1");
  assert.throws(() => agentChild(state, parent, "S-5", time), /budget/);
});

test("cancelled chains cannot be recreated, even from a previously dispatched parent", () => {
  let state = scheduled();
  state = confirmDispatch(beginDispatch(state, "S-1", "session-1", now + 1_800_000),
    "S-1", "session-1");
  state = agentChild(state, "S-1", "S-2", now + 1_800_000);

  state = cancelTask(state, "S-2", "session-1");

  assert.equal(state.chains["S-1"].cancelled, true);
  assert.throws(() => agentChild(state, "S-1", "S-3", now + 1_800_000), /cancelled/);
});

test("rejects fan-out, expired chains and cross-session parent references", () => {
  const state = scheduled();
  assert.throws(() => agentChild(state, "S-1", "S-2", now), /dispatched/);
  const delivered = confirmDispatch(
    beginDispatch(state, "S-1", "session-1", now + 1_800_000), "S-1", "session-1");
  const child = agentChild(delivered, "S-1", "S-2", now + 1_800_000);

  assert.throws(() => agentChild(child, "S-1", "S-3", now + 1_800_000), /pending/);
  assert.throws(() => agentChild(delivered, "S-1", "S-2", now + 7_200_000), /expiry/);
  assert.throws(() => createTask(delivered, { ...request, parentId: "S-1", reason: "Waiting" },
    { ...context, id: "S-2", sessionId: "other", creator: "agent" }));
});

test("rejects cancelled parents, late agent delivery and invalid dispatch clocks", () => {
  const cancelled = cancelTask(scheduled(), "S-1", "session-1");
  assert.throws(() => agentChild(cancelled, "S-1", "S-2", now + 1_800_000), /dispatched/);
  const agent = createTask(emptyState(), { ...request, reason: "CI is running" },
    { ...context, creator: "agent" });

  assert.throws(() => beginDispatch(agent, "S-1", "session-1", now + 7_200_000), /expired/);
  assert.throws(() => beginDispatch(agent, "S-1", "session-1", NaN));
  assert.throws(() => dueTasks(agent, Infinity, "session-1"));
});

test("rejects pending descendants even when the original parent is already dispatched", () => {
  let state = scheduled();
  state = confirmDispatch(beginDispatch(state, "S-1", "session-1", now + 1_800_000),
    "S-1", "session-1");
  state = agentChild(state, "S-1", "S-2", now + 1_800_000);

  const cancelled = cancelTask(state, "S-1", "session-1");

  assert.equal(cancelled.tasks["S-1"].status, "dispatched");
  assert.equal(cancelled.tasks["S-2"].status, "cancelled");
});

test("returned due tasks cannot mutate stored instructions and IDs cannot access prototypes", () => {
  const state = scheduled();
  const tasks = dueTasks(state, now + 1_800_000, "session-1");

  tasks[0].instruction = "changed";

  assert.equal(state.tasks["S-1"].instruction, request.instruction);
  assert.throws(() => cancelTask(state, "__proto__", "session-1"));
  const special = createTask(state, request, { ...context, id: "__proto__" });
  assert.equal(special.tasks["__proto__"].id, "__proto__");
  assert.equal(Object.getPrototypeOf(special.tasks), Object.prototype);
});

test("bounds instruction size in UTF-8 bytes, not JavaScript characters", () => {
  assert.throws(() => createTask(emptyState(), { ...request,
    instruction: "😀".repeat(2049) }, context), /bytes/);
});

test("limits pending work to twenty tasks per session", () => {
  let state = emptyState();
  for (let i = 0; i < 20; i++) {
    state = createTask(state, request, { ...context, id: `S-${i}` });
  }

  assert.throws(() => createTask(state, request, { ...context, id: "overflow" }), /20/);
  const other = createTask(state, request, { ...context, id: "other", sessionId: "other" });
  assert.equal(other.tasks.other.sessionId, "other");
});
