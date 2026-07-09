# Sharing a Sanitized Schema

Schema reports help ChunkFunk support real RAG databases, but public issues must
not include private data. Share structure, not contents.

## Safe To Share

- framework or library name, such as LangChain, LlamaIndex, or custom pgvector
- table names, unless they contain customer or project names
- column names and data types
- vector dimensions and index methods
- estimated row counts
- which column contains chunk text, embeddings, metadata, source ids, and timestamps
- the ChunkFunk command you ran and the sanitized error message

## Do Not Share

- connection strings or hostnames
- passwords, API tokens, service-role keys, or cloud credentials
- document text, chunk text, prompts, or retrieved answers
- source URLs, file paths, customer names, tenant ids, email addresses, or user ids
- raw metadata values
- screenshots that include private database names or row values

If a table or column name contains a customer, tenant, internal project, or
private product name, rename it before posting.

## Useful Read-Only Queries

These queries inspect schema shape only. They do not read document or chunk
content.

```sql
select
  table_schema,
  table_name,
  column_name,
  data_type,
  udt_name
from information_schema.columns
where table_schema not in ('pg_catalog', 'information_schema')
order by table_schema, table_name, ordinal_position;
```

```sql
select
  schemaname,
  relname as table_name,
  n_live_tup as estimated_rows
from pg_stat_user_tables
order by schemaname, relname;
```

```sql
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname not in ('pg_catalog', 'information_schema')
order by schemaname, tablename, indexname;
```

Review the output before posting. Remove private schema names, source-like
column names that include customer data, and any accidental row values.

## Copy-Paste Issue Format

```text
Framework or tool:
Postgres version:
pgvector version, if known:

Sanitized table shape:
  public.documents
    id uuid
    content text
    embedding vector(1536)
    metadata jsonb
    updated_at timestamptz

Estimated rows:
  public.documents: about 120000

Indexes:
  documents_embedding_hnsw_idx on embedding using hnsw

Chunk text column:
Embedding column:
Metadata column:
Source/citation column:
Timestamp column:

What ChunkFunk did:

What you expected:

Safety check:
  I removed connection strings, tokens, document text, chunk text, source URLs,
  customer names, tenant ids, user ids, and raw metadata values.
```

When in doubt, share less. A maintainer can ask for another sanitized detail if
it is needed.
