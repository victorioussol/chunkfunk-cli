import type { MappingV1 } from "@chunkfunk/core";
import type { CandidateTable, UserDbReader } from "../db/reader";
import { buildFingerprint } from "./fingerprint";
import { interactiveMapping } from "./interactive";
import type { IntrospectPrompts } from "./prompts";
import { guessEmbeddingModel, matchNamedRecipe } from "./recipes";

const TEXT_UDTS = new Set(["text", "varchar", "bpchar"]);
const JSON_UDTS = new Set(["jsonb", "json"]);
const TIME_UDTS = new Set(["timestamptz", "timestamp", "date"]);
const MIN_GENERIC_TEXT_LENGTH = 80;
const MIN_GENERIC_SCORE = 16;
const MIN_GENERIC_SCORE_MARGIN = 6;

interface ScoredTextColumn {
  name: string;
  avgLength: number;
  score: number;
}

interface GenericCandidate {
  mapping: MappingV1;
  score: number;
  estimatedRows: number | null;
}

function columnNamed(table: CandidateTable, names: string[]): string | null {
  const wanted = new Set(names);
  return table.columns.find((c) => wanted.has(c.name))?.name ?? null;
}

function preferredColumn(
  table: CandidateTable,
  predicate: (udt: string) => boolean,
  names: string[],
): string | null {
  const wanted = new Set(names);
  return table.columns.find((c) => predicate(c.udtName) && wanted.has(c.name))?.name
    ?? table.columns.find((c) => predicate(c.udtName))?.name
    ?? null;
}

function contentNameScore(name: string): number {
  const lower = name.toLowerCase();
  if (lower === "content") return 10;
  if (lower === "text" || lower === "document") return 9;
  if (lower === "body" || lower === "body_text") return 6;
  if (lower.includes("chunk") && lower.includes("text")) return 6;
  if (lower === "summary") return 3;
  if (lower === "title" || lower === "path" || lower.endsWith("_hash")) return 0;
  return 2;
}

function tableNameScore(name: string): number {
  const lower = name.toLowerCase();
  let score = 0;
  if (lower === "document_chunks") score += 10;
  else if (lower === "documents") score += 7;
  else if (lower.endsWith("_chunks") || lower.includes("chunk")) score += 5;

  if (lower.includes("cache")) score -= 12;
  if (lower.startsWith("chunkfunk_") || lower.startsWith("sprigkeeper_")) score -= 10;
  return score;
}

function rowEstimateScore(estimatedRows: number | null): number {
  if (estimatedRows === null) return 0;
  if (estimatedRows >= 10_000) return 5;
  if (estimatedRows >= 1_000) return 4;
  if (estimatedRows >= 100) return 3;
  if (estimatedRows > 0) return 1;
  return 0;
}

function chooseEmbeddingColumn(table: CandidateTable): string {
  return table.vectorColumns.find((c) => c === "embedding")
    ?? table.vectorColumns.find((c) => c === "vec")
    ?? table.vectorColumns[0];
}

async function chooseContentColumn(
  reader: UserDbReader,
  table: CandidateTable,
): Promise<ScoredTextColumn | null> {
  const textColumns = table.columns.filter((c) => TEXT_UDTS.has(c.udtName));
  const longColumns: ScoredTextColumn[] = [];
  for (const column of textColumns) {
    const avgLength = await reader.averageTextLength(table.qualified, column.name);
    if (avgLength > MIN_GENERIC_TEXT_LENGTH) {
      longColumns.push({
        name: column.name,
        avgLength,
        score: contentNameScore(column.name),
      });
    }
  }
  if (longColumns.length === 0) return null;

  longColumns.sort((a, b) => b.score - a.score || b.avgLength - a.avgLength || a.name.localeCompare(b.name));
  const best = longColumns[0];
  const runnerUp = longColumns[1];

  // If several long text columns exist, only auto-pick when the name is a
  // strong content signal. This preserves the manual picker for bespoke schemas.
  if (longColumns.length > 1 && best.score < 8) return null;
  if (runnerUp && best.score < 10 && best.score - runnerUp.score < 2) return null;
  if (best.score <= 0) return null;
  return best;
}

async function scoreGenericCandidate(
  reader: UserDbReader,
  table: CandidateTable,
): Promise<GenericCandidate | null> {
  if (table.vectorColumns.length === 0) return null;
  const content = await chooseContentColumn(reader, table);
  if (!content) return null;

  const embedding = chooseEmbeddingColumn(table);
  const metadata = preferredColumn(table, (udt) => JSON_UDTS.has(udt), ["metadata", "cmetadata", "metadata_"]);
  const sourceUrl = preferredColumn(table, (udt) => TEXT_UDTS.has(udt), ["source_url", "url", "page_url"]);
  const documentId = columnNamed(table, ["document_id", "doc_id", "source_id", "node_id"]);
  const updatedAt = preferredColumn(table, (udt) => TIME_UDTS.has(udt), ["updated_at", "modified_at", "created_at"]);

  const score =
    content.score +
    tableNameScore(table.name) +
    rowEstimateScore(table.estimatedRows) +
    (embedding === "embedding" || embedding === "vec" ? 2 : 0) +
    (metadata ? 2 : 0) +
    (sourceUrl ? 1 : 0) +
    (documentId ? 1 : 0) +
    (updatedAt ? 1 : 0);

  return {
    score,
    estimatedRows: table.estimatedRows,
    mapping: {
      version: 1,
      dialect: "pgvector",
      table: table.qualified,
      columns: {
        content: content.name,
        embedding,
        metadata,
        documentId,
        sourceUrl,
        updatedAt,
      },
    },
  };
}

export interface IntrospectResult {
  mapping: MappingV1;
  fingerprintHash: string;
  frameworkGuess: string | null;
  embeddingDims: number | null;
  embeddingModelGuess: string | null;
  /** Recipe id, `generic-single-table`, or `manual`. */
  recipeId: string;
}

export interface StackMeta {
  fingerprintHash: string;
  frameworkGuess: string | null;
  embeddingDims: number | null;
  embeddingModelGuess: string | null;
}

/**
 * Gathers the stack metadata a ReportV1 needs (§3.1) when a mapping already
 * exists in chunkfunk.yaml and full introspection is skipped: fingerprint hash,
 * a best-effort framework guess, and the embedding dims/model guess.
 */
export async function stackMetaForMapping(
  reader: UserDbReader,
  mapping: MappingV1,
): Promise<StackMeta> {
  const tables = await reader.listCandidateTables();
  const { hash } = await buildFingerprint(reader, tables);
  const named = matchNamedRecipe(tables);
  const frameworkGuess =
    named && named.mapping.table === mapping.table ? named.frameworkGuess : null;
  const embeddingDims = await reader.embeddingDimensions(
    mapping.table,
    mapping.columns.embedding,
  );
  return {
    fingerprintHash: hash,
    frameworkGuess,
    embeddingDims,
    embeddingModelGuess: guessEmbeddingModel(embeddingDims),
  };
}

/**
 * §4.3.5 (generic mapping) — proposes a mapping only when one candidate clearly
 * looks like the primary RAG chunk table. Multiple vector tables are allowed
 * when cache/internal tables can be confidently deprioritized; ambiguous
 * schemas still fall to the interactive picker.
 */
async function matchGeneric(
  reader: UserDbReader,
  tables: CandidateTable[],
): Promise<MappingV1 | null> {
  const candidates: GenericCandidate[] = [];
  for (const table of tables) {
    const candidate = await scoreGenericCandidate(reader, table);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      (b.estimatedRows ?? -1) - (a.estimatedRows ?? -1) ||
      a.mapping.table.localeCompare(b.mapping.table),
  );

  const best = candidates[0];
  const runnerUp = candidates[1];
  if (best.score < MIN_GENERIC_SCORE) return null;
  if (runnerUp && best.score - runnerUp.score < MIN_GENERIC_SCORE_MARGIN) return null;
  return best.mapping;
}

/**
 * Introspects the connected database into a MappingV1 (§4.3): fingerprint →
 * named recipes → generic single-table → interactive picker. A recipe hit still
 * asks for a one-line confirmation unless `yes` is set.
 */
export async function introspect(
  reader: UserDbReader,
  opts: { yes?: boolean; prompts: IntrospectPrompts; allowInteractive?: boolean },
): Promise<IntrospectResult> {
  const tables = await reader.listCandidateTables();
  if (tables.length === 0) {
    throw new Error("No pgvector tables found in this database.");
  }

  const { hash } = await buildFingerprint(reader, tables);

  let mapping: MappingV1 | null = null;
  let recipeId = "manual";
  let frameworkGuess: string | null = null;

  const named = matchNamedRecipe(tables);
  if (named) {
    const accept = opts.yes
      ? true
      : await opts.prompts.confirm(
          `Detected a ${named.frameworkGuess} layout in ${named.mapping.table}. Use this mapping?`,
          true,
        );
    if (accept) {
      mapping = named.mapping;
      recipeId = named.recipeId;
      frameworkGuess = named.frameworkGuess;
    }
  }

  if (mapping === null) {
    const generic = await matchGeneric(reader, tables);
    if (generic) {
      const accept = opts.yes
        ? true
        : await opts.prompts.confirm(
            `Propose content='${generic.columns.content}', embedding='${generic.columns.embedding}' in ${generic.table}. Use this mapping?`,
            true,
          );
      if (accept) {
        mapping = generic;
        recipeId = "generic-single-table";
        frameworkGuess = "custom";
      }
    }
  }

  if (mapping === null) {
    if (opts.allowInteractive === false) {
      throw new Error("Cannot map this database non-interactively; run chunkfunk init first.");
    }
    const interactive = await interactiveMapping(reader, tables, opts.prompts);
    mapping = interactive.mapping;
    recipeId = "manual";
    frameworkGuess = "custom";
  }

  const embeddingDims = await reader.embeddingDimensions(
    mapping.table,
    mapping.columns.embedding,
  );

  return {
    mapping,
    fingerprintHash: hash,
    frameworkGuess,
    embeddingDims,
    embeddingModelGuess: guessEmbeddingModel(embeddingDims),
    recipeId,
  };
}
