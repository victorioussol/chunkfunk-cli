# TelemetryV1 Schema

ChunkFunk telemetry is off by default. If you opt in, the CLI sends one anonymous payload after a scan. Run `chunkfunk --show-telemetry` to print the exact bytes before anything is sent.

No document text, chunk text, connection string, token, table sample, or source URL is allowed in this payload.

```ts
type TelemetryV1 = {
  fingerprintHash: string; // sha256 hex of the detected schema fingerprint
  frameworkGuess:
    | "langchain"
    | "llamaindex"
    | "vecs"
    | "generic"
    | "custom"
    | "unknown";
  embeddingDims: number | null;
  totals: {
    documents: number;
    chunks: number;
  };
  findingCounts: {
    byType: Partial<Record<
      | "stale_source"
      | "stale_document"
      | "exact_duplicate"
      | "near_duplicate"
      | "thin_chunk"
      | "risky_chunk"
      | "embedding_mixed_dims"
      | "embedding_null"
      | "architecture"
      | "test_regression",
      number
    >>;
  };
  healthScore: number; // 0..100
  mappingShape:
    | { id: "langchain-pgvector" }
    | { id: "llamaindex-pgvector" }
    | { id: "supabase-vecs" }
    | { id: "supabase-docs-tutorial" }
    | { id: "generic-single-table" }
    | {
        id: "manual";
        columns: [
          { role: "content"; name: TelemetryIdentifier | null },
          { role: "embedding"; name: TelemetryIdentifier | null },
          { role: "metadata"; name: TelemetryIdentifier | null },
          { role: "documentId"; name: TelemetryIdentifier | null },
          { role: "sourceUrl"; name: TelemetryIdentifier | null },
          { role: "updatedAt"; name: TelemetryIdentifier | null }
        ];
      };
  cliVersion: string;
  os: string; // example: "darwin/arm64"
};

type TelemetryIdentifier =
  | "content"
  | "text"
  | "document"
  | "body"
  | "embedding"
  | "vector"
  | "metadata"
  | "meta"
  | "cmetadata"
  | "metadata_"
  | "id"
  | "node_id"
  | "source"
  | "url"
  | "updated_at"
  | "created_at"
  | `sha256:${string}`;
```

Manual column names are only sent when they are common generic names from the allowlist above. Other column names are replaced with `sha256:<hex>`, so the server can learn repeated shapes without seeing private names.
