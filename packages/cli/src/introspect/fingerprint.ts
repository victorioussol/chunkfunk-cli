import { sha256Canonical } from "../util/hash";
import type { CandidateTable, UserDbReader } from "../db/reader";

interface FingerprintTable {
  table: string;
  columns: { name: string; type: string }[];
  jsonKeys: Record<string, string[]>;
}

/**
 * §4.3.2 — a canonical, sorted description of the candidate tables (columns +
 * sampled jsonb top-level keys). The sha256 of its JSON is the stack fingerprint,
 * stable across runs against the same schema and used by the recipe flywheel
 * (PR-11).
 */
export async function buildFingerprint(
  reader: UserDbReader,
  tables: CandidateTable[],
): Promise<{ fingerprint: FingerprintTable[]; hash: string }> {
  const fingerprint: FingerprintTable[] = [];

  for (const table of [...tables].sort((a, b) => a.qualified.localeCompare(b.qualified))) {
    const jsonKeys: Record<string, string[]> = {};
    for (const column of table.columns) {
      if (column.udtName === "jsonb" || column.udtName === "json") {
        const keys = await reader.sampleJsonKeys(table.qualified, column.name);
        jsonKeys[column.name] = keys.sort();
      }
    }
    fingerprint.push({
      table: table.qualified,
      columns: [...table.columns]
        .map((c) => ({ name: c.name, type: c.udtName }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      jsonKeys,
    });
  }

  return { fingerprint, hash: sha256Canonical(fingerprint) };
}
