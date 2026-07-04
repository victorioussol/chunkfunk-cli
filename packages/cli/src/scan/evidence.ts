// The evidence cap now lives in @chunkfunk/core so the CLI (emit-time cap, §10.4)
// and the sync API (server-side truncation on ingest, §6) share one
// implementation.
export {
  capFindingEvidence,
  MAX_EVIDENCE_CHARS as MAX_EXCERPT_CHARS,
} from "@chunkfunk/core";
