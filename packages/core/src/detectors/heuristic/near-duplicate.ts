import type { FindingV1 } from "../../schemas/report";
import type { DetectorContext } from "./types";

export interface NearDuplicateResult {
  findings: FindingV1[];
  /** Unique near-duplicate pairs found. */
  pairs: number;
  /** Number of chunks probed. */
  probes: number;
  /** pairs / probes * 100. */
  estimatedCorpusPct: number;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * §5.2 — server-side pgvector probe of up to `nearDupProbes` chunks for their
 * single nearest neighbor. A pair is a near-duplicate when cosine ≥ threshold and
 * the two are NOT exact duplicates (different content hashes). Pairs are
 * de-duplicated so A↔B is counted once.
 */
export async function runNearDuplicate(
  ctx: DetectorContext,
): Promise<NearDuplicateResult> {
  const threshold = ctx.thresholds.nearDuplicateCosine;
  const seen = new Set<string>();
  const probedRefs = new Set<string>();
  const findings: FindingV1[] = [];

  for await (const pair of ctx.reader.probeNearestNeighbors(ctx.limits.nearDupProbes)) {
    probedRefs.add(pair.ref);
    if (pair.similarity < threshold) continue;
    // Exclude exact duplicates — those belong to the exact-duplicate detector.
    if (pair.refContentHash === pair.neighborContentHash) continue;
    const key = pairKey(pair.ref, pair.neighborRef);
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      type: "near_duplicate",
      severity: "warning",
      title: "Two chunks are near-duplicates",
      evidence: {
        refs: [pair.ref, pair.neighborRef],
        similarity: Number(pair.similarity.toFixed(4)),
        threshold,
      },
      affectedCount: 2,
    });
  }

  const pairs = seen.size;
  const probes = probedRefs.size;
  const estimatedCorpusPct = probes > 0 ? (pairs / probes) * 100 : 0;
  return { findings, pairs, probes, estimatedCorpusPct };
}
