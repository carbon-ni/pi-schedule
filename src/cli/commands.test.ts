import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand, duration, help } from "./commands.ts";

test("parses direct manual creation and timezone-qualified dates without an LLM", () => {
  assert.deepEqual(parseCommand("in 30m check CI"), {
    action: "create",
    instruction: "check CI",
    delaySeconds: 1800,
  });
  assert.deepEqual(parseCommand("at 2026-11-09T12:00:00Z report status"), {
    action: "create",
    instruction: "report status",
    runAt: "2026-11-09T12:00:00Z",
  });
  assert.equal(duration("2h"), 7200);
  assert.equal(duration("10s"), 10);
  assert.equal(duration("1d"), 86400);
});

test("parses help, list, cancellation, recovery and user-only budget controls", () => {
  assert.deepEqual(parseCommand(""), { action: "help" });
  assert.deepEqual(parseCommand("help"), { action: "help" });
  assert.deepEqual(parseCommand("list"), { action: "list" });
  assert.deepEqual(parseCommand("cancel S-1"), { action: "cancel", id: "S-1" });
  assert.deepEqual(parseCommand("run S-1"), { action: "run", id: "S-1" });
  assert.deepEqual(parseCommand("dismiss S-1"), { action: "dismiss", id: "S-1" });
  assert.deepEqual(parseCommand("budget S-1 5 3h"), {
    action: "budget",
    id: "S-1",
    runs: 5,
    seconds: 10800,
  });
  assert.ok(help.length > 0);
});

test("rejects malformed commands with an exact recovery command", () => {
  for (const text of [
    "in 0m report",
    "in nope report",
    "in 1m",
    "cancel",
    "run S-1 extra",
    "budget S-1 nope 1h",
    "unknown",
    "list extra",
    "at",
  ]) {
    assert.throws(() => parseCommand(text), /schedule help/);
  }
  for (const text of ["-1m", "1.5h", "0s", "999999999999999999999999d"]) {
    assert.throws(() => duration(text));
  }
});
