import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tag = process.argv[2];
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (pkg.private || !stableVersion.test(pkg.version) || tag !== `v${pkg.version}`) {
  console.error(
    "Release blocked: use a public package with a stable version and a matching v<version> tag. " +
      "Run node scripts/release.mjs v$(node -p \"require('./package.json').version\") before tagging. " +
      "See docs/RELEASING.md for the release steps.",
  );
  process.exit(1);
}

console.log(`Validated release ${tag}.`);
