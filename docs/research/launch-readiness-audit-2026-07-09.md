# ChunkFunk Launch-Readiness Audit - 2026-07-09

This audit summarizes the current PMF loop for the public ChunkFunk CLI. It is
not a release announcement. It is the decision record for what is ready, what
was intentionally not built, and where more real operator evidence is needed.

## Current Confidence

ChunkFunk is now strongest as a Postgres/pgvector maintenance scanner for teams
that already have a RAG database and need to inspect the stored evidence layer
before debugging retrieval manually.

The strongest user promise is:

> Run ChunkFunk before changing chunking, prompts, retrievers, or models.

That promise is backed by the research note in
[`reddit-rag-operator-pain-2026-07-09.md`](reddit-rag-operator-pain-2026-07-09.md),
which collects more than 30 source-backed pain signals across Reddit, GitHub
issues, public docs, and weak X/Twitter snippets.

## Evidence-Backed Coverage Now Shipped

ChunkFunk now covers the highest-confidence first-scan maintenance failures
from the research:

| Operator pain | Current ChunkFunk coverage |
|---|---|
| Failed or empty ingestion | Empty mapped table finding and fixture coverage. |
| Unknown expected inventory | Optional `inventory.minChunks` and `inventory.minDocuments` checks. |
| Duplicate evidence | Exact and near-duplicate checks with share-safe evidence. |
| Bad chunk shape | Thin, oversized, and mid-sentence boundary diagnostics. |
| Table and spreadsheet RAG rot | Table-like chunk checks and source/page/sheet/row locator readiness. |
| Weak citations | Missing and sparse source/citation locator coverage. |
| Freshness and "latest" failures | Missing and partial timestamp diagnostics. |
| Metadata filter drift | Sparse keys, inconsistent keys, and mixed value types. |
| Pgvector schema health | Null embeddings, mixed dimensions, missing ANN indexes, multiple vector columns, and wrong indexed vector column checks. |
| Deleted/stale retained evidence | Rows marked deleted or archived while still present in the mapped chunk table. |
| Privacy trust | Reports hide chunk text, metadata values, source locators, and connection strings. Telemetry remains default-off. |

## Verification Surface

The public test surface now includes realistic fake Postgres databases for:

- LangChain PGVector
- LlamaIndex PGVector
- Supabase docs tutorial
- Guiri-like multi-table databases
- metadata drift
- empty ingestion
- structured/table-like RAG
- boundary-damaged chunks
- generic body/properties/source_url schemas
- sparse source locator coverage
- soft-deleted/archived chunk retention

The packaged smoke test installs the npm tarball into a temporary directory and
exercises the compiled `dist/` CLI against those fixtures. This matters because
it tests the tool like a new user would run it, not like a monorepo developer.

## Current Open PMF Questions

### Issue #30 - X/Twitter Evidence

Status: keep open.

X/Twitter remains weak evidence. Previous Firecrawl work returned snippets, not
full inspectable threads. A follow-up shell check on 2026-07-09 did not expose a
Firecrawl API key to this repo process, and normal web search still did not
produce enough full public X/Twitter thread context to treat it as deeply
researched.

Decision: do not build product behavior from X snippets alone. Use accessible
Reddit, GitHub issue, docs, and live user evidence until full X/Twitter threads
are available.

### Issue #24 - Risky Content Beyond Secrets

Status: keep open, out of launch scope.

The narrow, deterministic part of this risk was shipped as soft-deleted chunk
retention. Broad malicious-document, prompt-injection, or content-policy
classification remains too privacy-sensitive and likely to create false
positives without real user demand.

Decision: keep risky text detection limited to obvious leaked credentials for
launch. Revisit broader checks only with opt-in fixtures and clear user demand.

### Issue #23 - Non-Postgres Vector Stores

Status: keep open, out of launch scope.

Hosted vector stores have real maintenance concerns, but there is not enough
direct user demand yet to justify adding another adapter. The current wedge is
Postgres/pgvector, where ChunkFunk can be read-only, inspectable, and useful
without cloud credentials.

Decision: stay Postgres-first until actual users ask for Pinecone, Weaviate,
Qdrant, Chroma, or other adapters with concrete schemas and operational needs.

## Dependency PR Triage

The remaining Dependabot PRs are not launch blockers:

- Vitest 4 is dev-only but changes a large test toolchain and engine surface.
- Inquirer 8 affects runtime CLI prompts and should not be merged casually.
- ESLint 10 and `@eslint/js` 10 are major linting changes and should wait for a
  focused maintenance pass.

Decision: leave them open until a separate dependency-maintenance cycle.

## Current Launch Bet

ChunkFunk is ready to validate the Postgres/pgvector maintenance wedge with real
operators. The next best PMF step is not more detectors by default. It is to get
5 to 10 real RAG admins to run the packaged CLI on read-only databases or
sanitized schema replicas and collect:

- whether auto-detect picked the right table
- whether the first `Fix first` list matched their mental model
- whether they found a real issue before manual retrieval debugging
- whether the report felt safe enough to share in an issue or Slack thread
- which missing finding they expected but did not see

## No-Build Decision

No new feature is justified from this audit alone. The strongest current gaps
have already been built or logged. The remaining useful work needs real user
feedback or better public-source access, not speculative product expansion.
