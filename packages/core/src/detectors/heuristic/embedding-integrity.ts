import type { FindingV1 } from "../../schemas/report";
import type { DetectorContext } from "./types";

export interface EmbeddingIntegrityResult {
  findings: FindingV1[];
  nullEmbeddings: number;
  distinctDims: number[];
}

/**
 * §5.6 — count NULL embeddings (warning) and detect mixed embedding dimensions
 * across rows (critical — retrieval is broken). The "dims present but model
 * unknown → info" note is deferred to introspection/PR-12, where the model guess
 * actually exists (see QUESTIONS.md #9).
 */
export async function runEmbeddingIntegrity(
  ctx: DetectorContext,
): Promise<EmbeddingIntegrityResult> {
  let nullEmbeddings = 0;
  const dimCounts = new Map<number, number>();

  for await (const chunk of ctx.reader.streamChunks({ maxChunks: ctx.limits.maxChunks })) {
    if (chunk.embeddingDims === null) {
      nullEmbeddings += 1;
      continue;
    }
    dimCounts.set(chunk.embeddingDims, (dimCounts.get(chunk.embeddingDims) ?? 0) + 1);
  }

  const findings: FindingV1[] = [];
  const distinctDims = [...dimCounts.keys()].sort((a, b) => a - b);

  if (distinctDims.length > 1) {
    findings.push({
      type: "embedding_mixed_dims",
      severity: "critical",
      title: "Embeddings have mixed dimensions — retrieval is broken",
      evidence: {
        dimensions: distinctDims.map((d) => ({ dims: d, count: dimCounts.get(d) ?? 0 })),
      },
      affectedCount: distinctDims.reduce((sum, d) => sum + (dimCounts.get(d) ?? 0), 0),
    });
  }

  if (nullEmbeddings > 0) {
    findings.push({
      type: "embedding_null",
      severity: "warning",
      title: `${nullEmbeddings} chunks have no embedding`,
      evidence: { nullEmbeddings },
      affectedCount: nullEmbeddings,
    });
  }

  return { findings, nullEmbeddings, distinctDims };
}
