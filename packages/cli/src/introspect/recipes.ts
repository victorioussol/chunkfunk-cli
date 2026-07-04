import type { MappingV1 } from "@chunkfunk/core";
import type { CandidateTable } from "../db/reader";

export interface RecipeMatch {
  recipeId: string;
  frameworkGuess: string;
  mapping: MappingV1;
  embeddingColumn: string;
}

function hasColumns(table: CandidateTable, names: string[]): boolean {
  const present = new Set(table.columns.map((c) => c.name));
  return names.every((n) => present.has(n));
}

/**
 * Structural recipes tried in order, first match wins (§4.3). These are the
 * four named auto-detect recipes; `generic-single-table` (which needs row
 * sampling) and the interactive fallback are handled by the orchestrator.
 */
export function matchNamedRecipe(tables: CandidateTable[]): RecipeMatch | null {
  // 1. langchain-pgvector
  const langchain = tables.find(
    (t) =>
      t.name === "langchain_pg_embedding" &&
      hasColumns(t, ["document", "embedding", "cmetadata", "collection_id"]),
  );
  if (langchain) {
    const collection = tables.find((t) => t.name === "langchain_pg_collection")
      ?? { qualified: `${langchain.schema}.langchain_pg_collection` };
    return {
      recipeId: "langchain-pgvector",
      frameworkGuess: "langchain",
      embeddingColumn: "embedding",
      mapping: {
        version: 1,
        dialect: "pgvector",
        table: langchain.qualified,
        columns: {
          content: "document",
          embedding: "embedding",
          metadata: "cmetadata",
          documentId: null,
          sourceUrl: "meta:cmetadata.source",
          updatedAt: null,
        },
        joins: {
          collectionTable: collection.qualified,
          collectionFk: "collection_id",
          collectionNameColumn: "name",
        },
      },
    };
  }

  // 2. llamaindex-pgvector
  const llamaindex = tables.find(
    (t) =>
      t.name.startsWith("data_") &&
      hasColumns(t, ["text", "embedding", "metadata_", "node_id"]),
  );
  if (llamaindex) {
    return {
      recipeId: "llamaindex-pgvector",
      frameworkGuess: "llamaindex",
      embeddingColumn: "embedding",
      mapping: {
        version: 1,
        dialect: "pgvector",
        table: llamaindex.qualified,
        columns: {
          content: "text",
          embedding: "embedding",
          metadata: "metadata_",
          documentId: "meta:metadata_.doc_id",
          sourceUrl: null,
          updatedAt: null,
        },
      },
    };
  }

  // 3. supabase-vecs
  const vecs = tables.find(
    (t) => t.schema === "vecs" && hasColumns(t, ["id", "vec", "metadata"]),
  );
  if (vecs) {
    return {
      recipeId: "supabase-vecs",
      frameworkGuess: "vecs",
      embeddingColumn: "vec",
      mapping: {
        version: 1,
        dialect: "pgvector",
        table: vecs.qualified,
        columns: {
          content: "meta:metadata.text",
          embedding: "vec",
          metadata: "metadata",
          documentId: null,
          sourceUrl: null,
          updatedAt: null,
        },
      },
    };
  }

  // 4. supabase-docs-tutorial
  const docs = tables.find(
    (t) => t.name === "documents" && hasColumns(t, ["content", "embedding", "metadata"]),
  );
  if (docs) {
    return {
      recipeId: "supabase-docs-tutorial",
      frameworkGuess: "generic",
      embeddingColumn: "embedding",
      mapping: {
        version: 1,
        dialect: "pgvector",
        table: docs.qualified,
        columns: {
          content: "content",
          embedding: "embedding",
          metadata: "metadata",
          documentId: null,
          sourceUrl: null,
          updatedAt: null,
        },
      },
    };
  }

  return null;
}

/** §4.3.6 — infer an embedding model from dimensionality; always labeled "(guess)". */
export function guessEmbeddingModel(dims: number | null): string | null {
  switch (dims) {
    case 1536:
      return "openai text-embedding-3-small or ada-002 (guess)";
    case 3072:
      return "openai text-embedding-3-large (guess)";
    case 1024:
      return "Cohere/BGE-class (guess)";
    case 768:
      return "sentence-transformers-class (guess)";
    default:
      return dims === null ? null : "unknown model (guess)";
  }
}
