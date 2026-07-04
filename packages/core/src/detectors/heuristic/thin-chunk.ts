import type { FindingV1 } from "../../schemas/report";
import type { DetectorContext } from "./types";

const WARNING_CORPUS_PCT = 15;
const MAX_FINDINGS = 500;

const URL_TOKEN = /^(https?:\/\/|www\.)/i;
const SEPARATOR_TOKEN = /^[|›»·•\-—/>\\]+$/;
const BULLET_START = /^\s*([-*•]|\d+[.)])\s/;
const SENTENCE_TERMINATOR = /[.!?:;)"'\]]$/;

type ThinReason = "short" | "linkDensity" | "midSentence";

/** Ratio of URL/menu-separator tokens to total tokens in the sample. */
function linkNavDensity(sample: string): number {
  const tokens = sample.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return 0;
  let nav = 0;
  for (const token of tokens) {
    if (URL_TOKEN.test(token) || SEPARATOR_TOKEN.test(token)) nav += 1;
  }
  return nav / tokens.length;
}

/** True when the text neither starts like a sentence/bullet nor ends terminated. */
function startsAndEndsMidSentence(sample: string): boolean {
  const trimmed = sample.trim();
  if (trimmed.length === 0) return false;
  const startsMid = !BULLET_START.test(trimmed) && trimmed[0] !== trimmed[0].toUpperCase();
  const endsMid = !SENTENCE_TERMINATOR.test(trimmed);
  return startsMid && endsMid;
}

export interface ThinChunkResult {
  findings: FindingV1[];
  thinCount: number;
  corpusPct: number;
}

/**
 * §5.3 — a chunk is thin when its normalized length is below the threshold, OR
 * its link/nav density exceeds the threshold, OR it both starts mid-word and ends
 * mid-sentence. Severity is info, escalating to warning when > 15% of the corpus
 * is thin.
 */
export async function runThinChunk(ctx: DetectorContext): Promise<ThinChunkResult> {
  const { thinChunkMinChars, linkNavDensity: densityThreshold } = ctx.thresholds;
  const flagged: { ref: string; reason: ThinReason; length: number; excerpt: string }[] = [];
  let thinCount = 0;

  for await (const chunk of ctx.reader.streamChunks({ maxChunks: ctx.limits.maxChunks })) {
    let reason: ThinReason | null = null;
    if (chunk.length < thinChunkMinChars) reason = "short";
    else if (linkNavDensity(chunk.contentSample) > densityThreshold) reason = "linkDensity";
    else if (startsAndEndsMidSentence(chunk.contentSample)) reason = "midSentence";
    if (reason === null) continue;
    thinCount += 1;
    if (flagged.length < MAX_FINDINGS) {
      flagged.push({
        ref: chunk.ref,
        reason,
        length: chunk.length,
        excerpt: chunk.contentSample.slice(0, 500),
      });
    }
  }

  const corpusPct = ctx.totalChunks > 0 ? (thinCount / ctx.totalChunks) * 100 : 0;
  const severity = corpusPct > WARNING_CORPUS_PCT ? "warning" : "info";
  const findings: FindingV1[] = flagged.map((f) => ({
    type: "thin_chunk",
    severity,
    title: `Thin chunk (${f.reason})`,
    evidence: {
      ref: f.ref,
      reason: f.reason,
      length: f.length,
      excerpt: f.excerpt,
      corpusPct: Number(corpusPct.toFixed(1)),
      truncatedFindings: thinCount > MAX_FINDINGS,
    },
    affectedCount: 1,
  }));

  return { findings, thinCount, corpusPct };
}
