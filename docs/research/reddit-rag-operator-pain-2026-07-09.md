# RAG Operator Pain Research — 2026-07-09

This pass supports the PMF goal for ChunkFunk: make a RAG operator say, "I
should run this on my database before debugging retrieval manually."

Direct Reddit access was blocked from this network, so Reddit discovery used the
public PullPush archive and links back to the original Reddit threads. Public
X/Twitter search was attempted through Jina Reader and Nitter-style mirrors, but
anonymous access to `x.com` returned `403 AbuseAlleviationError` and Nitter
search returned an empty page. Do not treat X as researched in this pass.

## Strong Evidence

These are concrete pain signals from builders trying to make RAG work, maintain
it, or debug bad answers.

| # | Pain signal | Source | ChunkFunk implication |
|---:|---|---|---|
| 1 | Chunking and embedding settings feel like guesswork, especially with policy documents and spreadsheets where codes must stay attached to meaning. | [LocalLLaMA: RAG embeddings survey](https://www.reddit.com/r/LocalLLaMA/comments/1kp558b/rag_embeddings_survey_what_are_your_chunking/) | Keep chunk-shape diagnostics central; add checks for structured/table-like chunks that may lose row context. |
| 2 | Long PDFs create a practical chunking/context tradeoff: upload whole documents, chunk them, or pay for huge context. | [LocalLLaMA: How to improve RAG?](https://www.reddit.com/r/LocalLLaMA/comments/1kien12/how_to_improve_rag/) | Report oversized chunks and boundary problems in plain language. |
| 3 | Operators need accuracy and citations across 10k+ documents, not just a demo-sized corpus. | [LocalLLaMA: Multi-document RAG needs accuracy and citations](https://www.reddit.com/r/LocalLLaMA/comments/1ieiv7c/whats_the_best_current_setup_for_multi_document/) | Source/citation traceability is launch-critical, not polish. |
| 4 | Builders are unsure whether PDF workflows should be OCR, native model upload, or RAG. | [LocalLLaMA: How do SOTA LLMs process PDFs?](https://www.reddit.com/r/LocalLLaMA/comments/1kn69mp/how_do_sota_llms_process_pdfs_native/) | ChunkFunk should help after ingestion by showing whether the indexed rows look usable. |
| 5 | A PDF RAG app answered general questions instead of staying grounded in uploaded content. | [LangChain: PDF RAG app gives general answers](https://www.reddit.com/r/LangChain/comments/1e635xo/pdf_rag_app_is_giving_answer_of_general_questions/) | Grounding failures often start with weak retrieval/citation hygiene; source locator checks matter. |
| 6 | Long-answer quality drops even after trying hybrid retrieval, and the builder suspects metadata/content strategy. | [LangChain: RAG performance and metadata](https://www.reddit.com/r/LangChain/comments/1hrrhgi/help_with_rag_performance_and_content_for_metadata/) | Metadata completeness/type checks are directly tied to answer quality debugging. |
| 7 | Citation handling is unclear in advanced retrievers such as RAPTOR. | [LangChain: citations or metadata in RAPTOR](https://www.reddit.com/r/LangChain/comments/1fqmi0z/how_to_get_citations_or_include_metadata_in_raptor/) | Report missing source/document/page locators as a trust issue, not just schema trivia. |
| 8 | "Latest order" style questions fail because vector retrieval does not naturally understand recency. | [LangChain: retrieve accurate data with RAG](https://www.reddit.com/r/LangChain/comments/1ib92lx/ideas_on_how_to_retrieve_accurate_data_with_rag/) | Timestamp coverage is a first-scan diagnostic; freshness cannot be debugged if most rows lack dates. |
| 9 | Per-user RAG/GraphRAG over Slack, GitHub, Notion, and incident data creates messy ingestion and context-management problems. | [LangChain: per-user RAG/GraphRAG](https://www.reddit.com/r/LangChain/comments/1k60nw3/how_do_you_build_peruser_raggraphrag/) | Multi-source data needs consistent source IDs, tenant/workspace metadata, and timestamps. |
| 10 | Agentic RAG fails on annual-report questions where traditional retrieval misses the right evidence. | [LangChain: improve agentic RAG accuracy](https://www.reddit.com/r/LangChain/comments/1jo1ymn/how_to_improve_the_accuracy_of_agentic_rag_system/) | Annual reports imply long, structured, citation-heavy documents; table/source health checks fit. |
| 11 | Financial-report RAG needs both tabular and textual data; extraction and chunking are hard. | [LangChain: better performance with RAG](https://www.reddit.com/r/LangChain/comments/1is53f2/how_to_achieve_better_performance_with_rag/) | Add a privacy-safe detector for table-like chunks and missing row/page metadata. |
| 12 | A PDF RAG app returns incorrect documents for a query even though data was parsed and stored. | [LangChain: PDF RAG app not returning correct documents](https://www.reddit.com/r/LangChain/comments/1ijs73e/my_pdf_rag_app_isnt_able_to_return_correct/) | Retrieval debugging needs visible database-level health before model tuning. |
| 13 | Graph/JSON data raises questions about how to parse records and metadata for RAG. | [LangChain: graph-json data for RAG](https://www.reddit.com/r/LangChain/comments/1itvd8u/how_can_i_parse_graphjson_data_for_a_rag_app/) | Structured data should not be treated exactly like prose; metadata consistency checks help. |
| 14 | Pgvector users are unsure how to create and manage vector indexes through LangChain. | [LangChain: manage vector indexes in PGVector](https://www.reddit.com/r/LangChain/comments/1i5kjqx/how_to_properly_create_and_manage_vector_indexes/) | Pgvector index health is a trust signal for Postgres-first ChunkFunk. |
| 15 | Enterprise RAG builders are unsure whether to inject metadata as keywords or use filters. | [LangChain: metadata and retriever](https://www.reddit.com/r/LangChain/comments/1i579vv/metadata_and_retriever/) | Metadata filter readiness is a core operator diagnostic. |
| 16 | Multimodal PDF RAG can retrieve irrelevant images for queries that do not need images. | [LangChain: retrieval of irrelevant images](https://www.reddit.com/r/LangChain/comments/1i08vjx/retrieval_of_irrelevant_images/) | ChunkFunk should not expand to multimodal yet, but source/type metadata consistency is relevant. |
| 17 | CSV/table rows merged into blobs make metadata filtering confusing. | [LangChain: filtering through metadata](https://www.reddit.com/r/LangChain/comments/1hhqhkj/filtering_through_metadata/) | Table-like content plus weak metadata is a predictable RAG rot pattern. |
| 18 | School/email RAG needs date fields so the assistant retrieves the latest data. | [LangChain: date fields for latest data](https://www.reddit.com/r/LangChain/comments/1h0ih0x/rag_how_to_ensure_a_date_fields_in_metadata_is/) | Add timestamp coverage checks even when a timestamp column exists but many rows are null. |
| 19 | Excel/PPT ingestion needs citations down to file, sheet, row/column, and slide. | [LangChain: Excel and PPT metadata for citations](https://www.reddit.com/r/LangChain/comments/1f7fh83/how_to_extract_textual_data_from_excel_and_ppts/) | Source locator checks should recognize row/page/slide-style citation metadata. |
| 20 | Game-rules RAG struggles with precise rule interactions and evaluation. | [LangChain: improve RAG results for game rules](https://www.reddit.com/r/LangChain/comments/1h7r7eb/how_to_improve_rag_results_for_searching_a_set_of/) | Precision domains need traceability and chunk boundaries; do not over-focus on generic scores. |
| 21 | RAG builders report constant challenges evaluating whether outputs are reliable. | [LangChain: AI evaluation and output quality](https://www.reddit.com/r/LangChain/comments/1fpvwt0/a_community_for_ai_evaluation_and_output_quality/) | ChunkFunk should stay database-level now, but reports need clear next actions for eval setup. |
| 22 | PDF RAG can fail badly on tabular data. | [LangChain: handle tables in PDF](https://www.reddit.com/r/LangChain/comments/1ibck7z/how_do_i_handle_tables_in_my_pdf/) | Table-like chunk diagnostics are high-confidence. |
| 23 | A builder gets an apparently valid Chroma database with no usable rows. | [LangChain: ChromaDB always returns empty](https://www.reddit.com/r/LangChain/comments/1k7fv2j/chromadb_always_returns_empty/) | Empty-ingestion checks are already valuable; keep fixture coverage. |
| 24 | Builders are unsure whether vanilla text embeddings work for JSON/tabular data. | [LangChain: RAG for JSON/tabular data](https://www.reddit.com/r/LangChain/comments/1jtr7g8/how_to_build_a_rag_for_jsontabular_data/) | Structured-data readiness is a real first-run concern. |
| 25 | Data overlaps across documents make it hard to pick the right document for a question. | [LangChain: RAG over different kinds of data](https://www.reddit.com/r/LangChain/comments/1k8mpn4/rag_over_different_kind_of_data_pdf_chunks_vector/) | Duplicate/near-duplicate and source locator checks help explain ambiguous retrieval. |
| 26 | Dense books produce failed RAG questions; the builder does not know what to fix. | [LangChain: RAG failed questions on philosophy book](https://www.reddit.com/r/LangChain/comments/1jhfzej/llm_with_rag_failed_questions_on_philosophy_book/) | The report should give specific database-level suspects instead of vague "improve RAG" advice. |
| 27 | Complex PDFs with multi-column tables, images, and bullets make image/table chunking hard. | [LangChain: image chunking in PDF RAG](https://www.reddit.com/r/LangChain/comments/1hl94lj/best_way_for_image_chunking_in_ragbased_pdf/) | Do not build image support yet; do flag table-like chunks and missing locators. |
| 28 | PDF parsers can miss text around tables in financial reports. | [LangChain: top performing PDF parser](https://www.reddit.com/r/LangChain/comments/1i76ad2/what_are_some_of_the_top_performing_pdf_parser/) | ChunkFunk cannot inspect source PDFs, but can warn when indexed chunks look table-heavy without row/page metadata. |
| 29 | Multimodal PDF RAG works for text/images but math/table answers remain hard. | [LangChain: enhance PDF RAG mathematical capabilities](https://www.reddit.com/r/LangChain/comments/1i5ofd6/how_do_i_enhance_my_pdf_rag_apps_mathematical/) | Structured chunks need special caution in the report. |
| 30 | GraphRAG over PDFs with tables gets stuck during knowledge-graph construction. | [LangChain: Graph RAG for PDFs with table](https://www.reddit.com/r/LangChain/comments/1hx4ibr/graph_rag_for_pdfs_with_table/) | GraphRAG-specific features are out of scope, but the table/document structure pain is real. |
| 31 | Pgvector upsert/indexing can fail during document ingestion. | [LangChain: cannot upsert documents using PGVector](https://www.reddit.com/r/LangChain/comments/1j8w67r/cry_for_help_cannot_upsert_documents_using/) | Null embeddings, empty tables, and table counts should be obvious in the first scan. |
| 32 | Pgvector sits between database and vector-search communities, causing recurring confusion. | [LangChain: pgvector myths](https://www.reddit.com/r/LangChain/comments/1fttx7s/debunking_myths_about_pgvector/) | Postgres-native explanations should be plain and operational, not library-specific. |
| 33 | RAG search results can feel random because embedding behavior is hard to reason about. | [LocalLLaMA: improve RAG search results](https://www.reddit.com/r/LocalLLaMA/comments/1k0yna0/how_to_improve_rag_search_results_tips_and_tricks/) | Keep explaining issues as database symptoms operators can verify. |
| 34 | A policy/HR bot adds context beyond the documents and does not stay limited to source material. | [LocalLLaMA: HR bot adding context](https://www.reddit.com/r/LocalLLaMA/comments/1igihdm/deepseekr1_hr_bot_turning_policy_responses/) | Source traceability and risky/chunky data checks support grounded debugging. |
| 35 | Conversational RAG often retrieves with the wrong rewritten/latest user message. | [LocalLLaMA: rephrase message for retrieval accuracy](https://www.reddit.com/r/LocalLLaMA/comments/1ifpylh/whenhow_should_you_rephrase_the_last_user_message/) | Query rewriting is out of scope, but the report should be clear that it diagnoses stored data, not retriever prompts. |
| 36 | Long context still hallucinates over many PDFs, so operators need better evidence grounding. | [LocalLLaMA: long context hallucinations](https://www.reddit.com/r/LocalLLaMA/comments/1jt4m0y/how_accurately_it_answers_if_we_utilize_even_50/) | ChunkFunk should stay focused on the indexed evidence layer. |

## Weak Or Indirect Signals

These support market interest but are less directly actionable for a read-only
Postgres CLI.

| Signal | Source | Why weaker |
|---|---|---|
| Builders want managed document RAG instead of assembling the pipeline. | [r/RAG: managed document RAG](https://www.reddit.com/r/Rag/comments/1kilomy/searching_for_fully_managed_document_rag/) | Points to setup pain, but ChunkFunk is not a hosted ingestion platform. |
| Product builders compare RAG tools partly on source references. | [r/RAG: ChatDOC vs AnythingLLM](https://www.reddit.com/r/Rag/comments/1kqalbc/chatdoc_vs_anythingllm_my_thoughts_after_testing/) | Useful positioning, but not database-specific enough for a detector. |
| LLM-based chunking can be slow, expensive, and hit output limits. | [r/RAG: better chunking method](https://www.reddit.com/r/Rag/comments/1km8cqw/llm_better_chunking_method/) | Confirms chunking pain, but implementation belongs in ingestion tools. |
| Local/private RAG builders avoid closed vendors for sensitive PDFs. | [LocalLLaMA: PDF extraction is all you need?](https://www.reddit.com/r/LocalLLaMA/comments/1j0zvwj/retrieval_augmented_generation_pdf_extraction_is/) | Supports privacy positioning more than a new detector. |

## Opportunity Ranking

Scoring uses a 1-5 scale: frequency, urgency, read-only detectability, privacy
risk, effort, trust value, first-scan usefulness, and share potential.

| Opportunity | Frequency | Urgency | Detectable read-only | Privacy risk | Effort | Trust value | First scan | Share potential | Decision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Table-like / structured chunk health | 5 | 4 | 4 | 3 | 2 | 5 | 5 | 4 | Build next. |
| Timestamp coverage when freshness is partially mapped | 4 | 5 | 5 | 1 | 2 | 5 | 5 | 3 | Build next. |
| Citation locator coverage for page/sheet/row/slide metadata | 5 | 5 | 4 | 2 | 2 | 5 | 5 | 4 | Improve next. |
| Null embedding / missing-row diagnostics beyond empty tables | 4 | 4 | 5 | 1 | 2 | 4 | 5 | 3 | Keep in batch if fixture effort stays small. |
| Query-rewrite or retriever-prompt diagnosis | 3 | 4 | 1 | 3 | 5 | 2 | 1 | 2 | Do not build now; out of database scope. |
| Multimodal image retrieval checks | 2 | 3 | 1 | 4 | 5 | 2 | 1 | 3 | Log later; out of current Postgres text wedge. |
| Non-Postgres adapters | 3 | 3 | 2 | 3 | 5 | 3 | 2 | 3 | Defer until live users demand it. |

## Product Decision For Next Batch

Build a focused "structured RAG rot" batch:

- Detect table-like chunks without printing table content.
- Warn when many structured/table-like chunks lack row/page/sheet/slide/source
  locator metadata.
- Warn when an `updatedAt` mapping exists but a significant share of rows have
  no timestamp, because freshness and "latest data" questions cannot be trusted.
- Add fixtures, tests, packaged smoke coverage, and README/report wording.

Do not build query rewriting, GraphRAG-specific checks, image retrieval checks,
or embedding-model benchmarking in this batch. They are real pains, but they are
not reliably detectable from a read-only Postgres scan.

## Follow-up Batch: Explicit Inventory Drift

Issue [#20](https://github.com/victorioussol/chunkfunk-cli/issues/20) adds a
separate evidence stream from public LangChain/langchain-postgres reports where
upstream ingestion can silently truncate, skip, or overwrite rows. ChunkFunk
should not guess the expected corpus size, but it can safely compare explicit
operator-provided minimums in `chunkfunk.yaml` with observed chunk/document
counts.

Build only the opt-in version:

- If `inventory.minChunks` is configured, compare it with observed chunk rows.
- If `inventory.minDocuments` is configured and a document id is mapped, compare
  it with observed distinct document ids.
- If document ids are not mapped, report that document inventory cannot be
  verified instead of guessing.
- Do not print source names, document names, row values, or connection strings.
