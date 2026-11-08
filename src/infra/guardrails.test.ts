import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("commit-message policy accepts conventional history and rejects ambiguous subjects", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-schedule-hooks-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "message");
  for (const message of ["feat: add timer (TASK-0007)", "fix(store)!: preserve ownership"]) {
    writeFileSync(file, message);
    const result = spawnSync(process.execPath, ["scripts/commit-message.mjs", file], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  writeFileSync(file, "stuff");
  const rejected = spawnSync(process.execPath, ["scripts/commit-message.mjs", file], {
    encoding: "utf8",
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /^false\nUse a conventional commit/);
});

test("the normal gate emits one success boolean or a failure boolean before bounded diagnostics", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-schedule-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "npm"),
    '#!/bin/sh\nif [ "$FAKE_NPM_FAIL" = 1 ]; then echo fixture-failure; exit 1; fi\necho fixture-success\n',
    { mode: 0o700 },
  );
  const env = { ...process.env, PATH: root + ":" + process.env.PATH };
  const passed = spawnSync("sh", [resolve("scripts/gate.sh")], { env, encoding: "utf8" });
  assert.equal(passed.status, 0);
  assert.equal(passed.stdout, "true\n");
  const failed = spawnSync("sh", [resolve("scripts/gate.sh")], {
    env: { ...env, FAKE_NPM_FAIL: "1" },
    encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /^false\nfixture-failure\n$/);
});
