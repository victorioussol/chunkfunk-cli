import type { FindingV1 } from "../../schemas/report";
import type { DetectorContext } from "./types";

const MAX_REFS_PER_GROUP = 5;
const CORPUS_CRITICAL_PCT = 5;

export interface ExactDuplicateResult {
  findings: FindingV1[];
  /** Number of exact-duplicate groups (hash seen ≥ 2 times). */
  groups: number;
  /** Total member rows across all duplicate groups. */
  memberRows: number;
  /** memberRows / totalChunks * 100. */
  corpusPct: number;
}

interface GroupState {
  count: number;
  refs: string[];
}

/**
 * §5.1 — normalize → sha256 (done by the reader) → group by hash. Memory-safe:
 * per distinct hash we keep only a count + up to 5 refs. Emits one warning per
 * group plus a corpus-wide critical summary when > 5% of the corpus sits in
 * duplicate groups. Evidence never includes chunk text.
 */
export async function runExactDuplicate(
  ctx: DetectorContext,
): Promise<ExactDuplicateResult> {
  const groups = new Map<string, GroupState>();

  for await (const chunk of ctx.reader.streamChunks({ maxChunks: ctx.limits.maxChunks })) {
    const existing = groups.get(chunk.contentHash);
    if (!existing) {
      groups.set(chunk.contentHash, { count: 1, refs: [chunk.ref] });
      continue;
    }
    existing.count += 1;
    if (existing.refs.length < MAX_REFS_PER_GROUP) existing.refs.push(chunk.ref);
  }

  const findings: FindingV1[] = [];
  let groupCount = 0;
  let memberRows = 0;

  for (const group of groups.values()) {
    if (group.count < 2) continue;
    groupCount += 1;
    memberRows += group.count;
    findings.push({
      type: "exact_duplicate",
      severity: "warning",
      title: `${group.count} chunks are exact duplicates`,
      evidence: {
        duplicateChunks: group.count,
        refs: group.refs,
        sampled: ctx.sampled ?? false,
      },
      affectedCount: group.count,
    });
  }

  const corpusPct = ctx.totalChunks > 0 ? (memberRows / ctx.totalChunks) * 100 : 0;
  if (corpusPct > CORPUS_CRITICAL_PCT) {
    findings.push({
      type: "exact_duplicate",
      severity: "critical",
      title: `${corpusPct.toFixed(1)}% of the corpus is exact-duplicated`,
      evidence: {
        summary: true,
        duplicateGroups: groupCount,
        duplicatedChunks: memberRows,
        corpusPct: Number(corpusPct.toFixed(1)),
        sampled: ctx.sampled ?? false,
      },
      affectedCount: memberRows,
    });
  }

  return { findings, groups: groupCount, memberRows, corpusPct };
}
