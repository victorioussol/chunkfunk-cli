# Reddit RAG Operator Pain Research — 2026-07-09

Direct Reddit access was blocked from this network, so this pass used the public
PullPush Reddit archive for discovery and links back to the original Reddit
threads. Treat this as directional product evidence, not a formal survey.

## Repeated Pain Signals

| Signal | Reddit evidence | ChunkFunk implication |
|---|---|---|
| Chunking is hard to tune and feels like guesswork. | [`RAG embeddings survey - What are your chunking / embedding settings?`](https://www.reddit.com/r/LocalLLaMA/comments/1kp558b/rag_embeddings_survey_what_are_your_chunking/) describes chunking and embedding settings as hard to settle; [`RAG chunking improvement idea`](https://www.reddit.com/r/LocalLLaMA/comments/1kcib2y/rag_chunking_improvement_idea/) focuses on chunk-size tradeoffs and boundary misses. | Report chunk-size distribution problems, especially very large chunks that can bury relevant passages. |
| Operators need accuracy with citations over large document sets. | [`What's the Best Current Setup for Multi Document (10k+) Retrieval-Augmented Generation (RAG)? Need Accuracy and Citations`](https://www.reddit.com/r/LocalLLaMA/comments/1ieiv7c/whats_the_best_current_setup_for_multi_document/) asks for accurate retrieval with citations over 10k+ documents. [`An Enterprise-level Retrieval-Augmented Generation System`](https://www.reddit.com/r/LangChain/comments/1keyh3i/an_enterpriselevel_retrievalaugmented_generation/) emphasizes page-level references. | Detect when chunks lack source URL, file path, or document id fields needed for citation traceability. |
| Beginners and builders hit empty or failed vector DB ingestion. | [`Any good and easy tutorial on how to build a RAG?`](https://www.reddit.com/r/LangChain/comments/1k6p59i/any_good_and_easy_tutorial_on_how_to_build_a_rag/) describes getting as far as creating a Chroma vector database but seeing an empty database. | An empty mapped table should produce a critical, understandable report instead of looking clean. |
| Metadata and filters are confusing but important. | [`Metadata and Retriever`](https://www.reddit.com/r/LangChain/comments/1i579vv/metadata_and_retriever/) asks how people use metadata and filtering in enterprise RAG. [`Help with Rag Performance and Content for Metadata`](https://www.reddit.com/r/LangChain/comments/1hrrhgi/help_with_rag_performance_and_content_for_metadata/) connects metadata strategy with poor answer quality. | Continue investing in metadata completeness, consistency, and filter-type checks. |
| Embedding/vector-index choices are a common source of uncertainty. | [`Best embedding model for RAG`](https://www.reddit.com/r/LangChain/comments/1kj270v/best_embedding_model_for_rag/) asks whether embeddings, vector DB choice, or model choice is driving poor accuracy. [`How to Properly Create and Manage Vector Indexes in LangChain Postgres PGVector?`](https://www.reddit.com/r/LangChain/comments/1i5kjqx/how_to_properly_create_and_manage_vector_indexes/) asks about PGVector index management. | Keep pgvector index health checks in the CLI, but do not expand into benchmarking embedding models yet. |

## Product Decision

Build the checks ChunkFunk can prove read-only from an existing Postgres RAG DB:

- empty mapped table / failed ingestion
- very large chunk distribution
- missing source/citation locator coverage
- metadata completeness and type consistency
- pgvector index health

Do not build non-Postgres adapters, embedding-model benchmarking, or LLM-based
risky-content classification yet. Those need more live-user evidence and would
weaken the current launch wedge.
