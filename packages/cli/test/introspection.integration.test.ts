import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init";
import { UserDbReader } from "../src/db/reader";
import { introspect } from "../src/introspect/introspect";
import { ScriptedPrompts, throwingPrompts } from "./helpers/scripted-prompts";

/**
 * Integration tests against the PR-02 fixtures. Run when CHUNKFUNK_FIXTURES_URL
 * or FIXTURES_PG_URL points at a seeded Postgres+pgvector; skipped otherwise
 * so `npm test` stays green without a database.
 */
const BASE = process.env.CHUNKFUNK_FIXTURES_URL ?? process.env.FIXTURES_PG_URL;

function dbUrl(database: string): string {
  const url = new URL(BASE as string);
  url.pathname = `/${database}`;
  return url.toString();
}

async function introspectFixture(
  database: string,
  opts: Parameters<typeof introspect>[1],
) {
  const reader = new UserDbReader(dbUrl(database));
  try {
    return await introspect(reader, opts);
  } finally {
    await reader.close();
  }
}

describe.skipIf(!BASE)("introspection vs fixtures", () => {
  it("auto-detects fixture_langchain (langchain-pgvector) with no prompts", async () => {
    const result = await introspectFixture("fixture_langchain", {
      yes: true,
      prompts: throwingPrompts,
    });
    expect(result.recipeId).toBe("langchain-pgvector");
    expect(result.mapping.table).toBe("public.langchain_pg_embedding");
    expect(result.mapping.columns.content).toBe("document");
    expect(result.mapping.columns.sourceUrl).toBe("meta:cmetadata.source");
    expect(result.mapping.joins?.collectionTable).toBe("public.langchain_pg_collection");
    expect(result.embeddingDims).toBe(1536);
    expect(result.embeddingModelGuess).toContain("(guess)");
  });

  it("auto-detects fixture_llamaindex (llamaindex-pgvector)", async () => {
    const result = await introspectFixture("fixture_llamaindex", {
      yes: true,
      prompts: throwingPrompts,
    });
    expect(result.recipeId).toBe("llamaindex-pgvector");
    expect(result.mapping.table).toBe("public.data_embeddings");
    expect(result.mapping.columns.content).toBe("text");
    expect(result.mapping.columns.documentId).toBe("meta:metadata_.doc_id");
  });

  it("auto-detects fixture_supabase_docs (supabase-docs-tutorial)", async () => {
    const result = await introspectFixture("fixture_supabase_docs", {
      yes: true,
      prompts: throwingPrompts,
    });
    expect(result.recipeId).toBe("supabase-docs-tutorial");
    expect(result.mapping.table).toBe("public.documents");
    expect(result.mapping.columns.content).toBe("content");
  });

  it("completes fixture_custom via the interactive column picker", async () => {
    const prompts = new ScriptedPrompts({
      select: ["public.kb_entries", "vec", "body_text"],
      selectOptional: ["props", "page_url", "modified_at"],
      confirm: [true],
    });
    const result = await introspectFixture("fixture_custom", { yes: false, prompts });
    expect(result.recipeId).toBe("manual");
    expect(result.mapping.table).toBe("public.kb_entries");
    expect(result.mapping.columns.content).toBe("body_text");
    expect(result.mapping.columns.embedding).toBe("vec");
    expect(result.mapping.columns.updatedAt).toBe("modified_at");
    expect(result.embeddingDims).toBe(1024);
  });

  it("streams every chunk through the read-only reader (langchain = 298)", async () => {
    const reader = new UserDbReader(dbUrl("fixture_langchain"));
    try {
      const { mapping } = await introspect(reader, { yes: true, prompts: throwingPrompts });
      reader.setMapping(mapping);
      expect(await reader.countChunks()).toBe(298);
      expect(await reader.hasEmbeddings()).toBe(true);
      let streamed = 0;
      for await (const chunk of reader.streamChunks()) {
        void chunk;
        streamed += 1;
      }
      expect(streamed).toBe(298);
    } finally {
      await reader.close();
    }
  });

  it("refuses to write to the user database (read-only session)", async () => {
    const reader = new UserDbReader(dbUrl("fixture_custom"));
    try {
      // Reach the pool via a harmless read, then prove writes are blocked.
      await expect(
        // @ts-expect-error accessing the private pool for a negative test
        reader.pool.query("create temporary table cf_probe(x int)"),
      ).rejects.toThrow(/read-only transaction/i);
    } finally {
      await reader.close();
    }
  });
});

describe.skipIf(!BASE)("chunkfunk init", () => {
  let dir: string;
  const priorUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "chunkfunk-init-"));
    process.env.DATABASE_URL = dbUrl("fixture_langchain");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (priorUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorUrl;
  });

  it("writes chunkfunk.yaml without the connection string, then is idempotent", async () => {
    const first = await runInit({ dir, yes: true, prompts: throwingPrompts });
    expect(first.created).toBe(true);
    expect(first.path).toBe(join(dir, "chunkfunk.yaml"));

    const yaml = await readFile(join(dir, "chunkfunk.yaml"), "utf8");
    expect(yaml).toContain("env: DATABASE_URL");
    expect(yaml).not.toContain("postgresql://");
    expect(yaml).not.toContain("55433");

    const second = await runInit({ dir, yes: true, prompts: throwingPrompts });
    expect(second.created).toBe(false);
    const yamlAgain = await readFile(join(dir, "chunkfunk.yaml"), "utf8");
    expect(yamlAgain).toBe(yaml);
  });
});
