import type { MappingV1 } from "@chunkfunk/core";
import type { CandidateTable, UserDbReader } from "../db/reader";
import { buildFingerprint } from "./fingerprint";
import { interactiveMapping } from "./interactive";
import type { IntrospectPrompts } from "./prompts";
import { guessEmbeddingModel, matchNamedRecipe } from "./recipes";

const TEXT_UDTS = new Set(["text", "varchar", "bpchar"]);
const JSON_UDTS = new Set(["jsonb", "json"]);
const MIN_GENERIC_TEXT_LENGTH = 80;

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
 * §4.3.5 (generic-single-table) — proposes a mapping only when exactly one
 * candidate table has exactly one vector column and exactly one text-like column
 * whose sampled average length exceeds 80 chars. Anything more ambiguous falls
 * to the interactive picker.
 */
async function matchGeneric(
  reader: UserDbReader,
  tables: CandidateTable[],
): Promise<MappingV1 | null> {
  const singleVector = tables.filter((t) => t.vectorColumns.length === 1);
  if (singleVector.length !== 1) return null;
  const table = singleVector[0];

  const textColumns = table.columns.filter((c) => TEXT_UDTS.has(c.udtName));
  const longColumns: string[] = [];
  for (const column of textColumns) {
    const avg = await reader.averageTextLength(table.qualified, column.name);
    if (avg > MIN_GENERIC_TEXT_LENGTH) longColumns.push(column.name);
  }
  if (longColumns.length !== 1) return null;

  const metadata = table.columns.find((c) => JSON_UDTS.has(c.udtName))?.name ?? null;
  return {
    version: 1,
    dialect: "pgvector",
    table: table.qualified,
    columns: {
      content: longColumns[0],
      embedding: table.vectorColumns[0],
      metadata,
      documentId: null,
      sourceUrl: null,
      updatedAt: null,
    },
  };
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
