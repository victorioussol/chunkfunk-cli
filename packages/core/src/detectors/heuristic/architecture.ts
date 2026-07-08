import { createHash } from "node:crypto";
import type { JsonValue } from "../../schemas/json";
import type { FindingV1 } from "../../schemas/report";
import type { ArchitectureSignal, DetectorContext } from "./types";

const COMMON_METADATA_KEYS = new Set([
  "id",
  "source",
  "url",
  "path",
  "file",
  "file_path",
  "title",
  "topic",
  "category",
  "doc_id",
  "document_id",
  "source_id",
  "source_url",
  "tenant_id",
  "workspace_id",
  "org_id",
  "user_id",
  "created_at",
  "updated_at",
  "last_modified",
  "lastmod",
  "language",
  "lang",
]);

const SPARSE_METADATA_WARNING_PCT = 20;
const INCONSISTENT_KEY_MIN_ROWS = 10;
const MIXED_TYPE_MIN_ROWS = 5;

export interface ArchitectureResult {
  findings: FindingV1[];
  coverageScore: number | null;
}

function safeKey(key: string): string {
  if (COMMON_METADATA_KEYS.has(key)) return key;
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

function valueType(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function signalToFinding(signal: ArchitectureSignal): FindingV1 {
  return {
    type: "architecture",
    severity: signal.severity,
    title: signal.title,
    evidence: signal.evidence,
    suggestedRepair: signal.suggestedRepair ?? null,
    affectedCount: signal.affectedCount ?? 1,
  };
}

function metadataCoverageScore(missingPct: number, mixedTypeFieldCount: number): number {
  return Math.max(0, Math.round(100 - missingPct - mixedTypeFieldCount * 25));
}

async function runMetadataArchitecture(ctx: DetectorContext): Promise<{
  findings: FindingV1[];
  coverageScore: number | null;
}> {
  const findings: FindingV1[] = [];

  if (ctx.mapping.columns.metadata === null) {
    findings.push({
      type: "architecture",
      severity: "info",
      title: "No metadata column is mapped",
      evidence: {
        table: ctx.mapping.table,
        impact: "ChunkFunk cannot assess metadata completeness or filter readiness.",
      },
      suggestedRepair: {
        kind: "map_metadata",
        description: "Map a json/jsonb metadata column if this RAG table has one.",
      },
      affectedCount: 1,
    });
    return { findings, coverageScore: null };
  }

  let scanned = 0;
  let missing = 0;
  const keyCounts = new Map<string, number>();
  const typeCountsByKey = new Map<string, Map<string, number>>();

  for await (const chunk of ctx.reader.streamChunks({ maxChunks: ctx.limits.maxChunks })) {
    scanned += 1;
    const metadata = chunk.metadata;
    const keys = metadata ? Object.keys(metadata) : [];
    if (keys.length === 0) {
      missing += 1;
      continue;
    }

    for (const key of keys) {
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
      const type = valueType(metadata?.[key]);
      let typeCounts = typeCountsByKey.get(key);
      if (!typeCounts) {
        typeCounts = new Map();
        typeCountsByKey.set(key, typeCounts);
      }
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }
  }

  if (scanned === 0) return { findings, coverageScore: null };

  const missingPct = (missing / scanned) * 100;
  if (missingPct >= SPARSE_METADATA_WARNING_PCT) {
    findings.push({
      type: "architecture",
      severity: "warning",
      title: "Metadata is missing on many chunks",
      evidence: {
        scannedChunks: scanned,
        missingMetadataChunks: missing,
        missingPct: Number(missingPct.toFixed(1)),
        sampled: Boolean(ctx.sampled),
      },
      suggestedRepair: {
        kind: "backfill_metadata",
        description: "Backfill source/document metadata so retrieval filters and audits can work reliably.",
      },
      affectedCount: missing,
    });
  }

  const inconsistentKeys = [...keyCounts.entries()]
    .map(([key, count]) => ({
      key: safeKey(key),
      presentPct: Number(((count / scanned) * 100).toFixed(1)),
      missingPct: Number((((scanned - count) / scanned) * 100).toFixed(1)),
      presentRows: count,
    }))
    .filter((key) => key.presentRows >= INCONSISTENT_KEY_MIN_ROWS && key.presentPct < 80 && key.missingPct >= 20)
    .sort((a, b) => b.presentRows - a.presentRows || a.key.localeCompare(b.key))
    .slice(0, 8);

  if (inconsistentKeys.length > 0) {
    findings.push({
      type: "architecture",
      severity: "info",
      title: "Metadata keys are inconsistent across chunks",
      evidence: {
        scannedChunks: scanned,
        keys: inconsistentKeys,
        sampled: Boolean(ctx.sampled),
      },
      suggestedRepair: {
        kind: "standardize_metadata",
        description: "Standardize top-level metadata keys during ingestion so filters behave predictably.",
      },
      affectedCount: inconsistentKeys.length,
    });
  }

  const mixedTypeKeys = [...typeCountsByKey.entries()]
    .map(([key, counts]) => {
      const nonNull = [...counts.entries()].filter(([type]) => type !== "null");
      const rows = nonNull.reduce((sum, [, count]) => sum + count, 0);
      return {
        key: safeKey(key),
        rows,
        types: Object.fromEntries(nonNull.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
      };
    })
    .filter((key) => key.rows >= MIXED_TYPE_MIN_ROWS && Object.keys(key.types).length > 1)
    .sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key))
    .slice(0, 8);

  if (mixedTypeKeys.length > 0) {
    findings.push({
      type: "architecture",
      severity: "warning",
      title: "Metadata filter fields use mixed value types",
      evidence: {
        scannedChunks: scanned,
        keys: mixedTypeKeys,
        sampled: Boolean(ctx.sampled),
      },
      suggestedRepair: {
        kind: "normalize_metadata_types",
        description: "Normalize metadata value types before indexing so equality/range filters do not silently miss rows.",
      },
      affectedCount: mixedTypeKeys.length,
    });
  }

  return {
    findings,
    coverageScore: metadataCoverageScore(missingPct, mixedTypeKeys.length),
  };
}

export async function runArchitecture(ctx: DetectorContext): Promise<ArchitectureResult> {
  const metadata = await runMetadataArchitecture(ctx);
  const findings = [...metadata.findings];
  const catalogSignals = ctx.reader.inspectArchitecture ? await ctx.reader.inspectArchitecture() : [];
  findings.push(...catalogSignals.map(signalToFinding));
  return { findings, coverageScore: metadata.coverageScore };
}
