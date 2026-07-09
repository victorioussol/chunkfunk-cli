# Synthetic CLI testing

ChunkFunk can be tested like a real user without touching a real customer database.
The smoke test packs the npm artifact, installs it into a temporary directory
outside this repo, and runs the installed `chunkfunk` binary through common
first-run paths.

```bash
npm run test:smoke
```

Without a database URL, the smoke test still verifies:

- the bundled CLI builds
- the npm tarball installs
- `chunkfunk --version` works from the installed package
- missing `DATABASE_URL` produces a clear error

To run the full fake-database loop, seed the fixture databases and provide their
base connection URL:

```bash
FIXTURES_PG_URL=postgresql://postgres:postgres@localhost:55432/postgres npm run test:smoke
```

The full loop covers:

- fresh-user `init --yes` and `scan --json`
- JSON stdout staying clean while progress logs go to stderr
- `scan --ci --min-score` pass/fail exit codes
- explicit inventory drift from `chunkfunk.yaml`
- `--show-telemetry` payload inspection
- LangChain PGVector, LlamaIndex PGVector, Supabase docs-tutorial, Guiri-like
  multi-table, metadata-health, empty-ingestion, and structured-data fixtures

## Testing a dev database

Use only a read-only connection string. Do not run smoke tests with an admin,
service-role, owner, or migration credential.

Recommended safety checks before scanning a dev database:

- create a dedicated read-only Postgres role
- set a statement timeout for the role
- point `DATABASE_URL` at that role
- run `chunkfunk scan --json --yes` first, then inspect the report before using
  `sync`

For Guiri or any production-like database, prefer a read replica or sanitized
development copy. The goal is to test ChunkFunk's user experience, not to put
pressure on a live app database.
