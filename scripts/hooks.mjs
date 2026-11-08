import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
const action = process.argv[2];
if (action === "install") execFileSync("git", ["config", "core.hooksPath", ".githooks"]);
if (!["install", "check"].includes(action))
  throw new Error("Use node scripts/hooks.mjs install|check");
const configured = execFileSync("git", ["config", "--get", "core.hooksPath"], {
  encoding: "utf8",
}).trim();
if (configured !== ".githooks") throw new Error("Run make setup to install versioned hooks.");
for (const hook of ["pre-commit", "pre-push", "commit-msg"])
  accessSync(".githooks/" + hook, constants.X_OK);
console.log("true");
