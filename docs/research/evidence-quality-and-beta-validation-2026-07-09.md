# Evidence Quality and Beta Validation - 2026-07-09

This note tightens the product-confidence standard for ChunkFunk. It does not
add scanner behavior, change privacy boundaries, or announce a release.

## Decision

ChunkFunk is ready for a narrow, controlled beta with teams that already run a
Postgres/pgvector RAG database.

It is **not** yet validated product-market fit. Public research shows that RAG
maintenance and retrieval debugging are real problems. It does not prove that
operators will install this CLI, act on its findings, or run it repeatedly.

The current product promise remains:

> Run ChunkFunk before changing chunking, prompts, retrievers, or models.

## Evidence Standard

The prior research note contains 36 source-backed signals. That is useful
discovery evidence, but the signals have different strength.

| Evidence class | What it proves | How ChunkFunk uses it |
|---|---|---|
| Direct | An operator describes a stored-data, freshness, traceability, ingestion, metadata, or pgvector problem that a read-only scan can inspect. | Can support a bounded detector or beta hypothesis. |
| Adjacent | A builder reports a general RAG problem, a different vector-store problem, or a query-time issue. | Supports problem framing only. Do not infer a detector. |
| Weak | A snippet, benchmark claim, product pitch, or inaccessible thread. | Do not make product decisions from it. |

Do not describe all 36 signals as strong market proof. The more accurate claim
is: "ChunkFunk has 36 source-backed RAG pain signals, with a smaller direct
subset supporting its Postgres maintenance wedge."

## Revalidated Direct Evidence

| Operator signal | Why it is direct | Product implication |
|---|---|---|
| A production RAG builder describes stale indexes, wrong-version retrieval, and chunks split mid-sentence. | These are stored-evidence symptoms that can be inspected without seeing a live prompt or document text. | Keep freshness, timestamp coverage, and boundary-damage checks central. |
| A 10k-plus document corpus needs current answers, dates, and citations across continuously updated sources. | This combines scale, freshness, and traceability in a real knowledge-base scenario. | Keep locator and timestamp readiness high in first-scan output. |
| A builder cannot make date metadata influence retrieval because it is missing from the summary/vector layer. | This is a concrete example of a schema that looks healthy but cannot support "latest" queries. | Partial timestamp and metadata-coverage checks are justified. |
| A vector store can appear valid while having no usable rows. | The example is Chroma, not Postgres, but the ingestion failure mode maps directly to an empty mapped chunk table. | Keep empty-ingestion and explicit inventory checks. |
| pgvector documents that filtered approximate searches can return fewer results and that null vectors are not indexed. | This is primary-source behavior for the current technical wedge. | Keep index, null-embedding, and metadata readiness checks. Do not claim to diagnose live recall without query evidence. |
| RAG products request retrieval trace views for debugging. | It proves runtime visibility is valuable, but traces contain private inputs and are not present in a database-only scan. | Keep runtime trace diagnostics out of scope until users provide a privacy-safe input. |

Sources:

- [Production RAG maintenance thread](https://www.reddit.com/r/LangChain/comments/1tk8jcw/nobody_tells_you_that_rag_in_production_is_mostly/)
- [Large, continuously updated corpus with citation needs](https://www.reddit.com/r/LocalLLaMA/comments/1ieiv7c/whats_the_best_current_setup_for_multi_document/)
- [Date metadata and latest-data retrieval problem](https://www.reddit.com/r/LangChain/comments/1h0ih0x/rag_how_to_ensure_a_date_fields_in_metadata_is/)
- [Empty vector-store ingestion example](https://www.reddit.com/r/LangChain/comments/1k7fv2j/chromadb_always_returns_empty/)
- [pgvector documentation](https://github.com/pgvector/pgvector)
- [pgvector filtered index behavior](https://github.com/pgvector/pgvector/issues/263)
- [Retrieval trace view request](https://github.com/labring/FastGPT/issues/7113)

## What Current Research Does Not Prove

The available research does not prove:

- that teams want a CLI instead of a tracing, evaluation, or managed-observability
  product;
- that Postgres/pgvector is the first adapter users will demand after beta;
- that an aggregate health score alone causes a repair action;
- that a screenshot-safe report will be shared;
- that users will run scans repeatedly.

Public X/Twitter material remains weak. Direct post pages could not be read
reliably, and snippets are not enough context to treat as strong evidence. Keep
[issue #30](https://github.com/victorioussol/chunkfunk-cli/issues/30) open
rather than inventing conclusions from partial access.

## No-Build Decision

Do not add another detector before beta evidence changes the priority.

The remaining tempting areas - retriever traces, query rewriting, reranking,
prompt behavior, broad risky-content classification, and non-Postgres adapters -
either require runtime data, carry a higher privacy risk, or lack direct demand
for ChunkFunk. They are intentionally out of the current read-only database
wedge.

## Controlled Beta Protocol

### Participants

Recruit 5 to 10 operators who:

- own or maintain an existing Postgres/pgvector RAG database;
- can create a narrow, server-enforced read-only database role;
- have a real retrieval or maintenance concern, not only a tutorial database;
- agree not to share document content, customer names, raw metadata values, or
  connection strings.

A sanitized schema replica is acceptable when production access is not
appropriate.

### Session

Each operator should:

1. Create or use a server-enforced read-only role.
2. Run `chunkfunk init`, confirm the detected mapping, and run one scan.
3. Review the `Fix first` list without revealing document content.
4. Mark every finding as one of: actionable, expected, unclear, or false
   positive.
5. State what they would have debugged manually without ChunkFunk.
6. Repeat the scan after a repair, on a second database, or in CI when
   appropriate.

Record only safe aggregate information:

- whether auto-detection selected the intended table;
- whether manual mapping was required;
- finding category and severity;
- whether a finding changed a debugging or repair decision;
- whether the operator would run it again;
- whether they would safely share the report;
- expected but missing categories.

### Working Success Gates

These are decision gates for this early beta, not universal industry benchmarks.

| Gate | Pass condition |
|---|---|
| First-run usability | At least 70% complete an initial scan without maintainer intervention. |
| Actionability | At least half identify one credible next action or a useful reason to stop debugging the data layer. |
| Trust | No content, identity, raw metadata, or connection-string exposure; no unexpected write behavior. |
| Repeat intent | At least 3 participants run it again after a change, against another database, or in CI. |
| Workflow pull | At least 2 independently say they would run it before manual retrieval debugging. |

### Revise or Stop Signals

Reprioritize the product if:

- most operators cannot identify the right table;
- findings are frequently seen as vague or false positives;
- operators expect runtime trace diagnostics before the database scan is useful;
- read-only setup is too difficult for the intended user;
- none of the participants wants a repeat scan.

## Research Discipline After Beta

Treat operator results as primary evidence. Each future detector should start
with:

1. a repeatable operator pain;
2. proof that it is observable from a read-only database scan;
3. a privacy-safe fixture;
4. a clear first-scan action; and
5. packaged smoke coverage.

This keeps ChunkFunk focused on inspectable RAG maintenance rather than becoming
a generic promise to fix every retrieval problem.
