# ChunkFunk

ChunkFunk is a read-only CLI that scans an existing Postgres/pgvector RAG database and reports what looks stale, duplicated, or broken. It runs locally, does not need an account, and does not write to your database.

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
