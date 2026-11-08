import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const validator = resolve("scripts/release.mjs");

for (const scenario of [
  { name: "accepts a matching stable version", version: "0.0.1", tag: "v0.0.1", status: 0 },
  { name: "rejects a mismatched tag", version: "0.0.1", tag: "v0.0.2", status: 1 },
  { name: "rejects a missing tag", version: "0.0.1", tag: undefined, status: 1 },
  {
    name: "rejects prereleases on the stable channel",
    version: "0.0.1-beta.1",
    tag: "v0.0.1-beta.1",
    status: 1,
  },
  { name: "rejects invalid semver", version: "00.0.1", tag: "v00.0.1", status: 1 },
  { name: "rejects private packages", version: "0.0.1", tag: "v0.0.1", private: true, status: 1 },
]) {
  test(`release validation ${scenario.name}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "pi-schedule-release-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: scenario.version, private: scenario.private }),
    );

    const result = spawnSync(
      process.execPath,
      [validator, ...(scenario.tag ? [scenario.tag] : [])],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    assert.equal(result.status, scenario.status, result.stdout + result.stderr);
    if (scenario.status !== 0) assert.match(result.stderr, /Release blocked:/);
  });
}

test("npm package contains the Pi entrypoint and runtime but excludes tests and development tooling", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const [archive] = JSON.parse(result.stdout);
  const paths = archive.files.map((file) => file.path);

  assert.ok(paths.includes("src/index.ts"));
  assert.ok(paths.includes("src/infra/extension.ts"));
  assert.ok(paths.includes("src/domain/scheduler.ts"));
  assert.ok(paths.includes("README.md"));
  assert.deepEqual(
    paths.filter((path) => path.endsWith(".test.ts")),
    [],
  );
  assert.deepEqual(
    paths.filter((path) => path.startsWith("scripts/") || path.startsWith(".github/")),
    [],
  );
});
