import type { FindingV1 } from "../schemas/report";
import type { JsonValue } from "../schemas/json";
import type { ReportV1 } from "../schemas/report";

export const MAX_EVIDENCE_CHARS = 500;

function capValue(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    return value.length > MAX_EVIDENCE_CHARS ? value.slice(0, MAX_EVIDENCE_CHARS) : value;
  }
  if (Array.isArray(value)) {
    return value.map(capValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = capValue(inner);
    return out;
  }
  return value;
}

/**
 * Caps every string in a finding's evidence (and its suggestedRepair.description)
 * to 500 chars. Shared by the CLI (emit-time cap, §10.4) and the sync API
 * (server-side truncation on ingest, §6 — defense in depth).
 */
export function capFindingEvidence(finding: FindingV1): FindingV1 {
  return {
    ...finding,
    evidence: capValue(finding.evidence) as FindingV1["evidence"],
    suggestedRepair: finding.suggestedRepair
      ? {
          ...finding.suggestedRepair,
          description: finding.suggestedRepair.description.slice(0, MAX_EVIDENCE_CHARS),
        }
      : finding.suggestedRepair,
  };
}

/** Returns a copy of the report with every finding's evidence capped at 500 chars. */
export function capReportEvidence(report: ReportV1): ReportV1 {
  return { ...report, findings: report.findings.map(capFindingEvidence) };
}
