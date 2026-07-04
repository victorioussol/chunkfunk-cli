#!/usr/bin/env node
// Thin launcher. During development the CLI runs from TypeScript via tsx; a
// compiled/bundled entry point is produced by the packaging PR (PR-15).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/index.ts");
// Resolve tsx from the CLI package's own dependency tree, not the invoking
// directory — the CLI must work when run from a user's project folder.
const require = createRequire(import.meta.url);
const tsx = pathToFileURL(require.resolve("tsx")).href;
const child = spawn(
  process.execPath,
  ["--import", tsx, entry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
