import { readFileSync } from "node:fs";
const message = readFileSync(process.argv[2], "utf8").split("\n")[0];
if (
  !/^(feat|fix|docs|test|refactor|chore|ci|build|perf|revert)(\([a-z0-9-]+\))?!?: .{1,100}$/.test(
    message,
  )
) {
  console.log("false\nUse a conventional commit, e.g. feat: add session scheduling (TASK-0007)");
  process.exit(1);
}
