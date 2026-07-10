# RAG Operator Beta

This is a short, privacy-safe way to test whether ChunkFunk helps before you
spend time debugging retrieval manually.

## Who this is for

Use this beta if you maintain an existing Postgres/pgvector RAG database and
have a real concern about stale data, duplicate chunks, broken ingestion,
missing source traceability, metadata filters, chunk boundaries, or vector
index health.

It is not a request to share your documents or production credentials.

## What you need

- Node.js 20 or newer.
- A narrow, server-enforced read-only Postgres role.
- Permission to inspect the resulting terminal report without exposing private
  content.

Create the role using the [read-only role guide](../README.md#create-a-read-only-postgres-role).
The database connection string stays on your machine.

## Run one safe scan

```bash
export DATABASE_URL='postgresql://chunkfunk_readonly:YOUR_PASSWORD@HOST:5432/DATABASE'

npx chunkfunk init
npx chunkfunk scan
```

During `init`, confirm that the selected table is the one holding your RAG
chunks. If several tables look plausible, do not guess: choose the table
manually and record that outcome in the feedback form.

A normal `chunkfunk scan` stays local. It does not upload a report. Telemetry
is default-off, and `chunkfunk --show-telemetry` prints the exact bytes before
anything can be sent.

## What to look for

Read the `Fix first` list, then answer these questions:

1. Did ChunkFunk select the correct chunk table?
2. Did any finding reveal or confirm a real maintenance problem?
3. Was the suggested next action clear enough to act on?
4. Would you run this before manual retrieval debugging next time?
5. What category did you expect to see but did not?

## Send safe feedback

Use the [RAG operator feedback form](https://github.com/victorioussol/chunkfunk-cli/issues/new?template=operator_feedback.yml).
It asks only for safe, high-level outcomes.

Never include:

- connection strings, passwords, tokens, or secrets;
- document text, chunk text, customer names, or screenshots with private data;
- raw metadata values, source URLs, or identifying table names.

A sanitized schema shape is useful when you are comfortable sharing it. Follow
the [schema-sharing guide](sanitized-schema-sharing.md) and never include row
data.

## What a useful beta result looks like

A useful result can be positive or negative. We want to know whether the scan:

- found a real issue before a lengthy debugging session;
- confirmed that the stored data layer was not the problem;
- chose the wrong table or produced unclear findings; or
- missed an expected class of issue.

That information determines what ChunkFunk improves next.
