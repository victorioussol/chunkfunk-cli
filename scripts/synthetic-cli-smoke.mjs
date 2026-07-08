#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const fixtureBaseUrl = process.env.CHUNKFUNK_FIXTURES_URL ?? process.env.FIXTURES_PG_URL;
const keepTemp = process.env.CHUNKFUNK_SMOKE_KEEP === "1";
const tempRoot = await mkdtemp(join(tmpdir(), "chunkfunk-smoke-"));
const installDir = join(tempRoot, "installed-package");
const packDir = join(tempRoot, "pack");
const npmCacheDir = join(tempRoot, "npm-cache");
const npmEnv = { ...process.env, npm_config_cache: npmCacheDir };
const minFreeBytes = Number(process.env.CHUNKFUNK_SMOKE_MIN_FREE_BYTES ?? 500 * 1024 * 1024);
const results = [];

class SkipStep extends Error {
  constructor(message) {
    super(message);
    this.name = "SkipStep";
  }
}

function databaseUrl(database) {
  const url = new URL(fixtureBaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function cleanEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  if (env.DATABASE_URL === undefined) {
    delete env.DATABASE_URL;
  }
  return env;
}

function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 180_000;
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let killTimer;
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      timedOut = true;
      killProcess(child, "SIGTERM");
      killTimer = setTimeout(() => killProcess(child, "SIGKILL"), 2_000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      const timeoutMessage = timedOut
        ? `\nTimed out after ${timeoutMs}ms while running: ${command} ${args.join(" ")}\n`
        : "";
      resolve({ code: timedOut ? 124 : (code ?? 0), stdout, stderr: `${stderr}${timeoutMessage}` });
    });
  });
}

function killProcess(child, signal) {
  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function skip(message) {
  throw new SkipStep(message);
}

async function assertFreeSpace(path) {
  const stats = await statfs(path);
  const freeBytes = stats.bavail * stats.bsize;
  assert(
    freeBytes >= minFreeBytes,
    `packaged smoke testing needs at least ${Math.round(minFreeBytes / 1024 / 1024)} MB free; ` +
      `only ${Math.round(freeBytes / 1024 / 1024)} MB is available at ${path}`,
  );
}

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    if (error instanceof SkipStep) {
      results.push({ name, ok: null, ms: Date.now() - started, error });
      console.log(`SKIP ${name}: ${error.message}`);
      return;
    }
    results.push({ name, ok: false, ms: Date.now() - started, error });
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.message : String(error));
  }
}

function parseJson(stdout, context) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${context} did not print valid JSON to stdout: ${(error).message}`);
  }
}

let chunkfunkBin = "";

await mkdir(installDir, { recursive: true });
await mkdir(packDir, { recursive: true });

await step("builds the bundled CLI", async () => {
  const result = await run(npmBin, ["run", "build"], { env: npmEnv });
  assert(result.code === 0, result.stderr || result.stdout);
});

await step("packs the npm artifact", async () => {
  console.log("INFO checking free space for packaged install");
  await assertFreeSpace(tempRoot);
  console.log("INFO running npm pack");
  const result = await run(npmBin, ["pack", "--json", "--pack-destination", packDir], {
    env: npmEnv,
    timeoutMs: 45_000,
  });
  assert(result.code === 0, result.stderr || result.stdout);
  const packed = parseJson(result.stdout, "npm pack");
  const tarball = packed[0]?.filename;
  assert(tarball, "npm pack did not report a tarball filename");
  const tarballPath = join(packDir, tarball);
  console.log("INFO installing packed tarball into a temporary project");
  const install = await run(npmBin, ["install", "--silent", "--no-audit", "--no-fund", tarballPath], {
    cwd: installDir,
    env: npmEnv,
    timeoutMs: 120_000,
  });
  assert(install.code === 0, install.stderr || install.stdout);
  chunkfunkBin = join(installDir, "node_modules", ".bin", "chunkfunk");
});

await step("prints package version from the installed binary", async () => {
  if (!chunkfunkBin) skip("pack/install step did not produce a chunkfunk binary");
  const result = await run(chunkfunkBin, ["--version"], { cwd: installDir });
  assert(result.code === 0, result.stderr || result.stdout);
  assert(result.stdout.trim() === packageJson.version, `expected ${packageJson.version}, got ${result.stdout.trim()}`);
});

await step("explains missing DATABASE_URL clearly", async () => {
  if (!chunkfunkBin) skip("pack/install step did not produce a chunkfunk binary");
  const dir = join(tempRoot, "missing-database-url");
  await mkdir(dir, { recursive: true });
  const result = await run(chunkfunkBin, ["scan", "--json", "--yes"], {
    cwd: dir,
    env: cleanEnv({ DATABASE_URL: "" }),
  });
  assert(result.code === 1, `expected exit 1, got ${result.code}`);
  assert(result.stderr.includes("Environment variable DATABASE_URL is not set"), result.stderr);
});

if (!fixtureBaseUrl) {
  console.log("SKIP fixture database loops: set FIXTURES_PG_URL or CHUNKFUNK_FIXTURES_URL to a seeded fixture Postgres.");
} else if (!chunkfunkBin) {
  console.log("SKIP fixture database loops: pack/install step did not produce a chunkfunk binary.");
} else {
  await step("scans rotten LangChain fixture as a fresh user", async () => {
    const dir = join(tempRoot, "langchain");
    await mkdir(dir, { recursive: true });
    const env = cleanEnv({ DATABASE_URL: databaseUrl("fixture_langchain") });

    const init = await run(chunkfunkBin, ["init", "--yes", "--name", "smoke-langchain"], { cwd: dir, env });
    assert(init.code === 0, init.stderr || init.stdout);

    const config = await readFile(join(dir, "chunkfunk.yaml"), "utf8");
    assert(config.includes("env: DATABASE_URL"), "config should refer to DATABASE_URL");
    assert(!config.includes("postgresql://"), "config must not write the connection string");

    const scan = await run(chunkfunkBin, ["scan", "--json", "--yes"], { cwd: dir, env });
    assert(scan.code === 0, scan.stderr || scan.stdout);
    assert(scan.stderr.includes("Running detectors"), "progress logs should go to stderr");
    assert(!scan.stdout.includes("Running detectors"), "stdout should stay pure JSON");
    const report = parseJson(scan.stdout, "langchain scan");
    assert(report.version === 1, "expected ReportV1");
    assert(report.totals.chunks === 298, `expected 298 chunks, got ${report.totals.chunks}`);
    assert(report.stack.mapping.table === "public.langchain_pg_embedding", "expected LangChain mapping");
    assert(report.health.score >= 0 && report.health.score <= 100, "score should be 0-100");
  });

  await step("checks CI exit codes on rotten LangChain fixture", async () => {
    const dir = join(tempRoot, "ci-exit-codes");
    await mkdir(dir, { recursive: true });
    const env = cleanEnv({ DATABASE_URL: databaseUrl("fixture_langchain") });
    const fail = await run(chunkfunkBin, ["scan", "--ci", "--min-score", "95", "--yes"], { cwd: dir, env });
    assert(fail.code === 1, `expected failing CI exit 1, got ${fail.code}`);
    const pass = await run(chunkfunkBin, ["scan", "--ci", "--min-score", "1", "--yes"], { cwd: dir, env });
    assert(pass.code === 0, `expected passing CI exit 0, got ${pass.code}`);
  });

  await step("prints telemetry bytes without obvious secrets", async () => {
    const dir = join(tempRoot, "telemetry");
    await mkdir(dir, { recursive: true });
    const env = cleanEnv({ DATABASE_URL: databaseUrl("fixture_langchain") });
    const result = await run(chunkfunkBin, ["--show-telemetry"], { cwd: dir, env });
    assert(result.code === 0, result.stderr || result.stdout);
    const payload = parseJson(result.stdout, "telemetry");
    assert(typeof payload.fingerprintHash === "string", "telemetry should include fingerprintHash");
    assert(typeof payload.frameworkGuess === "string", "telemetry should include frameworkGuess");
    assert(typeof payload.healthScore === "number", "telemetry should include healthScore");
    assert(typeof payload.mappingShape?.id === "string", "telemetry should include mappingShape.id");
    assert(payload.cliVersion === packageJson.version, "telemetry should include the installed CLI version");
    assert(!result.stdout.includes("postgresql://"), "telemetry must not include connection strings");
    assert(!result.stdout.includes("fixture_langchain"), "telemetry must not include database names");
  });

  await step("auto-detects LlamaIndex fixture", async () => {
    const dir = join(tempRoot, "llamaindex");
    await mkdir(dir, { recursive: true });
    const env = cleanEnv({ DATABASE_URL: databaseUrl("fixture_llamaindex") });
    const result = await run(chunkfunkBin, ["scan", "--json", "--yes"], { cwd: dir, env });
    assert(result.code === 0, result.stderr || result.stdout);
    const report = parseJson(result.stdout, "llamaindex scan");
    assert(report.totals.chunks === 53, `expected 53 chunks, got ${report.totals.chunks}`);
    assert(report.stack.mapping.table === "public.data_embeddings", "expected LlamaIndex mapping");
  });

  await step("auto-detects Supabase docs fixture", async () => {
    const dir = join(tempRoot, "supabase-docs");
    await mkdir(dir, { recursive: true });
    const env = cleanEnv({ DATABASE_URL: databaseUrl("fixture_supabase_docs") });
    const result = await run(chunkfunkBin, ["scan", "--json", "--yes"], { cwd: dir, env });
    assert(result.code === 0, result.stderr || result.stdout);
    const report = parseJson(result.stdout, "supabase docs scan");
    assert(report.totals.chunks === 60, `expected 60 chunks, got ${report.totals.chunks}`);
    assert(report.stack.mapping.table === "public.documents", "expected Supabase docs mapping");
  });

  await step("flags metadata filterability problems without leaking values", async () => {
    const dir = join(tempRoot, "metadata-health");
    await mkdir(dir, { recursive: true });
    const env = cleanEnv({ DATABASE_URL: databaseUrl("fixture_metadata_health") });
    const result = await run(chunkfunkBin, ["scan", "--json", "--yes"], { cwd: dir, env });
    assert(result.code === 0, result.stderr || result.stdout);
    assert(!result.stdout.includes("tenant-a"), "report must not print metadata string values");
    assert(!result.stdout.includes("1001"), "report must not print metadata numeric values");
    const report = parseJson(result.stdout, "metadata-health scan");
    assert(report.totals.chunks === 40, `expected 40 chunks, got ${report.totals.chunks}`);
    assert(report.stack.mapping.table === "public.metadata_documents", "expected metadata_documents mapping");
    assert(report.stack.mapping.columns.sourceUrl === null, "source URL must not be guessed from the content column");
    assert(report.health.score < 100, "metadata warnings should lower the headline health score");
    const titles = report.findings.map((finding) => finding.title);
    assert(titles.includes("Metadata is missing on many chunks"), "expected sparse metadata finding");
    assert(titles.includes("Metadata filter fields use mixed value types"), "expected mixed metadata type finding");
  });

  await step("auto-ranks Guiri-like multi-table fixture", async () => {
    const dir = join(tempRoot, "guiri-like");
    await mkdir(dir, { recursive: true });
    const env = cleanEnv({ DATABASE_URL: databaseUrl("fixture_guiri_like") });
    const result = await run(chunkfunkBin, ["scan", "--json", "--yes"], { cwd: dir, env });
    assert(result.code === 0, result.stderr || result.stdout);
    const report = parseJson(result.stdout, "guiri-like scan");
    assert(report.totals.chunks === 150, `expected 150 chunks, got ${report.totals.chunks}`);
    assert(report.stack.mapping.table === "public.document_chunks", "expected document_chunks mapping");
    assert(report.stack.mapping.columns.content === "content", "expected content column");
    assert(report.stack.mapping.columns.embedding === "embedding", "expected embedding column");
  });
}

const failed = results.filter((result) => result.ok === false);
const skipped = results.filter((result) => result.ok === null);
const passed = results.filter((result) => result.ok === true);
console.log(`\nSynthetic CLI smoke: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
if (keepTemp) {
  console.log(`Temp files kept at ${tempRoot}`);
} else {
  await rm(tempRoot, { recursive: true, force: true });
}
if (failed.length > 0) {
  process.exitCode = 1;
}
