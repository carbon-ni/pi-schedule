import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store.ts";
import { createTask, emptyState } from "../domain/scheduler.ts";

function scratch(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "pi-schedule-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const state = () =>
  createTask(
    emptyState(),
    {
      instruction: "Check CI",
      target: "owner/repo#1",
      projectPath: "/repo",
      delaySeconds: 30,
    },
    { now: 1000, id: "S-1", creator: "user", sessionId: "session" },
  );

test("atomically round-trips private state and releases ownership for resume", (t) => {
  const root = scratch(t);
  const store = new FileStore(root, "session", "/repo");
  assert.deepEqual(store.load(), emptyState());

  store.save(state());
  assert.equal(statSync(store.file).mode & 0o777, 0o600);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.deepEqual(store.load(), JSON.parse(JSON.stringify(state())));
  store.close();
  store.close();

  const resumed = new FileStore(root, "session", "/repo");
  assert.deepEqual(resumed.load(), JSON.parse(JSON.stringify(state())));
  resumed.close();
});

test("a second session owner cannot load or mutate an occupied store", (t) => {
  const root = scratch(t);
  const first = new FileStore(root, "session", "/repo");

  assert.throws(() => new FileStore(root, "session", "/repo"), /locked/);
  const other = new FileStore(root, "different", "/repo");
  other.close();
  first.close();
});

test("corrupt state and foreign session/project identity fail closed without discarding data", (t) => {
  const root = scratch(t);
  const store = new FileStore(root, "session", "/repo");
  for (const invalid of [
    "{broken",
    JSON.stringify({ version: 99 }),
    JSON.stringify({ ...state(), activeRootId: "missing" }),
    JSON.stringify({ ...state(), chains: {} }),
    JSON.stringify({
      ...state(),
      tasks: { "S-1": { ...state().tasks["S-1"], sessionId: "other" } },
    }),
    JSON.stringify({
      ...state(),
      tasks: { "S-1": { ...state().tasks["S-1"], projectPath: "/other" } },
    }),
    JSON.stringify({ ...state(), tasks: { "S-1": { ...state().tasks["S-1"], id: "different" } } }),
    JSON.stringify({ ...state(), chains: { "S-1": { ...state().chains["S-1"], usedRuns: -1 } } }),
  ]) {
    writeFileSync(store.file, invalid, { mode: 0o600 });
    assert.throws(() => store.load());
    assert.equal(readFileSync(store.file, "utf8"), invalid);
  }
  store.close();
});

test("symlinked directories and state files are rejected", (t) => {
  const root = scratch(t);
  const alias = join(root, "alias");
  symlinkSync(root, alias);
  assert.throws(() => new FileStore(alias, "session", "/repo"), /directory/);
  const store = new FileStore(join(root, "data"), "session", "/repo");
  const target = join(root, "target");
  writeFileSync(target, "{}");
  symlinkSync(target, store.file);
  assert.throws(() => store.load(), /regular/);
  store.close();
});

test("closed stores reject reads and writes; history bounds protect decoding", (t) => {
  const root = scratch(t);
  const store = new FileStore(root, "session", "/repo");
  writeFileSync(store.file, " ".repeat(16 * 1024 * 1024 + 1), { mode: 0o600 });
  assert.throws(() => store.load(), /large/);
  store.close();
  assert.throws(() => store.save(state()), /closed/);
  assert.throws(() => store.load(), /closed/);
  assert.equal(existsSync(store.lock), false);
});
