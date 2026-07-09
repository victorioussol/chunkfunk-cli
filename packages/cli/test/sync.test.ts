import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { reportV1Schema, type ReportV1 } from "@chunkfunk/core";
import { runLogin } from "../src/commands/login";
import { runSync } from "../src/commands/sync";
import { credentialsPath } from "../src/auth/credentials";

const here = dirname(fileURLToPath(import.meta.url));

function makeReport(): ReportV1 {
  return reportV1Schema.parse({
    version: 1,
    scan: {
      id: "3f0d5f0a-9a5c-4d1a-8a83-1f0e6f0b7c21",
      origin: "cli",
      startedAt: "2026-07-03T09:00:00.000Z",
      finishedAt: "2026-07-03T09:01:00.000Z",
      cliVersion: "0.1.0",
    },
    stack: {
      fingerprintHash: "abc",
      frameworkGuess: "langchain",
      embeddingDims: 1536,
      embeddingModelGuess: "openai (guess)",
      mapping: {
        version: 1,
        dialect: "pgvector",
        table: "public.docs",
        columns: {
          content: "document",
          embedding: "embedding",
          metadata: "cmetadata",
          documentId: null,
          sourceUrl: null,
          updatedAt: null,
        },
      },
    },
    totals: { documents: 10, chunks: 100, sources: 0 },
    health: {
      score: 55,
      scoreVersion: 1,
      subscores: { freshness: null, duplication: 60, quality: 80, risk: 25, coverage: null },
    },
    findings: [],
    sources: [],
    nextActions: [],
  });
}

describe("CLI login/sync", () => {
  let configDir: string | null = null;
  const priorConfigDir = process.env.CHUNKFUNK_CONFIG_DIR;

  afterEach(async () => {
    if (configDir) await rm(configDir, { recursive: true, force: true });
    configDir = null;
    if (priorConfigDir === undefined) delete process.env.CHUNKFUNK_CONFIG_DIR;
    else process.env.CHUNKFUNK_CONFIG_DIR = priorConfigDir;
  });

  it("login stores only the API token with 0600 file permissions", async () => {
    configDir = await mkdtemp(join(tmpdir(), "chunkfunk-creds-"));
    process.env.CHUNKFUNK_CONFIG_DIR = configDir;

    await runLogin({ token: "cfunk_scan_test", stdout: () => undefined });

    const raw = await readFile(credentialsPath(), "utf8");
    expect(JSON.parse(raw)).toEqual({ token: "cfunk_scan_test" });
    expect((await stat(credentialsPath())).mode & 0o777).toBe(0o600);
  });

  it("keeps cloud sync behind the explicit sync command", async () => {
    const scanSource = await readFile(join(here, "..", "src", "commands", "scan.ts"), "utf8");

    expect(scanSource).not.toMatch(/\b(syncReport|readCredentials)\b/);
  });

  it("sync posts a ReportV1 with bearer auth and validates the response", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      expect(init?.headers).toMatchObject({
        authorization: "Bearer cfunk_scan_test",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body)).report.version).toBe(1);
      return new Response(
        JSON.stringify({
          scanId: "3f0d5f0a-9a5c-4d1a-8a83-1f0e6f0b7c22",
          dashboardUrl: "https://chunkfunk.app/rag/rs/scans/3f0d5f0a-9a5c-4d1a-8a83-1f0e6f0b7c22",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    };

    const response = await runSync({
      report: makeReport(),
      credentials: { token: "cfunk_scan_test" },
      apiUrl: "https://chunkfunk.app/",
      fetchFn,
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(response.scanId).toBe("3f0d5f0a-9a5c-4d1a-8a83-1f0e6f0b7c22");
    expect(calls[0].url).toBe("https://chunkfunk.app/api/scans");
  });
});
