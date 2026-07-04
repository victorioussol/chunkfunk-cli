import type { FindingV1 } from "../../schemas/report";
import type { DetectorContext } from "./types";

const MAX_FINDINGS = 500;

/** Secret patterns (§5.4). Each match is REDACTED before it reaches evidence. */
const SECRET_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "openai_key", re: /sk-[a-zA-Z0-9]{20,}/g },
  { id: "aws_access_key", re: /AKIA[0-9A-Z]{16}/g },
  { id: "private_key", re: /-----BEGIN[A-Z ]*PRIVATE KEY-----/g },
  { id: "slack_token", re: /xox[bp]-[a-zA-Z0-9-]+/g },
];

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const MARKERS = /\b(TODO|DRAFT|DEPRECATED|INTERNAL ONLY|DO NOT SHARE)\b/g;
const EMAIL_MASS_THRESHOLD = 3;

/** Show only the first 4 chars of a secret, per §5.4 / reviewer checklist #4. */
function redact(secret: string): string {
  return `${secret.slice(0, 4)}…`;
}

export interface RiskyChunkResult {
  findings: FindingV1[];
  criticalCount: number;
  warningCount: number;
}

/**
 * §5.4 — regex battery for secrets (critical, redacted in evidence), en-masse
 * emails and risk markers (warning). Operates on the 500-char content sample;
 * evidence never contains a raw secret or connection string.
 */
export async function runRiskyChunk(ctx: DetectorContext): Promise<RiskyChunkResult> {
  const findings: FindingV1[] = [];
  let criticalCount = 0;
  let warningCount = 0;

  for await (const chunk of ctx.reader.streamChunks({ maxChunks: ctx.limits.maxChunks })) {
    const sample = chunk.contentSample;

    const secretHits: { pattern: string; redacted: string }[] = [];
    for (const { id, re } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(sample)) !== null) {
        secretHits.push({ pattern: id, redacted: redact(match[0]) });
      }
    }
    if (secretHits.length > 0) {
      criticalCount += 1;
      if (findings.length < MAX_FINDINGS) {
        findings.push({
          type: "risky_chunk",
          severity: "critical",
          title: "Chunk contains what looks like a secret",
          evidence: { ref: chunk.ref, kind: "secret", matches: secretHits },
          affectedCount: 1,
        });
      }
      continue; // one finding per chunk; secret dominates
    }

    const emails = sample.match(EMAIL);
    const markers = sample.match(MARKERS);
    if ((emails && emails.length > EMAIL_MASS_THRESHOLD) || markers) {
      warningCount += 1;
      if (findings.length < MAX_FINDINGS) {
        const evidence: Record<string, string | number | string[]> = {
          ref: chunk.ref,
          kind: markers ? "marker" : "emails",
        };
        if (markers) evidence.markers = Array.from(new Set(markers));
        else if (emails) evidence.emailCount = emails.length;
        findings.push({
          type: "risky_chunk",
          severity: "warning",
          title: markers ? "Chunk contains a risk marker" : "Chunk contains many email addresses",
          evidence,
          affectedCount: 1,
        });
      }
    }
  }

  return { findings, criticalCount, warningCount };
}
