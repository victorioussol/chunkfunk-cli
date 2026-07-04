import { afterEach, describe, expect, it, vi } from "vitest";
import { runScan } from "../src/commands/scan";
import type { CandidateTable, UserDbReader } from "../src/db/reader";
import { throwingPrompts } from "./helpers/scripted-prompts";

class UnmappableReader {
  setSystemSeed = vi.fn();
  close = vi.fn(async () => undefined);
  listCandidateTables = vi.fn(async (): Promise<CandidateTable[]> => [
    {
      schema: "public",
      name: "bespoke_chunks",
      qualified: "public.bespoke_chunks",
      columns: [
        { name: "body_a", udtName: "text", dataType: "text" },
        { name: "body_b", udtName: "text", dataType: "text" },
        { name: "embedding", udtName: "vector", dataType: "USER-DEFINED" },
      ],
      vectorColumns: ["embedding"],
    },
  ]);
  sampleJsonKeys = vi.fn(async () => []);
  averageTextLength = vi.fn(async () => 200);
}

describe("scan non-interactive mapping failures", () => {
  const priorDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
  });

  it.each([
    ["--json", { json: true }],
    ["--ci", { ci: true }],
  ])("%s fails fast instead of prompting when the schema is unmappable", async (_label, opts) => {
    process.env.DATABASE_URL = "postgres://example.invalid/db";
    const reader = new UnmappableReader();

    await expect(
      runScan({
        ...opts,
        prompts: throwingPrompts,
        readerFactory: () => reader as unknown as UserDbReader,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    ).rejects.toThrow(/run chunkfunk init first/i);

    expect(reader.close).toHaveBeenCalled();
  });
});
