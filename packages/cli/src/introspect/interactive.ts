import type { MappingV1 } from "@chunkfunk/core";
import type { CandidateTable, UserDbReader } from "../db/reader";
import type { Choice, IntrospectPrompts } from "./prompts";

const TEXT_UDTS = new Set(["text", "varchar", "bpchar"]);
const JSON_UDTS = new Set(["jsonb", "json"]);
const TIME_UDTS = new Set(["timestamptz", "timestamp", "date"]);

function columnChoices(table: CandidateTable, predicate: (udt: string) => boolean): Choice[] {
  return table.columns
    .filter((c) => predicate(c.udtName))
    .map((c) => ({ name: `${c.name} (${c.udtName})`, value: c.name }));
}

/**
 * §4.3.4 — interactive column picker used when no recipe matches. Lists tables,
 * then columns per required field, then verifies the chosen mapping by sampling
 * three rows and asking the user to confirm the content looks right.
 */
export async function interactiveMapping(
  reader: UserDbReader,
  tables: CandidateTable[],
  prompts: IntrospectPrompts,
): Promise<{ mapping: MappingV1; embeddingColumn: string }> {
  const tableName = await prompts.select(
    "Which table holds your chunks?",
    tables.map((t) => ({ name: t.qualified, value: t.qualified })),
  );
  const table = tables.find((t) => t.qualified === tableName);
  if (!table) throw new Error(`unknown table: ${tableName}`);

  const embedding = await prompts.select(
    "Which column holds the embedding vector?",
    table.vectorColumns.map((c) => ({ name: c, value: c })),
  );
  const content = await prompts.select(
    "Which column holds the chunk text?",
    columnChoices(table, (udt) => TEXT_UDTS.has(udt)),
  );
  const metadata = await prompts.selectOptional(
    "Which column holds metadata (jsonb)?",
    columnChoices(table, (udt) => JSON_UDTS.has(udt)),
  );
  const sourceUrl = await prompts.selectOptional(
    "Which column holds the source URL?",
    columnChoices(table, (udt) => TEXT_UDTS.has(udt)),
  );
  const updatedAt = await prompts.selectOptional(
    "Which column holds the last-updated timestamp?",
    columnChoices(table, (udt) => TIME_UDTS.has(udt)),
  );

  const preview = await reader.sampleRows(table.qualified, [content], 3);
  const ok = await prompts.confirm(
    `Sample content:\n${preview
      .map((r) => `  - ${String(r[content] ?? "").slice(0, 80)}`)
      .join("\n")}\nDoes this look like your content?`,
    true,
  );
  if (!ok) throw new Error("mapping rejected at preview; re-run to try again");

  return {
    embeddingColumn: embedding,
    mapping: {
      version: 1,
      dialect: "pgvector",
      table: table.qualified,
      columns: {
        content,
        embedding,
        metadata,
        documentId: null,
        sourceUrl,
        updatedAt,
      },
    },
  };
}
