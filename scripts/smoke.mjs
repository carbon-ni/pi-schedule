import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const root = mkdtempSync(join(tmpdir(), "pi-schedule-smoke-"));
const agentDir = join(root, "agent");
mkdirSync(agentDir, { mode: 0o700 });
const children = new Set();
let requests = 0;
const observedPrompts = [];
let releaseHeld;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body);
  requests++;
  const last = input.messages.at(-1);
  const lastText =
    typeof last.content === "string"
      ? last.content
      : (last.content ?? []).map((block) => block.text ?? "").join("");
  observedPrompts.push(lastText);
  const agentCreate = last.role === "user" && lastText === "agent-schedule";
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const delta = agentCreate
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "schedule-" + requests,
            type: "function",
            function: {
              name: "schedule_task",
              arguments: JSON.stringify({
                action: "create",
                instruction: "Reply scheduled-check-ok",
                target: "smoke-fixture",
                reason: "Verify agent-initiated scheduling",
                delay_seconds: 1,
              }),
            },
          },
        ],
      }
    : { role: "assistant", content: "scheduled-check-ok" };
  const chunk = (delta, finish_reason = null) => ({
    id: "mock-" + requests,
    object: "chat.completion.chunk",
    created: 1,
    model: "deterministic",
    choices: [{ index: 0, delta, finish_reason }],
  });
  res.write("data: " + JSON.stringify(chunk(delta)) + "\n\n");
  if (lastText === "hold-work")
    await new Promise((resolve) => {
      releaseHeld = resolve;
    });
  res.write("data: " + JSON.stringify(chunk({}, agentCreate ? "tool_calls" : "stop")) + "\n\n");
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
writeFileSync(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      "schedule-smoke": {
        baseUrl: "http://127.0.0.1:" + port + "/v1",
        api: "openai-completions",
        apiKey: "local-fixture-only",
        models: [{ id: "deterministic", contextWindow: 128000, maxTokens: 1024 }],
      },
    },
  }),
  { mode: 0o600 },
);

function start(sessionId) {
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"])
    delete env[key];
  const child = spawn(
    process.env.PI_BIN || "pi",
    [
      "--mode",
      "rpc",
      "--no-extensions",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--offline",
      "--session-dir",
      join(root, "sessions"),
      "--session-id",
      sessionId,
      "-e",
      resolve("src/index.ts"),
      "-e",
      resolve("fixtures/smoke-control.ts"),
      "--provider",
      "schedule-smoke",
      "--model",
      "deterministic",
    ],
    { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(child);
  const records = [];
  const emitter = new EventEmitter();
  let buffer = "",
    stderr = "",
    seq = 0;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text) => {
    stderr += text;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text) => {
    buffer += text;
    let pos;
    while ((pos = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, pos).replace(/\r$/, "");
      buffer = buffer.slice(pos + 1);
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        records.push(record);
        emitter.emit("record");
      } catch {
        stderr += "\nNon-JSON stdout: " + line;
      }
    }
  });
  function wait(predicate, from = 0, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = records.slice(from).find(predicate);
        if (found) {
          clearTimeout(timer);
          emitter.off("record", check);
          resolve(found);
        }
      };
      const timer = setTimeout(() => {
        emitter.off("record", check);
        reject(
          new Error(
            "RPC timeout. stderr=" +
              stderr +
              "\nrecords=" +
              JSON.stringify(records.filter((record) => record.method !== "setStatus").slice(-20)),
          ),
        );
      }, timeout);
      emitter.on("record", check);
      check();
    });
  }
  async function command(type, fields = {}) {
    const id = "req-" + ++seq;
    child.stdin.write(JSON.stringify({ id, type, ...fields }) + "\n");
    const response = await wait((event) => event.type === "response" && event.id === id);
    assert.equal(response.success, true, JSON.stringify(response));
    return response.data;
  }
  async function prompt(message, options = {}) {
    return command("prompt", { message, ...options });
  }
  async function notice(text, from = 0) {
    return wait(
      (event) =>
        event.type === "extension_ui_request" &&
        event.method === "notify" &&
        event.message.includes(text),
      from,
    );
  }
  async function stop() {
    if (child.exitCode !== null) return;
    child.stdin.end();
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    await new Promise((resolve) => child.once("exit", resolve));
    clearTimeout(timeout);
    children.delete(child);
  }
  return { child, records, wait, command, prompt, notice, stop };
}

try {
  const sessionId = randomUUID();
  let client = start(sessionId);
  const commands = await client.command("get_commands");
  assert.ok(commands.commands.some((command) => command.name === "schedule"));
  let from = client.records.length;
  await client.prompt("/schedule in 1s Reply scheduled-check-ok");
  await client.notice("Scheduled S-", from);
  await client.wait((event) => event.type === "agent_settled", from);
  const messages = await client.command("get_messages");
  assert.ok(
    messages.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.content?.some((block) => block.text === "scheduled-check-ok"),
    ),
  );
  console.log("PASS manual timer -> real Pi run -> deterministic response");

  from = client.records.length;
  await client.prompt("agent-schedule");
  await client.wait(
    (event) => event.type === "tool_execution_end" && event.toolName === "schedule_task",
    from,
  );
  await client.wait((event) => event.type === "agent_settled", from);
  const afterCreate = client.records.length;
  await client.wait((event) => event.type === "agent_settled", afterCreate);
  console.log("PASS agent tool creation -> scheduled Pi follow-up");

  from = client.records.length;
  await client.prompt("/schedule in 1s Reply busy-timer-marker");
  await client.prompt("hold-work");
  await client.wait((event) => event.type === "message_update", from);
  const whileBusy = requests;
  await delay(1500);
  assert.equal(requests, whileBusy);
  await client.prompt("queued-user", { streamingBehavior: "followUp" });
  releaseHeld();
  releaseHeld = undefined;
  const scheduledStart = await client.wait(
    (event) =>
      event.type === "message_start" &&
      event.message?.role === "custom" &&
      event.message.content?.includes("busy-timer-marker"),
    from,
  );
  await client.wait(
    (event) => event.type === "agent_settled",
    client.records.indexOf(scheduledStart),
  );
  const queuedIndex = observedPrompts.lastIndexOf("queued-user");
  const scheduledIndex = observedPrompts.findIndex((text) => text.includes("busy-timer-marker"));
  assert.ok(queuedIndex >= 0 && scheduledIndex > queuedIndex);
  console.log("PASS real busy Pi and queued user work take priority over timer dispatch");

  from = client.records.length;
  await client.prompt("/schedule in 2s This must remain cancelled");
  const created = await client.notice("Scheduled S-", from);
  const cancelledId = /S-[a-f0-9-]+/.exec(created.message)[0];
  await client.prompt("/schedule cancel " + cancelledId);
  const requestCount = requests;
  await delay(2500);
  assert.equal(requests, requestCount);
  console.log("PASS cancelled timer never calls provider");

  from = client.records.length;
  await client.prompt("/schedule in 30m Future task survives reload");
  const future = await client.notice("Scheduled S-", from);
  const futureId = /S-[a-f0-9-]+/.exec(future.message)[0];
  await client.prompt("/smoke-reload");
  from = client.records.length;
  await client.prompt("/schedule list");
  const list = await client.notice(futureId, from);
  assert.ok(list.message.includes("[pending]"));
  console.log("PASS real runtime reload preserves pending task");

  const original = await client.command("get_state");
  await client.command("clone");
  const forked = await client.command("get_state");
  assert.notEqual(forked.sessionId, original.sessionId);
  from = client.records.length;
  await client.prompt("/schedule list");
  await client.notice("No scheduled tasks", from);
  await client.command("switch_session", { sessionPath: original.sessionFile });
  from = client.records.length;
  await client.prompt("/schedule list");
  await client.notice(futureId, from);
  console.log("PASS cloned sessions do not inherit tasks; switching back restores owner state");

  const competing = start(sessionId);
  await competing.command("get_state");
  await competing.notice("Scheduler locked");
  await competing.stop();
  await client.prompt("/schedule cancel " + futureId);
  console.log("PASS duplicate session ownership fails closed");

  from = client.records.length;
  await client.prompt("/schedule in 2s Reply after explicit recovery");
  const missed = await client.notice("Scheduled S-", from);
  const missedId = /S-[a-f0-9-]+/.exec(missed.message)[0];
  await client.stop();
  await delay(2500);
  const beforeResume = requests;
  client = start(sessionId);
  await client.command("get_state");
  await client.notice(missedId + " is overdue");
  assert.equal(requests, beforeResume);
  from = client.records.length;
  await client.prompt("/schedule run " + missedId);
  await client.wait((event) => event.type === "agent_settled", from);
  console.log("PASS close/resume marks overdue; explicit recovery starts run");
  await client.stop();
  console.log("PASS isolated Pi smoke checks; no external provider or user session used");
} finally {
  releaseHeld?.();
  for (const child of children) child.kill("SIGTERM");
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
