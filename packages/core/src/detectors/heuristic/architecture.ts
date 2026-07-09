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

const SOURCE_LOCATOR_KEYS = new Set([
  "source",
  "source_url",
  "url",
  "path",
  "file",
  "file_path",
  "page_url",
  "doc_id",
  "document_id",
  "source_id",
]);

const STRUCTURED_LOCATOR_KEYS = new Set([
  ...SOURCE_LOCATOR_KEYS,
  "page",
  "page_number",
  "page_label",
  "sheet",
  "sheet_name",
  "row",
  "row_id",
  "row_number",
  "column",
  "column_id",
  "column_name",
  "slide",
  "slide_number",
  "cell",
  "range",
  "section",
]);

const SPARSE_METADATA_WARNING_PCT = 20;
const INCONSISTENT_KEY_MIN_ROWS = 10;
const MIXED_TYPE_MIN_ROWS = 5;
const LARGE_CHUNK_CHARS = 4_000;
const LARGE_CHUNK_WARNING_PCT = 20;
const TABLE_LIKE_WARNING_MIN_CHUNKS = 5;
const TABLE_LIKE_WARNING_PCT = 10;
const TABLE_LIKE_MISSING_LOCATOR_WARNING_PCT = 50;

export interface ArchitectureResult {
  findings: FindingV1[];
  coverageScore: number | null;
  largeChunkPct: number;
  emptyTable: boolean;
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

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

function delimiterColumns(line: string, delimiter: string): number {
  return line
    .split(delimiter)
    .map((cell) => cell.trim())
    .filter(Boolean).length;
}

function repeatedDelimitedRows(lines: string[], delimiter: string): boolean {
  const rows = lines
    .filter((line) => line.length <= 220)
    .map((line) => delimiterColumns(line, delimiter))
    .filter((columns) => columns >= 3);
  return rows.length >= 3 && new Set(rows).size <= 2;
}

function isMarkdownTable(lines: string[]): boolean {
  const pipeRows = lines
    .map((line) => delimiterColumns(line, "|"))
    .filter((columns) => columns >= 3);
  return pipeRows.length >= 3 || (
    pipeRows.length >= 2 &&
    lines.some((line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
  );
}

function looksTableLike(sample: string): boolean {
  const lines = sample
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 24);

  if (lines.length < 3) return false;
  return (
    isMarkdownTable(lines) ||
    repeatedDelimitedRows(lines, "\t") ||
    repeatedDelimitedRows(lines, ",")
  );
}

async function runCorpusArchitecture(ctx: DetectorContext): Promise<{
  findings: FindingV1[];
  coverageScore: number | null;
  largeChunkPct: number;
  emptyTable: boolean;
}> {
  const findings: FindingV1[] = [];
  const hasMappedMetadata = ctx.mapping.columns.metadata !== null;
  const hasMappedSourceLocator = ctx.mapping.columns.sourceUrl !== null || ctx.mapping.columns.documentId !== null;

  if (!hasMappedMetadata) {
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
  }

  let scanned = 0;
  let missing = 0;
  let sourceLocatorRows = 0;
  let largeChunks = 0;
  let tableLikeChunks = 0;
  let tableLikeWithoutLocator = 0;
  const lengths: number[] = [];
  const keyCounts = new Map<string, number>();
  const typeCountsByKey = new Map<string, Map<string, number>>();

  for await (const chunk of ctx.reader.streamChunks({ maxChunks: ctx.limits.maxChunks })) {
    scanned += 1;
    lengths.push(chunk.length);
    if (chunk.length >= LARGE_CHUNK_CHARS) largeChunks += 1;
    const metadata = chunk.metadata;
    const keys = metadata ? Object.keys(metadata) : [];
    const hasSourceLocator = hasMappedSourceLocator || keys.some((key) => SOURCE_LOCATOR_KEYS.has(key));
    if (hasSourceLocator) {
      sourceLocatorRows += 1;
    }
    if (looksTableLike(chunk.contentSample)) {
      tableLikeChunks += 1;
      const hasStructuredLocator = hasMappedSourceLocator ||
        keys.some((key) => STRUCTURED_LOCATOR_KEYS.has(key));
      if (!hasStructuredLocator) tableLikeWithoutLocator += 1;
    }
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

  if (scanned === 0) {
    findings.push({
      type: "architecture",
      severity: "critical",
      title: "Mapped chunk table is empty",
      evidence: {
        table: ctx.mapping.table,
        scannedChunks: 0,
        totalChunks: ctx.totalChunks,
      },
      suggestedRepair: {
        kind: "verify_ingestion",
        description: "Verify the ingestion job inserted chunks into this table before testing retrieval quality.",
      },
      affectedCount: 1,
    });
    return { findings, coverageScore: 0, largeChunkPct: 0, emptyTable: true };
  }

  lengths.sort((a, b) => a - b);
  const largeChunkPct = (largeChunks / scanned) * 100;
  if (largeChunkPct >= LARGE_CHUNK_WARNING_PCT) {
    findings.push({
      type: "architecture",
      severity: "warning",
      title: "Many chunks are very large",
      evidence: {
        scannedChunks: scanned,
        largeChunks,
        largePct: Number(largeChunkPct.toFixed(1)),
        thresholdChars: LARGE_CHUNK_CHARS,
        p50Chars: percentile(lengths, 50),
        p95Chars: percentile(lengths, 95),
        maxChars: lengths.at(-1) ?? 0,
        sampled: Boolean(ctx.sampled),
      },
      suggestedRepair: {
        kind: "review_chunking",
        description: "Review the chunking strategy; very large chunks can bury the relevant passage and waste context window budget.",
      },
      affectedCount: largeChunks,
    });
  }

  const missingPct = (missing / scanned) * 100;
  if (hasMappedMetadata && missingPct >= SPARSE_METADATA_WARNING_PCT) {
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

  if (hasMappedMetadata && inconsistentKeys.length > 0) {
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

  if (hasMappedMetadata && mixedTypeKeys.length > 0) {
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

  const sourceLocatorPct = (sourceLocatorRows / scanned) * 100;
  if (!hasMappedSourceLocator && sourceLocatorPct < 80) {
    findings.push({
      type: "architecture",
      severity: sourceLocatorRows === 0 ? "warning" : "info",
      title: sourceLocatorRows === 0
        ? "No source or citation locator was found"
        : "Source/citation metadata is missing on many chunks",
      evidence: {
        scannedChunks: scanned,
        sourceLocatorRows,
        sourceLocatorPct: Number(sourceLocatorPct.toFixed(1)),
        checkedMetadataKeys: [...SOURCE_LOCATOR_KEYS].sort(),
        sampled: Boolean(ctx.sampled),
      },
      suggestedRepair: {
        kind: "add_source_locator",
        description: "Store a source URL, file path, or document id with each chunk so answers can show citations and operators can trace bad retrievals.",
      },
      affectedCount: scanned - sourceLocatorRows,
    });
  }

  const tableLikePct = (tableLikeChunks / scanned) * 100;
  const tableLikeMissingLocatorPct = tableLikeChunks > 0
    ? (tableLikeWithoutLocator / tableLikeChunks) * 100
    : 0;
  if (
    tableLikeChunks >= TABLE_LIKE_WARNING_MIN_CHUNKS &&
    tableLikePct >= TABLE_LIKE_WARNING_PCT &&
    tableLikeMissingLocatorPct >= TABLE_LIKE_MISSING_LOCATOR_WARNING_PCT
  ) {
    findings.push({
      type: "architecture",
      severity: "warning",
      title: "Table-like chunks are missing source/citation locators",
      evidence: {
        scannedChunks: scanned,
        tableLikeChunks,
        tableLikePct: Number(tableLikePct.toFixed(1)),
        tableLikeWithoutLocator,
        tableLikeWithoutLocatorPct: Number(tableLikeMissingLocatorPct.toFixed(1)),
        checkedMetadataKeys: [...STRUCTURED_LOCATOR_KEYS].sort(),
        sampled: Boolean(ctx.sampled),
      },
      suggestedRepair: {
        kind: "add_structured_locators",
        description: "Store source, page, sheet, row, or slide locators with table-like chunks so bad answers can be traced back to the exact structured record.",
      },
      affectedCount: tableLikeWithoutLocator,
    });
  }

  const tableLikeCoverageScore = tableLikeChunks > 0 && tableLikeMissingLocatorPct >= TABLE_LIKE_MISSING_LOCATOR_WARNING_PCT
    ? Math.round(100 - tableLikeMissingLocatorPct)
    : 100;

  return {
    findings,
    coverageScore: hasMappedMetadata
      ? Math.min(
          metadataCoverageScore(missingPct, mixedTypeKeys.length),
          sourceLocatorPct < 80 ? Math.round(sourceLocatorPct) : 100,
          tableLikeCoverageScore,
        )
      : (sourceLocatorPct < 80
          ? Math.min(Math.round(sourceLocatorPct), tableLikeCoverageScore)
          : (tableLikeCoverageScore < 100 ? tableLikeCoverageScore : null)),
    largeChunkPct,
    emptyTable: false,
  };
}

export async function runArchitecture(ctx: DetectorContext): Promise<ArchitectureResult> {
  const corpus = await runCorpusArchitecture(ctx);
  const findings = [...corpus.findings];
  const catalogSignals = ctx.reader.inspectArchitecture ? await ctx.reader.inspectArchitecture() : [];
  findings.push(...catalogSignals.map(signalToFinding));
  return {
    findings,
    coverageScore: corpus.coverageScore,
    largeChunkPct: corpus.largeChunkPct,
    emptyTable: corpus.emptyTable,
  };
}
