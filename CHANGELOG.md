# Changelog

All notable user-facing changes should be recorded here when preparing a release.

ChunkFunk is currently pre-1.0, so changes may still move quickly. Release notes should stay plain and practical: what changed, why it matters, and whether users need to do anything.

## Unreleased

- Changed normal scans to stay local even after `chunkfunk login`; report uploads now require the explicit `chunkfunk sync` command.

## 0.1.1

- Improved generic pgvector auto-detection when multiple vector-bearing tables exist.
- Added a production-like fixture that proves the primary `document_chunks` table wins over cache/internal vector tables.
- Kept ambiguous bespoke schemas on the interactive/manual mapping path instead of guessing.

## 0.1.0

- Initial public CLI release.
- Read-only Postgres/pgvector scanning.
- Auto-detection for LangChain PGVector, LlamaIndex, Supabase vecs, Supabase docs tutorial, and generic single-table pgvector layouts.
- Terminal, JSON, and self-contained HTML reports.
- Default-off telemetry with published payload schema.
