import assert from "node:assert/strict";
import { test } from "node:test";
import { createTask, emptyState } from "../domain/scheduler.ts";
import { summary, details, listTasks, boundOutput } from "./presentation.ts";

test("presents exact saved instructions and budget without interpreting terminal control codes", () => {
  const state = createTask(
    emptyState(),
    {
      instruction: "Check CI\nDo not merge",
      target: "\u001b[31mrepo#1",
      projectPath: "/repo",
      delaySeconds: 60,
    },
    { id: "S-1", now: 1000, creator: "user", sessionId: "session" },
  );
  const task = state.tasks["S-1"];
  assert.ok(!summary(task).includes("\u001b"));
  assert.match(details(task, state.chains["S-1"]), /Saved request: "Check CI\\nDo not merge"/);
  assert.match(details(task, state.chains["S-1"]), /0\/3/);
});

test("keeps all active tasks visible ahead of terminal history and bounds UTF-8 tool output", () => {
  const state = createTask(
    emptyState(),
    {
      instruction: "Check CI",
      target: "repo#1",
      projectPath: "/repo",
      delaySeconds: 60,
    },
    { id: "S-1", now: 1000, creator: "user", sessionId: "session" },
  );
  const pending = state.tasks["S-1"];
  const history = Array.from({ length: 110 }, (_, i) => ({
    ...pending,
    id: "old-" + i,
    status: "cancelled" as const,
  }));
  const listed = listTasks([...history, pending]);
  assert.match(listed.split("\n")[0], /^S-1 \[pending\]/);
  assert.equal(listed.split("\n").length, 100);
  assert.match(listTasks([]), /No scheduled tasks/);
  assert.equal(boundOutput("short"), "short");
  const clipped = boundOutput("😀".repeat(20000));
  assert.ok(Buffer.byteLength(clipped) <= 50 * 1024);
  assert.match(clipped, /Output truncated/);
});
