/**
 * The exact planted-problem counts for each fixture. These are the CONTRACT that
 * PR-03's detector tests assert against — keep them in sync with README.md.
 */

export const PLANTED = {
  langchain: {
    /** Healthy, non-flagged chunks. */
    healthy: 200,
    /** Exact-duplicate groups; each group has `exactDuplicateCopies` identical members. */
    exactDuplicateGroups: 10,
    exactDuplicateCopies: 3,
    /**
     * Of the 10 groups, this many are duplicates ONLY after normalization
     * (they differ by letter case and whitespace in the raw text).
     */
    exactDuplicateNormalizationOnlyGroups: 3,
    /** Near-duplicate pairs (distinct text, embeddings cosine ≥ 0.97). */
    nearDuplicatePairs: 20,
    /** Thin chunks (all < 120 normalized chars). */
    thinChunks: 25,
    /** Risky chunks, one planted secret each (openai key, aws key, private key). */
    secretChunks: 3,
  },
  llamaindex: {
    healthy: 45,
    /** Rows whose embedding dimension differs from the majority (→ mixed dims, critical). */
    mixedDimRows: 5,
    /** Rows with a NULL embedding (→ embedding_null, warning). */
    nullEmbeddingRows: 3,
  },
  /** Fixture C is intentionally clean — verifies zero false positives (PR-03). */
  custom: {
    healthy: 100,
  },
  /** Fixture D is a healthy corpus, second auto-detect target (PR-04). */
  supabaseDocs: {
    healthy: 60,
  },
  /** Fixture E proves metadata architecture findings against real Postgres rows. */
  metadataHealth: {
    total: 40,
    missingMetadataRows: 12,
    largeChunkRows: 10,
  },
  /** Fixture F proves failed ingestion can still produce a useful report. */
  emptyDocs: {
    total: 0,
  },
  /** Fixture G mirrors a production-like DB with multiple vector-bearing tables. */
  guiriLike: {
    documentChunks: 150,
    internalChunks: 8,
    cacheRows: 20,
  },
  /** Fixture H proves table-like chunk and partial-timestamp diagnostics. */
  structuredHealth: {
    tableLikeWithoutLocators: 20,
    tableLikeWithLocators: 10,
    proseRows: 18,
    missingTimestampRows: 20,
  },
} as const;

export const DIMS = {
  langchain: 1536,
  llamaindexMajority: 768,
  llamaindexOffDim: 1536,
  custom: 1024,
  supabaseDocs: 1536,
  metadataHealth: 1536,
  emptyDocs: 1536,
  guiriLikeCurrent: 1536,
  guiriLikeNext: 3072,
  structuredHealth: 1536,
} as const;

/** Derived totals, exported for README cross-checking and the seed self-check. */
export const DERIVED = {
  langchainExactDuplicateRows:
    PLANTED.langchain.exactDuplicateGroups * PLANTED.langchain.exactDuplicateCopies, // 30
  langchainNearDuplicateRows: PLANTED.langchain.nearDuplicatePairs * 2, // 40
  langchainTotal:
    PLANTED.langchain.healthy +
    PLANTED.langchain.exactDuplicateGroups * PLANTED.langchain.exactDuplicateCopies +
    PLANTED.langchain.nearDuplicatePairs * 2 +
    PLANTED.langchain.thinChunks +
    PLANTED.langchain.secretChunks, // 298
  llamaindexTotal:
    PLANTED.llamaindex.healthy +
    PLANTED.llamaindex.mixedDimRows +
    PLANTED.llamaindex.nullEmbeddingRows, // 53
  structuredHealthTotal:
    PLANTED.structuredHealth.tableLikeWithoutLocators +
    PLANTED.structuredHealth.tableLikeWithLocators +
    PLANTED.structuredHealth.proseRows, // 48
} as const;

/** Fake, non-functional secrets planted in fixture A. NEVER real credentials. */
export const FAKE_SECRETS = [
  "sk-FAKE0abcdefghijklmnopqrstuvwxyz0123456789ABCD",
  "AKIAFAKE0EXAMPLE1234",
  "-----BEGIN PRIVATE KEY-----\nMIIFAKEexamplekeymaterialnotrealdonotuse==\n-----END PRIVATE KEY-----",
] as const;
