# @chunkfunk/fixtures

Dockerized Postgres + pgvector databases seeded with **planted problems**, used by
detector, introspection, scan, and packaged-smoke tests.

> ⚠️ **The counts below are a contract.** PR-03's detector tests assert against
> these exact numbers. Do not change a fixture without updating this table and the
> matching constants in [`src/planted.ts`](src/planted.ts).

## Usage

```bash
npm run fixtures:up     # start Postgres+pgvector (host port 55432), wait for healthy
npm run fixtures:seed   # create + seed the fixture databases (idempotent)
npm run fixtures:down   # stop and remove the container + volume
```

Connection base (override with `FIXTURES_PG_URL`):
`postgresql://postgres:postgres@localhost:55432/<database>`

The seed is fully deterministic (seeded PRNG) and idempotent — re-running rebuilds
each database from a clean `public` schema. It self-checks the counts and the
near-duplicate cosine similarities at the end and exits non-zero on any drift.

## Fixtures

Each fixture is its own database so introspection sees one RAG system per connection.

| Database | Recipe (PR-04) | Table(s) | Embedding dims | Timestamp column |
|---|---|---|---|---|
| `fixture_langchain` | `langchain-pgvector` (auto) | `langchain_pg_embedding` + `langchain_pg_collection` | 1536 | **none** (missing-timestamp fixture) |
| `fixture_llamaindex` | `llamaindex-pgvector` (auto) | `data_embeddings` | **mixed** 768 / 1536 | none |
| `fixture_custom` | interactive mapping | `kb_entries` (two long text columns) | 1024 | `modified_at` |
| `fixture_supabase_docs` | `supabase-docs-tutorial` (auto) | `documents` | 1536 | none |
| `fixture_metadata_health` | `generic-single-table` (auto) | `metadata_documents` | 1536 | `created_at` |
| `fixture_empty_documents` | `supabase-docs-tutorial` (auto) | `documents` | 1536 | none |
| `fixture_guiri_like` | `generic-single-table` (auto-ranked) | `document_chunks`, `embedding_cache`, `chunkfunk_chunks`, `sprigkeeper_chunks` | 1536 + 3072 | `created_at` |
| `fixture_structured_health` | `generic-single-table` (auto) | `structured_documents` | 1536 | `created_at` |
| `fixture_boundary_health` | `generic-single-table` (auto) | `boundary_documents` | 1536 | `created_at` |
| `fixture_generic_body_chunks` | `generic-single-table` (auto) | `knowledge_chunks` | 768 | `updated_at` |

## Planted problems (exact counts)

### `fixture_langchain` — the rotten corpus (298 chunks total)

| Problem | Detector (§5) | Count | Notes |
|---|---|---|---|
| Healthy chunks | — | 200 | Long, capitalized, terminated; no detector fires |
| Exact duplicates | `exact-duplicate` | **30 rows in 10 groups of 3** | 3 groups are duplicates **only after normalization** (differ by case/whitespace); 20 redundant copies (rows beyond the first per group) |
| Near duplicates | `near-duplicate` | **20 pairs** (40 rows) | Distinct text; embeddings cosine ≥ 0.97 by construction (planted near-neighbor) |
| Thin chunks | `thin-chunk` | **25** | All < 120 normalized chars |
| Risky (secrets) | `risky-chunk` | **3** | One fake OpenAI `sk-…`, one fake AWS `AKIA…`, one fake `-----BEGIN PRIVATE KEY-----` — all non-functional |
| Missing timestamps | `freshness` | table-level | No `updated_at`/`created_at` column → one `architecture` finding |

Corpus-level: 30/298 ≈ 10.1% of rows are in exact-duplicate groups (> 5% → the
`exact-duplicate` detector's corpus-wide `critical` summary also fires).

### `fixture_llamaindex` — embedding integrity (53 chunks total)

| Problem | Detector (§5) | Count | Notes |
|---|---|---|---|
| Healthy chunks @ 768 dims | — | 45 | Majority dimension |
| Off-dimension rows @ 1536 | `embedding-integrity` (mixed dims → `critical`) | **5** | Column is unconstrained `vector` so rows may differ |
| NULL embeddings | `embedding-integrity` (`embedding_null` → `warning`) | **3** | — |

### `fixture_custom` — clean (100 chunks total)

No planted problems. Verifies **zero false positives** (esp. zero false-positive
secrets, per PR-03). Two long text columns (`body_text`, `summary`) intentionally
defeat auto-detection so PR-04 exercises the interactive column picker.

### `fixture_supabase_docs` — clean/healthy (60 chunks total)

No planted problems. Second auto-detect target for PR-04; `content` + `embedding`
+ `metadata` match the `supabase-docs-tutorial` recipe directly. Includes an
HNSW index on `embedding` so architecture checks cover an indexed vector table.

### `fixture_metadata_health` — sparse/mixed metadata (40 chunks)

Real pgvector table used to prove metadata/chunk-shape architecture findings
against Postgres, not only in-memory mocks. It contains 12 rows with missing
metadata, 10 oversized chunks, and mixed `tenant_id` value types so filterability
and chunking checks can flag real-world drift without printing metadata values.

### `fixture_empty_documents` — failed ingestion shape (0 chunks)

Valid `documents` table with `content`, `embedding`, and `metadata`, but no rows.
Verifies that ChunkFunk can still auto-map a conventional empty table and report
that ingestion produced zero chunks instead of returning a misleading clean scan.

### `fixture_guiri_like` — multi-table auto-detect (150 primary chunks)

Production-like schema used to prove ChunkFunk can pick the actual chunk table
when several vector-bearing tables exist:

| Table | Purpose |
|---|---|
| `document_chunks` | Primary RAG chunks; `content`, `embedding`, `embedding_3072`, `metadata`, source columns |
| `embedding_cache` | Embedding cache; vector columns but no chunk content column |
| `chunkfunk_chunks` | Internal/legacy tool table; vector + text but should be deprioritized |
| `sprigkeeper_chunks` | Internal/legacy tool table; vector + text but should be deprioritized |

The expected auto-detected mapping is `public.document_chunks` with `content` +
`embedding`; ambiguous bespoke schemas should still fall back to the interactive
picker.

### `fixture_structured_health` — table-like chunks + partial timestamps (48 chunks)

Production-like structured-data fixture for PDF/CSV/spreadsheet RAG pain:

| Problem | Count | Purpose |
|---|---:|---|
| Table-like chunks without source/page/sheet/row locators | **20** | Proves structured chunks can be flagged without printing table row values |
| Table-like chunks with locators | **10** | Proves the detector distinguishes healthier structured chunks |
| Prose rows with locators | **18** | Keeps the table-like warning from being a whole-corpus false positive |
| Missing timestamps in mapped `created_at` column | **20** | Proves freshness is partial when timestamp coverage is incomplete |

The smoke test asserts that reports do not leak planted tenant values or table
row values from this fixture.

### `fixture_boundary_health` — mechanically split chunks (40 chunks)

Production-like prose fixture for chunk-boundary pain:

| Problem | Count | Purpose |
|---|---:|---|
| Mid-sentence fragment chunks | **24** | Proves ChunkFunk can summarize mechanically cut chunks without printing their text |
| Healthy prose rows | **16** | Keeps the detector from treating every normal row as a boundary problem |

The smoke test asserts that the report contains the boundary summary and does
not leak the planted fragment text.

### `fixture_generic_body_chunks` — custom pgvector body/properties schema (72 chunks)

Healthy custom schema used to prove generic auto-detection without adding a
named recipe:

| Column | Purpose |
|---|---|
| `body` | chunk text |
| `embedding` | pgvector embedding |
| `properties` | JSON metadata |
| `document_id` | stable document id |
| `source_url` | source/citation locator |
| `updated_at` | freshness timestamp |

The expected auto-detected mapping is `public.knowledge_chunks` with `body` +
`embedding`; the fixture contains only fake generated text and source URLs.

## Requirements

A working Docker daemon. Docker Desktop on some machines fails to start (privileged
port / vmnetd error requiring interactive admin approval); [Colima](https://github.com/abiosoft/colima)
(`brew install colima && colima start`) is a userspace alternative that needs no
admin prompt.
