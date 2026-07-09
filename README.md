# ChunkFunk

ChunkFunk is a read-only CLI that scans an existing Postgres/pgvector RAG database and reports what looks stale, duplicated, or broken. It runs locally, does not need an account, and does not write to your database.

ChunkFunk is open source because RAG maintenance should be inspectable, practical, and safe for the builders who depend on it. Contributions are welcome, especially real-world schema reports, fixtures, docs, and small improvements that make the scanner easier to trust.

## 10-minute quickstart

```bash
npx chunkfunk init
npx chunkfunk scan
```

`init` writes a local `chunkfunk.yaml` with the detected mapping. It stores the name of your connection-string environment variable, not the connection string itself.

For a one-off run:

```bash
DATABASE_URL="postgresql://chunkfunk_readonly:password@host:5432/db" npx chunkfunk scan
```

## What ChunkFunk looks for

The first scan focuses on database-level problems that usually send RAG builders
into manual debugging:

- empty or partially failed ingestion
- indexed counts below an explicit inventory minimum you provide
- duplicate, near-duplicate, thin, or oversized chunks
- missing source/citation locators
- table-like chunks without source/page/sheet/row traceability
- missing or partial timestamps that make freshness and "latest data" hard to trust
- sparse or inconsistent metadata for filters
- null, mixed-dimension, or poorly indexed pgvector embeddings
- obvious risky strings such as accidentally indexed secrets

## Create a read-only Postgres role

Create a database role like this before connecting ChunkFunk. Replace `your_database`, `public`, and the password with your own values.

```sql
create role chunkfunk_readonly login password 'replace-with-a-long-random-password';

grant connect on database your_database to chunkfunk_readonly;
grant usage on schema public to chunkfunk_readonly;
grant select on all tables in schema public to chunkfunk_readonly;
grant select on all sequences in schema public to chunkfunk_readonly;

alter default privileges in schema public
  grant select on tables to chunkfunk_readonly;

alter role chunkfunk_readonly set default_transaction_read_only = on;
alter role chunkfunk_readonly set statement_timeout = '2min';
```

If your vectors live in another schema, repeat the schema grants for that schema.

## Auto-detected schemas

| Schema | What ChunkFunk looks for | Status |
|---|---|---|
| LangChain PGVector | `langchain_pg_embedding` with `document`, `embedding`, `cmetadata`, `collection_id` | Auto-detected |
| LlamaIndex | `data_*` table with `text`, `embedding`, `metadata_`, `node_id` | Auto-detected |
| Supabase vecs | `vecs` schema with `id`, `vec`, `metadata` | Auto-detected, with content confirmation |
| Supabase docs tutorial | `documents` with `content`, `embedding`, `metadata` | Auto-detected |
| Generic single table | One vector column plus one long text-like column | Proposed, then confirmed |

If your schema does not match, `chunkfunk init` asks you to map the columns manually.

## Optional inventory checks

ChunkFunk will not guess how many rows your ingestion job should have produced.
If you know the expected minimum, add it to `chunkfunk.yaml`:

```yaml
inventory:
  minChunks: 400
  minDocuments: 50
```

The scan will compare those numbers with the indexed rows it can observe and
report a count gap without printing source names or document content.

## Privacy and telemetry

ChunkFunk is read-only by construction:

- The recommended database role is read-only on the server.
- The CLI opens its Postgres session in read-only mode.
- The scanner only needs `SELECT` access.

Telemetry is consent-based and default-off. If you say no, nothing is sent. If you say yes, the payload contains schema shape, counts, finding totals, score, CLI version, and OS only. It does not contain document text, chunk text, table samples, connection strings, tokens, or source URLs.

Run this to see the exact bytes that would be sent:

```bash
npx chunkfunk --show-telemetry
```

The full published payload contract is in [TELEMETRY.md](TELEMETRY.md).

`chunkfunk login` and `chunkfunk sync` point at `https://chunkfunk.app`.

## Example report

See a committed sample report from the deliberately rotten LangChain fixture: [docs/sample-rotten-langchain-report.html](docs/sample-rotten-langchain-report.html).

Human-readable reports include a simple `RAG rot` label so the result is easy to
scan and share. Reports hide chunk text, metadata values, source locators, and
connection strings; detailed evidence uses counts, refs, safe keys, and hashes.

## Terminal demo

The source script for the terminal recording is committed at [docs/chunkfunk-demo.tape](docs/chunkfunk-demo.tape). The GIF slot is intentionally left for a real recording; no fake terminal capture is included.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
```

Fixture-backed tests use `FIXTURES_PG_URL`, for example:

```bash
FIXTURES_PG_URL="postgresql://postgres:postgres@127.0.0.1:55433/postgres" npm test
```

Do not publish from automation. Use `npm publish --dry-run` for review, then publish manually.

## Contributing

New contributors are welcome. Good first contributions include schema reports, fixtures, docs, clearer error messages, and small tests around real RAG layouts.

Start here:

- [docs/first-contribution.md](docs/first-contribution.md) gives new contributors a small first path.
- [CONTRIBUTING.md](CONTRIBUTING.md) explains how to make a useful pull request.
- [SUPPORT.md](SUPPORT.md) explains where to ask questions or report problems.
- [SECURITY.md](SECURITY.md) explains how to report sensitive issues safely.
- [GOVERNANCE.md](GOVERNANCE.md) explains how project decisions and reviews work.
- [docs/maintainer-review-guide.md](docs/maintainer-review-guide.md) is Victor's review checklist.

Victor Solares is the maintainer and final reviewer. The review bar is practical: keep the tool read-only, protect private data, solve one clear problem, and make the result easier for builders to trust.
