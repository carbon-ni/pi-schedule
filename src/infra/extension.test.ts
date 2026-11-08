import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import register from "../index.ts";

test("registers tools and commands, persists manual work, and cleans up on reload", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-schedule-extension-"));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const notifications: string[] = [];
  let command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> } | undefined;
  let tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> } | undefined;
  const pi = {
    on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
      handlers.set(name, handler),
    registerCommand: (_name: string, value: typeof command) => {
      command = value;
    },
    registerTool: (value: typeof tool) => {
      tool = value;
    },
    sendMessage() {},
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: "rpc",
    hasUI: true,
    cwd: "/repo",
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "test-session", getSessionFile: () => "/session.jsonl" },
    ui: { notify: (message: string) => notifications.push(message), setStatus() {} },
  } as unknown as ExtensionContext;
  t.after(() => {
    handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
    rmSync(root, { recursive: true, force: true });
  });

  register(pi);
  handlers.get("session_start")?.({ reason: "startup" }, ctx);
  assert.equal(tool?.name, "schedule_task");
  assert.ok(command);
  await command.handler("in 30m Check CI for owner/repo#1", ctx);
  assert.ok(notifications.some((text) => text.includes("Scheduled S-")));
  await command.handler("list", ctx);
  const listed = notifications.at(-1)!;
  assert.match(listed, /pending/);
  const id = /S-[a-f0-9-]+/.exec(listed)![0];
  await command.handler("show " + id, ctx);
  assert.match(notifications.at(-1)!, /Saved request/);
  await command.handler("budget " + id + " 4 3h", ctx);
  await command.handler("cancel " + id, ctx);
  await command.handler("list", ctx);
  assert.match(notifications.at(-1)!, /cancelled/);
  await command.handler("help", ctx);
  assert.match(notifications.at(-1)!, /schedule in/);
  await command.handler("bad syntax", ctx);
  assert.match(notifications.at(-1)!, /schedule help/);
  handlers.get("session_shutdown")?.({ reason: "reload" }, ctx);
  handlers.get("session_start")?.({ reason: "reload" }, ctx);
  await command.handler("list", ctx);
  assert.match(notifications.at(-1)!, /cancelled/);
});

test("agent tools and timer dispatch respect busy, UI, cancellation, and actual run acknowledgement", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-schedule-timer-"));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  let now = 1_000_000;
  let tick: () => void = () => {};
  let idle = true;
  let pending = false;
  let failDelivery = false;
  const sent: unknown[] = [];
  const notices: string[] = [];
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  let command!: {
    handler: (args: string, ctx: ExtensionContext) => Promise<void>;
    getArgumentCompletions(prefix: string): unknown[];
  };
  let tool!: { execute: (...args: unknown[]) => Promise<unknown> };
  const ctx = {
    mode: "rpc",
    hasUI: true,
    cwd: "/repo",
    isIdle: () => idle,
    hasPendingMessages: () => pending,
    sessionManager: { getSessionId: () => "timer-session", getSessionFile: () => "/session.jsonl" },
    ui: { notify: (text: string) => notices.push(text), setStatus() {} },
  } as unknown as ExtensionContext;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setInterval", ((cb: () => void) => {
    tick = cb;
    return { unref() {} };
  }) as unknown as typeof setInterval);
  t.mock.method(globalThis, "clearInterval", (() => {}) as typeof clearInterval);
  const pi = {
    on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
      handlers.set(name, handler),
    registerCommand: (_: string, value: typeof command) => {
      command = value;
    },
    registerTool: (value: typeof tool) => {
      tool = value;
    },
    sendMessage: (message: { customType: string; details: unknown }) => {
      if (failDelivery) throw new Error("transport rejected");
      sent.push(message);
      handlers.get("before_agent_start")?.({ messageType: "custom", message }, ctx);
    },
  } as unknown as ExtensionAPI;
  t.after(() => {
    handlers.get("session_shutdown")?.({}, ctx);
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
    rmSync(root, { recursive: true, force: true });
  });
  register(pi);
  handlers.get("session_start")?.({}, ctx);
  assert.ok(command.getArgumentCompletions("in").length);
  const invoke = (params: unknown) => tool.execute("call", params, undefined, undefined, ctx);
  await assert.rejects(() => invoke({ action: "create" }), /requires/);
  await assert.rejects(() => invoke({ action: "cancel" }), /requires/);
  await invoke({
    action: "create",
    instruction: "Check CI",
    target: "owner/repo#1",
    reason: "CI is running",
    delay_seconds: 1,
  });
  now += 1000;
  idle = false;
  tick();
  assert.equal(sent.length, 0);
  idle = true;
  pending = true;
  tick();
  assert.equal(sent.length, 0);
  pending = false;
  handlers.get("ui_prompt_start")?.({}, ctx);
  tick();
  assert.equal(sent.length, 0);
  handlers.get("ui_prompt_end")?.({}, ctx);
  tick();
  assert.equal(sent.length, 1);
  await invoke({ action: "list" });
  await invoke({
    action: "create",
    instruction: "Check CI",
    target: "owner/repo#1",
    reason: "Still running",
    delay_seconds: 1,
  });
  await command.handler("list", ctx);
  const child = /S-[a-f0-9-]+/.exec(
    notices
      .at(-1)!
      .split("\n")
      .find((line) => line.includes("[pending]"))!,
  )![0];
  const inspected = (await invoke({ action: "show", id: child })) as {
    content: { text: string }[];
  };
  assert.match(inspected.content[0].text, /Saved request/);
  await assert.rejects(() => invoke({ action: "show" }), /requires/);
  await invoke({ action: "cancel", id: child });
  await assert.rejects(
    () =>
      invoke({
        action: "create",
        instruction: "Check CI",
        target: "owner/repo#1",
        reason: "Again",
        delay_seconds: 1,
      }),
    /cancelled/,
  );
  handlers.get("input")?.({ source: "rpc" }, ctx);
  handlers.get("before_agent_start")?.({ messageType: "user" }, ctx);
  await command.handler("in 1s Reply hello", ctx);
  now += 180000;
  tick();
  await command.handler("list", ctx);
  const overdue = /S-[a-f0-9-]+/.exec(
    notices
      .at(-1)!
      .split("\n")
      .find((line) => line.includes("[overdue]"))!,
  )![0];
  await command.handler("run " + overdue, ctx);
  assert.equal(sent.length, 2);
  await command.handler("in 1s Reply hello", ctx);
  now += 1000;
  failDelivery = true;
  tick();
  await command.handler("list", ctx);
  assert.match(notices.at(-1)!, /uncertain/);
  const uncertain = /S-[a-f0-9-]+/.exec(
    notices
      .at(-1)!
      .split("\n")
      .find((line) => line.includes("[uncertain]"))!,
  )![0];
  await command.handler("dismiss " + uncertain, ctx);
  await command.handler("list", ctx);
  assert.match(
    notices
      .at(-1)!
      .split("\n")
      .find((line) => line.includes(uncertain))!,
    /cancelled/,
  );
});

test("non-persistent and print sessions reject scheduling with an actionable reason", async () => {
  let command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> } | undefined;
  let start: ((event: unknown, ctx: ExtensionContext) => void) | undefined;
  const notifications: string[] = [];
  register({
    on: (name: string, handler: typeof start) => {
      if (name === "session_start") start = handler;
    },
    registerTool() {},
    registerCommand: (_: string, value: typeof command) => {
      command = value;
    },
  } as unknown as ExtensionAPI);
  const ctx = {
    mode: "print",
    hasUI: true,
    ui: { notify: (message: string) => notifications.push(message), setStatus() {} },
  } as unknown as ExtensionContext;
  start?.({}, ctx);
  await command!.handler("in 1m Check CI", ctx);
  assert.match(notifications.at(-1)!, /tui|RPC|rpc/);
  const ephemeral = {
    ...ctx,
    mode: "rpc",
    sessionManager: { getSessionFile: () => undefined },
  } as unknown as ExtensionContext;
  start?.({}, ephemeral);
  await command!.handler("in 1m Check CI", ephemeral);
  assert.match(notifications.at(-1)!, /without --no-session/);
});
