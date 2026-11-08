import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

function discover(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? discover(path) : /\.(ts|mjs)$/.test(path) ? [path] : [];
  });
}
const coverage = process.argv.includes("--coverage");
const sources = discover("src").sort();
const tests = [...sources, ...discover("scripts")]
  .filter((path) => /\.test\.(ts|mjs)$/.test(path))
  .sort();
const args = ["--experimental-strip-types", "--test"];
if (coverage) {
  // Load every production module so unimported code cannot disappear from coverage.
  for (const source of sources.filter((path) => !path.endsWith(".test.ts"))) {
    args.push("--import=" + pathToFileURL(resolve(source)).href);
  }
  args.push(
    "--experimental-test-coverage",
    "--test-coverage-exclude=**/*.test.ts",
    "--test-coverage-exclude=**/*.test.mjs",
    "--test-coverage-lines=85",
    "--test-coverage-functions=85",
    "--test-coverage-branches=75",
  );
}
const result = spawnSync(process.execPath, [...args, ...tests], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
