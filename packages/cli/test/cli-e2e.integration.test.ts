import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reportV1Schema, scanSyncRequestSchema, telemetryV1Schema } from "@chunkfunk/core";

/**
 * End-to-end tests that invoke the ACTUAL CLI launcher (bin/chunkfunk.mjs) as a
 * child process from a directory OUTSIDE the repo — this is what catches launcher
 * bugs that in-process tests miss (reviewer note on PR-04). Gated on
 * CHUNKFUNK_FIXTURES_URL or FIXTURES_PG_URL.
 */
const BASE = process.env.CHUNKFUNK_FIXTURES_URL ?? process.env.FIXTURES_PG_URL;
const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, "..", "bin", "chunkfunk.mjs");

function dbUrl(database: string): string {
  const url = new URL(BASE as string);
  url.pathname = `/${database}`;
  return url.toString();
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(args: string[], cwd: string, database: string, extraEnv: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd,
      env: { ...process.env, ...extraEnv, DATABASE_URL: dbUrl(database) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("error", reject);
    request.on("end", () => resolve(body));
  });
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe.skipIf(!BASE)("chunkfunk CLI (out-of-repo, real binary)", () => {
  let workdir: string;

  beforeAll(async () => {
    // A temp dir OUTSIDE the repo, so the launcher must resolve tsx from the
    // CLI package's own dependency tree.
    workdir = await mkdtemp(join(tmpdir(), "chunkfunk-e2e-"));
  });

  afterAll(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("scan --json prints ONLY ReportV1 to stdout (logs on stderr)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chunkfunk-json-"));
    const { stdout, stderr, code } = await runCli(["scan", "--json", "--yes"], dir, "fixture_langchain");
    expect(code).toBe(0);
    // stdout must be exactly one JSON document — parse the whole thing.
    const parsed = JSON.parse(stdout);
    expect(() => reportV1Schema.parse(parsed)).not.toThrow();
    expect(parsed.totals.chunks).toBe(298);
    // Progress logs went to stderr, not stdout.
    expect(stderr).toContain("Running detectors");
    expect(stdout).not.toContain("Running detectors");
    await rm(dir, { recursive: true, force: true });
  }, 120_000);

  it("scan --ci --min-score 95 exits 1 on the rotten fixture", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chunkfunk-ci-"));
    const { code } = await runCli(["scan", "--ci", "--min-score", "95"], dir, "fixture_langchain");
    expect(code).toBe(1);
    await rm(dir, { recursive: true, force: true });
  }, 120_000);

  it("scan --ci --min-score 1 exits 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chunkfunk-ci0-"));
    const { code } = await runCli(["scan", "--ci", "--min-score", "1"], dir, "fixture_langchain");
    expect(code).toBe(0);
    await rm(dir, { recursive: true, force: true });
  }, 120_000);

  it("scan --html writes a self-contained report with no external requests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chunkfunk-html-"));
    const htmlPath = join(dir, "report.html");
    const { code, stdout } = await runCli(
      ["scan", "--json", "--yes", "--html", htmlPath],
      dir,
      "fixture_langchain",
    );
    expect(code).toBe(0);
    // stdout is still pure JSON even with --html.
    expect(() => reportV1Schema.parse(JSON.parse(stdout))).not.toThrow();
    const html = await readFile(htmlPath, "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/<link\s/i);
    await rm(dir, { recursive: true, force: true });
  }, 120_000);

  it("--show-telemetry matches the telemetry POST body byte-for-byte", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chunkfunk-telemetry-e2e-"));
    let telemetryBody = "";

    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/api/telemetry");
      telemetryBody = await readRequestBody(request);
      expect(() => telemetryV1Schema.parse(JSON.parse(telemetryBody))).not.toThrow();
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ received: true }));
    });

    const port = await listen(server);

    try {
      const shown = await runCli(["--show-telemetry"], dir, "fixture_langchain");
      expect(shown.code).toBe(0);
      expect(() => telemetryV1Schema.parse(JSON.parse(shown.stdout))).not.toThrow();

      const configPath = join(dir, "chunkfunk.yaml");
      const config = await readFile(configPath, "utf8");
      await writeFile(
        configPath,
        `
${config.trimEnd()}
sync:
  enabled: false
  apiUrl: http://127.0.0.1:${port}
telemetry: true
`.trimStart(),
        "utf8",
      );

      const scan = await runCli(["scan", "--yes"], dir, "fixture_langchain");
      expect(scan.code).toBe(0);
      expect(telemetryBody).toBe(shown.stdout);
    } finally {
      await close(server);
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("login + sync invoke the real CLI binary and post ReportV1 from outside the repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chunkfunk-sync-"));
    const configDir = await mkdtemp(join(tmpdir(), "chunkfunk-sync-config-"));
    let requestCount = 0;

    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
      requestCount += 1;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/api/scans");
      expect(request.headers.authorization).toBe("Bearer cfunk_scan_e2e");

      const body = await readRequestBody(request);
      expect(() => scanSyncRequestSchema.parse(JSON.parse(body))).not.toThrow();

      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          scanId:
            requestCount === 1
              ? "3f0d5f0a-9a5c-4d1a-8a83-1f0e6f0b7c22"
              : "3f0d5f0a-9a5c-4d1a-8a83-1f0e6f0b7c23",
          dashboardUrl: "http://127.0.0.1/dashboard",
          ...(requestCount > 1
            ? { delta: { previousScore: 55, previousScanAt: "2026-07-03T09:01:00.000Z" } }
            : {}),
        }),
      );
    });

    const port = await listen(server);
    const env = { CHUNKFUNK_CONFIG_DIR: configDir };

    try {
      expect((await runCli(["login", "--token", "cfunk_scan_e2e"], dir, "fixture_langchain", env)).code).toBe(0);

      const first = await runCli(["sync", "--yes", "--api-url", `http://127.0.0.1:${port}`], dir, "fixture_langchain", env);
      expect(first.code).toBe(0);
      expect(first.stdout).toContain("Synced scan");

      const second = await runCli(["sync", "--yes", "--api-url", `http://127.0.0.1:${port}`], dir, "fixture_langchain", env);
      expect(second.code).toBe(0);
      expect(second.stdout).toContain("Previous score 55");
      expect(requestCount).toBe(2);
    } finally {
      await close(server);
      await rm(dir, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 180_000);
});
