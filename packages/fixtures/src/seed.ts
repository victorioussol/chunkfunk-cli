/**
 * Seeds the four ChunkFunk fixture databases deterministically (PR-02).
 *
 * Idempotent: each fixture DB is dropped to a clean `public` schema and rebuilt.
 * The planted-problem counts are fixed by src/planted.ts and documented in
 * README.md; a self-check at the end asserts them (and near-duplicate cosine
 * similarity) so a broken seed fails loudly rather than silently drifting.
 *
 * Usage: `npm run fixtures:seed` (after `npm run fixtures:up`).
 */
import pg from "pg";
import {
  duplicateMember,
  healthyChunk,
  nearDuplicateText,
  secretChunk,
  sourceUrl,
  summaryText,
  thinChunk,
} from "./content";
import { DERIVED, DIMS, FAKE_SECRETS, PLANTED } from "./planted";
import { cosine, mulberry32, nearVector, toVectorLiteral, unitVector } from "./rng";

const { Client } = pg;

const BASE_URL =
  process.env.FIXTURES_PG_URL ??
  "postgresql://postgres:postgres@localhost:55432/postgres";

const DATABASES = {
  langchain: "fixture_langchain",
  llamaindex: "fixture_llamaindex",
  custom: "fixture_custom",
  supabaseDocs: "fixture_supabase_docs",
  guiriLike: "fixture_guiri_like",
} as const;

function dbUrl(database: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withClient<T>(
  url: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureDatabases(): Promise<void> {
  await withClient(BASE_URL, async (client) => {
    for (const name of Object.values(DATABASES)) {
      const existing = await client.query(
        "select 1 from pg_database where datname = $1",
        [name],
      );
      if (existing.rowCount === 0) {
        await client.query(`create database "${name}"`);
      }
    }
  });
}

async function resetSchema(client: pg.Client): Promise<void> {
  await client.query("drop schema if exists public cascade");
  await client.query("create schema public");
  await client.query("create extension if not exists vector");
}

/** A planted row destined for a chunk-bearing table. */
interface ChunkRow {
  text: string;
  embedding: number[] | null;
  source: string | null;
}

// ---------------------------------------------------------------------------
// Fixture A — langchain-pgvector (rotten corpus; no timestamp column)
// ---------------------------------------------------------------------------
function buildLangchainRows(): ChunkRow[] {
  const rng = mulberry32(0x1a2b3c4d);
  const dim = DIMS.langchain;
  const rows: ChunkRow[] = [];

  for (let i = 0; i < PLANTED.langchain.healthy; i += 1) {
    rows.push({ text: healthyChunk(i), embedding: unitVector(dim, rng), source: sourceUrl(i) });
  }

  for (let g = 0; g < PLANTED.langchain.exactDuplicateGroups; g += 1) {
    const groupEmbedding = unitVector(dim, rng);
    const normalizationOnly = g < PLANTED.langchain.exactDuplicateNormalizationOnlyGroups;
    for (let c = 0; c < PLANTED.langchain.exactDuplicateCopies; c += 1) {
      rows.push({
        text: duplicateMember(g, c, normalizationOnly),
        embedding: groupEmbedding,
        source: sourceUrl(1000 + g),
      });
    }
  }

  for (let p = 0; p < PLANTED.langchain.nearDuplicatePairs; p += 1) {
    const base = unitVector(dim, rng);
    const near = nearVector(base, 0.1, rng);
    if (cosine(base, near) < 0.97) {
      throw new Error(`near-duplicate pair ${p} fell below the 0.97 threshold`);
    }
    rows.push({ text: nearDuplicateText(p, 0), embedding: base, source: sourceUrl(2000 + p) });
    rows.push({ text: nearDuplicateText(p, 1), embedding: near, source: sourceUrl(2000 + p) });
  }

  for (let i = 0; i < PLANTED.langchain.thinChunks; i += 1) {
    rows.push({ text: thinChunk(i), embedding: unitVector(dim, rng), source: sourceUrl(3000 + i) });
  }

  for (let i = 0; i < PLANTED.langchain.secretChunks; i += 1) {
    rows.push({
      text: secretChunk(FAKE_SECRETS[i]),
      embedding: unitVector(dim, rng),
      source: sourceUrl(4000 + i),
    });
  }

  return rows;
}

async function seedLangchain(): Promise<void> {
  await withClient(dbUrl(DATABASES.langchain), async (client) => {
    await resetSchema(client);
    // No updated_at anywhere → "missing timestamps" fixture.
    await client.query(`
      create table langchain_pg_collection (
        uuid uuid primary key default gen_random_uuid(),
        name text not null,
        cmetadata jsonb
      );
      create table langchain_pg_embedding (
        id uuid primary key default gen_random_uuid(),
        collection_id uuid references langchain_pg_collection(uuid),
        embedding vector(${DIMS.langchain}),
        document text,
        cmetadata jsonb
      );
    `);
    const collection = await client.query(
      "insert into langchain_pg_collection (name, cmetadata) values ($1, $2) returning uuid",
      ["docs", JSON.stringify({ description: "product docs" })],
    );
    const collectionId = collection.rows[0].uuid as string;

    const rows = buildLangchainRows();
    await client.query("begin");
    for (const row of rows) {
      await client.query(
        `insert into langchain_pg_embedding (collection_id, embedding, document, cmetadata)
         values ($1, $2, $3, $4)`,
        [
          collectionId,
          row.embedding ? toVectorLiteral(row.embedding) : null,
          row.text,
          JSON.stringify({ source: row.source }),
        ],
      );
    }
    await client.query("commit");
  });
}

// ---------------------------------------------------------------------------
// Fixture B — llamaindex-pgvector (mixed embedding dims + null embeddings)
// ---------------------------------------------------------------------------
async function seedLlamaindex(): Promise<void> {
  await withClient(dbUrl(DATABASES.llamaindex), async (client) => {
    await resetSchema(client);
    // Unconstrained `vector` column so rows may hold differing dimensions.
    await client.query(`
      create table data_embeddings (
        id uuid primary key default gen_random_uuid(),
        node_id text not null,
        text text not null,
        embedding vector,
        metadata_ jsonb
      );
    `);
    const rng = mulberry32(0x5e6f7a8b);
    let node = 0;

    await client.query("begin");
    const insert = async (text: string, embedding: number[] | null) => {
      await client.query(
        `insert into data_embeddings (node_id, text, embedding, metadata_)
         values ($1, $2, $3, $4)`,
        [
          `node-${node}`,
          text,
          embedding ? toVectorLiteral(embedding) : null,
          JSON.stringify({ doc_id: `doc-${node}` }),
        ],
      );
      node += 1;
    };

    for (let i = 0; i < PLANTED.llamaindex.healthy; i += 1) {
      await insert(healthyChunk(i), unitVector(DIMS.llamaindexMajority, rng));
    }
    for (let i = 0; i < PLANTED.llamaindex.mixedDimRows; i += 1) {
      await insert(healthyChunk(500 + i), unitVector(DIMS.llamaindexOffDim, rng));
    }
    for (let i = 0; i < PLANTED.llamaindex.nullEmbeddingRows; i += 1) {
      await insert(healthyChunk(900 + i), null);
    }
    await client.query("commit");
  });
}

// ---------------------------------------------------------------------------
// Fixture C — custom bespoke schema (CLEAN; two long text columns force
// interactive mapping in PR-04). Used to verify zero detector false positives.
// ---------------------------------------------------------------------------
async function seedCustom(): Promise<void> {
  await withClient(dbUrl(DATABASES.custom), async (client) => {
    await resetSchema(client);
    await client.query(`
      create table kb_entries (
        id uuid primary key default gen_random_uuid(),
        body_text text not null,
        summary text not null,
        vec vector(${DIMS.custom}),
        props jsonb,
        page_url text,
        modified_at timestamptz not null default now()
      );
    `);
    const rng = mulberry32(0x9c0d1e2f);
    await client.query("begin");
    for (let i = 0; i < PLANTED.custom.healthy; i += 1) {
      await client.query(
        `insert into kb_entries (body_text, summary, vec, props, page_url)
         values ($1, $2, $3, $4, $5)`,
        [
          healthyChunk(i),
          summaryText(i),
          toVectorLiteral(unitVector(DIMS.custom, rng)),
          JSON.stringify({ topicIndex: i }),
          sourceUrl(i),
        ],
      );
    }
    await client.query("commit");
  });
}

// ---------------------------------------------------------------------------
// Fixture D — supabase-docs-tutorial (healthy; second auto-detect target)
// ---------------------------------------------------------------------------
async function seedSupabaseDocs(): Promise<void> {
  await withClient(dbUrl(DATABASES.supabaseDocs), async (client) => {
    await resetSchema(client);
    await client.query(`
      create table documents (
        id bigint generated always as identity primary key,
        content text not null,
        embedding vector(${DIMS.supabaseDocs}),
        metadata jsonb
      );
    `);
    const rng = mulberry32(0xa1b2c3d4);
    await client.query("begin");
    for (let i = 0; i < PLANTED.supabaseDocs.healthy; i += 1) {
      await client.query(
        `insert into documents (content, embedding, metadata) values ($1, $2, $3)`,
        [
          healthyChunk(i),
          toVectorLiteral(unitVector(DIMS.supabaseDocs, rng)),
          JSON.stringify({ source: sourceUrl(i) }),
        ],
      );
    }
    await client.query("commit");
  });
}

// ---------------------------------------------------------------------------
// Fixture E — production-like multi-table pgvector layout. The real chunk table
// should win over cache/internal vector tables without prompting.
// ---------------------------------------------------------------------------
async function seedGuiriLike(): Promise<void> {
  await withClient(dbUrl(DATABASES.guiriLike), async (client) => {
    await resetSchema(client);
    await client.query(`
      create table document_chunks (
        id uuid primary key default gen_random_uuid(),
        content text not null,
        embedding vector(${DIMS.guiriLikeCurrent}),
        source_id uuid,
        source_url text,
        source_type text,
        chunk_index integer,
        metadata jsonb,
        created_at timestamp without time zone default now(),
        embedding_3072 vector(${DIMS.guiriLikeNext}),
        quality_flags text[],
        quarantined boolean default false,
        content_hash text
      );

      create table embedding_cache (
        text_hash text primary key,
        embedding vector(${DIMS.guiriLikeCurrent}) not null,
        model text not null,
        created_at timestamptz not null default now(),
        last_used_at timestamptz not null default now(),
        usage_count integer not null default 1,
        text_length integer not null,
        embedding_3072 vector(${DIMS.guiriLikeNext})
      );

      create table chunkfunk_chunks (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null default gen_random_uuid(),
        source_id uuid not null default gen_random_uuid(),
        document_id uuid,
        title text not null,
        path text not null,
        text text not null,
        quality integer not null default 100,
        warnings text[] not null default '{}',
        duplicate boolean not null default false,
        embedding vector(${DIMS.guiriLikeCurrent}),
        metadata jsonb not null default '{}',
        created_at timestamptz not null default now()
      );

      create table sprigkeeper_chunks (like chunkfunk_chunks including all);
    `);

    const rng = mulberry32(0x67756972);
    await client.query("begin");
    for (let i = 0; i < PLANTED.guiriLike.documentChunks; i += 1) {
      await client.query(
        `insert into document_chunks
          (content, embedding, source_url, source_type, chunk_index, metadata, embedding_3072, content_hash)
         values ($1, $2, $3, $4, $5, $6, $7, md5($1))`,
        [
          healthyChunk(i),
          toVectorLiteral(unitVector(DIMS.guiriLikeCurrent, rng)),
          sourceUrl(i),
          "official",
          i,
          JSON.stringify({ topicIndex: i }),
          toVectorLiteral(unitVector(DIMS.guiriLikeNext, rng)),
        ],
      );
    }

    for (let i = 0; i < PLANTED.guiriLike.cacheRows; i += 1) {
      await client.query(
        `insert into embedding_cache
          (text_hash, embedding, model, text_length, embedding_3072)
         values ($1, $2, $3, $4, $5)`,
        [
          `hash-${i}`,
          toVectorLiteral(unitVector(DIMS.guiriLikeCurrent, rng)),
          "text-embedding-3-small",
          512,
          toVectorLiteral(unitVector(DIMS.guiriLikeNext, rng)),
        ],
      );
    }

    for (const table of ["chunkfunk_chunks", "sprigkeeper_chunks"]) {
      for (let i = 0; i < PLANTED.guiriLike.internalChunks; i += 1) {
        await client.query(
          `insert into ${table}
            (title, path, text, embedding, metadata)
           values ($1, $2, $3, $4, $5)`,
          [
            `Internal smoke chunk ${i}`,
            `/internal/${i}`,
            healthyChunk(500 + i),
            toVectorLiteral(unitVector(DIMS.guiriLikeCurrent, rng)),
            JSON.stringify({ internal: true }),
          ],
        );
      }
    }
    await client.query("commit");
    await client.query("analyze");
  });
}

// ---------------------------------------------------------------------------
// Self-check — fail loudly if the seeded corpus drifts from README's contract.
// ---------------------------------------------------------------------------
async function scalar(client: pg.Client, sql: string): Promise<number> {
  const result = await client.query(sql);
  return Number(result.rows[0].count);
}

async function verify(): Promise<void> {
  await withClient(dbUrl(DATABASES.langchain), async (client) => {
    const total = await scalar(client, "select count(*) from langchain_pg_embedding");
    if (total !== DERIVED.langchainTotal) {
      throw new Error(`langchain total ${total} !== expected ${DERIVED.langchainTotal}`);
    }
    // Normalization used to sanity-check the plant against §5.1 (lowercase +
    // collapse whitespace); intentionally does NOT trim, to prove the counts
    // hold even for a non-trimming normalizer.
    const norm = "regexp_replace(lower(document), '\\s+', ' ', 'g')";
    const dupRows = await scalar(
      client,
      `select coalesce(sum(c), 0) as count from (
         select count(*) c from langchain_pg_embedding group by ${norm} having count(*) >= 2
       ) g`,
    );
    if (dupRows !== DERIVED.langchainExactDuplicateRows) {
      throw new Error(
        `langchain exact-dup rows ${dupRows} !== ${DERIVED.langchainExactDuplicateRows} ` +
          `(normalization-only groups may not be collapsing)`,
      );
    }
    const dupGroups = await scalar(
      client,
      `select count(*) from (
         select ${norm} n from langchain_pg_embedding group by ${norm} having count(*) >= 2
       ) g`,
    );
    if (dupGroups !== PLANTED.langchain.exactDuplicateGroups) {
      throw new Error(`langchain exact-dup groups ${dupGroups} !== ${PLANTED.langchain.exactDuplicateGroups}`);
    }
    const thin = await scalar(
      client,
      `select count(*) from langchain_pg_embedding where length(${norm}) < 120`,
    );
    if (thin !== PLANTED.langchain.thinChunks) {
      throw new Error(
        `langchain thin ${thin} !== ${PLANTED.langchain.thinChunks} ` +
          `(a non-thin planted chunk may have dropped below 120 chars)`,
      );
    }
    const secrets = await scalar(
      client,
      `select count(*) from langchain_pg_embedding
       where document ~ 'sk-[a-zA-Z0-9]{20,}' or document ~ 'AKIA[0-9A-Z]{16}'
          or document ~ 'BEGIN PRIVATE KEY'`,
    );
    if (secrets !== PLANTED.langchain.secretChunks) {
      throw new Error(`langchain secrets ${secrets} !== ${PLANTED.langchain.secretChunks}`);
    }
    const nullTs = await scalar(
      client,
      `select count(*) from information_schema.columns
       where table_name = 'langchain_pg_embedding' and column_name in ('updated_at','created_at')`,
    );
    if (nullTs !== 0) throw new Error("langchain fixture must have no timestamp column");
  });

  await withClient(dbUrl(DATABASES.llamaindex), async (client) => {
    const total = await scalar(client, "select count(*) from data_embeddings");
    if (total !== DERIVED.llamaindexTotal) {
      throw new Error(`llamaindex total ${total} !== expected ${DERIVED.llamaindexTotal}`);
    }
    const distinctDims = await scalar(
      client,
      "select count(distinct vector_dims(embedding)) from data_embeddings where embedding is not null",
    );
    if (distinctDims < 2) throw new Error("llamaindex fixture must contain mixed embedding dims");
    const nulls = await scalar(
      client,
      "select count(*) from data_embeddings where embedding is null",
    );
    if (nulls !== PLANTED.llamaindex.nullEmbeddingRows) {
      throw new Error(`llamaindex null embeddings ${nulls} !== ${PLANTED.llamaindex.nullEmbeddingRows}`);
    }
  });

  await withClient(dbUrl(DATABASES.custom), async (client) => {
    const total = await scalar(client, "select count(*) from kb_entries");
    if (total !== PLANTED.custom.healthy) {
      throw new Error(`custom total ${total} !== ${PLANTED.custom.healthy}`);
    }
  });

  await withClient(dbUrl(DATABASES.supabaseDocs), async (client) => {
    const total = await scalar(client, "select count(*) from documents");
    if (total !== PLANTED.supabaseDocs.healthy) {
      throw new Error(`supabase-docs total ${total} !== ${PLANTED.supabaseDocs.healthy}`);
    }
  });

  await withClient(dbUrl(DATABASES.guiriLike), async (client) => {
    const total = await scalar(client, "select count(*) from document_chunks");
    if (total !== PLANTED.guiriLike.documentChunks) {
      throw new Error(`guiri-like document_chunks total ${total} !== ${PLANTED.guiriLike.documentChunks}`);
    }
    const cache = await scalar(client, "select count(*) from embedding_cache");
    if (cache !== PLANTED.guiriLike.cacheRows) {
      throw new Error(`guiri-like embedding_cache total ${cache} !== ${PLANTED.guiriLike.cacheRows}`);
    }
    const internal = await scalar(
      client,
      "select (select count(*) from chunkfunk_chunks) + (select count(*) from sprigkeeper_chunks) as count",
    );
    if (internal !== PLANTED.guiriLike.internalChunks * 2) {
      throw new Error(`guiri-like internal chunks ${internal} !== ${PLANTED.guiriLike.internalChunks * 2}`);
    }
  });
}

async function main(): Promise<void> {
  await ensureDatabases();
  await seedLangchain();
  await seedLlamaindex();
  await seedCustom();
  await seedSupabaseDocs();
  await seedGuiriLike();
  await verify();
  console.log(
    `Seeded fixtures:\n` +
      `  ${DATABASES.langchain}: ${DERIVED.langchainTotal} chunks ` +
      `(${DERIVED.langchainExactDuplicateRows} exact-dup rows / ${PLANTED.langchain.exactDuplicateGroups} groups, ` +
      `${PLANTED.langchain.nearDuplicatePairs} near-dup pairs, ${PLANTED.langchain.thinChunks} thin, ` +
      `${PLANTED.langchain.secretChunks} secrets, no timestamps)\n` +
      `  ${DATABASES.llamaindex}: ${DERIVED.llamaindexTotal} chunks ` +
      `(${PLANTED.llamaindex.mixedDimRows} off-dim, ${PLANTED.llamaindex.nullEmbeddingRows} null embeddings)\n` +
      `  ${DATABASES.custom}: ${PLANTED.custom.healthy} chunks (clean; interactive mapping target)\n` +
      `  ${DATABASES.supabaseDocs}: ${PLANTED.supabaseDocs.healthy} chunks (clean)\n` +
      `  ${DATABASES.guiriLike}: ${PLANTED.guiriLike.documentChunks} chunks ` +
      `(multi-table auto-detect target)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
