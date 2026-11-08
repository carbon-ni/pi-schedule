import assert from "node:assert/strict";
import { test } from "node:test";
import { Runtime, type Store } from "./runtime.ts";
import { emptyState, type Task } from "../domain/scheduler.ts";

function fixture(initial = emptyState()) {
  let state = structuredClone(initial);
  let now = 1000000;
  let available = true;
  let parent: string | undefined;
  let failSave = false;
  let failDelivery = false;
  let seq = 0;
  const sent: Task[] = [];
  const notices: string[] = [];
  const store: Store = {
    load: () => structuredClone(state),
    save: (next) => {
      if (failSave) throw new Error("disk full");
      state = structuredClone(next);
    },
    close() {},
  };
  const runtime = new Runtime(store, "session", "/repo", {
    now: () => now,
    id: () => "S-" + ++seq,
    available: () => available,
    deliver: (task) => {
      assert.equal(state.tasks[task.id].status, "uncertain");
      if (failDelivery) throw new Error("delivery failed");
      sent.push(task);
      parent = task.id;
      runtime.scheduledTurn(task.id);
    },
    notify: (message) => notices.push(message),
  });
  runtime.start();
  return {
    runtime,
    sent,
    notices,
    state: () => state,
    advance: (ms: number) => {
      now += ms;
    },
    busy: (value: boolean) => {
      available = !value;
    },
    failSave: () => {
      failSave = true;
    },
    failDelivery: () => {
      failDelivery = true;
    },
    parent: () => parent,
  };
}
const request = { instruction: "Report CI status", target: "owner/repo#1", delaySeconds: 1 };

test("persists creation and intent before sending exactly once at the deadline", () => {
  const f = fixture();
  const task = f.runtime.create(request, "user");
  f.runtime.tick();
  assert.equal(f.sent.length, 0);
  f.advance(1000);
  f.runtime.tick();
  f.runtime.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].id, task.id);
  assert.equal(f.state().tasks[task.id].status, "dispatched");
});

test("busy work remains cancellable and dispatches after continuous observed waiting", () => {
  const f = fixture();
  const task = f.runtime.create(request, "user");
  f.busy(true);
  f.advance(1000);
  f.runtime.tick();
  for (let i = 0; i < 130; i++) {
    f.advance(1000);
    f.runtime.tick();
  }
  assert.equal(f.sent.length, 0);
  f.busy(false);
  f.runtime.tick();
  assert.equal(f.sent.length, 1);
  const second = f.runtime.create(request, "user");
  f.busy(true);
  f.advance(1000);
  f.runtime.tick();
  f.runtime.cancel(second.id);
  f.busy(false);
  f.runtime.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.state().tasks[task.id].status, "dispatched");
});

test("sleep gaps and restored missed deadlines become overdue without surprise execution", () => {
  const f = fixture();
  const task = f.runtime.create(request, "user");
  f.advance(180000);
  f.runtime.tick();
  assert.equal(f.state().tasks[task.id].status, "overdue");
  assert.equal(f.sent.length, 0);
  const restored = fixture(f.state());
  restored.advance(180000);
  restored.runtime.run(task.id);
  assert.equal(restored.sent.length, 1);
  assert.throws(() => restored.runtime.run(task.id));
});

test("future work survives resume but past pending deadlines require explicit recovery", () => {
  const f = fixture();
  const task = f.runtime.create(request, "user");
  const restored = fixture(f.state());
  restored.advance(1000);
  restored.runtime.tick();
  assert.equal(restored.sent.length, 1);
  const old = structuredClone(f.state());
  old.tasks[task.id].createdAt = 990000;
  old.tasks[task.id].dueAt = 999999;
  const overdue = fixture(old);
  assert.equal(overdue.state().tasks[task.id].status, "overdue");
  assert.equal(overdue.sent.length, 0);
});

test("save failures prevent acknowledgement/delivery and delivery failures remain uncertain", () => {
  const f = fixture();
  f.failSave();
  assert.throws(() => f.runtime.create(request, "user"), /disk full/);
  assert.equal(f.runtime.list().length, 0);
  const other = fixture();
  const task = other.runtime.create(request, "user");
  other.failDelivery();
  other.advance(1000);
  other.runtime.tick();
  assert.equal(other.state().tasks[task.id].status, "uncertain");
  assert.equal(other.sent.length, 0);
  other.runtime.tick();
  assert.equal(other.sent.length, 0);
  assert.throws(() => other.runtime.run(task.id), /uncertain/);
});

test("agent roots cannot reset their own budget or evade cancellation", () => {
  const f = fixture();
  const first = f.runtime.create({ ...request, reason: "CI is running" }, "agent");
  assert.throws(() => f.runtime.create({ ...request, reason: "Again" }, "agent"), /pending/);
  f.advance(1000);
  f.runtime.tick();
  const child = f.runtime.create({ ...request, reason: "Still running" }, "agent");
  assert.equal(child.parentId, first.id);
  f.runtime.cancel(child.id);
  assert.throws(() => f.runtime.create({ ...request, reason: "Again" }, "agent"), /cancelled/);
  f.runtime.newUserRequest();
  assert.doesNotThrow(() => f.runtime.create({ ...request, reason: "New user request" }, "agent"));
});

test("scheduled turns bind the actual parent, and shutdown prevents future dispatch", () => {
  const f = fixture();
  const manual = f.runtime.create(request, "user");
  f.advance(1000);
  f.runtime.tick();
  f.runtime.scheduledTurn(manual.id);
  const child = f.runtime.create({ ...request, reason: "Waiting" }, "agent");
  assert.equal(child.parentId, manual.id);
  f.runtime.close();
  f.advance(1000);
  f.runtime.tick();
  assert.equal(f.sent.length, 1);
  assert.throws(() => f.runtime.create(request, "user"), /closed/);
});

test("manual budget changes are validated and expired agent work is not dispatched", () => {
  const f = fixture();
  const task = f.runtime.create({ ...request, reason: "Waiting" }, "agent");
  assert.throws(() => f.runtime.budget(task.id, 0, 60));
  f.runtime.budget(task.id, 4, 60);
  for (let i = 0; i < 61; i++) f.advance(1000);
  f.runtime.tick();
  assert.equal(f.state().tasks[task.id].status, "overdue");
  assert.equal(f.sent.length, 0);
});

test("backward clock changes never run early and uncertain restored work requires dismissal", () => {
  const f = fixture();
  const task = f.runtime.create(request, "user");
  f.advance(-2000);
  f.runtime.tick();
  f.advance(2999);
  f.runtime.tick();
  assert.equal(f.sent.length, 0);
  f.advance(1);
  f.runtime.tick();
  assert.equal(f.sent.length, 1);

  const snapshot = f.state();
  snapshot.tasks[task.id].status = "uncertain";
  const restored = fixture(snapshot);
  restored.advance(1000);
  restored.runtime.tick();
  assert.equal(restored.sent.length, 0);
  restored.runtime.dismiss(task.id);
  assert.equal(restored.state().tasks[task.id].status, "cancelled");
  assert.throws(() => restored.runtime.dismiss(task.id), /Only uncertain/);
});

test("a persistence failure while claiming dispatch stops all later automatic work", () => {
  const f = fixture();
  const task = f.runtime.create(request, "user");
  f.advance(1000);
  f.failSave();
  assert.throws(() => f.runtime.tick(), /disk full/);
  f.runtime.tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.state().tasks[task.id].status, "pending");
});

test("only one due task is sent per tick and explicit recovery respects user work", () => {
  const f = fixture();
  const a = f.runtime.create(request, "user");
  f.runtime.create(request, "user");
  f.advance(1000);
  f.runtime.tick();
  assert.equal(f.sent.length, 1);
  f.runtime.tick();
  assert.equal(f.sent.length, 2);
  const sleeping = fixture();
  const old = sleeping.runtime.create(request, "user");
  sleeping.advance(180000);
  sleeping.runtime.tick();
  sleeping.busy(true);
  assert.throws(() => sleeping.runtime.run(old.id), /idle/);
  assert.throws(() => f.runtime.cancel("missing"));
  assert.equal(a.sessionId, "session");
});
